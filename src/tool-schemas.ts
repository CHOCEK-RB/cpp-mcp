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
  search_cppreference: {
    query: z.string(),
    result_urls: z.array(z.string()),
  },
  get_cppreference_page: {
    content: z.string(),
    next_cursor: z.string().nullable(),
  },
  get_guideline: {
    query: z.string(),
    found: z.boolean(),
    totalMatches: z.number(),
    rule: z.record(z.string(), z.unknown()).optional(),
    rules: z
      .array(
        z.object({
          id: z.string(),
          title: z.string(),
          section: z.string(),
          url: z.string(),
          reason: z.string().optional(),
          enforcement: z.string().optional(),
          content: z.string().optional(),
        }),
      )
      .optional(),
    availableSections: z.array(z.string()).optional(),
    message: z.string().optional(),
  },
  get_cpp_modules_guide: {
    found: z.boolean(),
    totalTopics: z.number().optional(),
    topic: z.string().optional(),
    title: z.string().optional(),
    standard: z.string().optional(),
    summary: z.string().optional(),
    rules: z.array(z.string()).optional(),
    content: z.string().optional(),
    matches: z
      .array(
        z.object({
          id: z.string(),
          title: z.string(),
          standard: z.string(),
          summary: z.string(),
          matchedRules: z.array(z.string()).optional(),
        }),
      )
      .optional(),
    message: z.string().optional(),
  },
  check_module_toolchain: {
    success: z.boolean(),
    host: z.object({
      clang: z.object({ available: z.boolean(), version: z.string().optional() }),
      gcc: z.object({
        available: z.boolean(),
        version: z.string().optional(),
        stdModule: z.boolean(),
      }),
      clangd: z.object({ available: z.boolean(), version: z.string().optional() }),
      libcxx: z.boolean(),
    }),
    recommended: z.enum(["clang-libc++", "gcc-native", "hybrid"]),
    options: z.array(
      z.object({
        id: z.enum(["clang-libc++", "gcc-native", "hybrid"]),
        label: z.string(),
        viable: z.boolean(),
        reason: z.string(),
        requirements: z.array(z.string()),
      }),
    ),
    notes: z.array(z.string()),
    error: z.string().optional(),
  },
  check_secure_coding: {
    found: z.boolean(),
    totalRules: z.number().optional(),
    rule: z.record(z.string(), z.unknown()).optional(),
    matches: z
      .array(
        z.object({
          id: z.string(),
          category: z.string(),
          title: z.string(),
          severity: z.string(),
          cwe: z.string(),
          vulnerability: z.string(),
          summary: z.string(),
          matchedRules: z.array(z.string()).optional(),
        }),
      )
      .optional(),
    codeAuditFindings: z
      .array(
        z.object({
          ruleId: z.string(),
          cwe: z.string(),
          severity: z.string(),
          vulnerability: z.string(),
          issue: z.string(),
          recommendation: z.string(),
        }),
      )
      .optional(),
    message: z.string().optional(),
  },
  get_cpp_tooling_guide: {
    found: z.boolean(),
    totalTools: z.number().optional(),
    tool: z.string().optional(),
    title: z.string().optional(),
    configFileName: z.string().optional(),
    configContent: z.string().optional(),
    description: z.string().optional(),
    keyDirectives: z.array(z.record(z.string(), z.unknown())).optional(),
    commands: z.array(z.record(z.string(), z.unknown())).optional(),
    content: z.string().optional(),
    topic: z.string().optional(),
    category: z.string().optional(),
    path: z.string().optional(),
    skillsCount: z.number().optional(),
    skills: z
      .array(
        z.object({
          id: z.string(),
          name: z.string(),
          category: z.string(),
          title: z.string(),
          description: z.string(),
        }),
      )
      .optional(),
    categories: z
      .array(
        z.object({
          category: z.string(),
          count: z.number(),
          skills: z.array(z.object({ id: z.string(), title: z.string() })),
        }),
      )
      .optional(),
    matches: z
      .array(
        z.object({
          id: z.string(),
          title: z.string(),
          configFileName: z.string().optional(),
          description: z.string(),
          matchedDirectives: z.array(z.string()).optional(),
          category: z.string().optional(),
        }),
      )
      .optional(),
    message: z.string().optional(),
  },
  rename_code_symbol: {
    success: z.boolean(),
    symbol: z.string(),
    newName: z.string(),
    dryRun: z.boolean(),
    workspaceDir: z.string(),
    totalEdits: z.number(),
    affectedFiles: z.array(
      z.object({
        file: z.string(),
        absolutePath: z.string(),
        editCount: z.number(),
        edits: z.array(
          z.object({
            line: z.number(),
            character: z.number(),
            endLine: z.number(),
            endCharacter: z.number(),
            oldText: z.string(),
            newText: z.string(),
            snippet: z.string().optional(),
          }),
        ),
      }),
    ),
    error: z.string().optional(),
  },
  format_code: {
    formatted: z.boolean(),
    changed: z.boolean(),
    original: z.string().optional(),
    formattedCode: z.string().optional(),
    diff: z.string().optional(),
    file: z.string().optional(),
    applied: z.boolean().optional(),
    styleUsed: z.string().optional(),
    error: z.string().optional(),
    message: z.string().optional(),
  },
  run_clang_tidy: {
    success: z.boolean(),
    tool: z.string().optional(),
    version: z.string().optional(),
    preset: z.string().optional(),
    checks: z.string().optional(),
    applied: z.boolean(),
    files: z.array(z.string()),
    totalWarnings: z.number(),
    totalErrors: z.number(),
    diagnostics: z.array(
      z.object({
        file: z.string(),
        line: z.number(),
        column: z.number(),
        severity: z.enum(["warning", "error", "note"]),
        message: z.string(),
        check: z.string().optional(),
      }),
    ),
    compileCommandsDir: z.string().optional(),
    policyPath: z.string().optional(),
    error: z.string().optional(),
    message: z.string().optional(),
  },
  scaffold_project: {
    success: z.boolean(),
    projectName: z.string(),
    projectDir: z.string(),
    buildSystem: z.string(),
    projectType: z.string(),
    cppStandard: z.string(),
    testFramework: z.string(),
    packageManager: z.string(),
    filesCreated: z.array(z.string()),
    files: z.record(z.string(), z.string()),
    nextSteps: z.array(z.string()),
    gitInitialized: z.boolean().optional(),
    message: z.string().optional(),
  },
  explain_compiler_error: {
    success: z.boolean(),
    category: z.string(),
    detectedCompiler: z.string(),
    summary: z.string(),
    location: z
      .object({
        file: z.string(),
        line: z.number().optional(),
        column: z.number().optional(),
      })
      .optional(),
    codeSnippet: z.string().optional(),
    rootCause: z.string(),
    remediation: z.string(),
    suggestedHeaders: z.array(z.string()).optional(),
    demangledSymbols: z.array(z.object({ mangled: z.string(), demangled: z.string() })).optional(),
    simplifiedError: z.string(),
    pitfalls: z.array(z.string()).optional(),
  },
  generate_documentation: {
    success: z.boolean(),
    tool: z.string(),
    version: z.string().optional(),
    format: z.string(),
    outputDir: z.string(),
    filesGenerated: z.array(
      z.object({
        relativePath: z.string(),
        absolutePath: z.string(),
        sizeBytes: z.number(),
      }),
    ),
    totalFiles: z.number(),
    summary: z.string(),
    previewMarkdown: z.string().optional(),
    error: z.string().optional(),
  },
  generate_compilation_database: {
    success: z.boolean(),
    buildSystem: z.string(),
    compileCommandsPath: z.string().optional(),
    entryCount: z.number(),
    rootLinked: z.boolean(),
    filesIndexed: z.array(z.string()),
    summary: z.string(),
    error: z.string().optional(),
  },
  reorder_struct_fields: {
    success: z.boolean(),
    recordName: z.string(),
    fieldsOrder: z.array(z.string()),
    dryRun: z.boolean(),
    totalFiles: z.number(),
    modifiedFiles: z.array(z.string()),
    changes: z.array(
      z.object({
        file: z.string(),
        modified: z.boolean(),
        diff: z.string().optional(),
      }),
    ),
    unifiedDiff: z.string().optional(),
    warnings: z.array(z.string()),
    summary: z.string(),
    error: z.string().optional(),
  },
  trace_preprocessor: {
    success: z.boolean(),
    source: z.string(),
    tool: z.object({
      name: z.string(),
      path: z.string().optional(),
      version: z.string().optional(),
    }),
    summary: z.object({
      totalEvents: z.number(),
      userEvents: z.number(),
      truncated: z.boolean(),
      counts: z.record(z.string(), z.number()),
    }),
    macros: z.array(
      z.object({
        name: z.string(),
        action: z.enum(["define", "undefine"]),
        file: z.string().optional(),
        loc: z.string().optional(),
      }),
    ),
    includes: z.array(
      z.object({
        fileName: z.string(),
        angled: z.boolean(),
        resolved: z.string().optional(),
        searchPath: z.string().optional(),
        relativePath: z.string().optional(),
        loc: z.string().optional(),
      }),
    ),
    conditionals: z.array(
      z.object({
        kind: z.string(),
        loc: z.string().optional(),
        conditionValue: z.boolean().optional(),
        ifLoc: z.string().optional(),
      }),
    ),
    pragmas: z.array(
      z.object({
        kind: z.string(),
        loc: z.string().optional(),
        namespace: z.string().optional(),
        detail: z.string().optional(),
      }),
    ),
    modules: z.array(
      z.object({
        imported: z.string(),
        loc: z.string().optional(),
        path: z.string().optional(),
      }),
    ),
    events: z
      .array(z.object({ callback: z.string(), fields: z.record(z.string(), z.string()) }))
      .optional(),
    warnings: z.array(z.string()),
    error: z.string().optional(),
  },
};
