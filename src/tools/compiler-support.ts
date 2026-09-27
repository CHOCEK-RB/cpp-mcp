// src/tools/compiler-support.ts
// Tool to check compiler support across GCC, Clang, MSVC, and Apple Clang.
import {
  COMPILER_SUPPORT_BY_ID,
  COMPILER_SUPPORT_ENTRIES,
  type CompilerSupportEntry,
  type CompilerVersions,
} from "../data/compiler_support.js";

export type CompilerName = "gcc" | "clang" | "msvc" | "apple_clang";

export interface CheckCompilerSupportParams {
  feature?: string;
  standard?: string;
  compiler?: CompilerName;
  version?: string | number;
}

export interface CompatibilityCheck {
  compiler: string;
  userVersion: string;
  minVersion: string;
  compatible: boolean;
  message: string;
}

export interface CheckCompilerSupportResult {
  found: boolean;
  totalEntries?: number;
  entry?: CompilerSupportEntry;
  compatibility?: CompatibilityCheck;
  matches?: Array<{
    id: string;
    name: string;
    standard: string;
    category: string;
    compilers: CompilerVersions;
  }>;
  message?: string;
}

export function parseVersionSegments(v: string | number): number[] {
  const str = String(v).trim();
  const match = str.match(/\d+(?:\.\d+)*/);
  if (!match) return [];
  return match[0].split(".").map((n) => Number.parseInt(n, 10));
}

export function compareVersionSegments(userSegments: number[], minSegments: number[]): number {
  const maxLen = Math.max(userSegments.length, minSegments.length);
  for (let i = 0; i < maxLen; i++) {
    const u = userSegments[i] ?? 0;
    const m = minSegments[i] ?? 0;
    if (u > m) return 1;
    if (u < m) return -1;
  }
  return 0;
}

export function compareCompilerVersion(
  userVersionStr: string | number,
  minRequiredStr: string,
  compilerName: string,
): CompatibilityCheck {
  const userStr = String(userVersionStr).trim();
  const minStr = minRequiredStr.trim();

  if (minStr.toLowerCase() === "no") {
    return {
      compiler: compilerName,
      userVersion: userStr,
      minVersion: minStr,
      compatible: false,
      message: `${compilerName} does not support this feature yet.`,
    };
  }

  if (minStr.toLowerCase().includes("experimental")) {
    return {
      compiler: compilerName,
      userVersion: userStr,
      minVersion: minStr,
      compatible: false,
      message: `${compilerName} only has experimental/in-progress support (${minStr}).`,
    };
  }

  if (minStr.toLowerCase().includes("partial")) {
    return {
      compiler: compilerName,
      userVersion: userStr,
      minVersion: minStr,
      compatible: false,
      message: `${compilerName} only provides partial support (${minStr}).`,
    };
  }

  const userSegments = parseVersionSegments(userStr);
  const minSegments = parseVersionSegments(minStr);

  if (userSegments.length === 0 || minSegments.length === 0) {
    return {
      compiler: compilerName,
      userVersion: userStr,
      minVersion: minStr,
      compatible: false,
      message: `Could not reliably parse versions: user '${userStr}', required '${minStr}'.`,
    };
  }

  const cmp = compareVersionSegments(userSegments, minSegments);
  const compatible = cmp >= 0;
  const message = compatible
    ? `Compatible: ${compilerName} ${userStr} meets the minimum requirement (${minStr}).`
    : `Incompatible: ${compilerName} ${userStr} is older than the required ${minStr}.`;

  return {
    compiler: compilerName,
    userVersion: userStr,
    minVersion: minStr,
    compatible,
    message,
  };
}

export function normalizeFeatureQuery(query: string): string {
  return query
    .trim()
    .toLowerCase()
    .replace(/^std::/, "")
    .replace(/[\s_-]+/g, " ");
}

export function checkCompilerSupport(
  params: CheckCompilerSupportParams = {},
): CheckCompilerSupportResult {
  const { feature, standard, compiler, version } = params;

  // Case 1: Specific feature query
  if (feature?.trim()) {
    const rawKey = feature.trim().toLowerCase();
    const normalized = normalizeFeatureQuery(rawKey);

    // Exact or direct alias lookup
    let matched =
      COMPILER_SUPPORT_BY_ID.get(rawKey) ||
      COMPILER_SUPPORT_BY_ID.get(normalized) ||
      COMPILER_SUPPORT_BY_ID.get(`std-${normalized.replace(/\s+/g, "-")}`) ||
      COMPILER_SUPPORT_ENTRIES.find(
        (e) =>
          e.id.toLowerCase() === rawKey ||
          e.name.toLowerCase() === rawKey ||
          e.aliases.some((a) => a.toLowerCase() === rawKey),
      );

    // Substring / fuzzy match if not found exactly
    if (!matched) {
      matched = COMPILER_SUPPORT_ENTRIES.find(
        (e) =>
          e.id.toLowerCase().includes(normalized) ||
          e.name.toLowerCase().includes(normalized) ||
          e.aliases.some((a) => a.toLowerCase().includes(normalized)),
      );
    }

    if (matched) {
      let compatibility: CompatibilityCheck | undefined;

      if (compiler && version !== undefined) {
        const minReq = matched.compilers[compiler];
        if (minReq) {
          compatibility = compareCompilerVersion(version, minReq, compiler);
        }
      }

      return {
        found: true,
        entry: matched,
        compatibility,
      };
    }

    // Search matches across entries
    const searchMatches = COMPILER_SUPPORT_ENTRIES.filter(
      (e) =>
        e.id.toLowerCase().includes(normalized) ||
        Boolean(e.macro?.toLowerCase().includes(normalized)) ||
        Boolean(e.header?.toLowerCase().includes(normalized)) ||
        e.aliases.some((a) => a.toLowerCase().includes(normalized)),
    );

    if (searchMatches.length > 0) {
      return {
        found: true,
        matches: searchMatches.map((e) => ({
          id: e.id,
          name: e.name,
          standard: e.standard,
          category: e.category,
          compilers: e.compilers,
        })),
        message: `Found ${searchMatches.length} matching feature(s) for query "${feature}".`,
      };
    }

    return {
      found: false,
      message: `No compiler support data found for feature "${feature}". Try searching with a broader keyword (e.g. "print", "modules", "ranges").`,
    };
  }

  // Case 2: Filter by standard
  if (standard?.trim()) {
    const normStd = standard.trim().toUpperCase().replace(/\s+/g, "");
    const filtered = COMPILER_SUPPORT_ENTRIES.filter(
      (e) => e.standard.replace(/\s+/g, "").toUpperCase() === normStd,
    );

    return {
      found: filtered.length > 0,
      totalEntries: filtered.length,
      matches: filtered.map((e) => ({
        id: e.id,
        name: e.name,
        standard: e.standard,
        category: e.category,
        compilers: e.compilers,
      })),
      message: `Showing ${filtered.length} features for ${standard}.`,
    };
  }

  // Case 3: Catalog overview
  return {
    found: true,
    totalEntries: COMPILER_SUPPORT_ENTRIES.length,
    matches: COMPILER_SUPPORT_ENTRIES.map((e) => ({
      id: e.id,
      name: e.name,
      standard: e.standard,
      category: e.category,
      compilers: e.compilers,
    })),
    message: `Compiler support matrix catalog containing ${COMPILER_SUPPORT_ENTRIES.length} modern C++ features. Provide a "feature" name (e.g., "std::print") to view details.`,
  };
}
