import { type McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { CPP_STANDARD_HEADERS, HEADER_MAP } from "../data/headers.js";
import { C_STANDARDS, CPP_STANDARDS, FEATURE_TEST_MACROS } from "../tools/standards.js";

/**
 * Registers native MCP resources for C and C++ standard reference.
 */
export function registerResources(server: McpServer): void {
  // Resource 1: Complete Standard Headers Index
  server.registerResource(
    "cpp_standard_headers",
    "cppref://headers",
    {
      description:
        "Complete catalog of ISO C and C++ standard library headers with categories, standard versions, and declared symbols.",
      mimeType: "application/json",
    },
    async () => {
      return {
        contents: [
          {
            uri: "cppref://headers",
            text: JSON.stringify(CPP_STANDARD_HEADERS, null, 2),
            mimeType: "application/json",
          },
        ],
      };
    },
  );

  // Resource 2: Detailed Specification for a specific header
  server.registerResource(
    "cpp_standard_header_detail",
    new ResourceTemplate("cppref://headers/{name}", { list: undefined }),
    {
      description:
        "Full specification, declared symbols, and language revisions for a specific C or C++ header (e.g. 'vector', 'ranges', 'print', 'cstdio').",
      mimeType: "application/json",
    },
    async (uri: URL, variables: { [key: string]: string | string[] | undefined }) => {
      const rawName = variables.name;
      const cleanName = String(rawName || "")
        .replace(/[<>]/g, "")
        .trim()
        .toLowerCase();
      const headerEntry = HEADER_MAP.get(cleanName);

      if (!headerEntry) {
        return {
          contents: [
            {
              uri: uri.href,
              text: JSON.stringify(
                {
                  error: `Header '<${cleanName}>' is not recognized as a standard C or C++ header.`,
                  recognizedHeadersCount: CPP_STANDARD_HEADERS.length,
                },
                null,
                2,
              ),
              mimeType: "application/json",
            },
          ],
        };
      }

      return {
        contents: [
          {
            uri: uri.href,
            text: JSON.stringify(headerEntry, null, 2),
            mimeType: "application/json",
          },
        ],
      };
    },
  );

  // Resource 3: Standards Timeline and Feature Test Macros
  server.registerResource(
    "cpp_standards_timeline",
    "cppref://standards",
    {
      description:
        "Chronological specification of C++ standards (C++98 to C++26) and C standards (C89 to C23) with official SD-6 / library feature test macros.",
      mimeType: "application/json",
    },
    async () => {
      const payload = {
        cppStandards: CPP_STANDARDS,
        cStandards: C_STANDARDS,
        featureTestMacros: FEATURE_TEST_MACROS,
      };

      return {
        contents: [
          {
            uri: "cppref://standards",
            text: JSON.stringify(payload, null, 2),
            mimeType: "application/json",
          },
        ],
      };
    },
  );
}
