import { type McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { COMPILER_SUPPORT_BY_ID, COMPILER_SUPPORT_ENTRIES } from "../data/compiler_support.js";
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

  // Resource 4: C++ Core Guidelines Index
  server.registerResource(
    "cpp_core_guidelines_index",
    "cppref://guidelines",
    {
      description:
        "Complete index of all official C++ Core Guidelines rules (Bjarne Stroustrup & Herb Sutter) with IDs, titles, sections, and URLs.",
      mimeType: "application/json",
    },
    async () => {
      const { CPP_CORE_GUIDELINES } = await import("../data/guidelines.js");
      const summaryList = CPP_CORE_GUIDELINES.map((r) => ({
        id: r.id,
        title: r.title,
        section: r.section,
        url: r.url,
      }));

      return {
        contents: [
          {
            uri: "cppref://guidelines",
            text: JSON.stringify(summaryList, null, 2),
            mimeType: "application/json",
          },
        ],
      };
    },
  );

  // Resource 5: C++ Core Guidelines Rule Detail
  server.registerResource(
    "cpp_core_guideline_detail",
    new ResourceTemplate("cppref://guidelines/{id}", { list: undefined }),
    {
      description:
        "Full specification, reason, enforcement, and markdown examples for a specific C++ Core Guidelines rule (e.g. 'F.16', 'R.1', 'C.21').",
      mimeType: "application/json",
    },
    async (uri: URL, variables: { [key: string]: string | string[] | undefined }) => {
      const { GUIDELINE_BY_ID } = await import("../data/guidelines.js");
      const { normalizeRuleId } = await import("../tools/guidelines.js");
      const rawId = String(variables.id || "");
      const normalized = normalizeRuleId(rawId);
      const rule = GUIDELINE_BY_ID.get(normalized);

      if (!rule) {
        return {
          contents: [
            {
              uri: uri.href,
              text: JSON.stringify(
                {
                  error: `Rule '${rawId}' (normalized as '${normalized}') not found in C++ Core Guidelines.`,
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
            text: JSON.stringify(rule, null, 2),
            mimeType: "application/json",
          },
        ],
      };
    },
  );

  // Resource 6: C++ Modules Guide Index
  server.registerResource(
    "cpp_modules_guide_index",
    "cppref://modules",
    {
      description:
        "Architectural catalog and best practice guidelines for C++20, C++23, and C++26 Modules (syntax, import std, partitions, GMF, CMake).",
      mimeType: "application/json",
    },
    async () => {
      const { MODULE_GUIDES } = await import("../data/modules_guide.js");
      const summaryList = MODULE_GUIDES.map((g) => ({
        id: g.id,
        title: g.title,
        standard: g.standard,
        summary: g.summary,
      }));

      return {
        contents: [
          {
            uri: "cppref://modules",
            text: JSON.stringify(summaryList, null, 2),
            mimeType: "application/json",
          },
        ],
      };
    },
  );

  // Resource 7: C++ Modules Topic Detail
  server.registerResource(
    "cpp_modules_topic_detail",
    new ResourceTemplate("cppref://modules/{topic}", { list: undefined }),
    {
      description:
        "Full architectural specification, rules, and code patterns for a specific C++ module topic (e.g. 'import-std', 'partitions', 'cmake-build-systems').",
      mimeType: "application/json",
    },
    async (uri: URL, variables: { [key: string]: string | string[] | undefined }) => {
      const { MODULE_GUIDE_BY_ID, MODULE_GUIDES } = await import("../data/modules_guide.js");
      const { normalizeTopicId } = await import("../tools/modules.js");
      const rawTopic = String(variables.topic || "");
      const normalized = normalizeTopicId(rawTopic);
      const topicEntry =
        MODULE_GUIDE_BY_ID.get(rawTopic.toLowerCase()) ||
        MODULE_GUIDE_BY_ID.get(normalized) ||
        MODULE_GUIDES.find(
          (g) =>
            g.id.toLowerCase().includes(normalized) ||
            g.aliases.some((a) => a.toLowerCase().includes(normalized)),
        );

      if (!topicEntry) {
        return {
          contents: [
            {
              uri: uri.href,
              text: JSON.stringify(
                {
                  error: `Module topic '${rawTopic}' not found. Available topics: ${MODULE_GUIDES.map((g) => g.id).join(", ")}.`,
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
            text: JSON.stringify(topicEntry, null, 2),
            mimeType: "application/json",
          },
        ],
      };
    },
  );

  // Resource 8: SEI CERT C++ Rules Index
  server.registerResource(
    "cpp_cert_rules_index",
    "cppref://cert",
    {
      description:
        "Index of SEI CERT C++ Coding Standard rules with identifiers, categories, CWE mappings, and vulnerability definitions.",
      mimeType: "application/json",
    },
    async () => {
      const { CERT_RULES } = await import("../data/cert_rules.js");
      const summaryList = CERT_RULES.map((r) => ({
        id: r.id,
        category: r.category,
        title: r.title,
        severity: r.severity,
        cwe: r.cwe,
        vulnerability: r.vulnerability,
        summary: r.summary,
      }));

      return {
        contents: [
          {
            uri: "cppref://cert",
            text: JSON.stringify(summaryList, null, 2),
            mimeType: "application/json",
          },
        ],
      };
    },
  );

  // Resource 9: SEI CERT C++ Rule Detail
  server.registerResource(
    "cpp_cert_rule_detail",
    new ResourceTemplate("cppref://cert/{id}", { list: undefined }),
    {
      description:
        "Full SEI CERT C++ rule specification, risk assessment, noncompliant code example, and compliant secure solution.",
      mimeType: "application/json",
    },
    async (uri: URL, variables: { [key: string]: string | string[] | undefined }) => {
      const { CERT_RULE_BY_ID } = await import("../data/cert_rules.js");
      const { normalizeCertRuleId } = await import("../tools/cert.js");
      const rawId = String(variables.id || "");
      const normalized = normalizeCertRuleId(rawId);
      const rule = CERT_RULE_BY_ID.get(normalized);

      if (!rule) {
        return {
          contents: [
            {
              uri: uri.href,
              text: JSON.stringify(
                {
                  error: `SEI CERT C++ rule '${rawId}' (normalized '${normalized}') not found.`,
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
            text: JSON.stringify(rule, null, 2),
            mimeType: "application/json",
          },
        ],
      };
    },
  );

  // Resource 10: Modern C/C++ Developer Tooling Catalog
  server.registerResource(
    "cpp_tooling_index",
    "cppref://tooling",
    {
      description:
        "Catalog of modern C and C++ developer tooling, build utilities (xmake), linters (clang-tidy), formatters (clang-format), and sanitizers.",
      mimeType: "application/json",
    },
    async () => {
      const { C_CPP_TOOLS } = await import("../data/tooling.js");
      const summaryList = C_CPP_TOOLS.map((t) => ({
        id: t.id,
        title: t.title,
        configFileName: t.configFileName,
        description: t.description,
      }));

      return {
        contents: [
          {
            uri: "cppref://tooling",
            text: JSON.stringify(summaryList, null, 2),
            mimeType: "application/json",
          },
        ],
      };
    },
  );

  // Resource 11: Specific C/C++ Tool Documentation & Config
  server.registerResource(
    "cpp_tooling_detail",
    new ResourceTemplate("cppref://tooling/{tool}", { list: undefined }),
    {
      description:
        "Full documentation, commands, and production starter configuration for a specific C/C++ tool (e.g. 'xmake', 'clang-format', 'clang-tidy', 'sanitizers').",
      mimeType: "application/json",
    },
    async (uri: URL, variables: { [key: string]: string | string[] | undefined }) => {
      const { TOOL_BY_ID, C_CPP_TOOLS } = await import("../data/tooling.js");
      const { normalizeToolId } = await import("../tools/tooling.js");
      const rawTool = String(variables.tool || "");
      const normalized = normalizeToolId(rawTool);
      const toolGuide =
        TOOL_BY_ID.get(rawTool.toLowerCase()) ||
        TOOL_BY_ID.get(normalized) ||
        C_CPP_TOOLS.find((t) => t.aliases.some((a) => a.toLowerCase() === normalized));

      if (!toolGuide) {
        return {
          contents: [
            {
              uri: uri.href,
              text: JSON.stringify(
                {
                  error: `Tool '${rawTool}' not found. Available tools: ${C_CPP_TOOLS.map((t) => t.id).join(", ")}.`,
                },
                null,
                2,
              ),
              mimeType: "application/json",
            },
          ],
        };
      }

      if (toolGuide.id === "xmake") {
        const { XMAKE_SKILLS } = await import("../data/xmake-skills.js");
        return {
          contents: [
            {
              uri: uri.href,
              text: JSON.stringify(
                {
                  ...toolGuide,
                  skillsCount: XMAKE_SKILLS.length,
                  skillsResourceUri: "cppref://tooling/xmake/skills",
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
            text: JSON.stringify(toolGuide, null, 2),
            mimeType: "application/json",
          },
        ],
      };
    },
  );

  // Resource 12: Official xmake Agent Skills Index
  server.registerResource(
    "cpp_xmake_skills_index",
    "cppref://tooling/xmake/skills",
    {
      description:
        "Index of all 58 official xmake recipes and agent skills across 12 categories (modules, cross-compilation, packages, etc.).",
      mimeType: "application/json",
    },
    async () => {
      const { XMAKE_SKILLS, XMAKE_SKILLS_BY_CATEGORY } = await import("../data/xmake-skills.js");
      const summary = {
        totalSkills: XMAKE_SKILLS.length,
        categories: Array.from(XMAKE_SKILLS_BY_CATEGORY.entries()).map(([category, skills]) => ({
          category,
          count: skills.length,
          skills: skills.map((s) => ({
            id: s.id,
            name: s.name,
            title: s.title,
            description: s.description,
          })),
        })),
      };

      return {
        contents: [
          {
            uri: "cppref://tooling/xmake/skills",
            text: JSON.stringify(summary, null, 2),
            mimeType: "application/json",
          },
        ],
      };
    },
  );

  // Resource 13: Official xmake Skill Recipe Markdown
  server.registerResource(
    "cpp_xmake_skill_detail",
    new ResourceTemplate("cppref://tooling/xmake/{topic}", { list: undefined }),
    {
      description:
        "Full recipe and tutorial markdown for a specific xmake capability (e.g. 'cxx-modules', 'cross-compilation', 'packages', 'cuda', 'unity').",
      mimeType: "text/markdown",
    },
    async (uri: URL, variables: { [key: string]: string | string[] | undefined }) => {
      const { findXmakeSkill, XMAKE_SKILLS } = await import("../data/xmake-skills.js");
      const topic = String(variables.topic || "").trim();

      const skill = findXmakeSkill(topic);
      if (!skill) {
        return {
          contents: [
            {
              uri: uri.href,
              text: JSON.stringify(
                {
                  error: `Xmake skill recipe '${topic}' not found.`,
                  availableCount: XMAKE_SKILLS.length,
                  hint: "Query cppref://tooling/xmake/skills to see all available recipes.",
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
            text: skill.content,
            mimeType: "text/markdown",
          },
        ],
      };
    },
  );

  // Resource 14: Compiler Support Matrix Catalog
  server.registerResource(
    "cpp_compiler_support",
    "cppref://compiler-support",
    {
      description:
        "Comprehensive compiler support matrix (GCC, Clang, MSVC, Apple Clang) for modern C++ features across C++17, C++20, C++23, and C++26.",
      mimeType: "application/json",
    },
    async () => {
      return {
        contents: [
          {
            uri: "cppref://compiler-support",
            text: JSON.stringify(COMPILER_SUPPORT_ENTRIES, null, 2),
            mimeType: "application/json",
          },
        ],
      };
    },
  );

  // Resource 14: Compiler Support Feature Detail
  server.registerResource(
    "cpp_compiler_support_detail",
    new ResourceTemplate("cppref://compiler-support/{feature}", { list: undefined }),
    {
      description:
        "Detailed compiler support matrix and paper info for a specific feature (e.g. 'std-print', 'std-expected', 'import-std', 'std-generator').",
      mimeType: "application/json",
    },
    async (uri: URL, variables: { [key: string]: string | string[] | undefined }) => {
      const rawFeature = String(variables.feature || "")
        .trim()
        .toLowerCase();
      const entry =
        COMPILER_SUPPORT_BY_ID.get(rawFeature) ||
        COMPILER_SUPPORT_ENTRIES.find(
          (e) =>
            e.id.toLowerCase() === rawFeature ||
            e.aliases.some((a) => a.toLowerCase() === rawFeature),
        );

      if (!entry) {
        return {
          contents: [
            {
              uri: uri.href,
              text: JSON.stringify(
                {
                  error: `Feature '${rawFeature}' not found in compiler support matrix. Available features: ${COMPILER_SUPPORT_ENTRIES.map((e) => e.id).join(", ")}.`,
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
            text: JSON.stringify(entry, null, 2),
            mimeType: "application/json",
          },
        ],
      };
    },
  );
}
