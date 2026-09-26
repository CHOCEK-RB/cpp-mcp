import {
  type CoreGuidelineRule,
  CPP_CORE_GUIDELINES,
  GUIDELINE_BY_ID,
} from "../data/guidelines.js";

export interface GuidelineQueryResult {
  query: string;
  found: boolean;
  totalMatches: number;
  rule?: CoreGuidelineRule;
  rules?: Array<{
    id: string;
    title: string;
    section: string;
    url: string;
    reason?: string;
    enforcement?: string;
    content?: string;
  }>;
  availableSections?: string[];
  message?: string;
}

export function normalizeRuleId(raw: string): string {
  const clean = raw.trim().replace(/^#/, "").toUpperCase();
  const missingDotMatch = clean.match(/^([A-Z]+)(\d+)$/);
  if (missingDotMatch?.[1] && missingDotMatch[2]) {
    return `${missingDotMatch[1]}.${missingDotMatch[2]}`;
  }
  return clean;
}

export interface GetGuidelineOptions {
  ruleId?: string;
  query?: string;
  section?: string;
  includeContent?: boolean;
}

export function getGuideline(options: GetGuidelineOptions): GuidelineQueryResult {
  const { ruleId, query, section, includeContent } = options;

  // 1. Search by exact Rule ID
  if (ruleId?.trim()) {
    const normalizedId = normalizeRuleId(ruleId);
    const rule = GUIDELINE_BY_ID.get(normalizedId);

    if (rule) {
      return {
        query: ruleId,
        found: true,
        totalMatches: 1,
        rule,
      };
    }

    // Try prefix or case-insensitive search if exact key missed
    const partialMatch = CPP_CORE_GUIDELINES.find(
      (r) =>
        r.id.toUpperCase() === normalizedId ||
        r.id.toUpperCase().startsWith(`${normalizedId}.`) ||
        r.anchor.toUpperCase() === normalizedId.toLowerCase(),
    );

    if (partialMatch) {
      return {
        query: ruleId,
        found: true,
        totalMatches: 1,
        rule: partialMatch,
      };
    }

    return {
      query: ruleId,
      found: false,
      totalMatches: 0,
      message: `Rule '${ruleId}' (normalized as '${normalizedId}') not found in C++ Core Guidelines. Try searching by keyword using the query parameter.`,
    };
  }

  // 2. Search by keyword or section
  if (query?.trim()) {
    const lowerQuery = query.toLowerCase().trim();
    const scoredRules: Array<{ rule: CoreGuidelineRule; score: number }> = [];

    for (const rule of CPP_CORE_GUIDELINES) {
      if (section && !rule.section.toLowerCase().includes(section.toLowerCase())) {
        continue;
      }

      let score = 0;
      const lowerId = rule.id.toLowerCase();
      const lowerTitle = rule.title.toLowerCase();
      const lowerReason = (rule.reason ?? "").toLowerCase();
      const lowerContent = rule.content.toLowerCase();

      if (lowerId === lowerQuery) score += 100;
      else if (lowerId.includes(lowerQuery)) score += 50;

      if (lowerTitle.includes(lowerQuery)) score += 40;
      if (lowerReason.includes(lowerQuery)) score += 20;
      if (lowerContent.includes(lowerQuery)) score += 10;

      if (score > 0) {
        scoredRules.push({ rule, score });
      }
    }

    scoredRules.sort((a, b) => b.score - a.score);
    const topMatches = scoredRules.slice(0, 5);

    if (topMatches.length === 0) {
      return {
        query,
        found: false,
        totalMatches: 0,
        message: `No rules found matching '${query}'${section ? ` in section '${section}'` : ""}.`,
      };
    }

    // If exactly 1 match or single top score, return full rule
    if (topMatches.length === 1 && topMatches[0]) {
      return {
        query,
        found: true,
        totalMatches: 1,
        rule: topMatches[0].rule,
      };
    }

    return {
      query,
      found: true,
      totalMatches: scoredRules.length,
      rules: topMatches.map(({ rule }) => ({
        id: rule.id,
        title: rule.title,
        section: rule.section,
        url: rule.url,
        reason: rule.reason,
        enforcement: rule.enforcement,
        content: includeContent ? rule.content : undefined,
      })),
    };
  }

  // 3. Section listing if only section is provided
  if (section?.trim()) {
    const sectionMatches = CPP_CORE_GUIDELINES.filter((r) =>
      r.section.toLowerCase().includes(section.toLowerCase()),
    );

    return {
      query: section,
      found: sectionMatches.length > 0,
      totalMatches: sectionMatches.length,
      rules: sectionMatches.slice(0, 10).map((rule) => ({
        id: rule.id,
        title: rule.title,
        section: rule.section,
        url: rule.url,
        reason: rule.reason,
      })),
    };
  }

  // 4. Return available sections overview
  const sections = Array.from(new Set(CPP_CORE_GUIDELINES.map((r) => r.section)));
  return {
    query: "",
    found: true,
    totalMatches: CPP_CORE_GUIDELINES.length,
    message:
      "Please provide a ruleId (e.g. 'F.16', 'R.1', 'C.21') or a search query (e.g. 'RAII', 'ownership', 'smart pointers').",
    availableSections: sections,
  };
}
