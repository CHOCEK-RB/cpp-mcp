// src/tool-registry.ts
// Single source of truth for the MCP tool surface. Each definition carries the
// name, description, input schema, error label and pure invocation; src/index.ts
// registers them in a loop, so a tool is declared exactly once.

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { checkSecureCoding } from "./tools/cert.js";
import { getGuideline } from "./tools/guidelines.js";
import { lookupHeader } from "./tools/header.js";
import { checkModuleToolchain } from "./tools/module-toolchain.js";
import { getCppModulesGuide } from "./tools/modules.js";
import { getCppreferencePage } from "./tools/page.js";
import { searchCppreference } from "./tools/search.js";
import { checkCppStandard } from "./tools/standards.js";

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
];
