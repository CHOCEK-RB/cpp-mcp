import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

/**
 * Registers native MCP prompts for AI-assisted C and C++ workflows.
 */
export function registerPrompts(server: McpServer): void {
  // Prompt 1: Deep explanation of a C/C++ symbol
  server.registerPrompt(
    "cpp_explain_symbol",
    {
      description:
        "Generate a structured, authoritative explanation of a C or C++ symbol, covering declaration, required header, language version availability, complexity, and modern usage examples.",
      argsSchema: {
        symbol: z
          .string()
          .min(1)
          .describe(
            "C or C++ symbol, type, function, or concept name (e.g. 'std::vector', 'std::ranges::views::filter', 'printf', 'std::span')",
          ),
        standard: z
          .string()
          .optional()
          .describe(
            "Target language standard to contextualize the explanation (e.g. 'C++20', 'C++23', 'C11')",
          ),
      },
    },
    async ({ symbol, standard }) => {
      const targetStdText = standard ? ` in standard ${standard}` : "";
      return {
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text: `Please provide a thorough, authoritative explanation of the C/C++ symbol \`${symbol}\`${targetStdText} based on cppreference standards:

1. **Header Requirement:** Specify the exact header (\`<...>\`) needed to use it.
2. **Language Availability:** State the standard version where it was introduced, and any deprecation or removal notices.
3. **Signatures & Overloads:** Present representative declarations and template parameters.
4. **Complexity & Safety:** Detail time/space complexity guarantees and exception safety.
5. **Idiomatic Example:** Provide a concise, modern, compile-ready example demonstrating best practices.`,
            },
          },
        ],
      };
    },
  );

  // Prompt 2: Modernize legacy C/C++ code
  server.registerPrompt(
    "cpp_modernize_code",
    {
      description:
        "Refactor and modernize legacy C or C++ code to a target modern standard (e.g. C++20 or C++23), adopting RAII, concepts, ranges, string_view, smart pointers, and constexpr.",
      argsSchema: {
        code: z.string().min(1).describe("The legacy C or C++ code to refactor"),
        targetStandard: z
          .string()
          .optional()
          .describe("Target modern standard version (defaults to 'C++20')"),
      },
    },
    async ({ code, targetStandard }) => {
      const target = targetStandard || "C++20";
      return {
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text: `Modernize and refactor the following C/C++ code to **${target}** standards:

\`\`\`cpp
${code}
\`\`\`

Refactoring objectives:
- Replace raw pointers and manual memory management with RAII and smart pointers (\`std::unique_ptr\`, \`std::shared_ptr\`).
- Adopt modern standard containers, \`std::string_view\`, and \`std::span\` where appropriate.
- Replace raw indexing loops with range-based for loops, \`std::ranges\` algorithms, or views.
- Replace legacy formatting (\`printf\`, \`sprintf\`) with \`std::format\` (C++20) or \`std::print\` (C++23) if available.
- Ensure type safety, \`constexpr\` suitability, and \`noexcept\` correctness.
- Explain the key improvements made and specify the required headers.`,
            },
          },
        ],
      };
    },
  );

  // Prompt 3: Diagnose compilation error
  server.registerPrompt(
    "cpp_diagnose_compiler_error",
    {
      description:
        "Diagnose a C or C++ compiler diagnostic message, identifying missing headers, standard flag discrepancies (-std=c++20), concept constraints, or deprecated API usage.",
      argsSchema: {
        symbol: z.string().min(1).describe("The symbol or construct involved in the error"),
        errorMessage: z.string().min(1).describe("The compiler error or warning output"),
        compiler: z
          .string()
          .optional()
          .describe("Compiler name and version (e.g. 'GCC 13', 'Clang 17', 'MSVC 19.38')"),
      },
    },
    async ({ symbol, errorMessage, compiler }) => {
      const compilerInfo = compiler ? ` using ${compiler}` : "";
      return {
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text: `Diagnose the following C/C++ compiler error related to symbol \`${symbol}\`${compilerInfo}:

\`\`\`
${errorMessage}
\`\`\`

Analysis guidelines:
1. **Root Cause:** State clearly why the compiler issued this error (e.g., missing \`#include\`, language standard flag mismatch like \`-std=c++20\`, template constraint/concept violation, or API removal).
2. **Standard & Header Verification:** Check which header defines \`${symbol}\` and its minimum required language revision.
3. **Fix & Resolution:** Provide the exact code adjustment, header include, or compiler flag needed to fix the error.`,
            },
          },
        ],
      };
    },
  );
}
