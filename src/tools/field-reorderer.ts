// src/tools/field-reorderer.ts
// Semantic refactoring tool to reorder fields in C/C++ structs and classes using clang-reorder-fields.
// Automatically updates struct declarations, aggregate initializers, C++ constructor init lists, and C++20 designated initializers.

import { execFile } from "node:child_process";
import { existsSync, promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { findExistingCompilationDb } from "../project/xmake.js";
import { resolveClangTool } from "./clang-tool-resolver.js";
import { generateSimpleDiff } from "./code-formatter.js";
import { scanSourceFiles } from "./compile-db.js";

const execFileAsync = promisify(execFile);

/**
 * Maximum number of auto-discovered files to inspect in a single request.
 * clang-reorder-fields is invoked once per file, so an unbounded workspace scan
 * would spawn thousands of processes. Pass an explicit `files` list to bypass it.
 */
const MAX_AUTO_DISCOVERY_FILES = 200;

/** Per-invocation timeout for clang-reorder-fields (one process per file). */
const PER_FILE_TIMEOUT_MS = 30_000;

/** stdout buffer limit per invocation; a rewritten translation unit can be large. */
const MAX_STDOUT_BUFFER = 32 * 1024 * 1024;

export interface ReorderFieldsParams {
  recordName: string;
  fieldsOrder: string[] | string;
  files?: string[];
  workspace?: string;
  extraArgs?: string[];
  apply?: boolean;
  clangReorderFieldsPath?: string;
}

export interface FileChangeSummary {
  file: string;
  modified: boolean;
  diff?: string;
}

export interface ReorderFieldsResult {
  success: boolean;
  recordName: string;
  fieldsOrder: string[];
  dryRun: boolean;
  totalFiles: number;
  modifiedFiles: string[];
  changes: FileChangeSummary[];
  unifiedDiff?: string;
  warnings: string[];
  summary: string;
  error?: string;
}

/**
 * Discovers clang-reorder-fields executable in PATH or custom candidate paths.
 */
export async function findClangReorderFields(customPath?: string): Promise<{
  available: boolean;
  path?: string;
  version?: string;
}> {
  return resolveClangTool({ name: "clang-reorder-fields", customPath });
}

interface SingleFileOutcome {
  file: string;
  original: string;
  /** Rewritten source produced on stdout by clang-reorder-fields (never written to disk here). */
  rewritten: string;
  stderr: string;
  failed: boolean;
  errorMessage?: string;
}

/**
 * Runs clang-reorder-fields on a single translation unit WITHOUT `-i`, so the tool
 * prints the rewritten source to stdout and never touches the user's files.
 *
 * All files are computed against the original on-disk state before anything is
 * written, which keeps cross-file rewrites (e.g. a header definition plus an
 * aggregate initializer in a .cpp) consistent.
 */
async function reorderSingleFile(opts: {
  binaryPath: string;
  recordName: string;
  fieldsOrder: string[];
  file: string;
  workspaceDir: string;
  compilationDbDir?: string;
  compilerArgs: string[];
}): Promise<SingleFileOutcome> {
  let original = "";
  try {
    original = await fs.readFile(opts.file, "utf-8");
  } catch {
    original = "";
  }

  const args = [`-record-name=${opts.recordName}`, `-fields-order=${opts.fieldsOrder.join(",")}`];
  if (opts.compilationDbDir) {
    args.push("-p", opts.compilationDbDir);
  }
  args.push(opts.file);
  // Source files must precede `--`; everything after it is forwarded to the compiler.
  if (opts.compilerArgs.length > 0) {
    args.push("--", ...opts.compilerArgs);
  }

  try {
    const { stdout, stderr } = await execFileAsync(opts.binaryPath, args, {
      cwd: opts.workspaceDir,
      timeout: PER_FILE_TIMEOUT_MS,
      maxBuffer: MAX_STDOUT_BUFFER,
    });
    return {
      file: opts.file,
      original,
      rewritten: stdout,
      stderr: stderr || "",
      failed: false,
    };
  } catch (err: unknown) {
    const execErr = err as { stderr?: string; message?: string };
    return {
      file: opts.file,
      original,
      rewritten: original,
      stderr: execErr.stderr || "",
      failed: true,
      errorMessage: execErr.stderr?.trim() || execErr.message || String(err),
    };
  }
}

/**
 * Reorders fields in C/C++ structs or classes across definitions and initializers.
 */
export async function reorderStructFields(
  params: ReorderFieldsParams,
): Promise<ReorderFieldsResult> {
  const workspaceDir = path.resolve(params.workspace ?? process.cwd());
  const apply = params.apply ?? false;
  const dryRun = !apply;
  const recordName = params.recordName?.trim();

  // 1. Parse fields order
  const fieldsOrder: string[] = Array.isArray(params.fieldsOrder)
    ? params.fieldsOrder.map((f) => f.trim()).filter(Boolean)
    : (params.fieldsOrder ?? "")
        .split(",")
        .map((f) => f.trim())
        .filter(Boolean);

  if (!recordName) {
    return {
      success: false,
      recordName: "",
      fieldsOrder: [],
      dryRun,
      totalFiles: 0,
      modifiedFiles: [],
      changes: [],
      warnings: [],
      summary: "Missing required parameter 'recordName'.",
      error: "Provide the struct or class name (e.g. 'Foo' or '::bar::Foo').",
    };
  }

  if (fieldsOrder.length < 2) {
    return {
      success: false,
      recordName,
      fieldsOrder,
      dryRun,
      totalFiles: 0,
      modifiedFiles: [],
      changes: [],
      warnings: [],
      summary: "Invalid 'fieldsOrder': at least 2 fields are required to reorder.",
      error: "Provide at least two comma-separated field names (e.g. 'z,w,y,x').",
    };
  }

  // 2. Discover binary
  const binaryInfo = await findClangReorderFields(params.clangReorderFieldsPath);
  if (!binaryInfo.available || !binaryInfo.path) {
    return {
      success: false,
      recordName,
      fieldsOrder,
      dryRun,
      totalFiles: 0,
      modifiedFiles: [],
      changes: [],
      warnings: [],
      summary: "clang-reorder-fields is not installed or not found in system PATH.",
      error:
        "clang-reorder-fields binary was not found. Install it via your package manager:\n" +
        "  - Arch Linux: sudo pacman -S clang-tools-extra\n" +
        "  - Ubuntu/Debian: sudo apt install clang-tools\n" +
        "  - macOS: brew install llvm",
    };
  }

  // 3. Resolve target files
  const autoDiscovered = !(params.files && params.files.length > 0);
  let targetFiles: string[] = [];
  if (!autoDiscovered && params.files) {
    for (const f of params.files) {
      const resolved = path.isAbsolute(f) ? f : path.resolve(workspaceDir, f);
      if (existsSync(resolved)) {
        targetFiles.push(resolved);
      }
    }
  } else {
    // Auto-discover C/C++ source and header files in workspace
    const scanned = await scanSourceFiles(workspaceDir);
    targetFiles = Array.from(new Set([...scanned.sources, ...scanned.headers]));
  }

  if (targetFiles.length === 0) {
    return {
      success: false,
      recordName,
      fieldsOrder,
      dryRun,
      totalFiles: 0,
      modifiedFiles: [],
      changes: [],
      warnings: [],
      summary: "No source or header files found to inspect.",
      error: "Provide specific files via the 'files' parameter or run inside a C/C++ workspace.",
    };
  }

  // 4. Read original contents (needed for diffing, filtering and safety)
  const originalContents = new Map<string, string>();
  for (const f of targetFiles) {
    try {
      const content = await fs.readFile(f, "utf-8");
      originalContents.set(f, content);
    } catch {
      // Skip unreadable files
    }
  }

  const warnings: string[] = [];

  // 5. Narrow the candidate set before spawning one process per file.
  let candidateFiles = Array.from(originalContents.keys());

  if (autoDiscovered) {
    // Cheap pre-filter: only files that actually mention the record can be affected.
    const recordLeaf = recordName.split("::").filter(Boolean).pop() ?? recordName;
    candidateFiles = candidateFiles.filter((f) =>
      (originalContents.get(f) ?? "").includes(recordLeaf),
    );
  }

  if (autoDiscovered && candidateFiles.length > MAX_AUTO_DISCOVERY_FILES) {
    warnings.push(
      `Auto-discovery matched ${candidateFiles.length} files; inspecting only the first ` +
        `${MAX_AUTO_DISCOVERY_FILES}. Pass an explicit 'files' list to target specific files.`,
    );
    candidateFiles = candidateFiles.slice(0, MAX_AUTO_DISCOVERY_FILES);
  }

  if (candidateFiles.length === 0) {
    return {
      success: false,
      recordName,
      fieldsOrder,
      dryRun,
      totalFiles: 0,
      modifiedFiles: [],
      changes: [],
      warnings,
      summary: `No source or header file references '${recordName}'.`,
      error:
        "No candidate files contained the record name. Verify the spelling or pass files explicitly.",
    };
  }

  // 6. Build compiler arguments shared by every invocation
  const existingDb = findExistingCompilationDb(workspaceDir);
  const compilationDbDir = existingDb ? path.dirname(existingDb) : undefined;

  const compilerArgs: string[] = [];
  if (params.extraArgs && params.extraArgs.length > 0) {
    compilerArgs.push(...params.extraArgs);
  }
  // If no compilation database is present, supply a default workspace include path.
  if (!existingDb) {
    compilerArgs.push(`-I${workspaceDir}`);
  }

  // 7. Phase 1 — compute rewrites for every file against the original state.
  const warningSet = new Set<string>(warnings);
  const errorSet = new Set<string>();
  const outcomes: SingleFileOutcome[] = [];

  for (const file of candidateFiles) {
    const outcome = await reorderSingleFile({
      binaryPath: binaryInfo.path,
      recordName,
      fieldsOrder,
      file,
      workspaceDir,
      compilationDbDir,
      compilerArgs,
    });
    outcomes.push(outcome);

    if (outcome.stderr) {
      for (const line of outcome.stderr.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        if (/warning:/i.test(trimmed)) {
          warningSet.add(trimmed);
        } else if (
          /not found/i.test(trimmed) ||
          /doesn't match/i.test(trimmed) ||
          /error:/i.test(trimmed) ||
          /flexible array member/i.test(trimmed) ||
          /different access/i.test(trimmed)
        ) {
          errorSet.add(trimmed);
        }
      }
    }
    if (outcome.failed && outcome.errorMessage) {
      errorSet.add(outcome.errorMessage);
    }
  }

  // 8. Phase 2 — write changes only when explicitly requested.
  if (apply) {
    for (const outcome of outcomes) {
      if (outcome.failed || outcome.rewritten === outcome.original) continue;
      try {
        await fs.writeFile(outcome.file, outcome.rewritten, "utf-8");
      } catch (err) {
        errorSet.add(
          `Failed to write ${outcome.file}: ${err instanceof Error ? err.message : String(err)}`,
        );
        // Reflect reality: the file was not updated.
        outcome.rewritten = outcome.original;
      }
    }
  }

  // 9. Build the change report
  const changes: FileChangeSummary[] = [];
  const modifiedFiles: string[] = [];
  const diffs: string[] = [];

  for (const outcome of outcomes) {
    const isModified = outcome.rewritten !== outcome.original;
    const relPath = path.relative(workspaceDir, outcome.file) || outcome.file;

    if (isModified) {
      modifiedFiles.push(relPath);
      const fileDiff = generateSimpleDiff(outcome.original, outcome.rewritten, relPath);
      if (fileDiff) {
        diffs.push(fileDiff);
      }
      changes.push({ file: relPath, modified: true, diff: fileDiff });
    } else {
      changes.push({ file: relPath, modified: false });
    }
  }

  // 10. Check if record or fields were not found
  if (modifiedFiles.length === 0) {
    const errorMsg =
      errorSet.size > 0
        ? Array.from(errorSet).join("; ")
        : `Record '${recordName}' was not modified or fields were already in the desired order.`;

    return {
      success: false,
      recordName,
      fieldsOrder,
      dryRun,
      totalFiles: outcomes.length,
      modifiedFiles: [],
      changes,
      warnings: Array.from(warningSet),
      summary: `Failed to reorder fields for '${recordName}'.`,
      error: errorMsg,
    };
  }

  const modeStr = dryRun ? "[DRY-RUN / PREVIEW]" : "[APPLIED]";
  const summary = `${modeStr} Successfully reordered fields in '${recordName}' (${fieldsOrder.join(", ")}) across ${modifiedFiles.length} file(s).`;

  return {
    success: true,
    recordName,
    fieldsOrder,
    dryRun,
    totalFiles: outcomes.length,
    modifiedFiles,
    changes: changes.filter((c) => c.modified),
    unifiedDiff: diffs.join("\n\n"),
    warnings: Array.from(warningSet),
    summary,
  };
}
