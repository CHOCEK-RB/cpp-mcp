// src/tools/code-formatter.ts
// C/C++ code formatter using clang-format with in-memory snippets and file formatting support.
import { spawn } from "node:child_process";
import { existsSync, promises as fs } from "node:fs";
import path from "node:path";
import { resolveClangTool } from "./clang-tool-resolver.js";

export interface FormatRange {
  startLine: number;
  endLine: number;
}

export interface FormatCodeParams {
  code?: string;
  file?: string;
  workspace?: string;
  style?: string;
  fallbackStyle?: string;
  apply?: boolean;
  range?: FormatRange;
  /** Explicit clang-format executable path; also read from CLANG_FORMAT_PATH. */
  clangFormatPath?: string;
}

export interface FormatCodeResult {
  formatted: boolean;
  changed: boolean;
  original?: string;
  formattedCode?: string;
  diff?: string;
  file?: string;
  applied?: boolean;
  styleUsed?: string;
  error?: string;
  message?: string;
}

export function generateSimpleDiff(original: string, modified: string, fileName?: string): string {
  const origLines = original.split(/\r?\n/);
  const modLines = modified.split(/\r?\n/);

  if (original === modified) {
    return "";
  }

  const diffLines: string[] = [];
  if (fileName) {
    diffLines.push(`--- a/${fileName}`);
    diffLines.push(`+++ b/${fileName}`);
  }

  let i = 0;
  let j = 0;

  while (i < origLines.length || j < modLines.length) {
    if (i < origLines.length && j < modLines.length && origLines[i] === modLines[j]) {
      i++;
      j++;
    } else {
      const startI = i;
      const startJ = j;
      const removed: string[] = [];
      const added: string[] = [];

      while (i < origLines.length && (j >= modLines.length || origLines[i] !== modLines[j])) {
        if (modLines.slice(j, j + 5).includes(origLines[i] ?? "")) {
          break;
        }
        removed.push(origLines[i] ?? "");
        i++;
      }

      while (j < modLines.length && (i >= origLines.length || origLines[i] !== modLines[j])) {
        added.push(modLines[j] ?? "");
        j++;
      }

      diffLines.push(
        `@@ -${startI + 1},${Math.max(1, removed.length)} +${startJ + 1},${Math.max(1, added.length)} @@`,
      );
      for (const r of removed) {
        diffLines.push(`- ${r}`);
      }
      for (const a of added) {
        diffLines.push(`+ ${a}`);
      }
    }
  }

  return diffLines.join("\n");
}

/** Default per-invocation timeout for clang-format, in milliseconds. */
const DEFAULT_TIMEOUT_MS = 10_000;

/**
 * Runs clang-format over `input`, reading the formatted result from stdout. A hung
 * process is killed and the promise rejected so the MCP server never wedges.
 */
export function runClangFormat(
  input: string,
  options: {
    assumeFilename: string;
    style: string;
    fallbackStyle: string;
    cwd: string;
    binaryPath?: string;
    timeoutMs?: number;
    range?: FormatRange;
  },
): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve, reject) => {
    const args = [
      `--assume-filename=${options.assumeFilename}`,
      `-style=${options.style}`,
      `--fallback-style=${options.fallbackStyle}`,
    ];

    if (
      options.range &&
      options.range.startLine > 0 &&
      options.range.endLine >= options.range.startLine
    ) {
      args.push(`--lines=${options.range.startLine}:${options.range.endLine}`);
    }

    const proc = spawn(options.binaryPath ?? "clang-format", args, {
      cwd: options.cwd,
      stdio: ["pipe", "pipe", "pipe"],
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
          reject(new Error(`clang-format timed out after ${timeoutMs}ms`));
        });
      }, timeoutMs);
    }

    // Prevent uncaught EPIPE error if clang-format exits early (e.g. invalid flags/style)
    proc.stdin.on("error", () => {});

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

    proc.stdin.write(input, "utf-8");
    proc.stdin.end();
  });
}

/**
 * Formats C/C++ source code or files using clang-format.
 */
export async function formatCode(params: FormatCodeParams): Promise<FormatCodeResult> {
  const {
    code,
    file,
    workspace,
    style = "file",
    fallbackStyle = "LLVM",
    apply = false,
    range,
  } = params;

  if (code === undefined && !file) {
    return {
      formatted: false,
      changed: false,
      error: "Either 'code' (string) or 'file' (path) must be specified.",
    };
  }

  if (range) {
    if (
      !Number.isInteger(range.startLine) ||
      !Number.isInteger(range.endLine) ||
      range.startLine < 1 ||
      range.endLine < 1
    ) {
      return {
        formatted: false,
        changed: false,
        error: `Invalid range: startLine and endLine must be positive integers (received startLine=${range.startLine}, endLine=${range.endLine}).`,
      };
    }
    if (range.startLine > range.endLine) {
      return {
        formatted: false,
        changed: false,
        error: `Invalid range: startLine (${range.startLine}) cannot be greater than endLine (${range.endLine}).`,
      };
    }
  }

  let originalText = "";
  let targetPath = file;
  let workDir = workspace ? path.resolve(workspace) : process.cwd();

  if (file) {
    const resolvedPath = path.isAbsolute(file) ? file : path.resolve(workDir, file);
    if (!existsSync(resolvedPath)) {
      return {
        formatted: false,
        changed: false,
        file: resolvedPath,
        error: `File not found: '${resolvedPath}'.`,
      };
    }
    try {
      originalText = await fs.readFile(resolvedPath, "utf-8");
      targetPath = resolvedPath;
      if (!workspace) {
        workDir = path.dirname(resolvedPath);
      }
    } catch (err) {
      return {
        formatted: false,
        changed: false,
        file: resolvedPath,
        error: `Failed to read file: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  } else {
    originalText = code ?? "";
    targetPath = "snippet.cpp";
  }

  const toolInfo = await resolveClangTool({
    name: "clang-format",
    customPath: params.clangFormatPath,
    envVar: "CLANG_FORMAT_PATH",
  });

  if (!toolInfo.available || !toolInfo.path) {
    return {
      formatted: false,
      changed: false,
      error:
        "clang-format not found. Install LLVM/clang-format, set CLANG_FORMAT_PATH, or pass clangFormatPath to its executable path.",
    };
  }

  try {
    const {
      stdout,
      stderr,
      code: exitCode,
    } = await runClangFormat(originalText, {
      assumeFilename: targetPath ?? "snippet.cpp",
      style,
      fallbackStyle,
      cwd: workDir,
      binaryPath: toolInfo.path,
      range,
    });

    if (exitCode !== 0) {
      return {
        formatted: false,
        changed: false,
        error: `clang-format failed with exit code ${exitCode}: ${stderr.trim() || stdout.trim() || "Process exited with non-zero status"}`,
      };
    }

    const formattedCode = stdout;
    const changed = formattedCode !== originalText;
    const diff = changed ? generateSimpleDiff(originalText, formattedCode, targetPath) : "";

    let applied = false;
    if (file && apply && changed && targetPath) {
      await fs.writeFile(targetPath, formattedCode, "utf-8");
      applied = true;
    }

    return {
      formatted: true,
      changed,
      original: originalText,
      formattedCode,
      diff: changed ? diff : undefined,
      file: file ? targetPath : undefined,
      applied,
      styleUsed: style,
      message: !changed
        ? "Code is already well-formatted."
        : applied
          ? `Formatted and saved changes to '${targetPath}'.`
          : "Formatted successfully (dry-run preview). Pass apply=true to write to disk.",
    };
  } catch (err) {
    return {
      formatted: false,
      changed: false,
      error: `Failed to execute clang-format: ${err instanceof Error ? err.message : String(err)}. Ensure clang-format is installed and available in PATH.`,
    };
  }
}
