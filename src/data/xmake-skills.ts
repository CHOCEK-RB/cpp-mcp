// src/data/xmake-skills.ts
// Official xmake Agent Skills synchronized from xmake-io/xmake-skills
import rawSkills from "./xmake-skills.json" with { type: "json" };

export interface XmakeSkill {
  id: string;
  name: string;
  category: string;
  title: string;
  description: string;
  path: string;
  content: string;
}

export const XMAKE_SKILLS: XmakeSkill[] = rawSkills as XmakeSkill[];

export const XMAKE_SKILLS_BY_NAME = new Map<string, XmakeSkill>();
export const XMAKE_SKILLS_BY_PATH_KEY = new Map<string, XmakeSkill>();
export const XMAKE_SKILLS_BY_ID = new Map<string, XmakeSkill>();
export const XMAKE_SKILLS_BY_CATEGORY = new Map<string, XmakeSkill[]>();

for (const skill of XMAKE_SKILLS) {
  XMAKE_SKILLS_BY_NAME.set(skill.name.toLowerCase(), skill);
  XMAKE_SKILLS_BY_PATH_KEY.set(`${skill.category}/${skill.id}`.toLowerCase(), skill);

  if (!XMAKE_SKILLS_BY_ID.has(skill.id.toLowerCase())) {
    XMAKE_SKILLS_BY_ID.set(skill.id.toLowerCase(), skill);
  }

  const catList = XMAKE_SKILLS_BY_CATEGORY.get(skill.category) || [];
  catList.push(skill);
  XMAKE_SKILLS_BY_CATEGORY.set(skill.category, catList);
}

/**
 * Resolves an official xmake skill recipe by ID, name, category/id, or common alias.
 */
export function findXmakeSkill(queryOrTopic: string): XmakeSkill | undefined {
  const q = queryOrTopic.trim().toLowerCase();

  // 1. Exact match on name (e.g. "xmake-cxx-modules" or "xrepo-cli")
  const byName = XMAKE_SKILLS_BY_NAME.get(q);
  if (byName) return byName;

  // 2. Exact match on category/id (e.g. "toolchains/cxx-modules")
  const byPath = XMAKE_SKILLS_BY_PATH_KEY.get(q);
  if (byPath) return byPath;

  // 3. Exact match on id (e.g. "cxx-modules")
  const byId = XMAKE_SKILLS_BY_ID.get(q);
  if (byId) return byId;

  // 4. Aliases
  if (q === "modules" || q === "c++20-modules" || q === "cpp-modules" || q === "cxx-modules") {
    return XMAKE_SKILLS_BY_ID.get("cxx-modules");
  }
  if (q === "cross" || q === "cross-compile" || q === "cross-compilation") {
    return XMAKE_SKILLS_BY_ID.get("cross-compilation");
  }
  if (q === "packages" || q === "add_requires" || q === "package") {
    return XMAKE_SKILLS_BY_NAME.get("xmake-packages");
  }
  if (q === "vcpkg" || q === "conan" || q === "xrepo") {
    return XMAKE_SKILLS_BY_NAME.get("xmake-packages");
  }
  if (q === "cache" || q === "ccache" || q === "sccache") {
    return XMAKE_SKILLS_BY_NAME.get("xmake-build-cache");
  }
  if (q === "optimize" || q === "unity" || q === "unity-build" || q === "pgo" || q === "lto") {
    return XMAKE_SKILLS_BY_NAME.get("xmake-build-optimization");
  }
  if (q === "targets" || q === "target") {
    return XMAKE_SKILLS_BY_NAME.get("xmake-targets");
  }
  if (q === "rules" || q === "rule") {
    return XMAKE_SKILLS_BY_NAME.get("xmake-rules");
  }

  // 5. Partial match on name, id, or title
  return XMAKE_SKILLS.find(
    (s) =>
      s.id.toLowerCase() === q ||
      s.name.toLowerCase() === `xmake-${q}` ||
      s.name.toLowerCase() === `xrepo-${q}` ||
      s.id.toLowerCase().includes(q) ||
      s.title.toLowerCase().includes(q),
  );
}

/**
 * Free-text search across official xmake skills.
 */
export function searchXmakeSkills(query: string): XmakeSkill[] {
  const q = query.trim().toLowerCase();
  const terms = q.split(/\s+/).filter(Boolean);

  const scored: Array<{ skill: XmakeSkill; score: number }> = [];

  for (const skill of XMAKE_SKILLS) {
    let score = 0;
    const nameLower = skill.name.toLowerCase();
    const idLower = skill.id.toLowerCase();
    const titleLower = skill.title.toLowerCase();
    const descLower = skill.description.toLowerCase();
    const contentLower = skill.content.toLowerCase();

    if (nameLower === q || idLower === q) score += 50;
    if (titleLower.includes(q)) score += 30;
    if (descLower.includes(q)) score += 20;

    for (const term of terms) {
      if (titleLower.includes(term)) score += 10;
      if (descLower.includes(term)) score += 6;
      if (contentLower.includes(term)) score += 2;
    }

    if (score > 0) {
      scored.push({ skill, score });
    }
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.map((s) => s.skill);
}
