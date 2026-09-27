// src/tools/tooling.ts
import {
  C_CPP_TOOLS,
  type KeyDirective,
  TOOL_BY_ID,
  type ToolCommand,
  type ToolGuide,
} from "../data/tooling.js";
import {
  findXmakeSkill,
  searchXmakeSkills,
  XMAKE_SKILLS,
  XMAKE_SKILLS_BY_CATEGORY,
} from "../data/xmake-skills.js";

export interface GetCppToolingGuideParams {
  tool?: string;
  topic?: string;
  category?: string;
  query?: string;
  generate_config?: boolean;
}

export interface XmakeSkillSummary {
  id: string;
  name: string;
  category: string;
  title: string;
  description: string;
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
  topic?: string;
  category?: string;
  path?: string;
  skillsCount?: number;
  skills?: XmakeSkillSummary[];
  categories?: Array<{
    category: string;
    count: number;
    skills: Array<{ id: string; title: string }>;
  }>;
  matches?: Array<{
    id: string;
    title: string;
    configFileName?: string;
    description: string;
    matchedDirectives?: string[];
    category?: string;
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
  const { tool, topic, category, query, generate_config } = params;

  let targetTool = tool?.trim();
  let targetTopic = topic?.trim();

  // Support positional tool string like "xmake cxx-modules"
  if (targetTool && !targetTopic && targetTool.includes(" ")) {
    const parts = targetTool.split(/\s+/);
    if (parts[0] && normalizeToolId(parts[0]) === "xmake") {
      targetTool = parts[0];
      targetTopic = parts.slice(1).join(" ");
    }
  }

  // Case 1: Topic lookup without explicit tool or with xmake
  if (targetTopic && (!targetTool || normalizeToolId(targetTool) === "xmake")) {
    const skill = findXmakeSkill(targetTopic);
    if (skill) {
      return {
        found: true,
        tool: "xmake",
        topic: skill.id,
        category: skill.category,
        title: skill.title,
        description: skill.description,
        path: skill.path,
        content: skill.content,
        message: `Official xmake recipe for '${skill.id}' (${skill.category}).`,
      };
    }
    return {
      found: false,
      tool: "xmake",
      message: `Skill recipe '${targetTopic}' not found in official xmake skills. Run with tool='xmake' without topic to view all ${XMAKE_SKILLS.length} available topics across 12 categories.`,
    };
  }

  // Case 2: Category lookup for xmake recipes
  if (category?.trim() && (!targetTool || normalizeToolId(targetTool) === "xmake")) {
    const catKey = category.trim().toLowerCase();
    const catSkills = XMAKE_SKILLS_BY_CATEGORY.get(catKey);
    if (catSkills) {
      return {
        found: true,
        tool: "xmake",
        category: catKey,
        skillsCount: catSkills.length,
        skills: catSkills.map((s) => ({
          id: s.id,
          name: s.name,
          category: s.category,
          title: s.title,
          description: s.description,
        })),
        message: `Found ${catSkills.length} official xmake recipes in category '${catKey}'.`,
      };
    }
    return {
      found: false,
      tool: "xmake",
      message: `Category '${category}' not found. Available categories: ${Array.from(XMAKE_SKILLS_BY_CATEGORY.keys()).join(", ")}.`,
    };
  }

  // Case 3: Specific tool requested
  if (targetTool) {
    const rawKey = targetTool.toLowerCase();
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
      const isXmake = matched.id === "xmake";

      let skillsInfo: {
        skillsCount?: number;
        categories?: Array<{
          category: string;
          count: number;
          skills: Array<{ id: string; title: string }>;
        }>;
      } = {};

      if (isXmake) {
        skillsInfo = {
          skillsCount: XMAKE_SKILLS.length,
          categories: Array.from(XMAKE_SKILLS_BY_CATEGORY.entries()).map(([cat, list]) => ({
            category: cat,
            count: list.length,
            skills: list.map((s) => ({ id: s.id, title: s.title })),
          })),
        };
      }

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
        ...skillsInfo,
        message: generate_config
          ? `Generated recommended configuration content for '${matched.configFileName}'.`
          : isXmake
            ? `xmake includes ${XMAKE_SKILLS.length} official recipes across 12 categories. Specify topic='<topic>' (e.g. 'cxx-modules', 'cross-compilation', 'packages', 'cuda') or category='<category>' to view full recipes.`
            : undefined,
      };
    }

    // Check if targetTool is an xmake skill directly (e.g. tool='cxx-modules')
    const skill = findXmakeSkill(targetTool);
    if (skill) {
      return {
        found: true,
        tool: "xmake",
        topic: skill.id,
        category: skill.category,
        title: skill.title,
        description: skill.description,
        path: skill.path,
        content: skill.content,
        message: `Official xmake recipe for '${skill.id}' (${skill.category}).`,
      };
    }

    return {
      found: false,
      message: `Tool '${targetTool}' not found. Available tools: ${C_CPP_TOOLS.map((t) => t.id).join(", ")}.`,
    };
  }

  // Case 4: Free-text search across directives, commands, content, and xmake skills
  if (query?.trim()) {
    const q = query.trim().toLowerCase();
    const terms = q.split(/\s+/).filter(Boolean);

    const scoredTools: Array<{
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
        scoredTools.push({ guide, score, matchedDirectives });
      }
    }

    scoredTools.sort((a, b) => b.score - a.score);

    // Also search xmake skills
    const skillMatches = searchXmakeSkills(query);

    if (scoredTools.length === 0 && skillMatches.length === 0) {
      return {
        found: false,
        message: `No C++ tools or configuration directives found matching '${query}'.`,
      };
    }

    // If single tool match and no skill match, return detailed response
    if (scoredTools.length === 1 && skillMatches.length === 0 && scoredTools[0]) {
      const top = scoredTools[0].guide;
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

    // If single skill match and no tool match, return the skill
    if (skillMatches.length === 1 && scoredTools.length === 0 && skillMatches[0]) {
      const s = skillMatches[0];
      return {
        found: true,
        tool: "xmake",
        topic: s.id,
        category: s.category,
        title: s.title,
        description: s.description,
        path: s.path,
        content: s.content,
        message: `Official xmake recipe for '${s.id}' (${s.category}).`,
      };
    }

    const matches: Array<{
      id: string;
      title: string;
      configFileName?: string;
      description: string;
      matchedDirectives?: string[];
      category?: string;
    }> = [];

    for (const { guide, matchedDirectives } of scoredTools) {
      matches.push({
        id: guide.id,
        title: guide.title,
        configFileName: guide.configFileName,
        description: guide.description,
        matchedDirectives: matchedDirectives.length > 0 ? matchedDirectives : undefined,
      });
    }

    for (const s of skillMatches.slice(0, 10)) {
      matches.push({
        id: `xmake:${s.id}`,
        title: s.title,
        description: s.description,
        category: s.category,
      });
    }

    return {
      found: true,
      totalTools: matches.length,
      matches,
    };
  }

  // Case 5: Overview of all supported modern tools
  return {
    found: true,
    totalTools: C_CPP_TOOLS.length,
    skillsCount: XMAKE_SKILLS.length,
    matches: C_CPP_TOOLS.map((t) => ({
      id: t.id,
      title: t.title,
      configFileName: t.configFileName,
      description:
        t.id === "xmake"
          ? `${t.description} (Includes ${XMAKE_SKILLS.length} official agent skill recipes)`
          : t.description,
    })),
    message:
      "Call get_cpp_tooling_guide with tool='<xmake|clang-format|clang-tidy|sanitizers>' or topic='<topic>' (for xmake recipes) to view documentation, commands, and generate production configs.",
  };
}
