// src/cli-registry.ts
// Declarative catalog of the direct-CLI command surface. src/cli.ts dispatches
// from this table and renders its help from it, so a command cannot exist in
// one place and be missing from the other.

import pkg from "../package.json" with { type: "json" };

export interface CliCommandSpec {
  /** Canonical command name typed after `cpp-mcp`. */
  command: string;
  /** Additional accepted spellings that resolve to this command. */
  aliases?: readonly string[];
  /** MCP tool this command fronts. Omitted for CLI-only commands. */
  tool?: string;
  /** Help line (already padded), rendered verbatim in the Commands block. */
  usage: string;
}

export const CLI_COMMANDS = [
  {
    command: "header",
    tool: "lookup_header",
    usage:
      "header <symbol>                   Lookup standard header for a symbol (e.g. std::span -> <span>)",
  },
  {
    command: "query",
    usage:
      "query <symbol|concept>            Comprehensive lookup across headers and documentation",
  },
  {
    command: "search",
    tool: "search_cppreference",
    usage: "search <query>                    Search cppreference.com for documentation and URLs",
  },
  {
    command: "project",
    tool: "get_project_details",
    usage:
      "project [dir]                     Inspect workspace build configuration, compile_commands, and tools",
  },
  {
    command: "code-search",
    tool: "search_code_symbols",
    usage:
      "code-search <query>               Search symbols in workspace code (clangd + xmake/CMake)",
  },
  {
    command: "code-analyze",
    tool: "analyze_code_symbol",
    usage: "code-analyze <symbol>             Analyze symbol definition, hierarchy, and usage",
  },
  {
    command: "code-diagnostics",
    aliases: ["diagnostics", "check"],
    tool: "get_code_diagnostics",
    usage: "code-diagnostics [file]           Inspect live compiler errors and warnings via clangd",
  },
  {
    command: "code-rename",
    aliases: ["rename"],
    tool: "rename_code_symbol",
    usage:
      "code-rename <symbol> <new_name>   Rename symbol across project using AST analysis (clangd)",
  },
  {
    command: "code-format",
    aliases: ["format"],
    tool: "format_code",
    usage:
      "code-format [file]                Format C/C++ source code or file via clang-format (--style, --apply)",
  },
  {
    command: "clang-tidy",
    aliases: ["tidy", "modernize"],
    tool: "run_clang_tidy",
    usage:
      "clang-tidy [files...]             Lint/auto-fix C/C++ files via clang-tidy (--preset, --checks, --apply, --check)",
  },
  {
    command: "scaffold",
    aliases: ["init"],
    tool: "scaffold_project",
    usage:
      "scaffold <name>                   Scaffold modern C++ project (xmake/CMake, C++20, Catch2, clangd)",
  },
  {
    command: "explain-error",
    aliases: ["explain"],
    tool: "explain_compiler_error",
    usage:
      "explain-error <text|->            Explain complex C++ compiler or linker errors (or pipe via stdin)",
  },
  {
    command: "docs",
    aliases: ["generate-docs", "clang-doc"],
    tool: "generate_documentation",
    usage:
      "docs [files...]                   Generate API documentation via clang-doc (--format, --output)",
  },
  {
    command: "compile-db",
    aliases: ["compiledb", "generate-compile-commands"],
    tool: "generate_compilation_database",
    usage:
      "compile-db [dir]                  Generate compile_commands.json (auto, CMake, xmake, Meson, Bear, synthetic)",
  },
  {
    command: "reorder-fields",
    aliases: ["reorder"],
    tool: "reorder_struct_fields",
    usage:
      "reorder-fields <record> <order>   Reorder fields in C/C++ struct/class via clang-reorder-fields (--apply)",
  },
  {
    command: "trace-preprocessor",
    aliases: ["trace-pp", "pretrace"],
    tool: "trace_preprocessor",
    usage:
      "trace-preprocessor <file>         Trace macros, includes, and #if branches via pp-trace (--callbacks, --max-events)",
  },
  {
    command: "compiler",
    tool: "check_compiler_support",
    usage:
      "compiler <feature> [options]      Check compiler support matrix (GCC, Clang, MSVC, Apple Clang)",
  },
  {
    command: "demangle",
    tool: "demangle_symbol",
    usage: "demangle <symbol|->               Demangle Itanium or MSVC mangled symbols (or stdin)",
  },
  {
    command: "cert",
    tool: "check_secure_coding",
    usage: "cert <rule_id|cwe|category>       Audit against SEI CERT C++ rules and CWEs",
  },
  {
    command: "guideline",
    tool: "get_guideline",
    usage: "guideline <rule_id|query>         Lookup C++ Core Guidelines rules and enforcement",
  },
  {
    command: "standard",
    tool: "check_cpp_standard",
    usage: "standard <version>                Inspect C or C++ standard features and test macros",
  },
  {
    command: "module",
    tool: "get_cpp_modules_guide",
    usage: "module <topic>                    Inspect C++20/23/26 modules architecture guides",
  },
  {
    command: "module-toolchain",
    aliases: ["module-check"],
    tool: "check_module_toolchain",
    usage:
      "module-toolchain                  Check which 'import std;' / modules toolchain is viable on this host",
  },
  {
    command: "tooling",
    tool: "get_cpp_tooling_guide",
    usage:
      "tooling <tool> [topic]            Inspect modern C++ tooling & official xmake recipes (58 skills)",
  },
] as const satisfies readonly CliCommandSpec[];

export type CliCommandName = (typeof CLI_COMMANDS)[number]["command"];

/** A catalog entry with its literal command/alias types preserved. */
export type CliCommand = (typeof CLI_COMMANDS)[number];

/** Resolves a canonical name or an alias to its command spec. */
export const CLI_COMMAND_BY_NAME: ReadonlyMap<string, CliCommand> = new Map(
  CLI_COMMANDS.flatMap((spec) =>
    [spec.command, ...("aliases" in spec ? (spec.aliases ?? []) : [])].map(
      (name) => [name, spec] as const,
    ),
  ),
);

const OPTIONS_HELP = `  --json                            Output response in raw JSON format
  --raw                             Print only primary scalar value (e.g. only header name or formatted code)
  --workspace <dir>                 Project root directory for code tools and .clang-format lookup
  --file <path>                     Source file path for symbol disambiguation, diagnostics, rename, or format
  --line <num>                      Line number (1-indexed) for symbol disambiguation or rename
  --lines <start:end>               Line range (1-indexed) to format only a sub-region
  --style <name>                    Format style ('file', 'LLVM', 'Google', 'Chromium', 'Mozilla', 'WebKit')
  --apply                           Apply rename, format, or reorder changes to disk (default is dry-run)
  --dry-run                         Preview changes without modifying files (default)
  --order, --fields-order <order>   Comma-separated list of field names in desired order
  --extra-arg <arg>                 Additional compiler flag for clang-reorder-fields or pp-trace (e.g. -std=c++20)
  --callbacks <a,b,...>             Restrict pp-trace to specific callbacks or globs (e.g. MacroDefined,MacroExpands)
  --max-events <num>                Max raw pp-trace events returned with --include-events (default: 500)
  --include-events                  Include capped raw pp-trace callback events in the output
  --all-files                       Include system-header events in pp-trace output (default: project files only)
  --dir <path>                      Target directory for scaffolded project (default: ./<name>)
  --build <xmake|cmake>             Build system for scaffolding (default: xmake)
  --build-system <system>           Build system for compile-db ('auto', 'cmake', 'xmake', 'meson', 'bear', 'synthetic')
  --build-dir <dir>                 Build directory for compile_commands.json (default: 'build')
  --no-root-link                    Do not copy/link compile_commands.json to workspace root
  --type <type>                     Project type (executable, library, header-only, cxx-modules, qt, cuda)
  --std <version>                   C++ standard for scaffolding/compile-db (11, 14, 17, 20, 23, 26)
  --test <framework>                Test framework (catch2, gtest, doctest, none)
  --pm, --package-manager <name>    Package manager (xrepo, vcpkg, conan, none)
  --git                             Initialize git repository during scaffold
  --no-clang                        Disable generation of .clang-format and .clangd
  --force, --overwrite              Overwrite existing non-empty directory during scaffold
  --severity <level>                Filter diagnostics (all, error, warning)
  --code <code>                     Inline code snippet to check or format without saving to disk
  --output, -o <dir>                Output directory for generated documentation (default: docs/api)
  --format <format>                 Doc format: 'md', 'html', 'json', 'yaml' (default: md)
  --public                          Document only public declarations
  --doxygen                         Parse only Doxygen-style comments
  --compiler <name>                 Compiler name for compatibility checks (gcc, clang, msvc, apple_clang)
  --version <ver>                   Compiler version to evaluate against feature requirement
  -v, --version                     Print version and exit
  -h, --help                        Print this help message and exit`;

/** Renders the full `--help` text from the command catalog. */
export function renderHelp(): string {
  const commands = CLI_COMMANDS.map((spec) => `  ${spec.usage}`).join("\n");
  return `cpp-mcp v${pkg.version} - Fast offline C/C++ reference and developer tools

Usage:
  cpp-mcp [command] [arguments] [options]
  cpp-mcp <symbol>                  # Fast header lookup (e.g. cpp-mcp std::span)

Commands:
${commands}

Options:
${OPTIONS_HELP}

When executed without arguments, cpp-mcp runs as an MCP stdio server.`;
}
