// src/tools/tooling.ts
import {
  C_CPP_TOOLS,
  type KeyDirective,
  TOOL_BY_ID,
  type ToolCommand,
  type ToolGuide,
} from "../data/tooling.js";

export interface GetCppToolingGuideParams {
  tool?: string;
  query?: string;
  generate_config?: boolean;
}

export interface GetCppToolingGuideResult {
  found: boolean;
  totalTools?: number;
  tool?: string;
  title?: string;
  configFileName?: string;
  configContent?: string;
  description?: string;
  keyDirectives?: KeyDirective[];
  commands?: ToolCommand[];
  content?: string;
  matches?: Array<{
    id: string;
    title: string;
    configFileName: string;
    description: string;
    matchedDirectives?: string[];
  }>;
  message?: string;
}

export function normalizeToolId(input: string): string {
  const trimmed = input.trim().toLowerCase().replace(/^\./, "");
  if (trimmed.includes("xmake")) return "xmake";
  if (trimmed.includes("format")) return "clang-format";
  if (trimmed.includes("tidy")) return "clang-tidy";
  if (
    trimmed.includes("sanitizer") ||
    trimmed.includes("asan") ||
    trimmed.includes("ubsan") ||
    trimmed.includes("tsan")
  ) {
    return "sanitizers";
  }
  return trimmed;
}

export function getCppToolingGuide(
  params: GetCppToolingGuideParams = {},
): GetCppToolingGuideResult {
  const { tool, query, generate_config } = params;

  // Case 1: Specific tool requested
  if (tool?.trim()) {
    const rawKey = tool.trim().toLowerCase();
    const normalizedKey = normalizeToolId(rawKey);

    const matched =
      TOOL_BY_ID.get(rawKey) ||
      TOOL_BY_ID.get(normalizedKey) ||
      C_CPP_TOOLS.find(
        (t) =>
          t.id.toLowerCase().includes(normalizedKey) ||
          t.aliases.some((a) => a.toLowerCase().includes(normalizedKey)),
      );

    if (matched) {
      return {
        found: true,
        tool: matched.id,
        title: matched.title,
        configFileName: matched.configFileName,
        configContent: matched.sampleConfig,
        description: matched.description,
        keyDirectives: matched.keyDirectives,
        commands: matched.commands,
        content: matched.content,
        message: generate_config
          ? `Generated recommended configuration content for '${matched.configFileName}'.`
          : undefined,
      };
    }

    return {
      found: false,
      message: `Tool '${tool}' not found. Available tools: ${C_CPP_TOOLS.map((t) => t.id).join(", ")}.`,
    };
  }

  // Case 2: Free-text search across directives, commands, and content
  if (query?.trim()) {
    const q = query.trim().toLowerCase();
    const terms = q.split(/\s+/).filter(Boolean);

    const scored: Array<{
      guide: ToolGuide;
      score: number;
      matchedDirectives: string[];
    }> = [];

    for (const guide of C_CPP_TOOLS) {
      let score = 0;
      const matchedDirectives: string[] = [];

      if (guide.id.toLowerCase().includes(q)) score += 30;
      if (guide.title.toLowerCase().includes(q)) score += 25;
      if (guide.aliases.some((a) => a.toLowerCase().includes(q))) score += 20;
      if (guide.description.toLowerCase().includes(q)) score += 15;

      for (const directive of guide.keyDirectives) {
        const dName = directive.name.toLowerCase();
        const dDesc = directive.description.toLowerCase();
        if (dName.includes(q) || dDesc.includes(q)) {
          score += 10;
          matchedDirectives.push(directive.name);
        } else if (terms.some((t) => dName.includes(t) || dDesc.includes(t))) {
          score += 4;
          if (!matchedDirectives.includes(directive.name)) {
            matchedDirectives.push(directive.name);
          }
        }
      }

      for (const cmd of guide.commands) {
        if (cmd.command.toLowerCase().includes(q)) score += 8;
      }

      if (guide.content.toLowerCase().includes(q)) score += 5;

      if (score > 0) {
        scored.push({ guide, score, matchedDirectives });
      }
    }

    scored.sort((a, b) => b.score - a.score);

    if (scored.length === 0) {
      return {
        found: false,
        message: `No C++ tools or configuration directives found matching '${query}'.`,
      };
    }

    // If single match found, return detailed response
    if (scored.length === 1 && scored[0]) {
      const top = scored[0].guide;
      return {
        found: true,
        tool: top.id,
        title: top.title,
        configFileName: top.configFileName,
        configContent: top.sampleConfig,
        description: top.description,
        keyDirectives: top.keyDirectives,
        commands: top.commands,
        content: top.content,
      };
    }

    return {
      found: true,
      totalTools: scored.length,
      matches: scored.map(({ guide, matchedDirectives }) => ({
        id: guide.id,
        title: guide.title,
        configFileName: guide.configFileName,
        description: guide.description,
        matchedDirectives: matchedDirectives.length > 0 ? matchedDirectives : undefined,
      })),
    };
  }

  // Case 3: Overview of all supported modern tools
  return {
    found: true,
    totalTools: C_CPP_TOOLS.length,
    matches: C_CPP_TOOLS.map((t) => ({
      id: t.id,
      title: t.title,
      configFileName: t.configFileName,
      description: t.description,
    })),
    message:
      "Call get_cpp_tooling_guide with tool='<xmake|clang-format|clang-tidy|sanitizers>' to view documentation, commands, and generate production configs.",
  };
}
