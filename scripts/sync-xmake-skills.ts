#!/usr/bin/env bun
// scripts/sync-xmake-skills.ts
// Synchronizes official xmake Agent Skills from xmake-io/xmake-skills on GitHub.

import { promises as fs } from "node:fs";
import path from "node:path";

export interface XmakeSkillEntry {
  id: string;
  name: string;
  category: string;
  title: string;
  description: string;
  path: string;
  content: string;
}

const OUTPUT_JSON = path.resolve(import.meta.dir, "../src/data/xmake-skills.json");
const REPO_TREE_URL =
  "https://api.github.com/repos/xmake-io/xmake-skills/git/trees/master?recursive=1";
const RAW_BASE_URL = "https://raw.githubusercontent.com/xmake-io/xmake-skills/master";

interface TreeItem {
  path: string;
  type: string;
}

interface TreeResponse {
  tree: TreeItem[];
}

function parseFrontmatter(raw: string): {
  name: string;
  description: string;
  body: string;
} {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) {
    return { name: "", description: "", body: raw };
  }

  const fm = match[1] || "";
  const body = match[2] || "";

  let name = "";
  let description = "";

  const nameMatch = fm.match(/^name:\s*(.+)$/m);
  if (nameMatch) {
    name = (nameMatch[1] ?? "").trim().replace(/^['"]|['"]$/g, "");
  }

  const descMatch = fm.match(/^description:\s*([\s\S]+?)(?=\n[a-zA-Z0-9_-]+:|$)/m);
  if (descMatch) {
    description = (descMatch[1] ?? "")
      .trim()
      .replace(/^['"]|['"]$/g, "")
      .replace(/\r?\n\s+/g, " ");
  }

  return { name, description, body };
}

function extractTitle(body: string, fallback: string): string {
  const headingMatch = body.match(/^#\s+(.+)$/m);
  if (headingMatch?.[1]) {
    return headingMatch[1].trim();
  }
  return fallback;
}

async function main() {
  console.log("Fetching repository tree from xmake-io/xmake-skills...");
  const headers: Record<string, string> = {
    "User-Agent": "cpp-mcp-sync-tool",
  };
  if (process.env.GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  }

  const res = await fetch(REPO_TREE_URL, { headers });
  if (!res.ok) {
    throw new Error(`Failed to fetch tree: HTTP ${res.status} ${res.statusText}`);
  }

  const data = (await res.json()) as TreeResponse;
  const skillPaths = data.tree
    .filter((item) => item.path.startsWith("skills/") && item.path.endsWith("SKILL.md"))
    .map((item) => item.path);

  console.log(`Discovered ${skillPaths.length} skills in repository. Fetching markdown bodies...`);

  const skills: XmakeSkillEntry[] = [];
  const BATCH_SIZE = 8;

  for (let i = 0; i < skillPaths.length; i += BATCH_SIZE) {
    const chunk = skillPaths.slice(i, i + BATCH_SIZE);
    const promises = chunk.map(async (skillPath) => {
      const parts = skillPath.split("/");
      const category = parts[1] || "general";
      const rawUrl = `${RAW_BASE_URL}/${skillPath}`;

      const fileRes = await fetch(rawUrl, { headers });
      if (!fileRes.ok) {
        console.warn(`Failed to fetch ${skillPath}: HTTP ${fileRes.status}`);
        return null;
      }

      const rawText = await fileRes.text();
      const { name, description, body } = parseFrontmatter(rawText);
      const fallbackName = parts[parts.length - 2] || "xmake-skill";
      const actualName = name || fallbackName;
      const cleanId = actualName.replace(/^(xmake-|xrepo-)/, "");
      const title = extractTitle(body, cleanId);

      return {
        id: cleanId,
        name: actualName,
        category,
        title,
        description,
        path: skillPath,
        content: body.trim(),
      };
    });

    const results = await Promise.all(promises);
    for (const r of results) {
      if (r) skills.push(r);
    }
  }

  // Sort by category, then by id
  skills.sort((a, b) => {
    if (a.category !== b.category) {
      return a.category.localeCompare(b.category);
    }
    return a.id.localeCompare(b.id);
  });

  await fs.writeFile(OUTPUT_JSON, JSON.stringify(skills, null, 2), "utf-8");
  console.log(`✓ Successfully saved ${skills.length} xmake skills to ${OUTPUT_JSON}`);

  const byCat: Record<string, number> = {};
  for (const s of skills) {
    byCat[s.category] = (byCat[s.category] || 0) + 1;
  }

  console.log("Categories breakdown:");
  for (const [cat, count] of Object.entries(byCat)) {
    console.log(`  - ${cat}: ${count} skills`);
  }
}

main().catch((err) => {
  console.error("Error syncing xmake skills:", err);
  process.exit(1);
});
