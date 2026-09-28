#!/usr/bin/env node

import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import pkg from "../package.json" with { type: "json" };
import { runCli } from "./cli.js";
import { registerPrompts } from "./prompts/index.js";
import { registerResources } from "./resources/index.js";
import { registerToolDefinitions } from "./tool-registry.js";
import { runClangTidy } from "./tools/clang-tidy.js";
import { formatCode } from "./tools/code-formatter.js";
import { sessionManager } from "./tools/code-session-manager.js";
import { generateCompilationDatabase } from "./tools/compile-db.js";
import { generateDocumentation } from "./tools/doc-generator.js";
import { explainCompilerError } from "./tools/error-explainer.js";
import { reorderStructFields } from "./tools/field-reorderer.js";
import { tracePreprocessor } from "./tools/preprocessor-tracer.js";
import { scaffoldProject } from "./tools/project-scaffold.js";

export { runCli } from "./cli.js";
export const SERVER_NAME = "cpp-mcp";
export const SERVER_VERSION = pkg.version;

/**
 * Creates and configures the C/C++ Reference MCP Server with tools.
 */
export function createServer(): McpServer {
  const server = new McpServer({
    name: SERVER_NAME,
    version: SERVER_VERSION,
  });

  registerToolDefinitions(server);

  server.registerTool(
    "format_code",
    {
      description:
        "Use when code must match the project's style (before a commit, after generation) or to format a snippet. Runs clang-format with .clang-format discovery, presets (LLVM, Google, Chromium, Mozilla, WebKit, Microsoft), line ranges, and atomic disk apply.",
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
    },
    async ({ code, file, workspace, style, fallback_style, apply, start_line, end_line }) => {
      try {
        if (
          (start_line !== undefined && end_line === undefined) ||
          (start_line === undefined && end_line !== undefined)
        ) {
          return {
            isError: true,
            content: [
              {
                type: "text" as const,
                text: "Error: Both 'start_line' and 'end_line' must be provided when specifying a format range.",
              },
            ],
          };
        }

        if (start_line !== undefined && end_line !== undefined && start_line > end_line) {
          return {
            isError: true,
            content: [
              {
                type: "text" as const,
                text: `Error: 'start_line' (${start_line}) cannot be greater than 'end_line' (${end_line}).`,
              },
            ],
          };
        }

        const range =
          start_line !== undefined && end_line !== undefined
            ? { startLine: start_line, endLine: end_line }
            : undefined;

        const result = await formatCode({
          code,
          file,
          workspace,
          style,
          fallbackStyle: fallback_style,
          apply,
          range,
        });

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (error) {
        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text: `Error formatting code: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    },
  );

  server.registerTool(
    "run_clang_tidy",
    {
      description:
        "Use when modernizing or linting C/C++ code (e.g. std::cout -> std::print, NULL -> nullptr, raw new/delete) or gating CI on a check preset. Runs clang-tidy with presets (modernize, bugprone, performance, portability, cppcoreguidelines, cert, security, all) or a raw --checks expression; reports findings by default, apply=true writes fixes to disk.",
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
    },
    async ({ file, files, preset, checks, apply, workspace, build_dir, extra_args }) => {
      try {
        const result = await runClangTidy({
          file,
          files,
          preset,
          checks,
          apply,
          workspace,
          buildDir: build_dir,
          extraArgs: extra_args,
        });

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (error) {
        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text: `Error running clang-tidy: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    },
  );

  server.registerTool(
    "scaffold_project",
    {
      description:
        "Use when starting a new C/C++ project and you want a best-practice skeleton. Scaffolds xmake/CMake with a chosen standard (C++11-26), test framework (Catch2/GTest/doctest), .clang-format, .clangd LSP config, and git.",
      inputSchema: {
        project_name: z
          .string()
          .min(1)
          .describe("Name of the project (alphanumeric, underscores, hyphens, and dots)."),
        target_dir: z
          .string()
          .optional()
          .describe(
            "Directory where the project should be created. Defaults to './<project_name>'.",
          ),
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
    },
    async ({
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
    }) => {
      try {
        const result = await scaffoldProject({
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
        });

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (error) {
        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text: `Error scaffolding project: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    },
  );

  server.registerTool(
    "explain_compiler_error",
    {
      description:
        "Use when a C/C++ build fails and you need the error decoded: massive template/SFINAE backtraces, unsatisfied C++20 concepts, undefined references, vtable issues, missing includes, or module resolution failures. Returns a plain-language diagnosis and fix.",
      inputSchema: {
        error: z
          .string()
          .min(1)
          .describe(
            "Compiler error output or linker error trace (GCC, Clang, or MSVC error text).",
          ),
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
    },
    async ({ error, compiler, code_snippet, workspace_dir }) => {
      try {
        const result = await explainCompilerError({
          error,
          compiler,
          codeSnippet: code_snippet,
          workspaceDir: workspace_dir,
        });

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (err) {
        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text: `Error explaining compiler error: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
        };
      }
    },
  );

  server.registerTool(
    "generate_documentation",
    {
      description:
        "Use when you need API documentation generated from C/C++ sources (Markdown, HTML, JSON, YAML) with Doxygen comments, types, and inheritance. Runs clang-doc non-destructively (manifest-tracked outputs).",
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
    },
    async ({ workspace, files, output_dir, format, public_only, doxygen_only, dry_run }) => {
      try {
        const result = await generateDocumentation({
          workspace,
          files,
          outputDir: output_dir,
          format,
          publicOnly: public_only,
          doxygenOnly: doxygen_only,
          dryRun: dry_run,
        });

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (err) {
        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text: `Error generating documentation: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
        };
      }
    },
  );

  server.registerTool(
    "generate_compilation_database",
    {
      description:
        "Use when clangd or clang tools report a missing compile_commands.json, when symbols don't resolve, or when setting up semantic intelligence for a project without a build system. Generates or resolves the database for CMake, xmake, Meson, Bear, or synthetic mode.",
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
          .describe(
            "Directory for build artifacts and compile_commands.json (defaults to 'build').",
          ),
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
    },
    async ({
      workspace,
      build_system,
      build_dir,
      compiler,
      std,
      include_dirs,
      symlink_to_root,
      dry_run,
    }) => {
      try {
        const result = await generateCompilationDatabase({
          workspace,
          buildSystem: build_system,
          buildDir: build_dir,
          compiler,
          std,
          includeDirs: include_dirs,
          symlinkToRoot: symlink_to_root,
          dryRun: dry_run,
        });

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (err) {
        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text: `Error generating compilation database: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
        };
      }
    },
  );

  server.registerTool(
    "reorder_struct_fields",
    {
      description:
        "Use when optimizing a struct/class memory layout or reordering members safely. Runs clang-reorder-fields and updates field declarations, constructor initializer lists, aggregate initializers, and C++20 designated initializers across the codebase.",
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
    },
    async ({ record_name, fields_order, workspace, files, extra_args, apply }) => {
      try {
        const result = await reorderStructFields({
          recordName: record_name,
          fieldsOrder: fields_order,
          workspace,
          files,
          extraArgs: extra_args,
          apply,
        });

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (err) {
        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text: `Error reordering fields: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
        };
      }
    },
  );

  server.registerTool(
    "trace_preprocessor",
    {
      description:
        "Use when debugging macro expansion or conditional compilation. Traces pp-trace activity — #define/#undef, #include, #if/#ifdef/#elif branches, pragmas, module imports — as an aggregated summary, filtering system-header noise by default.",
      inputSchema: {
        file: z
          .string()
          .describe(
            "Path to the C/C++ source file to trace (absolute or relative to 'workspace').",
          ),
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
    },
    async ({
      file,
      workspace,
      callbacks,
      extra_args,
      max_events,
      include_events,
      user_files_only,
    }) => {
      try {
        const result = await tracePreprocessor({
          file,
          workspace,
          callbacks,
          extraArgs: extra_args,
          maxEvents: max_events,
          includeEvents: include_events,
          userFilesOnly: user_files_only,
        });

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (err) {
        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text: `Error tracing preprocessor: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
        };
      }
    },
  );

  registerResources(server);
  registerPrompts(server);

  return server;
}

export async function main(): Promise<void> {
  const server = createServer();
  const transport = new StdioServerTransport();

  const cleanup = async () => {
    await sessionManager.closeAll();
  };

  process.on("SIGINT", async () => {
    await cleanup();
    process.exit(0);
  });

  process.on("SIGTERM", async () => {
    await cleanup();
    process.exit(0);
  });

  process.on("exit", () => {
    void sessionManager.closeAll();
  });

  await server.connect(transport);
}

const entryArg = typeof process !== "undefined" ? process.argv[1] : undefined;

/**
 * True when argv[1] resolves to this very module. Comparing real paths is
 * precise: import.meta.main is false under `bun test`, and the previous
 * substring heuristic (`arg.includes("test")`) silently disabled CLI mode for
 * any argument or path containing "test" (e.g. `code-diagnostics tests/a.cpp`).
 */
export function isEntryPoint(entry: string): boolean {
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

const isDirectExecution =
  (typeof import.meta !== "undefined" && Boolean(import.meta.main)) ||
  (typeof process !== "undefined" && entryArg !== undefined && isEntryPoint(entryArg));

if (isDirectExecution) {
  const args = typeof process !== "undefined" ? process.argv.slice(2) : [];
  const isStdioMode =
    args.length === 0 ||
    args.includes("--stdio") ||
    args[0] === "stdio" ||
    args.includes("--transport");

  if (!isStdioMode) {
    runCli(args)
      .then(async (code) => {
        await sessionManager.closeAll();
        process.exit(code);
      })
      .catch(async (err) => {
        await sessionManager.closeAll();
        console.error("Fatal CLI error:", err);
        process.exit(1);
      });
  } else {
    main().catch(async (err) => {
      await sessionManager.closeAll();
      console.error("Fatal error starting cpp-mcp server:", err);
      process.exit(1);
    });
  }
}
