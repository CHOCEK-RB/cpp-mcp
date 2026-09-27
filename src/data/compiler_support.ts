// src/data/compiler_support.ts
// Curated compiler support matrix for modern C++ standards (C++17, C++20, C++23, C++26).
import rawEntries from "./compiler_support.json" with { type: "json" };

export interface CompilerVersions {
  gcc: string;
  clang: string;
  msvc: string;
  apple_clang: string;
}

export interface CompilerSupportEntry {
  id: string;
  name: string;
  standard: "C++17" | "C++20" | "C++23" | "C++26";
  category: "language" | "library";
  paper: string;
  macro?: string;
  header?: string;
  aliases: string[];
  compilers: CompilerVersions;
  notes?: string;
}

export const COMPILER_SUPPORT_ENTRIES: CompilerSupportEntry[] =
  rawEntries as CompilerSupportEntry[];

export const COMPILER_SUPPORT_BY_ID = new Map<string, CompilerSupportEntry>();

for (const entry of COMPILER_SUPPORT_ENTRIES) {
  COMPILER_SUPPORT_BY_ID.set(entry.id.toLowerCase(), entry);
  COMPILER_SUPPORT_BY_ID.set(entry.name.toLowerCase(), entry);
  for (const alias of entry.aliases) {
    COMPILER_SUPPORT_BY_ID.set(alias.toLowerCase(), entry);
  }
}
