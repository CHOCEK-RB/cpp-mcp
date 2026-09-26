// src/data/modules_guide.ts
// Structured module guidelines for C++20, C++23, and C++26.
import rawGuides from "./modules_guide.json" with { type: "json" };

export interface ModuleGuideTopic {
  id: string;
  title: string;
  standard: "C++20" | "C++23" | "C++26";
  aliases: string[];
  summary: string;
  rules: string[];
  content: string;
}

export const MODULE_GUIDES: ModuleGuideTopic[] = rawGuides as ModuleGuideTopic[];

export const MODULE_GUIDE_BY_ID = new Map<string, ModuleGuideTopic>();

for (const guide of MODULE_GUIDES) {
  MODULE_GUIDE_BY_ID.set(guide.id.toLowerCase(), guide);
  for (const alias of guide.aliases) {
    MODULE_GUIDE_BY_ID.set(alias.toLowerCase(), guide);
  }
}
