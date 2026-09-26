#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { lookupHeader } from "./tools/header.js";
import { getCppreferencePage } from "./tools/page.js";
import { searchCppreference } from "./tools/search.js";
import { checkCppStandard } from "./tools/standards.js";

export const SERVER_NAME = "cpp-mcp";
export const SERVER_VERSION = "1.0.0";

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

  return server;
}

export async function main(): Promise<void> {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

const isDirectExecution =
  typeof process !== "undefined" &&
  process.argv[1] &&
  (process.argv[1].endsWith("index.js") || process.argv[1].endsWith("index.ts"));

if (isDirectExecution) {
  main().catch((err) => {
    console.error("Fatal error starting cpp-mcp server:", err);
    process.exit(1);
  });
}
