// src/tool-registry.ts
// Single source of truth for the MCP tool surface. Each definition carries the
// name, description, input schema, error label and pure invocation; src/index.ts
// registers them in a loop, so a tool is declared exactly once.

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { isExecutableAvailable, resolveProjectBuildInfo } from "./project/xmake.js";
import { checkSecureCoding } from "./tools/cert.js";
import { runClangTidy } from "./tools/clang-tidy.js";
import { analyzeCodeSymbol } from "./tools/code-analyzer.js";
import { getCodeDiagnostics } from "./tools/code-diagnostics.js";
import { formatCode } from "./tools/code-formatter.js";
import { renameCodeSymbol } from "./tools/code-renamer.js";
import { searchCodeSymbols } from "./tools/code-search.js";
import { generateCompilationDatabase } from "./tools/compile-db.js";
import { checkCompilerSupport } from "./tools/compiler-support.js";
import { demangleSymbol } from "./tools/demangle.js";
import { generateDocumentation } from "./tools/doc-generator.js";
import { explainCompilerError } from "./tools/error-explainer.js";
import { reorderStructFields } from "./tools/field-reorderer.js";
import { getGuideline } from "./tools/guidelines.js";
import { lookupHeader } from "./tools/header.js";
import { checkModuleToolchain } from "./tools/module-toolchain.js";
import { getCppModulesGuide } from "./tools/modules.js";
import { getCppreferencePage } from "./tools/page.js";
import { tracePreprocessor } from "./tools/preprocessor-tracer.js";
import { scaffoldProject } from "./tools/project-scaffold.js";
import { searchCppreference } from "./tools/search.js";
import { checkCppStandard } from "./tools/standards.js";
import { getCppToolingGuide } from "./tools/tooling.js";

/**
 * Invocation arguments arrive as the validated Zod shape output. The registry is
 * heterogeneous (each tool has its own shape), so `args` is intentionally loose
 * here; every definition narrows it immediately in its own lambda.
 */
// biome-ignore lint/suspicious/noExplicitAny: heterogeneous registry of tool-specific shapes
type ToolArgs = any;

export interface ToolDefinition {
  /** MCP tool name (snake_case). */
  name: string;
  /** Trigger-first description shown to the model. */
  description: string;
  /** Zod raw shape for the tool inputs. */
  inputSchema: z.ZodRawShape;
  /** Message prefix for a failed invocation; a function receives the arguments. */
  errorLabel: string | ((args: ToolArgs) => string);
  /** Optional guard that returns a verbatim error message before invoking. */
  precheck?: (args: ToolArgs) => string | undefined;
  /** Pure tool function. Must not touch MCP types. */
  invoke: (args: ToolArgs) => unknown | Promise<unknown>;
}

function labelFor(def: ToolDefinition, args: ToolArgs): string {
  return typeof def.errorLabel === "function" ? def.errorLabel(args) : def.errorLabel;
}

/** Registers every definition on the MCP server with the shared envelope/error contract. */
export function registerToolDefinitions(server: McpServer): void {
  for (const def of TOOL_DEFINITIONS) {
    server.registerTool(
      def.name,
      { description: def.description, inputSchema: def.inputSchema },
      async (args) => {
        const precheckMessage = def.precheck?.(args);
        if (precheckMessage) {
          return {
            isError: true,
            content: [{ type: "text" as const, text: precheckMessage }],
          };
        }
        try {
          const result = await def.invoke(args);
          return {
            content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
          };
        } catch (error) {
          return {
            isError: true,
            content: [
              {
                type: "text" as const,
                text: `Error ${labelFor(def, args)}: ${error instanceof Error ? error.message : String(error)}`,
              },
            ],
          };
        }
      },
    );
  }
}

export const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: "search_cppreference",
    description:
      "Use when you need to find the official cppreference page for a C/C++ symbol, header, or language feature and don't know its URL. Returns up to 5 matching cppreference.com URLs; follow up with get_cppreference_page for the contents.",
    errorLabel: "searching cppreference",
    inputSchema: {
      query: z
        .string()
        .describe(
          "Concise C or C++ search query, such as a symbol, header, keyword, or concept (e.g. std::vector, constexpr, std::ranges::sort).",
        ),
    },
    invoke: ({ query }) => searchCppreference(query),
  },
  {
    name: "get_cppreference_page",
    description:
      "Use when you have a cppreference.com URL and need the authoritative reference text for a symbol (semantics, overloads, since/deprecated/removed notes). Returns sanitized Markdown, paginated with a cursor for long pages.",
    errorLabel: "retrieving cppreference page",
    inputSchema: {
      url: z.url().describe("HTTPS URL of a cppreference.com documentation page to retrieve."),
      cursor: z
        .string()
        .nullable()
        .optional()
        .describe(
          "Pagination cursor returned by a previous call, or null/omitted for the first fragment.",
        ),
    },
    invoke: ({ url, cursor }) => getCppreferencePage(url, cursor),
  },
  {
    name: "lookup_header",
    description:
      "Use when you need to know which ISO C/C++ header declares a symbol (e.g. 'where is std::span defined?'). Returns the header (<vector>, <algorithm>, <cstdio>, ...), first standard, category, and the C equivalent when one exists.",
    errorLabel: (args) => `looking up header for "${args.symbol}"`,
    inputSchema: {
      symbol: z
        .string()
        .min(1)
        .describe(
          "C or C++ symbol, type, function, class, or header name (e.g. 'std::vector', 'printf', 'std::views::filter', 'size_t', '<ranges>')",
        ),
    },
    invoke: ({ symbol }) => lookupHeader(symbol),
  },
  {
    name: "check_cpp_standard",
    description:
      "Use when you must confirm whether a symbol/header exists in a target C/C++ standard (C++17, C++20, C++23, ...) or when it was introduced, deprecated, or removed. Returns the status and feature-test macro for that standard.",
    errorLabel: (args) => `checking standard version for "${args.symbol}"`,
    inputSchema: {
      symbol: z
        .string()
        .min(1)
        .describe(
          "C or C++ symbol, type, function, class, or header name (e.g. 'std::span', 'std::auto_ptr', 'std::ranges::sort', 'std::print', '<format>')",
        ),
      standard: z
        .string()
        .optional()
        .describe(
          "Target language standard to evaluate compatibility against (e.g. 'c++17', 'c++20', 'c++23', 'c11'). If omitted, returns general language availability.",
        ),
    },
    invoke: ({ symbol, standard }) => checkCppStandard(symbol, standard),
  },
  {
    name: "get_guideline",
    description:
      "Use when you need the official C++ Core Guidelines rule for an ID (F.16, R.1, C.21, I.11) or advice on an idiom (RAII, ownership, smart pointers, rule of five). Returns rule text, rationale, and enforcement.",
    errorLabel: "retrieving C++ Core Guideline",
    inputSchema: {
      rule_id: z
        .string()
        .optional()
        .describe(
          "Specific Core Guidelines rule ID (e.g. 'F.16', 'R.1', 'C.21', 'ES.20', 'I.11', 'P.1')",
        ),
      query: z
        .string()
        .optional()
        .describe(
          "Topic or search keyword (e.g. 'RAII', 'rule of five', 'ownership', 'smart pointers', 'pass by value', 'virtual destructor')",
        ),
      section: z
        .string()
        .optional()
        .describe(
          "Filter by section name (e.g. 'Resource management', 'Functions', 'Classes and class hierarchies', 'Concurrency and parallelism')",
        ),
      include_content: z
        .boolean()
        .optional()
        .describe(
          "Whether to include full markdown text and code examples in multi-match results (defaults to true for exact ruleId, false for broad query)",
        ),
    },
    invoke: ({ rule_id, query, section, include_content }) =>
      getGuideline({
        ruleId: rule_id,
        query,
        section,
        includeContent: include_content ?? Boolean(rule_id),
      }),
  },
  {
    name: "get_cpp_modules_guide",
    description:
      "Use when writing or migrating to C++20/23/26 modules ('import std;', partitions, global module fragment, CMake 3.28+ setup, header migration). Returns architecture guides, rules, and code patterns by topic.",
    errorLabel: "retrieving C++ modules guide",
    inputSchema: {
      topic: z
        .string()
        .optional()
        .describe(
          "Specific module topic (e.g. 'syntax-structure', 'import-std', 'partitions', 'global-module-fragment', 'linkage-and-visibility', 'cmake-build-systems', 'migration-strategies', 'pitfalls-anti-patterns', 'cpp26-evolution')",
        ),
      standard: z
        .enum(["c++20", "c++23", "c++26"])
        .optional()
        .describe("Target C++ language version filter ('c++20', 'c++23', 'c++26')"),
      query: z
        .string()
        .optional()
        .describe(
          "Search query across module rules and code patterns (e.g. 'ninja', 'private fragment', 'inline', 'macro', 'export import')",
        ),
    },
    invoke: ({ topic, standard, query }) => getCppModulesGuide({ topic, standard, query }),
  },
  {
    name: "check_module_toolchain",
    description:
      "Use when modules fail to build or navigate (module_not_found, 'import std' errors, incompatible BMI) or before choosing a toolchain for modules. Inspects clang++, g++, libc++ and clangd and reports which import std; setup is viable on this host.",
    errorLabel: "checking module toolchain",
    inputSchema: {},
    invoke: () => checkModuleToolchain(),
  },
  {
    name: "check_secure_coding",
    description:
      "Use when auditing C++ code for security, undefined behavior, or safety (e.g. before a commit or review), or to look up a SEI CERT C++ rule or CWE. Returns noncompliant examples and secure modern fixes.",
    errorLabel: "checking secure coding rules",
    inputSchema: {
      rule_id: z
        .string()
        .optional()
        .describe(
          "Specific SEI CERT rule ID (e.g. 'MEM50-CPP', 'OOP50-CPP', 'CON53-CPP', 'EXP54-CPP') or CWE ID (e.g. 'CWE-416', 'CWE-833')",
        ),
      category: z
        .enum(["MEM", "EXP", "CTR", "ERR", "CON", "OOP", "MSC", "DCL", "FIO", "STR", "INT"])
        .optional()
        .describe(
          "SEI CERT category filter ('MEM' memory, 'CON' concurrency, 'EXP' expressions, 'OOP' object-oriented, 'ERR' exceptions, 'CTR' containers, 'STR' strings, 'INT' integers, 'FIO' input-output, 'DCL' declarations, 'MSC' miscellaneous)",
        ),
      query: z
        .string()
        .optional()
        .describe(
          "Topic or vulnerability search keyword (e.g. 'use-after-free', 'deadlock', 'data race', 'slicing', 'virtual destructor', 'uninitialized')",
        ),
      code: z
        .string()
        .optional()
        .describe(
          "C++ code snippet to inspect for common security and undefined behavior patterns (e.g. rand usage, exception-by-value, throw in destructor)",
        ),
    },
    invoke: ({ rule_id, category, query, code }) =>
      checkSecureCoding({ rule_id, category, query, code }),
  },
  {
    name: "get_cpp_tooling_guide",
    description:
      "Use when configuring or asking about C/C++ build and tooling (xmake with C++20 modules and official agent skills, .clang-format, .clang-tidy, LLVM/GCC sanitizers). Returns authoritative commands and production starter configs.",
    errorLabel: "retrieving C++ tooling guide",
    inputSchema: {
      tool: z
        .string()
        .optional()
        .describe(
          "Target tool ID or alias (e.g. 'xmake', 'clang-format', 'clang-tidy', 'sanitizers', 'format', 'tidy', 'asan')",
        ),
      topic: z
        .string()
        .optional()
        .describe(
          "Specific tooling topic or official xmake recipe (e.g. 'cxx-modules', 'cross-compilation', 'packages', 'cuda', 'unity', 'zigcc')",
        ),
      category: z
        .string()
        .optional()
        .describe(
          "Category filter for official xmake recipes (e.g. 'basics', 'cli', 'languages', 'ops', 'packages', 'packaging', 'performance', 'project-config', 'scripting', 'testing', 'toolchains')",
        ),
      query: z
        .string()
        .optional()
        .describe(
          "Search query across directives, CLI commands, configuration options, and xmake recipes (e.g. 'compile_commands', 'add_requires', 'modernize', 'IndentWidth', 'cuda')",
        ),
      generate_config: z
        .boolean()
        .optional()
        .describe(
          "If true, outputs the raw, copy-pasteable production configuration file (e.g. xmake.lua, .clang-format, .clang-tidy)",
        ),
    },
    invoke: ({ tool, topic, category, query, generate_config }) =>
      getCppToolingGuide({ tool, topic, category, query, generate_config }),
  },
  {
    name: "check_compiler_support",
    description:
      "Use when you need the minimum compiler versions (GCC, Clang, MSVC, Apple Clang) for a modern C++ feature, or to check whether a specific compiler version supports it (std::print, std::expected, import std, std::generator, coroutines, concepts, modules).",
    errorLabel: "checking compiler support",
    inputSchema: {
      feature: z
        .string()
        .optional()
        .describe(
          "C++ standard feature, library symbol, or keyword (e.g. 'std::print', 'expected', 'import std', 'generator', 'deducing this'). If omitted, returns an overview of features.",
        ),
      standard: z
        .string()
        .optional()
        .describe(
          "Filter features by C++ standard version (e.g. 'C++20', 'C++23', 'C++26', 'C++17').",
        ),
      compiler: z
        .enum(["gcc", "clang", "msvc", "apple_clang"])
        .optional()
        .describe("Specific compiler to check compatibility against."),
      version: z
        .union([z.string(), z.number()])
        .optional()
        .describe(
          "User compiler version (e.g. '13.2', '16.0', 17) to evaluate compatibility against minimum requirements.",
        ),
    },
    invoke: ({ feature, standard, compiler, version }) =>
      checkCompilerSupport({ feature, standard, compiler, version }),
  },
  {
    name: "demangle_symbol",
    description:
      "Use when a compiler or linker log contains mangled names (_ZN..., ?...) and you need readable signatures — or when you need to demangle a single symbol. Handles Itanium ABI (GCC/Clang) and MSVC.",
    errorLabel: "demangling symbol",
    inputSchema: {
      symbol: z
        .string()
        .min(1)
        .describe(
          "Mangled symbol (e.g. '_ZNSt6vectorIiSaIiEE9push_backERKi', '_Z3addii', '?func@@YAHXZ') or an entire compiler/linker error trace containing mangled symbols.",
        ),
      strip_params: z
        .boolean()
        .optional()
        .describe("If true, strips function parameter types to return only the qualified name."),
    },
    invoke: ({ symbol, strip_params }) => demangleSymbol({ symbol, strip_params }),
  },
  {
    name: "search_code_symbols",
    description:
      "Use when you know a symbol's name but not where it is defined, or before calling analyze_code_symbol. Searches the indexed project workspace via clangd for classes, structs, functions, methods, and variables.",
    errorLabel: "searching workspace code symbols",
    inputSchema: {
      query: z
        .string()
        .describe(
          "Symbol name or partial query to search for in workspace code (e.g. 'Calculator', 'Vec2', 'render').",
        ),
      workspaceDir: z
        .string()
        .optional()
        .describe(
          "Project root directory containing xmake.lua, CMakeLists.txt, or compile_commands.json. Defaults to cwd.",
        ),
      files: z
        .array(z.string())
        .optional()
        .describe("Filter results to matching file names or relative paths."),
      limit: z
        .number()
        .optional()
        .describe("Maximum number of matching symbols to return (default: 25)."),
    },
    invoke: ({ query, workspaceDir, files, limit }) =>
      searchCodeSymbols({ query, workspaceDir, files, limit }),
  },
  {
    name: "analyze_code_symbol",
    description:
      "Use when you need deep semantics for one C++ symbol: definition, hover signature, docstrings, inheritance, incoming/outgoing call hierarchy, members, and usage examples. Runs a multi-dimensional clangd analysis.",
    errorLabel: "analyzing code symbol",
    inputSchema: {
      symbol: z
        .string()
        .describe(
          "Symbol name or qualified name to analyze (e.g. 'Calculator::add', 'Vec2', 'process').",
        ),
      workspaceDir: z
        .string()
        .optional()
        .describe(
          "Project root directory containing xmake.lua, CMakeLists.txt, or compile_commands.json. Defaults to cwd.",
        ),
      file: z.string().optional().describe("Source file path hint for disambiguation."),
      line: z.number().optional().describe("Line number hint (1-indexed) for disambiguation."),
      maxExamples: z
        .number()
        .optional()
        .describe("Maximum number of usage references to extract (default: 5)."),
    },
    invoke: ({ symbol, workspaceDir, file, line, maxExamples }) =>
      analyzeCodeSymbol({ symbol, workspaceDir, file, line, maxExamples }),
  },
  {
    name: "get_project_details",
    description:
      "Use when you need to know how a workspace is built, why clangd tools fail, or which toolchain is available: returns the detected build system (xmake, CMake, compile_commands.json), indexed translation units, and clangd/xmake availability.",
    errorLabel: "inspecting project details",
    inputSchema: {
      workspaceDir: z
        .string()
        .optional()
        .describe(
          "Project root directory containing xmake.lua, CMakeLists.txt, or compile_commands.json. Defaults to cwd.",
        ),
      autoGenerate: z
        .boolean()
        .optional()
        .describe(
          "Automatically generate compile_commands.json via xmake if missing (default: true).",
        ),
    },
    invoke: async ({ workspaceDir, autoGenerate }) => {
      const info = await resolveProjectBuildInfo({ workspaceDir, autoGenerate });
      const [hasClangd, hasXmake] = await Promise.all([
        isExecutableAvailable("clangd"),
        isExecutableAvailable("xmake"),
      ]);
      return { ...info, toolchain: { clangd: hasClangd, xmake: hasXmake } };
    },
  },
  {
    name: "get_code_diagnostics",
    description:
      "Use when you need live compile errors and warnings for a file or in-memory snippet without running the build. Returns clangd diagnostics with line snippets and caret indicators; supports a severity filter.",
    errorLabel: "retrieving code diagnostics",
    inputSchema: {
      file: z
        .string()
        .optional()
        .describe(
          "Source or header file path to analyze (e.g. 'src/main.cpp'). If omitted, returns diagnostics across all tracked project files.",
        ),
      code: z
        .string()
        .optional()
        .describe(
          "Optional in-memory source code to check without saving to disk. Requires 'file' to determine path and file type.",
        ),
      workspaceDir: z
        .string()
        .optional()
        .describe(
          "Project root directory containing xmake.lua, CMakeLists.txt, or compile_commands.json. Defaults to cwd.",
        ),
      severity: z
        .enum(["all", "error", "warning"])
        .optional()
        .describe("Filter diagnostics by severity level (default: 'all')."),
      waitTimeout: z
        .number()
        .optional()
        .describe(
          "Maximum seconds to wait for clangd to parse and publish diagnostics (default: 3).",
        ),
    },
    invoke: ({ file, code, workspaceDir, severity, waitTimeout }) =>
      getCodeDiagnostics({ file, code, workspaceDir, severity, waitTimeout }),
  },
  {
    name: "rename_code_symbol",
    description:
      "Use when renaming a C++ symbol safely across the whole workspace. Performs AST-level rename of declarations, definitions and references via clangd without textual false positives; dry_run previews first.",
    errorLabel: "renaming symbol",
    inputSchema: {
      symbol: z
        .string()
        .describe(
          "Symbol name or qualified identifier to rename (e.g. 'Calculator::add', 'process_data').",
        ),
      new_name: z.string().describe("New identifier name. Must be a valid C/C++ identifier."),
      workspaceDir: z
        .string()
        .optional()
        .describe(
          "Project root directory containing xmake.lua, CMakeLists.txt, or compile_commands.json. Defaults to cwd.",
        ),
      file: z.string().optional().describe("Source file path hint for symbol location."),
      line: z.number().optional().describe("Line number hint (1-indexed) for symbol location."),
      dry_run: z
        .boolean()
        .optional()
        .describe(
          "If true (default), returns preview diff of all affected files without modifying disk. If false, writes changes to disk.",
        ),
    },
    invoke: ({ symbol, new_name, workspaceDir, file, line, dry_run }) =>
      renameCodeSymbol({
        symbol,
        newName: new_name,
        workspaceDir,
        file,
        line,
        dryRun: dry_run,
      }),
  },
  {
    name: "format_code",
    description:
      "Use when code must match the project's style (before a commit, after generation) or to format a snippet. Runs clang-format with .clang-format discovery, presets (LLVM, Google, Chromium, Mozilla, WebKit, Microsoft), line ranges, and atomic disk apply.",
    errorLabel: "formatting code",
    inputSchema: {
      code: z
        .string()
        .optional()
        .describe(
          "C/C++ code snippet to format in-memory. Ideal for formatting generated code before writing to disk.",
        ),
      file: z
        .string()
        .optional()
        .describe(
          "Path to a C/C++ source or header file to format (.cpp, .hpp, .c, .h, .cxx, .ixx, .mpp).",
        ),
      workspace: z
        .string()
        .optional()
        .describe(
          "Root workspace directory used to locate the project's .clang-format configuration file.",
        ),
      style: z
        .string()
        .optional()
        .default("file")
        .describe(
          "Coding style preset ('file' to use project .clang-format, 'LLVM', 'Google', 'Chromium', 'Mozilla', 'WebKit', 'Microsoft', or custom YAML string). Defaults to 'file'.",
        ),
      fallback_style: z
        .string()
        .optional()
        .default("LLVM")
        .describe(
          "Fallback style if no .clang-format is found when style='file'. Defaults to 'LLVM'.",
        ),
      apply: z
        .boolean()
        .optional()
        .default(false)
        .describe(
          "If true and 'file' is provided, writes formatted changes directly to disk. Defaults to false (dry-run preview with unified diff).",
        ),
      start_line: z
        .number()
        .int()
        .positive()
        .optional()
        .describe("Optional 1-indexed starting line number to format only a sub-region."),
      end_line: z
        .number()
        .int()
        .positive()
        .optional()
        .describe("Optional 1-indexed ending line number to format only a sub-region."),
    },
    precheck: ({ start_line, end_line }) => {
      if (
        (start_line !== undefined && end_line === undefined) ||
        (start_line === undefined && end_line !== undefined)
      ) {
        return "Error: Both 'start_line' and 'end_line' must be provided when specifying a format range.";
      }
      if (start_line !== undefined && end_line !== undefined && start_line > end_line) {
        return `Error: 'start_line' (${start_line}) cannot be greater than 'end_line' (${end_line}).`;
      }
      return undefined;
    },
    invoke: ({ code, file, workspace, style, fallback_style, apply, start_line, end_line }) =>
      formatCode({
        code,
        file,
        workspace,
        style,
        fallbackStyle: fallback_style,
        apply,
        range:
          start_line !== undefined && end_line !== undefined
            ? { startLine: start_line, endLine: end_line }
            : undefined,
      }),
  },
  {
    name: "run_clang_tidy",
    description:
      "Use when modernizing or linting C/C++ code (e.g. std::cout -> std::print, NULL -> nullptr, raw new/delete) or gating CI on a check preset. Runs clang-tidy with presets (modernize, bugprone, performance, portability, cppcoreguidelines, cert, security, all) or a raw --checks expression; reports findings by default, apply=true writes fixes to disk.",
    errorLabel: "running clang-tidy",
    inputSchema: {
      file: z.string().optional().describe("Single C/C++ file to analyze."),
      files: z
        .array(z.string())
        .optional()
        .describe("Multiple files to analyze. Ignored when 'file' is set."),
      preset: z
        .enum([
          "modernize",
          "bugprone",
          "performance",
          "portability",
          "cppcoreguidelines",
          "cert",
          "security",
          "all",
        ])
        .optional()
        .default("modernize")
        .describe(
          "Check group preset: 'modernize' (std::print/format, ranges, nullptr), 'bugprone', 'performance', 'portability', 'cppcoreguidelines', 'cert', 'security', or 'all'. Defaults to 'modernize'.",
        ),
      checks: z
        .string()
        .optional()
        .describe("Raw clang-tidy --checks expression; overrides 'preset' when set."),
      apply: z
        .boolean()
        .optional()
        .default(false)
        .describe(
          "If true, write clang-tidy fixes to disk (--fix --fix-errors). Defaults to false (report only, dry-run).",
        ),
      workspace: z
        .string()
        .optional()
        .describe("Root workspace directory. Defaults to the current working directory."),
      build_dir: z
        .string()
        .optional()
        .describe("Directory containing compile_commands.json. Auto-resolved when omitted."),
      extra_args: z
        .array(z.string())
        .optional()
        .describe("Extra raw arguments appended to every clang-tidy invocation."),
    },
    invoke: ({ file, files, preset, checks, apply, workspace, build_dir, extra_args }) =>
      runClangTidy({
        file,
        files,
        preset,
        checks,
        apply,
        workspace,
        buildDir: build_dir,
        extraArgs: extra_args,
      }),
  },
  {
    name: "scaffold_project",
    description:
      "Use when starting a new C/C++ project and you want a best-practice skeleton. Scaffolds xmake/CMake with a chosen standard (C++11-26), test framework (Catch2/GTest/doctest), .clang-format, .clangd LSP config, and git.",
    errorLabel: "scaffolding project",
    inputSchema: {
      project_name: z
        .string()
        .min(1)
        .describe("Name of the project (alphanumeric, underscores, hyphens, and dots)."),
      target_dir: z
        .string()
        .optional()
        .describe("Directory where the project should be created. Defaults to './<project_name>'."),
      build_system: z
        .enum(["xmake", "cmake"])
        .optional()
        .default("xmake")
        .describe("Build system to use ('xmake' or 'cmake'). Defaults to 'xmake'."),
      project_type: z
        .enum(["executable", "library", "header-only", "cxx-modules", "qt", "cuda"])
        .optional()
        .default("executable")
        .describe(
          "Type of C++ project ('executable', 'library', 'header-only', 'cxx-modules', 'qt', 'cuda'). Defaults to 'executable'.",
        ),
      cpp_standard: z
        .enum(["11", "14", "17", "20", "23", "26"])
        .optional()
        .default("20")
        .describe("C++ standard version ('11', '14', '17', '20', '23', '26'). Defaults to '20'."),
      test_framework: z
        .enum(["catch2", "gtest", "doctest", "none"])
        .optional()
        .default("catch2")
        .describe(
          "Unit test framework ('catch2', 'gtest', 'doctest', 'none'). Defaults to 'catch2'.",
        ),
      package_manager: z
        .enum(["xrepo", "vcpkg", "conan", "none"])
        .optional()
        .describe(
          "Package manager ('xrepo', 'vcpkg', 'conan', 'none'). Defaults to 'xrepo' for xmake or 'none' for cmake.",
        ),
      init_clang_tools: z
        .boolean()
        .optional()
        .default(true)
        .describe(
          "Whether to generate .clang-format and .clangd LSP configurations. Defaults to true.",
        ),
      init_git: z
        .boolean()
        .optional()
        .default(false)
        .describe(
          "Whether to initialize a git repository in the target directory. Defaults to false.",
        ),
      dry_run: z
        .boolean()
        .optional()
        .default(false)
        .describe(
          "If true, returns file tree and previews without writing to disk. Defaults to false.",
        ),
      overwrite: z
        .boolean()
        .optional()
        .default(false)
        .describe(
          "If true, allows writing into an existing non-empty directory. Defaults to false.",
        ),
    },
    invoke: ({
      project_name,
      target_dir,
      build_system,
      project_type,
      cpp_standard,
      test_framework,
      package_manager,
      init_clang_tools,
      init_git,
      dry_run,
      overwrite,
    }) =>
      scaffoldProject({
        projectName: project_name,
        targetDir: target_dir,
        buildSystem: build_system,
        projectType: project_type,
        cppStandard: cpp_standard,
        testFramework: test_framework,
        packageManager: package_manager,
        initClangTools: init_clang_tools,
        initGit: init_git,
        dryRun: dry_run,
        overwrite,
      }),
  },
  {
    name: "explain_compiler_error",
    description:
      "Use when a C/C++ build fails and you need the error decoded: massive template/SFINAE backtraces, unsatisfied C++20 concepts, undefined references, vtable issues, missing includes, or module resolution failures. Returns a plain-language diagnosis and fix.",
    errorLabel: "explaining compiler error",
    inputSchema: {
      error: z
        .string()
        .min(1)
        .describe("Compiler error output or linker error trace (GCC, Clang, or MSVC error text)."),
      compiler: z
        .enum(["gcc", "clang", "msvc", "auto"])
        .optional()
        .default("auto")
        .describe(
          "Compiler flavor hint ('gcc', 'clang', 'msvc', or 'auto' to auto-detect). Defaults to 'auto'.",
        ),
      code_snippet: z
        .string()
        .optional()
        .describe("Optional source code context around the error location."),
      workspace_dir: z.string().optional().describe("Optional workspace root directory."),
    },
    invoke: ({ error, compiler, code_snippet, workspace_dir }) =>
      explainCompilerError({
        error,
        compiler,
        codeSnippet: code_snippet,
        workspaceDir: workspace_dir,
      }),
  },
  {
    name: "generate_documentation",
    description:
      "Use when you need API documentation generated from C/C++ sources (Markdown, HTML, JSON, YAML) with Doxygen comments, types, and inheritance. Runs clang-doc non-destructively (manifest-tracked outputs).",
    errorLabel: "generating documentation",
    inputSchema: {
      workspace: z
        .string()
        .optional()
        .describe(
          "Project workspace directory containing compile_commands.json, xmake.lua, or CMakeLists.txt (defaults to current directory).",
        ),
      files: z
        .array(z.string())
        .optional()
        .describe("Optional specific source or header files to document."),
      output_dir: z
        .string()
        .optional()
        .default("docs/api")
        .describe("Destination output directory (default: 'docs/api')."),
      format: z
        .enum(["md", "html", "json", "yaml"])
        .optional()
        .default("md")
        .describe(
          "Documentation output format: 'md', 'html', 'json', or 'yaml'. Defaults to 'md'.",
        ),
      public_only: z
        .boolean()
        .optional()
        .default(false)
        .describe("Document only public declarations."),
      doxygen_only: z
        .boolean()
        .optional()
        .default(false)
        .describe("Parse only Doxygen-style comments."),
      dry_run: z
        .boolean()
        .optional()
        .default(false)
        .describe("Preview generation without writing files to disk."),
    },
    invoke: ({ workspace, files, output_dir, format, public_only, doxygen_only, dry_run }) =>
      generateDocumentation({
        workspace,
        files,
        outputDir: output_dir,
        format,
        publicOnly: public_only,
        doxygenOnly: doxygen_only,
        dryRun: dry_run,
      }),
  },
  {
    name: "generate_compilation_database",
    description:
      "Use when clangd or clang tools report a missing compile_commands.json, when symbols don't resolve, or when setting up semantic intelligence for a project without a build system. Generates or resolves the database for CMake, xmake, Meson, Bear, or synthetic mode.",
    errorLabel: "generating compilation database",
    inputSchema: {
      workspace: z
        .string()
        .optional()
        .describe(
          "Project workspace directory containing build files or C/C++ source code (defaults to current directory).",
        ),
      build_system: z
        .enum(["auto", "cmake", "xmake", "meson", "bear", "synthetic"])
        .optional()
        .default("auto")
        .describe(
          "Build system generator to use: 'auto', 'cmake', 'xmake', 'meson', 'bear', or 'synthetic' (default: 'auto').",
        ),
      build_dir: z
        .string()
        .optional()
        .describe("Directory for build artifacts and compile_commands.json (defaults to 'build')."),
      compiler: z
        .string()
        .optional()
        .describe("Compiler executable for synthetic generation (e.g. 'clang++', 'g++')."),
      std: z
        .string()
        .optional()
        .default("c++20")
        .describe("C/C++ standard flag for synthetic generation (e.g. 'c++20', 'c++17')."),
      include_dirs: z
        .array(z.string())
        .optional()
        .describe("Additional include directories for synthetic generation."),
      symlink_to_root: z
        .boolean()
        .optional()
        .default(true)
        .describe(
          "Link or copy the generated compile_commands.json to workspace root for automatic clangd discovery.",
        ),
      dry_run: z
        .boolean()
        .optional()
        .default(false)
        .describe("Preview generation without writing files to disk."),
    },
    invoke: ({
      workspace,
      build_system,
      build_dir,
      compiler,
      std,
      include_dirs,
      symlink_to_root,
      dry_run,
    }) =>
      generateCompilationDatabase({
        workspace,
        buildSystem: build_system,
        buildDir: build_dir,
        compiler,
        std,
        includeDirs: include_dirs,
        symlinkToRoot: symlink_to_root,
        dryRun: dry_run,
      }),
  },
  {
    name: "reorder_struct_fields",
    description:
      "Use when optimizing a struct/class memory layout or reordering members safely. Runs clang-reorder-fields and updates field declarations, constructor initializer lists, aggregate initializers, and C++20 designated initializers across the codebase.",
    errorLabel: "reordering fields",
    inputSchema: {
      record_name: z
        .string()
        .describe(
          "Fully-qualified name of the struct or class to reorder (e.g. 'Foo' or '::bar::Foo').",
        ),
      fields_order: z
        .array(z.string())
        .describe("The desired order of field names (e.g. ['z', 'w', 'y', 'x'])."),
      workspace: z
        .string()
        .optional()
        .describe(
          "Workspace directory containing source files or compile_commands.json (defaults to current directory).",
        ),
      files: z
        .array(z.string())
        .optional()
        .describe("Optional specific source or header files to inspect and update."),
      extra_args: z
        .array(z.string())
        .optional()
        .describe("Additional compiler arguments (e.g. ['-std=c++20'])."),
      apply: z
        .boolean()
        .optional()
        .default(false)
        .describe(
          "When true, writes rewritten changes to disk. When false (default), returns preview diff.",
        ),
    },
    invoke: ({ record_name, fields_order, workspace, files, extra_args, apply }) =>
      reorderStructFields({
        recordName: record_name,
        fieldsOrder: fields_order,
        workspace,
        files,
        extraArgs: extra_args,
        apply,
      }),
  },
  {
    name: "trace_preprocessor",
    description:
      "Use when debugging macro expansion or conditional compilation. Traces pp-trace activity — #define/#undef, #include, #if/#ifdef/#elif branches, pragmas, module imports — as an aggregated summary, filtering system-header noise by default.",
    errorLabel: "tracing preprocessor",
    inputSchema: {
      file: z
        .string()
        .describe("Path to the C/C++ source file to trace (absolute or relative to 'workspace')."),
      workspace: z
        .string()
        .optional()
        .describe(
          "Workspace directory used to resolve the file and locate compile_commands.json (defaults to current directory).",
        ),
      callbacks: z
        .array(z.string())
        .optional()
        .describe(
          "Restrict tracing to specific pp-trace callbacks or globs (e.g. ['MacroDefined', 'MacroExpands']).",
        ),
      extra_args: z
        .array(z.string())
        .optional()
        .describe(
          "Additional compiler arguments forwarded via --extra-arg (e.g. ['-std=c++20', '-Iinclude']).",
        ),
      max_events: z
        .number()
        .int()
        .optional()
        .default(500)
        .describe(
          "Maximum number of raw events retained when 'include_events' is true (default 500, max 10000).",
        ),
      include_events: z
        .boolean()
        .optional()
        .default(false)
        .describe("When true, also return the raw callback events (capped by 'max_events')."),
      user_files_only: z
        .boolean()
        .optional()
        .default(true)
        .describe(
          "Filter out events from system headers and virtual files, keeping only project code (default true).",
        ),
    },
    invoke: ({
      file,
      workspace,
      callbacks,
      extra_args,
      max_events,
      include_events,
      user_files_only,
    }) =>
      tracePreprocessor({
        file,
        workspace,
        callbacks,
        extraArgs: extra_args,
        maxEvents: max_events,
        includeEvents: include_events,
        userFilesOnly: user_files_only,
      }),
  },
];
