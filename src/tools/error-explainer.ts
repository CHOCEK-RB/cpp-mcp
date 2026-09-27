// src/tools/error-explainer.ts
// Intelligent diagnostic parser and explainer for complex C++ compiler and linker errors.

import * as fs from "node:fs";
import * as path from "node:path";
import { demangleSymbol } from "./demangle.js";
import { lookupHeader } from "./header.js";

export type ErrorCategory =
  | "template_instantiation"
  | "concept_constraint"
  | "linker_undefined_reference"
  | "linker_multiple_definition"
  | "vtable_missing"
  | "cxx_modules"
  | "const_correctness"
  | "move_copy_violation"
  | "incomplete_type"
  | "missing_include"
  | "general";

export type DetectedCompiler = "gcc" | "clang" | "msvc" | "generic";

export interface ExplainCompilerErrorParams {
  error: string;
  compiler?: "gcc" | "clang" | "msvc" | "auto";
  codeSnippet?: string;
  workspaceDir?: string;
}

export interface ErrorLocation {
  file: string;
  line?: number;
  column?: number;
}

export interface ExplainedCompilerErrorResult {
  success: boolean;
  category: ErrorCategory;
  detectedCompiler: DetectedCompiler;
  summary: string;
  location?: ErrorLocation;
  codeSnippet?: string;
  rootCause: string;
  remediation: string;
  suggestedHeaders?: string[];
  demangledSymbols?: Array<{
    mangled: string;
    demangled: string;
  }>;
  simplifiedError: string;
  pitfalls?: string[];
}

function stripAnsi(text: string): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI escape code stripping requires matching \x1b
  return text.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "");
}

function detectCompiler(errorText: string, hint?: string): DetectedCompiler {
  if (hint && hint !== "auto") {
    if (hint === "gcc" || hint === "clang" || hint === "msvc") {
      return hint;
    }
  }

  if (/(?:fatal\s+)?error\s*(?:C\d{4}|LNK\d{4})/i.test(errorText) || /MSVC/i.test(errorText)) {
    return "msvc";
  }
  if (
    /clang(?:-\d+)?:\s*error/i.test(errorText) ||
    /candidate template ignored:/i.test(errorText)
  ) {
    return "clang";
  }
  if (/g\+\+:\s*error/i.test(errorText) || /in instantiation of/i.test(errorText)) {
    return "gcc";
  }

  return "generic";
}

function extractLocation(errorText: string): ErrorLocation | undefined {
  // Pattern 1: Unix GCC/Clang format: /path/to/My Project/file.cpp:42:15: error: ...
  const unixMatch = errorText.match(
    /(?:^|\n)\s*((?:[a-zA-Z]:[\\/])?[^\n\r:]+?\.[a-zA-Z0-9]+):(\d+)(?::(\d+))?:\s*(?:fatal\s+)?(?:error|warning):/i,
  );
  if (unixMatch?.[1] && unixMatch[2]) {
    return {
      file: unixMatch[1].trim(),
      line: Number.parseInt(unixMatch[2], 10),
      column: unixMatch[3] ? Number.parseInt(unixMatch[3], 10) : undefined,
    };
  }

  // Pattern 2: MSVC format: C:\My Project\file.cpp(42,15): fatal error C1083: ...
  const msvcMatch = errorText.match(
    /(?:^|\n)\s*((?:[a-zA-Z]:[\\/])?[^\n\r()]+\.[a-zA-Z0-9]+)\((\d+)(?:,\s*(\d+))?\)\s*:\s*(?:fatal\s+)?error\s*(?:C\d+|LNK\d+):/i,
  );
  if (msvcMatch?.[1] && msvcMatch[2]) {
    return {
      file: msvcMatch[1].trim(),
      line: Number.parseInt(msvcMatch[2], 10),
      column: msvcMatch[3] ? Number.parseInt(msvcMatch[3], 10) : undefined,
    };
  }

  return undefined;
}

function resolveCodeSnippet(
  paramsSnippet: string | undefined,
  location: ErrorLocation | undefined,
  workspaceDir: string | undefined,
): string | undefined {
  if (paramsSnippet?.trim()) {
    return paramsSnippet.trim();
  }

  if (!location?.file || !location.line) {
    return undefined;
  }

  try {
    let resolvedFile = location.file;
    if (!path.isAbsolute(resolvedFile)) {
      if (workspaceDir) {
        resolvedFile = path.resolve(workspaceDir, resolvedFile);
      } else {
        resolvedFile = path.resolve(process.cwd(), resolvedFile);
      }
    }

    if (!fs.existsSync(resolvedFile) || !fs.statSync(resolvedFile).isFile()) {
      return undefined;
    }

    const content = fs.readFileSync(resolvedFile, "utf-8");
    const lines = content.split(/\r?\n/);
    const targetLineIdx = location.line - 1;
    if (targetLineIdx < 0 || targetLineIdx >= lines.length) {
      return undefined;
    }

    const startIdx = Math.max(0, targetLineIdx - 2);
    const endIdx = Math.min(lines.length - 1, targetLineIdx + 2);
    const lineNumWidth = String(endIdx + 1).length;

    const snippetLines: string[] = [];
    for (let i = startIdx; i <= endIdx; i++) {
      const lineNum = String(i + 1).padStart(lineNumWidth, " ");
      const isTarget = i === targetLineIdx;
      const prefix = isTarget ? "> " : "  ";
      snippetLines.push(`${prefix}${lineNum} | ${lines[i]}`);
      if (isTarget && location.column && location.column > 0) {
        const caretPad = " ".repeat(
          prefix.length + lineNumWidth + 3 + Math.max(0, location.column - 1),
        );
        snippetLines.push(`${caretPad}^`);
      }
    }

    return snippetLines.join("\n");
  } catch {
    return undefined;
  }
}

function simplifyTypeNoise(text: string): string {
  return text
    .replace(/std::(?:__1|__cxx11)::/g, "std::")
    .replace(
      /std::basic_string<char,\s*std::char_traits<char>,\s*std::allocator<char>\s*>/g,
      "std::string",
    )
    .replace(/std::basic_string_view<char,\s*std::char_traits<char>\s*>/g, "std::string_view")
    .replace(/std::allocator<[^>]+>/g, "std::allocator")
    .replace(/std::vector<([^,>]+),\s*std::allocator>/g, "std::vector<$1>");
}

export async function explainCompilerError(
  params: ExplainCompilerErrorParams,
): Promise<ExplainedCompilerErrorResult> {
  const unstripped = params.error?.trim();
  if (!unstripped) {
    throw new Error("Compiler error text cannot be empty.");
  }

  const rawError = stripAnsi(unstripped);
  const detectedCompiler = detectCompiler(rawError, params.compiler);
  const location = extractLocation(rawError);
  const codeSnippet = resolveCodeSnippet(params.codeSnippet, location, params.workspaceDir);

  // 1. Demangle any mangled symbols present in the error output
  const demangleRes = demangleSymbol({ symbol: rawError });
  const demangledText = demangleRes.demangled;
  const demangledSymbols = demangleRes.extractedSymbols?.map((s) => ({
    mangled: s.mangled,
    demangled: s.demangled,
  }));

  const cleanedText = simplifyTypeNoise(demangledText);

  // 2. Identify Category & Diagnostic Details
  let category: ErrorCategory = "general";
  let summary = "";
  let rootCause = "";
  let remediation = "";
  const pitfalls: string[] = [];
  const suggestedHeaders: string[] = [];

  // Check 1: Missing Vtable / Virtual functions
  if (
    /undefined reference to [`']?vtable for\s+([^'\n]+)/i.test(cleanedText) ||
    /unresolved external symbol.*__vftable/i.test(cleanedText) ||
    /unresolved external symbol.*`vftable'/i.test(cleanedText)
  ) {
    category = "vtable_missing";
    const match = cleanedText.match(/vtable for\s+([a-zA-Z0-9_:]+)/i);
    const className = match?.[1] ?? "your class";

    summary = `Missing virtual method implementation causing unsatisfied vtable for '${className}'.`;
    rootCause = `In C++, if a class declares one or more virtual functions (commonly the virtual destructor or the first virtual method) without a definition, the compiler cannot generate the virtual function table (vtable) and the linker fails.`;
    remediation =
      `1. Check '${className}' in its header and ensure all virtual methods have an implementation body.\n` +
      `2. If a virtual destructor is declared (\`virtual ~${className.split("::").pop()}();\`), ensure it is implemented or define it inline: \`virtual ~${className.split("::").pop()}() = default;\`.\n` +
      `3. If any pure virtual method (\`= 0\`) was intended, verify it has \`= 0;\`.`;
    pitfalls.push(
      "Declaring `virtual ~Class();` in header without adding `Class::~Class() {}` in the .cpp file.",
    );
  }

  // Check 2: Linker Undefined Reference / Unresolved External
  else if (
    /undefined reference to [`']?([^'\n]+)/i.test(cleanedText) ||
    /error LNK2019: unresolved external symbol/i.test(cleanedText) ||
    /error LNK2001: unresolved external symbol/i.test(cleanedText) ||
    /Undefined symbols for architecture/i.test(cleanedText)
  ) {
    category = "linker_undefined_reference";
    const refMatch =
      cleanedText.match(/undefined reference to [`']?([^'\n]+)/i) ||
      cleanedText.match(/unresolved external symbol\s+["`']?([^"'\n]+)/i);
    const missingSymbol = refMatch?.[1]?.trim() ?? "symbol";

    summary = `Linker error: undefined reference to '${missingSymbol}'.`;
    rootCause = `The declaration for '${missingSymbol}' was visible during compilation, but its compiled object code was not found during linking.`;
    remediation =
      `1. Missing source file: Check if the .cpp containing '${missingSymbol}' is included in your build (e.g. \`add_files("src/*.cpp")\` in xmake.lua or \`target_sources\` in CMakeLists.txt).\n` +
      `2. Missing library: If '${missingSymbol}' belongs to a third-party library, verify the package is linked (\`add_packages("pkg")\` in xmake or \`target_link_libraries\` in CMake).\n` +
      `3. Template in .cpp: If '${missingSymbol}' is a template function/class, its definition must reside in a header file, not a .cpp file.\n` +
      `4. Static member: If '${missingSymbol}' is a class static member, define it in a .cpp file.`;
    pitfalls.push("Writing template function definitions in .cpp files instead of header files.");
    pitfalls.push("Forgetting to add a newly created .cpp file to the build system target.");
  }

  // Check 3: Linker Multiple Definition / Duplicate Symbols
  else if (
    /multiple definition of [`']?([^'\n]+)/i.test(cleanedText) ||
    /error LNK2005:\s+([^'\n]+) already defined/i.test(cleanedText) ||
    /error LNK1169:\s+one or more multiply defined symbols/i.test(cleanedText) ||
    /duplicate symbol/i.test(cleanedText)
  ) {
    category = "linker_multiple_definition";
    const dupMatch =
      cleanedText.match(/multiple definition of [`']?([^'\n]+)/i) ||
      cleanedText.match(/error LNK2005:\s+([^'\n]+) already defined/i);
    const dupSymbol = dupMatch?.[1]?.trim() ?? "symbol";

    summary = `Linker error: duplicate/multiple definition of '${dupSymbol}'.`;
    rootCause = `A non-inline function or non-template global variable has its body defined in a header file that was included by multiple translation units (.cpp files), violating the One Definition Rule (ODR).`;
    remediation =
      `1. Add the \`inline\` keyword if defined in a header: \`inline void ${dupSymbol}() { ... }\`.\n` +
      `2. Or move the function body into a single .cpp file and leave only the declaration in the header.\n` +
      `3. For variables in headers: use \`inline constexpr\` (C++17+) or declare \`extern int x;\` in header and \`int x = 0;\` in a .cpp file.`;
    pitfalls.push(
      "Defining non-inline functions directly in header files included by more than one .cpp.",
    );
  }

  // Check 4: C++20 Concepts & Constraint Failures
  else if (
    /constraints not satisfied/i.test(cleanedText) ||
    /concept [`']?([^'\n]+)[`']? was not satisfied/i.test(cleanedText) ||
    /the associated constraints are not satisfied/i.test(cleanedText) ||
    /evaluated to false/i.test(cleanedText)
  ) {
    category = "concept_constraint";
    const conceptMatch = cleanedText.match(/concept [`']?([a-zA-Z0-9_:]+)[`']?/i);
    const conceptName = conceptMatch?.[1] ?? "C++20 Concept";

    summary = `C++20 Concept constraint failure: '${conceptName}' was not satisfied.`;
    rootCause = `A template requires '${conceptName}', but the provided type argument does not satisfy one or more required operations, member types, or traits.`;
    remediation =
      `1. Inspect the notes section in the error to locate which requirement evaluated to \`false\`.\n` +
      `2. Common checks: verify copyability/movability, presence of \`begin()\`/\`end()\` for ranges, or correct parameter signatures for callables.\n` +
      `3. Adapt the type or adjust the concept requirements.`;
    pitfalls.push("Passing a move-only type where a concept requires copy-constructible.");
  }

  // Check 5: C++20 Modules Errors
  else if (
    /module [`']?([^'\n]+)[`']? not found/i.test(cleanedText) ||
    /fatal error: module file [`']?([^'\n]+)[`']? not found/i.test(cleanedText) ||
    /BMI file for module/i.test(cleanedText) ||
    /export module/i.test(cleanedText)
  ) {
    category = "cxx_modules";
    const modMatch = cleanedText.match(/module (?:file )?[`']?([a-zA-Z0-9_.:]+)[`']?/i);
    const modName = modMatch?.[1] ?? "module";

    summary = `C++20 Module error: '${modName}' could not be resolved or compiled.`;
    rootCause = `The build system has not compiled the primary module interface (BMI) for '${modName}' before compiling the importer, or module support is not enabled in the build configuration.`;
    remediation =
      `1. In Xmake: Ensure \`set_policy("build.c++.modules", true)\` is enabled on the target and that module files (.mpp or .cppm) are added to \`add_files\`. \n` +
      `2. In CMake: Ensure CMake 3.28+ is used with \`FILE_SET CXX_MODULES\`.\n` +
      `3. Verify there are no circular module imports (e.g. A imports B and B imports A).`;
    pitfalls.push('Missing `set_policy("build.c++.modules", true)` in xmake.lua.');
    pitfalls.push("Circular dependencies between C++20 module interfaces.");
  }

  // Check 6: Const Correctness / Discarding Qualifiers
  else if (
    /discards qualifiers/i.test(cleanedText) ||
    /cannot bind non-const lvalue reference/i.test(cleanedText) ||
    /drops ['`]?const['`]? qualifier/i.test(cleanedText) ||
    /cannot be called on a const object/i.test(cleanedText)
  ) {
    category = "const_correctness";
    summary = `Const-correctness violation: operation discards 'const' qualifiers.`;
    rootCause = `Attempting to call a non-const member function on a const object/reference, or binding a temporary rvalue to a non-const lvalue reference (T&).`;
    remediation =
      `1. If the member function does not modify state, mark it \`const\`: \`void print() const;\`.\n` +
      `2. If passing a temporary value into a function, change the parameter to \`const T&\` or \`T\` (by value) or \`T&&\` (rvalue reference).\n` +
      `3. If the object was intended to be mutable, remove the \`const\` specifier from the variable or parameter.`;
    pitfalls.push(
      "Passing temporary literals or function return values into `void fn(std::string& s)` instead of `const std::string&`.",
    );
  }

  // Check 7: Move / Copy / Deleted Function
  else if (
    /use of deleted function/i.test(cleanedText) ||
    /call to implicitly-deleted copy constructor/i.test(cleanedText) ||
    /attempt to use a deleted function/i.test(cleanedText) ||
    /cannot be referenced -- it is a deleted function/i.test(cleanedText)
  ) {
    category = "move_copy_violation";
    summary = `Attempting to use an implicitly or explicitly deleted copy/move constructor.`;
    rootCause = `The class is move-only (such as std::unique_ptr, std::mutex, or a class containing them) or has explicitly deleted its copy constructor with \`= delete\`, but code attempts to copy it.`;
    remediation =
      `1. Use \`std::move(obj)\` to transfer ownership instead of copying.\n` +
      `2. Pass by reference (\`const T&\` or \`T&\`) rather than by value if copying was not intended.\n` +
      `3. If shared ownership is truly required, use \`std::shared_ptr\` instead of \`std::unique_ptr\`.`;
    pitfalls.push(
      "Storing `std::unique_ptr` in a struct and trying to copy the struct without `std::move`.",
    );
  }

  // Check 8: Incomplete Type
  else if (
    /invalid use of incomplete type/i.test(cleanedText) ||
    /has incomplete type/i.test(cleanedText) ||
    /forward declaration of/i.test(cleanedText) ||
    /definition of incomplete type/i.test(cleanedText)
  ) {
    category = "incomplete_type";
    const incMatch = cleanedText.match(
      /incomplete type ['`]?\s*(?:class|struct|enum)?\s*([a-zA-Z0-9_:]+)['`]?/i,
    );
    const incType = incMatch?.[1] ?? "type";

    summary = `Incomplete type error for '${incType}'.`;
    rootCause = `The type '${incType}' was only forward-declared, but the compiler requires its complete definition (e.g. to call a member, instantiate a member variable, or determine \`sizeof\`).`;
    remediation =
      `1. Include the header file that fully defines '${incType}'.\n` +
      `2. If using forward declarations in a header, move member access into the .cpp file where the full header is included.`;
    pitfalls.push(
      "Using `unique_ptr<IncompleteType>` in a class where the destructor is defined in the header without the complete type definition.",
    );
  }

  // Check 9: Missing Include / Undeclared Identifier / Missing Header File
  else if (
    /was not declared in this scope/i.test(cleanedText) ||
    /use of undeclared identifier/i.test(cleanedText) ||
    /identifier ['`]?([a-zA-Z0-9_]+)['`]? is undefined/i.test(cleanedText) ||
    /Cannot open include file/i.test(cleanedText) ||
    /fatal error:.*No such file or directory/i.test(cleanedText) ||
    /['"<][^'">\n]+['">]\s*file not found/i.test(cleanedText) ||
    /fatal error C1083/i.test(cleanedText)
  ) {
    category = "missing_include";

    if (
      /Cannot open include file/i.test(cleanedText) ||
      /No such file or directory/i.test(cleanedText) ||
      /file not found/i.test(cleanedText) ||
      /fatal error C1083/i.test(cleanedText)
    ) {
      const fileMatch =
        cleanedText.match(/Cannot open include file:\s*['"<]?([^'">\n:]+)['">]?/i) ||
        cleanedText.match(/fatal error:\s*([^':\n]+):\s*No such file or directory/i) ||
        cleanedText.match(/['"<]([^'">\n]+)['">]\s*file not found/i);
      const missingFile = fileMatch?.[1]?.trim() ?? "header file";

      summary = `Missing header file '${missingFile}'.`;
      rootCause = `The compiler could not locate the included header file '${missingFile}' in the system or project include paths.`;
      remediation =
        `1. Check the spelling and include path of \`#include <${missingFile}>\` or \`#include "${missingFile}"\`.\n` +
        `2. Ensure the directory containing '${missingFile}' is added to include paths (e.g. \`add_includedirs("include")\` in xmake or \`target_include_directories\` in CMake).\n` +
        `3. If it belongs to a third-party package, verify the dependency is installed and linked.`;
      pitfalls.push(
        'Using quotes `#include "file.h"` vs angle brackets `#include <file.h>` inconsistently with build include paths.',
      );
    } else {
      const identMatch =
        cleanedText.match(/undeclared identifier ['`]?([a-zA-Z0-9_:]+)['`]?/i) ||
        cleanedText.match(/['`]?([a-zA-Z0-9_:]+)['`]? was not declared in this scope/i) ||
        cleanedText.match(/identifier ['`]?([a-zA-Z0-9_:]+)['`]? is undefined/i);
      const identifier = identMatch?.[1] ?? "identifier";

      summary = `Undeclared identifier '${identifier}'.`;
      rootCause = `The symbol '${identifier}' is used without being declared or included in the current scope.`;
      remediation = `Include the required header file or declare the symbol before use.`;

      // Attempt standard header lookup
      try {
        const headerLookup = await lookupHeader(identifier);
        if (headerLookup.found && headerLookup.header) {
          suggestedHeaders.push(headerLookup.header);
          remediation = `Include standard header ${headerLookup.header} (defines '${identifier}').`;
        }
      } catch {
        // Ignore lookup failure
      }
    }
  }

  // Check 10: Template Instantiation / SFINAE
  else if (
    /in instantiation of/i.test(cleanedText) ||
    /no matching (?:function|member function) for call to/i.test(cleanedText) ||
    /candidate template ignored/i.test(cleanedText) ||
    /substitution failure/i.test(cleanedText)
  ) {
    category = "template_instantiation";
    summary = `Template instantiation error or no matching function overload candidate.`;
    rootCause = `The compiler tried to instantiate a template with the given types, but none of the candidate function overloads or template specializations could satisfy the arguments.`;
    remediation =
      `1. Review the candidate list below in simplified form to see which parameter caused the rejection.\n` +
      `2. Verify that argument types match parameter types without conflicting conversions.\n` +
      `3. If using standard algorithms (std::sort, std::find), ensure custom types provide the required operators (e.g. \`operator<\` or \`operator==\`).`;
    pitfalls.push(
      "Using `std::sort` on elements that do not implement `operator<` or `std::less`.",
    );
  }

  // Check 11: General Fallback
  else {
    category = "general";
    summary = "C/C++ compiler or build error.";
    rootCause = "The compiler encountered an error during parsing or code generation.";
    remediation =
      "Inspect the line number and error message to resolve the syntax or semantic issue.";
  }

  // Generate a clean, simplified version of the error message without massive backtrace cascades
  const simplifiedError = cleanedText
    .split("\n")
    .filter((line) => {
      // Filter out deep internal STL headers noise
      if (
        line.includes("/bits/stl_") ||
        line.includes("/include/c++/") ||
        line.includes("/libcxx/") ||
        line.includes("\\include\\vector")
      ) {
        return false;
      }
      return true;
    })
    .slice(0, 15)
    .join("\n")
    .trim();

  return {
    success: true,
    category,
    detectedCompiler,
    summary,
    location,
    codeSnippet,
    rootCause,
    remediation,
    suggestedHeaders: suggestedHeaders.length > 0 ? suggestedHeaders : undefined,
    demangledSymbols:
      demangledSymbols && demangledSymbols.length > 0 ? demangledSymbols : undefined,
    simplifiedError: simplifiedError || cleanedText.slice(0, 500),
    pitfalls: pitfalls.length > 0 ? pitfalls : undefined,
  };
}
