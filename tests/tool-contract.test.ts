import { describe, expect, it } from "bun:test";
import { runCli } from "../src/cli.js";
import { createServer } from "../src/index.js";
import { isFailureResult } from "../src/tool-registry.js";

interface RegisteredTool {
  description?: string;
  inputSchema?: { shape?: Record<string, unknown> };
  annotations?: Record<string, unknown>;
  handler: unknown;
}

interface ToolCallResult {
  isError?: boolean;
  content?: Array<{ type: string; text?: string }>;
  structuredContent?: unknown;
}

/**
 * Frozen contract: the tool names and the exact set of input parameter names
 * each one accepts. Any intentional change to a public schema must be reflected
 * here, which forces the author to think about downstream clients (prompts,
 * resources, README) before shipping it.
 */
const EXPECTED_SCHEMAS: Record<string, string[]> = {
  search_cppreference: ["query"],
  get_cppreference_page: ["cursor", "url"],
  lookup_header: ["symbol"],
  check_cpp_standard: ["standard", "symbol"],
  get_guideline: ["include_content", "query", "rule_id", "section"],
  get_cpp_modules_guide: ["query", "standard", "topic"],
  check_module_toolchain: [],
  check_secure_coding: ["category", "code", "query", "rule_id"],
  get_cpp_tooling_guide: ["category", "generate_config", "query", "tool", "topic"],
  check_compiler_support: ["compiler", "feature", "standard", "version"],
  demangle_symbol: ["strip_params", "symbol"],
  search_code_symbols: ["files", "limit", "query", "workspaceDir"],
  analyze_code_symbol: ["file", "line", "maxExamples", "symbol", "workspaceDir"],
  get_project_details: ["autoGenerate", "workspaceDir"],
  get_code_diagnostics: ["code", "file", "severity", "waitTimeout", "workspaceDir"],
  rename_code_symbol: ["dry_run", "file", "line", "new_name", "symbol", "workspaceDir"],
  format_code: [
    "apply",
    "code",
    "end_line",
    "fallback_style",
    "file",
    "start_line",
    "style",
    "workspace",
  ],
  run_clang_tidy: [
    "apply",
    "build_dir",
    "checks",
    "extra_args",
    "file",
    "files",
    "preset",
    "workspace",
  ],
  scaffold_project: [
    "build_system",
    "cpp_standard",
    "dry_run",
    "init_clang_tools",
    "init_git",
    "overwrite",
    "package_manager",
    "project_name",
    "project_type",
    "target_dir",
    "test_framework",
  ],
  explain_compiler_error: ["code_snippet", "compiler", "error", "workspace_dir"],
  generate_documentation: [
    "doxygen_only",
    "dry_run",
    "files",
    "format",
    "output_dir",
    "public_only",
    "workspace",
  ],
  generate_compilation_database: [
    "build_dir",
    "build_system",
    "compiler",
    "dry_run",
    "include_dirs",
    "std",
    "symlink_to_root",
    "workspace",
  ],
  reorder_struct_fields: [
    "apply",
    "extra_args",
    "fields_order",
    "files",
    "record_name",
    "workspace",
  ],
  trace_preprocessor: [
    "callbacks",
    "extra_args",
    "file",
    "include_events",
    "max_events",
    "user_files_only",
    "workspace",
  ],
};

/**
 * MCP tool -> CLI command. `null` marks an intentional parity gap; every other
 * tool must be reachable from the CLI (AGENTS.md section 3.4). Adding a tool
 * without updating this table fails the suite.
 */
const CLI_COMMAND_BY_TOOL: Record<string, string | null> = {
  search_cppreference: "search",
  // Documented gap: the CLI has no standalone page-fetch command.
  get_cppreference_page: null,
  lookup_header: "header",
  check_cpp_standard: "standard",
  get_guideline: "guideline",
  get_cpp_modules_guide: "module",
  check_module_toolchain: "module-toolchain",
  check_secure_coding: "cert",
  get_cpp_tooling_guide: "tooling",
  check_compiler_support: "compiler",
  demangle_symbol: "demangle",
  search_code_symbols: "code-search",
  analyze_code_symbol: "code-analyze",
  get_project_details: "project",
  get_code_diagnostics: "code-diagnostics",
  rename_code_symbol: "code-rename",
  format_code: "code-format",
  run_clang_tidy: "clang-tidy",
  scaffold_project: "scaffold",
  explain_compiler_error: "explain-error",
  generate_documentation: "docs",
  generate_compilation_database: "compile-db",
  reorder_struct_fields: "reorder-fields",
  trace_preprocessor: "trace-preprocessor",
};

/**
 * Tools invoked with `{}` that answer from local data (no network, no writes)
 * and always return a JSON payload, regardless of what the host has installed.
 */
const INVOKE_LOCAL: string[] = [
  "get_guideline",
  "get_cpp_modules_guide",
  "check_module_toolchain",
  "check_secure_coding",
  "get_cpp_tooling_guide",
  "check_compiler_support",
  "get_project_details",
];

/**
 * Tools that shell out to an external LLVM binary. With `{}` they return either a
 * JSON payload or a dependency error, depending on the host, so the contract is
 * looser: a text envelope whose body parses as JSON only when it is not an error.
 */
const INVOKE_DEPENDENT: string[] = [
  "format_code",
  "run_clang_tidy",
  "reorder_struct_fields",
  "generate_documentation",
];

/** Tools that must reject empty input before any I/O, returning `isError`. */
const INVOKE_MISSING_INPUT: string[] = [
  "get_cppreference_page",
  "check_cpp_standard",
  "demangle_symbol",
  "explain_compiler_error",
  "trace_preprocessor",
  "scaffold_project",
];

/** Tools deliberately not invoked: they fetch, index or write to the project. */
const INTROSPECT_ONLY: string[] = [
  "search_cppreference",
  "lookup_header",
  "search_code_symbols",
  "analyze_code_symbol",
  "get_code_diagnostics",
  "rename_code_symbol",
  "generate_compilation_database",
];

function registeredTools(): Record<string, RegisteredTool> {
  const server = createServer();
  // @ts-expect-error accessing private property for test verification
  return server._registeredTools as Record<string, RegisteredTool>;
}

async function callTool(
  tool: RegisteredTool,
  args: Record<string, unknown>,
): Promise<ToolCallResult> {
  const handler = tool.handler as (a: unknown, b: unknown) => Promise<ToolCallResult>;
  return handler(args, {});
}

async function helpText(): Promise<string> {
  const lines: string[] = [];
  const original = console.log;
  console.log = (...args: unknown[]) => {
    lines.push(args.map(String).join(" "));
  };
  try {
    await runCli(["--help"]);
  } finally {
    console.log = original;
  }
  return lines.join("\n");
}

describe("MCP tool contract", () => {
  it("exposes exactly the expected tools", () => {
    expect(Object.keys(registeredTools()).sort()).toEqual(Object.keys(EXPECTED_SCHEMAS).sort());
  });

  it("keeps every tool's input schema stable", () => {
    const tools = registeredTools();
    for (const [name, expected] of Object.entries(EXPECTED_SCHEMAS)) {
      const shape = tools[name]?.inputSchema?.shape ?? {};
      expect(Object.keys(shape).sort()).toEqual(expected);
    }
  });

  it("gives every tool a non-empty description", () => {
    for (const tool of Object.values(registeredTools())) {
      expect(typeof tool.description).toBe("string");
      expect((tool.description ?? "").length).toBeGreaterThan(20);
    }
  });

  it("declares all four behaviour hints as booleans on every tool", () => {
    const hints = ["readOnlyHint", "destructiveHint", "idempotentHint", "openWorldHint"] as const;
    for (const [name, tool] of Object.entries(registeredTools())) {
      expect(tool.annotations, `${name} is missing annotations`).toBeDefined();
      for (const hint of hints) {
        expect(typeof tool.annotations?.[hint], `${name}.${hint}`).toBe("boolean");
      }
    }
  });
});

describe("MCP tool handlers", () => {
  it("classifies every tool as invoked or introspect-only", () => {
    const classified = [
      ...INVOKE_LOCAL,
      ...INVOKE_DEPENDENT,
      ...INVOKE_MISSING_INPUT,
      ...INTROSPECT_ONLY,
    ].sort();
    expect(classified).toEqual(Object.keys(EXPECTED_SCHEMAS).sort());
  });

  for (const name of INVOKE_LOCAL) {
    it(`returns a JSON payload from ${name}`, async () => {
      const result = await callTool(registeredTools()[name] as RegisteredTool, {});
      expect(result.isError).not.toBe(true);
      const text = result.content?.[0]?.text ?? "";
      expect(result.content?.[0]?.type).toBe("text");
      expect(() => JSON.parse(text)).not.toThrow();
    });
  }

  for (const name of INVOKE_DEPENDENT) {
    it(`returns a JSON payload or a dependency error from ${name}`, async () => {
      const result = await callTool(registeredTools()[name] as RegisteredTool, {});
      expect(result.content?.[0]?.type).toBe("text");
      const text = result.content?.[0]?.text ?? "";
      expect(text.length).toBeGreaterThan(0);
      if (!result.isError) {
        expect(() => JSON.parse(text)).not.toThrow();
      }
    });
  }

  for (const name of INVOKE_MISSING_INPUT) {
    it(`returns an error envelope from ${name} without arguments`, async () => {
      const result = await callTool(registeredTools()[name] as RegisteredTool, {});
      expect(result.isError).toBe(true);
      const text = result.content?.[0]?.text ?? "";
      expect(result.content?.[0]?.type).toBe("text");
      expect(text.length).toBeGreaterThan(0);
    });
  }
});

describe("MCP structured output", () => {
  const samples: Record<string, Record<string, unknown>> = {
    check_compiler_support: { feature: "std::print" },
    get_project_details: {},
    lookup_header: { symbol: "std::vector" },
    check_cpp_standard: { symbol: "std::auto_ptr", standard: "C++17" },
    demangle_symbol: { symbol: "_Z3fooi" },
  };

  for (const [name, args] of Object.entries(samples)) {
    it(`returns structuredContent consistent with the text JSON from ${name}`, async () => {
      const result = await callTool(registeredTools()[name] as RegisteredTool, args);
      expect(result.isError).not.toBe(true);
      expect(result.content?.[0]?.type).toBe("text");
      const text = result.content?.[0]?.text ?? "";
      expect(result.structuredContent).toEqual(JSON.parse(text));
    });
  }

  it("keeps tools without an output schema text-only", async () => {
    const result = await callTool(registeredTools().check_module_toolchain as RegisteredTool, {});
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toBeUndefined();
  });
});

describe("MCP error contract", () => {
  it("treats only an explicit success:false as a failure", () => {
    expect(isFailureResult({ success: false })).toBe(true);
    expect(isFailureResult({ success: true })).toBe(false);
    expect(isFailureResult({ found: false })).toBe(false);
    expect(isFailureResult(null)).toBe(false);
    expect(isFailureResult("error")).toBe(false);
  });

  it("fails fast with an actionable message when a required binary is missing", async () => {
    const previous = process.env.CLANG_FORMAT_PATH;
    process.env.CLANG_FORMAT_PATH = "/nonexistent/clang-format-for-test";
    try {
      const result = await callTool(registeredTools().format_code as RegisteredTool, {
        code: "int  main(){}",
      });
      expect(result.isError).toBe(true);
      expect(result.content?.[0]?.text ?? "").toContain("CLANG_FORMAT_PATH");
    } finally {
      if (previous === undefined) {
        delete process.env.CLANG_FORMAT_PATH;
      } else {
        process.env.CLANG_FORMAT_PATH = previous;
      }
    }
  });
});

describe("MCP / CLI parity", () => {
  it("maps every tool to a CLI command or a documented gap", () => {
    expect(Object.keys(CLI_COMMAND_BY_TOOL).sort()).toEqual(Object.keys(EXPECTED_SCHEMAS).sort());
  });

  it("lists every mapped command in the CLI help", async () => {
    const help = await helpText();
    const missing: string[] = [];
    for (const [tool, command] of Object.entries(CLI_COMMAND_BY_TOOL)) {
      if (!command) continue;
      const listed = new RegExp(`(^|\\s)${command}(\\s|$)`, "m").test(help);
      if (!listed) missing.push(`${tool} -> ${command}`);
    }
    expect(missing).toEqual([]);
  });
});
