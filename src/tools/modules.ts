// src/tools/modules.ts
import { MODULE_GUIDE_BY_ID, MODULE_GUIDES, type ModuleGuideTopic } from "../data/modules_guide.js";

export interface GetCppModulesGuideParams {
  topic?: string;
  standard?: "c++20" | "c++23" | "c++26";
  query?: string;
}

export interface GetCppModulesGuideResult {
  found: boolean;
  totalTopics?: number;
  topic?: string;
  title?: string;
  standard?: string;
  summary?: string;
  rules?: string[];
  content?: string;
  matches?: Array<{
    id: string;
    title: string;
    standard: string;
    summary: string;
    matchedRules?: string[];
  }>;
  message?: string;
}

export function normalizeTopicId(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, "-")
    .replace(/^c\+\+(\d+)-?/, "")
    .replace(/^modules?-?/, "");
}

export function getCppModulesGuide(
  params: GetCppModulesGuideParams = {},
): GetCppModulesGuideResult {
  const { topic, standard, query } = params;

  // Case 1: Specific topic requested
  if (topic?.trim()) {
    const rawKey = topic.trim().toLowerCase();
    const normalizedKey = normalizeTopicId(rawKey);

    const matched =
      MODULE_GUIDE_BY_ID.get(rawKey) ||
      MODULE_GUIDE_BY_ID.get(normalizedKey) ||
      MODULE_GUIDES.find(
        (g) =>
          g.id.toLowerCase().includes(normalizedKey) ||
          g.aliases.some((a) => a.toLowerCase().includes(normalizedKey)),
      );

    if (matched) {
      return {
        found: true,
        topic: matched.id,
        title: matched.title,
        standard: matched.standard,
        summary: matched.summary,
        rules: matched.rules,
        content: matched.content,
      };
    }

    return {
      found: false,
      message: `No C++ module topic found matching '${topic}'. Available topics: ${MODULE_GUIDES.map((g) => g.id).join(", ")}.`,
    };
  }

  // Case 2: Free-text search or standard filtering
  if (query?.trim() || standard) {
    const q = (query || "").trim().toLowerCase();
    const terms = q.split(/\s+/).filter(Boolean);
    const targetStd = standard ? standard.toLowerCase() : null;

    const scored: Array<{ guide: ModuleGuideTopic; score: number; matchedRules: string[] }> = [];

    for (const guide of MODULE_GUIDES) {
      if (targetStd && guide.standard.toLowerCase() !== targetStd) {
        continue;
      }

      if (terms.length === 0) {
        scored.push({ guide, score: 1, matchedRules: [] });
        continue;
      }

      let score = 0;
      const matchedRules: string[] = [];

      // Full phrase bonuses
      if (guide.id.toLowerCase().includes(q)) score += 30;
      if (guide.title.toLowerCase().includes(q)) score += 25;
      if (guide.aliases.some((a) => a.toLowerCase().includes(q))) score += 20;

      // Individual terms matching
      for (const term of terms) {
        if (guide.id.toLowerCase().includes(term)) score += 10;
        if (guide.title.toLowerCase().includes(term)) score += 8;
        if (guide.aliases.some((a) => a.toLowerCase().includes(term))) score += 6;
        if (guide.summary.toLowerCase().includes(term)) score += 5;
        if (guide.content.toLowerCase().includes(term)) score += 2;
      }

      for (const rule of guide.rules) {
        const ruleLower = rule.toLowerCase();
        if (ruleLower.includes(q)) {
          score += 15;
          if (!matchedRules.includes(rule)) matchedRules.push(rule);
        } else if (terms.some((term) => ruleLower.includes(term))) {
          score += 5;
          if (!matchedRules.includes(rule)) matchedRules.push(rule);
        }
      }

      if (score > 0) {
        scored.push({ guide, score, matchedRules });
      }
    }

    scored.sort((a, b) => b.score - a.score);

    if (scored.length === 0) {
      return {
        found: false,
        message: `No C++ module guides found matching query '${query}'${standard ? ` with standard ${standard}` : ""}.`,
      };
    }

    // When only standard filtering was requested (no query), return list format
    if (!q && standard) {
      return {
        found: true,
        totalTopics: scored.length,
        matches: scored.map(({ guide }) => ({
          id: guide.id,
          title: guide.title,
          standard: guide.standard,
          summary: guide.summary,
        })),
      };
    }

    // If exact single match found with search query, return full detail
    if (scored.length === 1 && scored[0]) {
      const top = scored[0].guide;
      return {
        found: true,
        topic: top.id,
        title: top.title,
        standard: top.standard,
        summary: top.summary,
        rules: top.rules,
        content: top.content,
      };
    }

    return {
      found: true,
      totalTopics: scored.length,
      matches: scored.slice(0, 5).map(({ guide, matchedRules }) => ({
        id: guide.id,
        title: guide.title,
        standard: guide.standard,
        summary: guide.summary,
        matchedRules: matchedRules.length > 0 ? matchedRules : undefined,
      })),
    };
  }

  // Case 3: Overview of all module guides
  return {
    found: true,
    totalTopics: MODULE_GUIDES.length,
    matches: MODULE_GUIDES.map((g) => ({
      id: g.id,
      title: g.title,
      standard: g.standard,
      summary: g.summary,
    })),
    message:
      "Call get_cpp_modules_guide with topic='<topic_id>' for in-depth rules, code examples, and architecture guidance.",
  };
}
