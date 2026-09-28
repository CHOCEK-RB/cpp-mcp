// src/tools/project-policy.ts
// Reads an optional `.cpp-mcp.json` from the project root upward and resolves
// tool defaults with the precedence: explicit flag > environment > file > built-in.
import { promises as fs } from "node:fs";
import path from "node:path";
import { findUpwardFile } from "../project/xmake.js";

export const PROJECT_POLICY_FILENAME = ".cpp-mcp.json";

export interface ProjectPolicy {
  /** Default C++ standard year, e.g. "23". */
  std?: string;
  /** Defaults for `run_clang_tidy` / `cpp-mcp clang-tidy`. */
  clangTidy?: {
    preset?: string;
    checks?: string;
  };
  /** Preferred modern constructs, surfaced by guidance and prompts. */
  modernize?: {
    prefer?: string[];
  };
}

export interface LoadedProjectPolicy {
  policy: ProjectPolicy;
  /** Absolute path of the policy file, or null when none was found. */
  path: string | null;
  /** Set when a policy file exists but could not be parsed. */
  error?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const items = value.filter((item): item is string => typeof item === "string");
  return items.length > 0 ? items : undefined;
}

/**
 * Parses policy JSON, keeping only recognized fields. Throws when the payload
 * is not a JSON object so callers can surface a useful error.
 */
export function parseProjectPolicy(raw: string): ProjectPolicy {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `Could not parse ${PROJECT_POLICY_FILENAME}: ${err instanceof Error ? err.message : String(err)}.`,
    );
  }
  if (!isRecord(parsed)) {
    throw new Error(`${PROJECT_POLICY_FILENAME} must contain a JSON object.`);
  }

  const policy: ProjectPolicy = {};
  if (typeof parsed.std === "string" && parsed.std.trim()) {
    policy.std = parsed.std.trim();
  }

  if (isRecord(parsed.clangTidy)) {
    const clangTidy: ProjectPolicy["clangTidy"] = {};
    if (typeof parsed.clangTidy.preset === "string" && parsed.clangTidy.preset.trim()) {
      clangTidy.preset = parsed.clangTidy.preset.trim();
    }
    if (typeof parsed.clangTidy.checks === "string" && parsed.clangTidy.checks.trim()) {
      clangTidy.checks = parsed.clangTidy.checks.trim();
    }
    if (clangTidy.preset || clangTidy.checks) {
      policy.clangTidy = clangTidy;
    }
  }

  if (isRecord(parsed.modernize)) {
    const prefer = asStringArray(parsed.modernize.prefer);
    if (prefer) {
      policy.modernize = { prefer };
    }
  }

  return policy;
}

/**
 * Locates and loads `.cpp-mcp.json` starting at `rootDir` and walking upward.
 * A missing file yields an empty policy; an unreadable or invalid file yields
 * an empty policy plus `error`, so callers degrade gracefully.
 */
export async function loadProjectPolicy(rootDir = process.cwd()): Promise<LoadedProjectPolicy> {
  let found: string | null = null;
  try {
    found = findUpwardFile(path.resolve(rootDir), PROJECT_POLICY_FILENAME);
  } catch {
    return { policy: {}, path: null };
  }
  if (!found) {
    return { policy: {}, path: null };
  }

  try {
    const raw = await fs.readFile(found, "utf-8");
    return { policy: parseProjectPolicy(raw), path: found };
  } catch (err) {
    return {
      policy: {},
      path: found,
      error: `Could not read ${PROJECT_POLICY_FILENAME}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    };
  }
}

/**
 * Resolves a default C++ standard using flag > CPP_MCP_STD env > policy file.
 * Returns undefined when none is configured.
 */
export function resolveStandard(options: {
  flag?: string;
  policy?: ProjectPolicy;
  env?: string | null;
}): string | undefined {
  const envValue = options.env === undefined ? process.env.CPP_MCP_STD : options.env;
  return options.flag?.trim() || envValue?.trim() || options.policy?.std?.trim() || undefined;
}
