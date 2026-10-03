// src/tool-schemas.ts
// Structured MCP metadata that lives next to the tool definitions: a stable,
// human-readable title per tool and the explicit Zod raw shape of each success
// payload. Kept separate from src/tool-registry.ts so the registry stays focused
// on wiring. Every shape is additive: hosts that ignore `structuredContent`
// still receive the JSON text envelope unchanged.

import { z } from "zod";

/** Human-friendly titles for hosts that render one (MCP `title` field). */
export const TOOL_TITLES: Record<string, string> = {
  search_cppreference: "Search cppreference",
  get_cppreference_page: "Get cppreference page",
  lookup_header: "Look up header",
  check_cpp_standard: "Check language standard",
  get_guideline: "Get C++ Core Guideline",
  get_cpp_modules_guide: "C++ modules guide",
  check_module_toolchain: "Check module toolchain",
  check_secure_coding: "Check secure coding (CERT)",
  get_cpp_tooling_guide: "C++ tooling guide",
  check_compiler_support: "Check compiler support",
  demangle_symbol: "Demangle symbol",
  search_code_symbols: "Search code symbols",
  analyze_code_symbol: "Analyze code symbol",
  get_project_details: "Get project details",
  get_code_diagnostics: "Get code diagnostics",
  rename_code_symbol: "Rename code symbol",
  format_code: "Format code",
  run_clang_tidy: "Run clang-tidy",
  scaffold_project: "Scaffold project",
  explain_compiler_error: "Explain compiler error",
  generate_documentation: "Generate documentation",
  generate_compilation_database: "Generate compilation database",
  reorder_struct_fields: "Reorder struct fields",
  trace_preprocessor: "Trace preprocessor",
};

const compilerVersions = z.object({
  gcc: z.string(),
  clang: z.string(),
  msvc: z.string(),
  apple_clang: z.string(),
});

const compilerSupportEntry = z.object({
  id: z.string(),
  name: z.string(),
  standard: z.enum(["C++17", "C++20", "C++23", "C++26"]),
  category: z.enum(["language", "library"]),
  paper: z.string(),
  macro: z.string().optional(),
  header: z.string().optional(),
  aliases: z.array(z.string()),
  compilers: compilerVersions,
  notes: z.string().optional(),
});

const hierarchyEntry = z.object({
  name: z.string(),
  kind: z.string(),
  detail: z.string().optional(),
  file: z.string(),
  line: z.number(),
});

const position = z.object({
  file: z.string(),
  line: z.number(),
  character: z.number(),
});

/**
 * Explicit success payload shape per tool. Tools without an entry keep the
 * text-only envelope from earlier versions.
 */
export const TOOL_OUTPUT_SCHEMAS: Record<string, z.ZodRawShape> = {
  lookup_header: {
    query: z.string(),
    found: z.boolean(),
    source: z.enum(["static_index", "cppreference_scrape", "not_found"]),
    header: z.string().optional(),
    standard: z.enum(["C", "C++"]).optional(),
    since: z.string().optional(),
    category: z.string().optional(),
    cEquivalent: z.string().optional(),
    url: z.string().optional(),
    matchedSymbol: z.string().optional(),
    symbols: z.array(z.string()).optional(),
  },
  check_cpp_standard: {
    symbol: z.string(),
    standard: z.enum(["C++", "C"]),
    since: z.string(),
    status: z.enum(["supported", "unsupported", "deprecated", "removed", "not_found"]),
    summary: z.string(),
    source: z.enum(["static_index", "cppreference_scrape", "not_found"]),
    deprecatedIn: z.string().optional(),
    removedIn: z.string().optional(),
    targetStandard: z.string().optional(),
    featureTestMacro: z.object({ macro: z.string(), value: z.string() }).optional(),
    url: z.string().optional(),
  },
  check_compiler_support: {
    found: z.boolean(),
    totalEntries: z.number().optional(),
    entry: compilerSupportEntry.optional(),
    compatibility: z
      .object({
        compiler: z.string(),
        userVersion: z.string(),
        minVersion: z.string(),
        compatible: z.boolean(),
        message: z.string(),
      })
      .optional(),
    matches: z
      .array(
        z.object({
          id: z.string(),
          name: z.string(),
          standard: z.string(),
          category: z.string(),
          compilers: compilerVersions,
        }),
      )
      .optional(),
    message: z.string().optional(),
  },
  demangle_symbol: {
    original: z.string(),
    demangled: z.string(),
    abi: z.enum(["itanium", "msvc", "rust", "unknown"]),
    method: z.enum(["cxxfilt", "llvm-undname", "fallback", "unmangled", "text_translation"]),
    isMangled: z.boolean(),
    extractedSymbols: z
      .array(z.object({ mangled: z.string(), demangled: z.string(), abi: z.string() }))
      .optional(),
    translatedText: z.string().optional(),
  },
  get_project_details: {
    found: z.boolean(),
    buildSystem: z.enum(["xmake", "cmake", "manual", "unknown"]),
    rootDir: z.string(),
    compileCommandsPath: z.string().optional(),
    entryCount: z.number().optional(),
    generated: z.boolean().optional(),
    error: z.string().optional(),
    toolchain: z.object({ clangd: z.boolean(), xmake: z.boolean() }),
  },
  get_code_diagnostics: {
    success: z.boolean(),
    workspaceDir: z.string(),
    buildSystem: z.string().optional(),
    totalErrors: z.number(),
    totalWarnings: z.number(),
    files: z.array(
      z.object({
        file: z.string(),
        errorCount: z.number(),
        warningCount: z.number(),
        diagnostics: z.array(
          z.object({
            file: z.string(),
            line: z.number(),
            character: z.number(),
            endLine: z.number(),
            endCharacter: z.number(),
            severity: z.enum(["error", "warning", "information", "hint"]),
            message: z.string(),
            source: z.string().optional(),
            code: z.union([z.string(), z.number()]).optional(),
            snippet: z.string().optional(),
          }),
        ),
      }),
    ),
    error: z.string().optional(),
  },
  search_code_symbols: {
    found: z.boolean(),
    query: z.string(),
    workspaceDir: z.string(),
    totalMatches: z.number(),
    symbols: z.array(
      z.object({
        name: z.string(),
        kind: z.string(),
        container: z.string().optional(),
        file: z.string(),
        line: z.number(),
        character: z.number(),
      }),
    ),
    error: z.string().optional(),
  },
  analyze_code_symbol: {
    found: z.boolean(),
    symbol: z.string(),
    workspaceDir: z.string(),
    kind: z.string().optional(),
    signature: z.string().optional(),
    documentation: z.string().optional(),
    declaration: position.optional(),
    definition: position.optional(),
    inheritance: z
      .object({ supertypes: z.array(hierarchyEntry), subtypes: z.array(hierarchyEntry) })
      .optional(),
    callHierarchy: z
      .object({
        incomingCalls: z.array(z.object({ from: hierarchyEntry, callCount: z.number() })),
        outgoingCalls: z.array(z.object({ to: hierarchyEntry })),
      })
      .optional(),
    members: z
      .array(
        z.object({
          name: z.string(),
          kind: z.string(),
          detail: z.string().optional(),
          line: z.number(),
        }),
      )
      .optional(),
    usageExamples: z
      .array(z.object({ file: z.string(), line: z.number(), preview: z.string().optional() }))
      .optional(),
    error: z.string().optional(),
  },
};
