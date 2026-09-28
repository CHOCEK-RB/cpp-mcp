// src/tools/clang-tidy.ts
// Runs clang-tidy over project files with preset check groups. Reporting is the
// default (dry-run); fixes are written to disk only when `apply` is set.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { resolveProjectBuildInfo } from "../project/xmake.js";
import { resolveClangTool } from "./clang-tool-resolver.js";

export type ClangTidyPreset =
  | "modernize"
  | "bugprone"
  | "performance"
  | "portability"
  | "cppcoreguidelines"
  | "cert"
  | "security"
  | "all";

/** Preset name -> `--checks` value. */
export const CLANG_TIDY_PRESETS: Record<ClangTidyPreset, string> = {
  modernize: "modernize-*",
  bugprone: "bugprone-*",
  performance: "performance-*",
  portability: "portability-*",
  cppcoreguidelines: "cppcoreguidelines-*",
  cert: "cert-*",
  security: "cert-*,bugprone-*,clang-analyzer-security-*",
  all: "*",
};

export const DEFAULT_CLANG_TIDY_PRESET: ClangTidyPreset = "modernize";

export function isClangTidyPreset(value: string): value is ClangTidyPreset {
  return Object.hasOwn(CLANG_TIDY_PRESETS, value);
}

export interface ClangTidyParams {
  /** Single file to analyze. */
  file?: string;
  /** Multiple files to analyze (ignored when `file` is set). */
  files?: string[];
  /** Check preset; defaults to `modernize`. */
  preset?: ClangTidyPreset;
  /** Raw `--checks` value; overrides `preset` when set. */
  checks?: string;
  /** Apply fixes in place. Defaults to false (report only). */
  apply?: boolean;
  /** Workspace root; defaults to cwd. */
  workspace?: string;
  /** Directory holding compile_commands.json; auto-resolved when omitted. */
  buildDir?: string;
  /** Extra raw arguments appended to every invocation. */
  extraArgs?: string[];
  /** Explicit clang-tidy executable path; also read from CLANG_TIDY_PATH. */
  clangTidyPath?: string;
  /** Per-invocation timeout in milliseconds. */
  timeoutMs?: number;
}

export interface ClangTidyDiagnostic {
  file: string;
  line: number;
  column: number;
  severity: "warning" | "error" | "note";
  message: string;
  check?: string;
}

export interface ClangTidyResult {
  success: boolean;
  tool?: string;
  version?: string;
  preset?: string;
  checks?: string;
  applied: boolean;
  files: string[];
  totalWarnings: number;
  totalErrors: number;
  diagnostics: ClangTidyDiagnostic[];
  compileCommandsDir?: string;
  error?: string;
  message?: string;
}

/** Default per-invocation timeout for clang-tidy, in milliseconds. */
const DEFAULT_TIMEOUT_MS = 60_000;

const DIAGNOSTIC_RE = /^(.*?):(\d+):(\d+):\s+(warning|error|note):\s+(.*)$/;

/**
 * Parses GCC-style clang-tidy diagnostics, extracting the trailing `[check-name]`
 * when present. Non-diagnostic lines (source snippets, "N warnings generated.")
 * are ignored.
 */
export function parseClangTidyOutput(output: string): ClangTidyDiagnostic[] {
  const diagnostics: ClangTidyDiagnostic[] = [];
  for (const rawLine of output.split(/\r?\n/)) {
    const match = DIAGNOSTIC_RE.exec(rawLine.trim());
    if (!match) continue;
    const [, file, lineStr, colStr, severity, rest] = match;
    let message = rest ?? "";
    let check: string | undefined;
    const bracket = message.match(/^(.*?)\s*\[([^\]]+)\]\s*$/);
    if (bracket) {
      message = bracket[1] ?? "";
      check = bracket[2];
    }
    diagnostics.push({
      file: file ?? "",
      line: Number.parseInt(lineStr ?? "0", 10),
      column: Number.parseInt(colStr ?? "0", 10),
      severity: severity as ClangTidyDiagnostic["severity"],
      message: message.trim(),
      check,
    });
  }
  return diagnostics;
}

/**
 * Spawns clang-tidy and collects its output. A hung process is killed and the
 * promise rejected so the MCP server never wedges.
 */
export function runClangTidyProcess(
  files: string[],
  options: {
    binaryPath?: string;
    compileCommandsDir?: string;
    checks: string;
    fix: boolean;
    cwd: string;
    extraArgs?: string[];
    timeoutMs?: number;
  },
): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve, reject) => {
    const args: string[] = [];
    if (options.compileCommandsDir) {
      args.push("-p", options.compileCommandsDir);
    }
    args.push(...files, `--checks=${options.checks}`);
    if (options.fix) {
      args.push("--fix", "--fix-errors", "--format-style=file");
    }
    if (options.extraArgs?.length) {
      args.push(...options.extraArgs);
    }

    const proc = spawn(options.binaryPath ?? "clang-tidy", args, {
      cwd: options.cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const finish = (action: () => void) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      action();
    };

    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    if (timeoutMs > 0) {
      timer = setTimeout(() => {
        finish(() => {
          if (!proc.killed) proc.kill("SIGKILL");
          reject(new Error(`clang-tidy timed out after ${timeoutMs}ms`));
        });
      }, timeoutMs);
    }

    proc.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf-8");
    });
    proc.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf-8");
    });
    proc.on("error", (err) => {
      finish(() => reject(err));
    });
    proc.on("close", (code) => {
      finish(() => resolve({ stdout, stderr, code: code ?? 0 }));
    });
  });
}

export interface ClangTidyDeps {
  resolveTool?: typeof resolveClangTool;
  runProcess?: typeof runClangTidyProcess;
}

/**
 * Runs clang-tidy over the requested files. Returns a structured report; with
 * `apply` the language server rewrites the files in place.
 */
export async function runClangTidy(
  params: ClangTidyParams,
  deps: ClangTidyDeps = {},
): Promise<ClangTidyResult> {
  const requested = params.file ? [params.file] : (params.files ?? []);
  const base: ClangTidyResult = {
    success: false,
    applied: false,
    files: [],
    totalWarnings: 0,
    totalErrors: 0,
    diagnostics: [],
  };

  if (requested.length === 0) {
    return { ...base, error: "Either 'file' or 'files' must be specified." };
  }

  const preset = params.preset ?? DEFAULT_CLANG_TIDY_PRESET;
  const checks = params.checks ?? CLANG_TIDY_PRESETS[preset];
  const wsDir = path.resolve(params.workspace ?? process.cwd());

  const files: string[] = [];
  for (const entry of requested) {
    const resolved = path.isAbsolute(entry) ? entry : path.resolve(wsDir, entry);
    if (!existsSync(resolved)) {
      return { ...base, error: `File not found: '${resolved}'.` };
    }
    files.push(resolved);
  }

  let compileCommandsDir = params.buildDir ? path.resolve(wsDir, params.buildDir) : undefined;
  if (!compileCommandsDir) {
    try {
      const buildInfo = await resolveProjectBuildInfo({ workspaceDir: wsDir, autoGenerate: true });
      if (buildInfo.compileCommandsPath) {
        compileCommandsDir = path.dirname(buildInfo.compileCommandsPath);
      }
    } catch {
      // No build system or compilation database: clang-tidy still runs with default flags.
    }
  }

  const resolveTool = deps.resolveTool ?? resolveClangTool;
  const runProcess = deps.runProcess ?? runClangTidyProcess;

  const toolInfo = await resolveTool({
    name: "clang-tidy",
    customPath: params.clangTidyPath,
    envVar: "CLANG_TIDY_PATH",
  });

  if (!toolInfo.available || !toolInfo.path) {
    return {
      ...base,
      files,
      error:
        "clang-tidy not found. Install LLVM/clang-tidy, set CLANG_TIDY_PATH, or pass clangTidyPath to its executable path.",
    };
  }

  try {
    const { stdout, stderr, code } = await runProcess(files, {
      binaryPath: toolInfo.path,
      compileCommandsDir,
      checks,
      fix: params.apply === true,
      cwd: wsDir,
      extraArgs: params.extraArgs,
      timeoutMs: params.timeoutMs,
    });

    const diagnostics = parseClangTidyOutput(`${stdout}\n${stderr}`);
    const totalWarnings = diagnostics.filter((d) => d.severity === "warning").length;
    const totalErrors = diagnostics.filter((d) => d.severity === "error").length;

    if (code !== 0 && diagnostics.length === 0) {
      const detail = `${stderr}${stdout}`.trim().split(/\r?\n/).slice(-3).join(" ").trim();
      return {
        ...base,
        files,
        compileCommandsDir,
        error: `clang-tidy exited with code ${code}${detail ? `: ${detail}` : ""}.`,
      };
    }

    const applied = params.apply === true;
    const findings = totalWarnings + totalErrors;
    return {
      success: true,
      tool: `clang-tidy${toolInfo.version ? ` (v${toolInfo.version})` : ""}`,
      version: toolInfo.version,
      preset,
      checks,
      applied,
      files,
      totalWarnings,
      totalErrors,
      diagnostics,
      compileCommandsDir,
      message: !applied
        ? findings > 0
          ? `${findings} finding(s) reported (dry-run). Re-run with apply=true to write fixes.`
          : "No clang-tidy findings."
        : findings > 0
          ? `Applied clang-tidy fixes in place; ${findings} finding(s) involved.`
          : "No clang-tidy findings; nothing to fix.",
    };
  } catch (err) {
    return {
      ...base,
      files,
      compileCommandsDir,
      error: `Failed to execute clang-tidy: ${err instanceof Error ? err.message : String(err)}.`,
    };
  }
}
