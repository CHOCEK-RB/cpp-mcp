#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import pkg from "../package.json" with { type: "json" };
import { registerPrompts } from "./prompts/index.js";
import { registerResources } from "./resources/index.js";
import { checkSecureCoding } from "./tools/cert.js";
import { checkCompilerSupport } from "./tools/compiler-support.js";
import { demangleSymbol } from "./tools/demangle.js";
import { getGuideline } from "./tools/guidelines.js";
import { lookupHeader } from "./tools/header.js";
import { getCppModulesGuide } from "./tools/modules.js";
import { getCppreferencePage } from "./tools/page.js";
import { searchCppreference } from "./tools/search.js";
import { checkCppStandard } from "./tools/standards.js";
import { getCppToolingGuide } from "./tools/tooling.js";

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

  server.registerTool(
    "search_cppreference",
    {
      description:
        "Search cppreference.com for C or C++ standard library, language, and compiler documentation. Returns up to 5 matching URLs.",
      inputSchema: {
        query: z
          .string()
          .describe(
            "Concise C or C++ search query, such as a symbol, header, keyword, or concept (e.g. std::vector, constexpr, std::ranges::sort).",
          ),
      },
    },
    async ({ query }) => {
      try {
        const result = await searchCppreference(query);
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
              text: `Error searching cppreference: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    },
  );

  server.registerTool(
    "get_cppreference_page",
    {
      description:
        "Retrieve a cppreference.com documentation page and return its sanitized content as Markdown.",
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
    },
    async ({ url, cursor }) => {
      try {
        const result = await getCppreferencePage(url, cursor);
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
              text: `Error retrieving cppreference page: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    },
  );

  server.registerTool(
    "lookup_header",
    {
      description:
        "Find the standard C or C++ header (<vector>, <algorithm>, <cstdio>, etc.) required for a given function, type, class, or symbol, including standard version and category.",
      inputSchema: {
        symbol: z
          .string()
          .min(1)
          .describe(
            "C or C++ symbol, type, function, class, or header name (e.g. 'std::vector', 'printf', 'std::views::filter', 'size_t', '<ranges>')",
          ),
      },
    },
    async ({ symbol }) => {
      try {
        const result = await lookupHeader(symbol);
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
              text: `Error looking up header for "${symbol}": ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    },
  );

  server.registerTool(
    "check_cpp_standard",
    {
      description:
        "Check which C or C++ standard version introduced, deprecated, or removed a given symbol, function, class, or header, and verify compatibility against a target language standard (e.g. C++17, C++20, C++23).",
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
    },
    async ({ symbol, standard }) => {
      try {
        const result = await checkCppStandard(symbol, standard);
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
              text: `Error checking standard version for "${symbol}": ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    },
  );

  server.registerTool(
    "get_guideline",
    {
      description:
        "Look up rules, modern idioms, and best practices from the official C++ Core Guidelines (Bjarne Stroustrup & Herb Sutter) by rule ID (e.g. 'F.16', 'R.1', 'C.21', 'I.11') or keyword query (e.g. 'RAII', 'ownership', 'smart pointers', 'rule of five').",
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
    },
    async ({ rule_id, query, section, include_content }) => {
      try {
        const result = getGuideline({
          ruleId: rule_id,
          query,
          section,
          includeContent: include_content ?? Boolean(rule_id),
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
              text: `Error retrieving C++ Core Guideline: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    },
  );

  server.registerTool(
    "get_cpp_modules_guide",
    {
      description:
        "Retrieve authoritative architecture guides, rules, code patterns, and best practices for C++ Modules in C++20, C++23, and C++26. Covers 'import std;', interface & implementation partitions, Global Module Fragment macro isolation, CMake 3.28+ setup, and header migration.",
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
    },
    async ({ topic, standard, query }) => {
      try {
        const result = getCppModulesGuide({
          topic,
          standard,
          query,
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
              text: `Error retrieving C++ modules guide: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    },
  );

  server.registerTool(
    "check_secure_coding",
    {
      description:
        "Audit C++ code for security vulnerabilities, undefined behavior (UB), and safety violations against the official SEI CERT C++ Coding Standard and MITRE CWEs. Provides noncompliant code explanations and secure modern fixes.",
      inputSchema: {
        rule_id: z
          .string()
          .optional()
          .describe(
            "Specific SEI CERT rule ID (e.g. 'MEM50-CPP', 'OOP50-CPP', 'CON53-CPP', 'EXP54-CPP') or CWE ID (e.g. 'CWE-416', 'CWE-833')",
          ),
        category: z
          .enum(["MEM", "EXP", "CTR", "ERR", "CON", "OOP", "MSC", "DCL", "FIO"])
          .optional()
          .describe(
            "SEI CERT category filter ('MEM' memory, 'CON' concurrency, 'EXP' expressions, 'OOP' object-oriented, 'ERR' exceptions, 'CTR' containers)",
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
    },
    async ({ rule_id, category, query, code }) => {
      try {
        const result = checkSecureCoding({
          rule_id,
          category,
          query,
          code,
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
              text: `Error checking secure coding rules: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    },
  );

  server.registerTool(
    "get_cpp_tooling_guide",
    {
      description:
        "Retrieve authoritative documentation, commands, and production starter configurations for modern C/C++ developer tools (xmake build system with C++20 modules, .clang-format, .clang-tidy, and LLVM/GCC runtime sanitizers).",
      inputSchema: {
        tool: z
          .string()
          .optional()
          .describe(
            "Target tool ID or alias (e.g. 'xmake', 'clang-format', 'clang-tidy', 'sanitizers', 'format', 'tidy', 'asan')",
          ),
        query: z
          .string()
          .optional()
          .describe(
            "Search query across directives, CLI commands, and configuration options (e.g. 'compile_commands', 'add_requires', 'modernize', 'IndentWidth')",
          ),
        generate_config: z
          .boolean()
          .optional()
          .describe(
            "If true, outputs the raw, copy-pasteable production configuration file (e.g. xmake.lua, .clang-format, .clang-tidy)",
          ),
      },
    },
    async ({ tool, query, generate_config }) => {
      try {
        const result = getCppToolingGuide({
          tool,
          query,
          generate_config,
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
              text: `Error retrieving C++ tooling guide: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    },
  );

  server.registerTool(
    "check_compiler_support",
    {
      description:
        "Check minimum compiler support versions (GCC, Clang, MSVC, Apple Clang) for modern C++ features (e.g. std::print, std::expected, import std, std::generator, coroutines, concepts, modules). Optionally evaluate if a specific user compiler version is compatible.",
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
    },
    async ({ feature, standard, compiler, version }) => {
      try {
        const result = checkCompilerSupport({
          feature,
          standard,
          compiler,
          version,
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
              text: `Error checking compiler support: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    },
  );

  server.registerTool(
    "demangle_symbol",
    {
      description:
        "Demangle C++ mangled symbol names (Itanium ABI for GCC/Clang, or MSVC) into human-readable function signatures, or translate entire compiler/linker error trace logs containing mangled identifiers.",
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
    },
    async ({ symbol, strip_params }) => {
      try {
        const result = demangleSymbol({
          symbol,
          strip_params,
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
              text: `Error demangling symbol: ${error instanceof Error ? error.message : String(error)}`,
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
  await server.connect(transport);
}

const entryArg = typeof process !== "undefined" ? process.argv[1] : undefined;
const isDirectExecution =
  (typeof import.meta !== "undefined" && Boolean(import.meta.main)) ||
  (typeof process !== "undefined" &&
    entryArg !== undefined &&
    !process.argv.some((arg) => arg.includes("test")) &&
    (entryArg.endsWith("index.js") ||
      entryArg.endsWith("index.ts") ||
      entryArg.includes("cpp-mcp")));

if (isDirectExecution) {
  main().catch((err) => {
    console.error("Fatal error starting cpp-mcp server:", err);
    process.exit(1);
  });
}
