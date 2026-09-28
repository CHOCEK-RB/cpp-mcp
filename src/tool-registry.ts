// src/tool-registry.ts
// Single source of truth for the MCP tool surface. Each definition carries the
// name, description, input schema, error label and pure invocation; src/index.ts
// registers them in a loop, so a tool is declared exactly once.

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { isExecutableAvailable, resolveProjectBuildInfo } from "./project/xmake.js";
import { checkSecureCoding } from "./tools/cert.js";
import { analyzeCodeSymbol } from "./tools/code-analyzer.js";
import { getCodeDiagnostics } from "./tools/code-diagnostics.js";
import { renameCodeSymbol } from "./tools/code-renamer.js";
import { searchCodeSymbols } from "./tools/code-search.js";
import { checkCompilerSupport } from "./tools/compiler-support.js";
import { demangleSymbol } from "./tools/demangle.js";
import { getGuideline } from "./tools/guidelines.js";
import { lookupHeader } from "./tools/header.js";
import { checkModuleToolchain } from "./tools/module-toolchain.js";
import { getCppModulesGuide } from "./tools/modules.js";
import { getCppreferencePage } from "./tools/page.js";
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
];
