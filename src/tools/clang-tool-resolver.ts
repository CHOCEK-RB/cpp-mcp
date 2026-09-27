// src/tools/clang-tool-resolver.ts
// Shared discovery for LLVM clang tool binaries (clang-format, clang-doc, pp-trace,
// clang-reorder-fields). Tries a bare PATH lookup, absolute fallbacks, and versioned
// suffixed names (e.g. clang-format-22) so distros that only ship versioned binaries work.
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface ResolvedClangTool {
  available: boolean;
  path?: string;
  version?: string;
}

export interface ResolveClangToolOptions {
  /** Base executable name, e.g. "clang-format". */
  name: string;
  /** Explicit path override; when set it is the only candidate probed. */
  customPath?: string;
  /** Environment variable that may hold a path override. */
  envVar?: string;
}

export type ClangToolProbe = (
  file: string,
  args: string[],
  options: { timeout: number },
) => Promise<{ stdout: string; stderr: string }>;

/** LLVM major versions tried as `<name>-NN`, newest first. */
const FALLBACK_VERSIONS = [22, 21, 20, 19, 18, 17];

/**
 * Builds the ordered list of candidate executables for a clang tool. An explicit
 * `customPath` (or `envVar` override) short-circuits discovery to a single candidate.
 */
export function clangToolCandidates(name: string, customPath?: string, envVar?: string): string[] {
  const override = customPath ?? (envVar ? process.env[envVar] : undefined);
  if (override) {
    return [override];
  }
  return [
    name,
    `/usr/bin/${name}`,
    `/usr/local/bin/${name}`,
    ...FALLBACK_VERSIONS.map((major) => `${name}-${major}`),
  ];
}

/**
 * Extracts a version from `--version` output, handling both the clang-format
 * ("clang-format version 22.1.8") and LLVM ("LLVM version 18.1.0") banners.
 */
export function parseClangToolVersion(output: string): string | undefined {
  const match =
    output.match(/LLVM version\s+([0-9]+(?:\.[0-9]+)*)/i) ??
    output.match(/version\s+([0-9]+(?:\.[0-9]+)*)/i);
  return match?.[1];
}

async function defaultProbe(
  file: string,
  args: string[],
  options: { timeout: number },
): Promise<{ stdout: string; stderr: string }> {
  const { stdout, stderr } = await execFileAsync(file, args, { timeout: options.timeout });
  return { stdout, stderr };
}

/**
 * Resolves the first candidate that responds to `--version`. Pass a custom `probe`
 * to exercise discovery without the binaries being installed.
 */
export async function resolveClangTool(
  options: ResolveClangToolOptions,
  probe: ClangToolProbe = defaultProbe,
): Promise<ResolvedClangTool> {
  const candidates = clangToolCandidates(options.name, options.customPath, options.envVar);
  for (const candidate of candidates) {
    try {
      const { stdout, stderr } = await probe(candidate, ["--version"], { timeout: 3000 });
      return {
        available: true,
        path: candidate,
        version: parseClangToolVersion(`${stdout}${stderr}`),
      };
    } catch {
      // Try the next candidate.
    }
  }
  return { available: false };
}
