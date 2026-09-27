// src/tools/preprocessor-tracer.ts
// Traces the C/C++ preprocessor with clang-tools-extra's `pp-trace`, turning its
// high-volume YAML callback stream into a filtered, aggregated summary of macros,
// includes, conditional branches, pragmas, and module imports.

import { execFile, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { findExistingCompilationDb } from "../project/xmake.js";

const execFileAsync = promisify(execFile);

/** Default cap on retained raw events returned when `includeEvents` is enabled. */
const DEFAULT_MAX_EVENTS = 500;

/** Upper bound accepted for the `maxEvents` parameter, to keep responses bounded. */
const MAX_EVENTS_LIMIT = 10_000;

/** Cap on entries retained per aggregated list (macros, includes, conditionals, ...). */
const MAX_LIST_ITEMS = 200;

/** Wall-clock budget for a single pp-trace invocation. */
const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * Hard limit on captured stdout. A trivial translation unit already emits ~20 MB of
 * YAML because every system header is traced; this guards against pathological inputs.
 */
const MAX_OUTPUT_BYTES = 256 * 1024 * 1024;

/** Cap on retained stderr, which only carries diagnostics/warnings. */
const MAX_STDERR_BYTES = 1024 * 1024;

/** Cap on the warnings array surfaced to callers. */
const MAX_WARNINGS = 25;

/** System/synthetic locations that never count as user code. */
const SYSTEM_PATH_PREFIXES = [
  "/usr/",
  "/usr",
  "/lib/",
  "/lib64/",
  "/opt/",
  "/nix/",
  "/snap/",
  "/Applications/",
  "C:\\Program Files",
  "C:\\Windows",
];

const CALLBACK_LINE = /^- Callback:\s*(.+?)\s*$/;
const FIELD_LINE = /^\s+([A-Za-z_][A-Za-z0-9_]*):\s?(.*)$/;

/** A single `- Callback: <Name>` record with its scalar/flow-mapping fields. */
export interface PpTraceEvent {
  callback: string;
  fields: Record<string, string>;
}

export interface MacroEntry {
  name: string;
  action: "define" | "undefine";
  file?: string;
  loc?: string;
}

export interface IncludeEntry {
  fileName: string;
  angled: boolean;
  resolved?: string;
  searchPath?: string;
  relativePath?: string;
  loc?: string;
}

export interface ConditionalEntry {
  kind: string;
  loc?: string;
  conditionValue?: boolean;
  ifLoc?: string;
}

export interface PragmaEntry {
  kind: string;
  loc?: string;
  namespace?: string;
  detail?: string;
}

export interface ModuleEntry {
  imported: string;
  loc?: string;
  path?: string;
}

export interface TracePreprocessorParams {
  file: string;
  workspace?: string;
  callbacks?: string[] | string;
  extraArgs?: string[];
  maxEvents?: number;
  includeEvents?: boolean;
  userFilesOnly?: boolean;
  ppTracePath?: string;
  timeoutMs?: number;
}

export interface PreprocessorTraceResult {
  success: boolean;
  source: string;
  tool: { name: string; path?: string; version?: string };
  summary: {
    totalEvents: number;
    userEvents: number;
    truncated: boolean;
    counts: Record<string, number>;
  };
  macros: MacroEntry[];
  includes: IncludeEntry[];
  conditionals: ConditionalEntry[];
  pragmas: PragmaEntry[];
  modules: ModuleEntry[];
  events?: PpTraceEvent[];
  warnings: string[];
  error?: string;
}

/**
 * Discovers the pp-trace executable in PATH or custom candidate paths.
 */
export async function findPpTrace(customPath?: string): Promise<{
  available: boolean;
  path?: string;
  version?: string;
}> {
  const candidates = customPath
    ? [customPath]
    : [
        "pp-trace",
        "/usr/bin/pp-trace",
        "/usr/local/bin/pp-trace",
        "pp-trace-22",
        "pp-trace-21",
        "pp-trace-20",
        "pp-trace-19",
        "pp-trace-18",
        "pp-trace-17",
      ];

  for (const candidate of candidates) {
    try {
      const { stdout, stderr } = await execFileAsync(candidate, ["--version"], { timeout: 3000 });
      const output = `${stdout}${stderr}`;
      const versionMatch = output.match(/version\s+([0-9]+\.[0-9]+(?:\.[0-9]+)?)/i);
      return {
        available: true,
        path: candidate,
        version: versionMatch ? versionMatch[1] : undefined,
      };
    } catch {
      // Continue checking the next candidate.
    }
  }

  return { available: false };
}

/**
 * True when a value's brackets and quotes are balanced, meaning the YAML field is
 * complete on one line. Unbalanced values (e.g. a flow sequence split across lines)
 * must consume the following lines.
 */
function isBalanced(value: string): boolean {
  let depth = 0;
  let inQuote = false;
  for (let i = 0; i < value.length; i++) {
    const ch = value[i];
    if (ch === '"') {
      inQuote = !inQuote;
    } else if (!inQuote && (ch === "[" || ch === "{")) {
      depth++;
    } else if (!inQuote && (ch === "]" || ch === "}")) {
      depth--;
    }
  }
  return depth <= 0 && !inQuote;
}

interface EventParser {
  line(rawLine: string): void;
  finish(): void;
}

/**
 * Incremental line parser for pp-trace's YAML callback stream. Emits one event per
 * `- Callback:` record; nested flow values are merged back into a single field.
 */
function createEventParser(onEvent: (event: PpTraceEvent) => void): EventParser {
  let current: PpTraceEvent | null = null;
  let lastKey: string | null = null;
  let needsContinuation = false;

  const emit = () => {
    if (current) {
      onEvent(current);
    }
    current = null;
  };

  return {
    line(rawLine: string): void {
      const line = rawLine.replace(/\r$/, "");
      const trimmed = line.trim();
      if (!trimmed || trimmed === "---") {
        return;
      }

      const callbackMatch = line.match(CALLBACK_LINE);
      if (callbackMatch) {
        emit();
        current = { callback: (callbackMatch[1] ?? "").trim(), fields: {} };
        lastKey = null;
        needsContinuation = false;
        return;
      }

      if (!current) {
        return;
      }

      if (!needsContinuation) {
        const fieldMatch = line.match(FIELD_LINE);
        if (fieldMatch) {
          const key = fieldMatch[1] ?? "";
          const value = fieldMatch[2] ?? "";
          current.fields[key] = value;
          lastKey = key;
          needsContinuation = !isBalanced(value);
          return;
        }
      }

      if (lastKey) {
        const merged = `${current.fields[lastKey] ?? ""} ${trimmed}`.trim();
        current.fields[lastKey] = merged;
        needsContinuation = !isBalanced(merged);
      }
    },
    finish(): void {
      emit();
    },
  };
}

/**
 * Parses a full pp-trace YAML dump into raw callback events. Pure and side-effect free,
 * so it can be exercised without the pp-trace binary. Nested values (e.g.
 * `Path: [{Name: X, Loc: \"...\"}]`) are preserved verbatim as a single field.
 */
export function parsePpTraceYaml(text: string): PpTraceEvent[] {
  const events: PpTraceEvent[] = [];
  const parser = createEventParser((event) => events.push(event));
  for (const line of text.split(/\r?\n/)) {
    parser.line(line);
  }
  parser.finish();
  return events;
}

/** Strips wrapping quotes and surrounding whitespace from a scalar YAML value. */
function cleanValue(value: string | undefined): string {
  if (value === undefined) {
    return "";
  }
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length >= 2) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'") && trimmed.length >= 2)
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

/** Extracts a file path from a `file:line:col` location, returning null for sentinels. */
function fileFromLoc(value: string): string | null {
  const cleaned = cleanValue(value);
  if (!cleaned || cleaned === "(null)" || cleaned === "(invalid)" || cleaned === "(nonfile)") {
    return null;
  }
  const match = cleaned.match(/^(.*?):(\d+):(\d+)$/);
  if (!match) {
    return cleaned;
  }
  return match[1] ?? null;
}

/** Collects every file referenced by a callback's location and range fields. */
function eventFiles(event: PpTraceEvent): string[] {
  const files: string[] = [];
  for (const [key, value] of Object.entries(event.fields)) {
    if (key.endsWith("Loc")) {
      const file = fileFromLoc(value);
      if (file) {
        files.push(file);
      }
      continue;
    }
    if (key === "Range" || key === "ConditionRange") {
      for (const part of value.match(/"([^"]+)"/g) ?? []) {
        const file = fileFromLoc(part);
        if (file) {
          files.push(file);
        }
      }
    }
  }
  return files;
}

/** True when a path refers to user/project code rather than the toolchain or a virtual file. */
function isUserFile(file: string): boolean {
  if (!file) {
    return false;
  }
  // <built-in>, <command line>, <scratch space>, ...
  if (file.startsWith("<")) {
    return false;
  }
  if (path.isAbsolute(file)) {
    return !SYSTEM_PATH_PREFIXES.some((prefix) => file.startsWith(prefix));
  }
  // Relative paths are project-local by construction.
  return true;
}

export interface AggregatedTrace {
  totalEvents: number;
  userEvents: number;
  truncated: boolean;
  counts: Record<string, number>;
  macros: MacroEntry[];
  includes: IncludeEntry[];
  conditionals: ConditionalEntry[];
  pragmas: PragmaEntry[];
  modules: ModuleEntry[];
  events: PpTraceEvent[];
}

export interface AggregateOptions {
  userFilesOnly: boolean;
  includeEvents: boolean;
  maxEvents: number;
  /**
   * Callbacks used only for attribution (e.g. FileChanged to track the active file)
   * that must not appear in the aggregated output.
   */
  suppressCallbacks?: string[];
}

/**
 * Streaming aggregator: consumes raw events one at a time and keeps only bounded,
 * user-relevant summaries, so a 300k-record dump never has to be held in memory.
 */
export function createTraceAggregator(options: AggregateOptions): {
  push(event: PpTraceEvent): void;
  finish(): AggregatedTrace;
} {
  const counts: Record<string, number> = {};
  const macros: MacroEntry[] = [];
  const includes: IncludeEntry[] = [];
  const conditionals: ConditionalEntry[] = [];
  const pragmas: PragmaEntry[] = [];
  const modules: ModuleEntry[] = [];
  const events: PpTraceEvent[] = [];
  const fileStack: string[] = [];
  const suppressed = new Set(options.suppressCallbacks ?? []);

  let totalEvents = 0;
  let userEvents = 0;
  let truncated = false;

  const pushCapped = <T>(list: T[], item: T): void => {
    if (list.length < MAX_LIST_ITEMS) {
      list.push(item);
    } else {
      truncated = true;
    }
  };

  return {
    push(event: PpTraceEvent): void {
      if (event.callback === "FileChanged") {
        const reason = cleanValue(event.fields.Reason);
        const loc = fileFromLoc(event.fields.Loc ?? "");
        if (reason === "EnterFile") {
          if (loc) {
            fileStack.push(loc);
          }
        } else if (reason === "ExitFile") {
          fileStack.pop();
        } else if (reason === "RenameFile") {
          if (loc) {
            fileStack[fileStack.length - 1] = loc;
          }
        }
      }

      if (suppressed.has(event.callback)) {
        return;
      }

      totalEvents++;

      const currentFile = fileStack.length > 0 ? fileStack[fileStack.length - 1] : undefined;
      const files = eventFiles(event);
      const userEvent =
        !options.userFilesOnly ||
        files.some((file) => isUserFile(file)) ||
        (files.length === 0 && currentFile !== undefined && isUserFile(currentFile));

      if (!userEvent) {
        return;
      }

      userEvents++;
      counts[event.callback] = (counts[event.callback] ?? 0) + 1;

      switch (event.callback) {
        case "MacroDefined":
        case "MacroUndefined": {
          pushCapped(macros, {
            name: cleanValue(event.fields.MacroNameTok),
            action: event.callback === "MacroDefined" ? "define" : "undefine",
            file: currentFile,
            loc: cleanValue(event.fields.Loc) || undefined,
          });
          break;
        }
        case "InclusionDirective": {
          pushCapped(includes, {
            fileName: cleanValue(event.fields.FileName),
            angled: cleanValue(event.fields.IsAngled) === "true",
            resolved: cleanValue(event.fields.File) || undefined,
            searchPath: cleanValue(event.fields.SearchPath) || undefined,
            relativePath: cleanValue(event.fields.RelativePath) || undefined,
            loc: cleanValue(event.fields.HashLoc) || undefined,
          });
          break;
        }
        case "If":
        case "Elif":
        case "Ifdef":
        case "Ifndef":
        case "Else":
        case "Endif": {
          const rawCondition = cleanValue(event.fields.ConditionValue);
          const conditionValue = /true/i.test(rawCondition)
            ? true
            : /false/i.test(rawCondition)
              ? false
              : undefined;
          pushCapped(conditionals, {
            kind: event.callback,
            loc: cleanValue(event.fields.Loc) || undefined,
            conditionValue,
            ifLoc: cleanValue(event.fields.IfLoc) || undefined,
          });
          break;
        }
        case "moduleImport": {
          pushCapped(modules, {
            imported: cleanValue(event.fields.Imported),
            loc: cleanValue(event.fields.ImportLoc) || undefined,
            path: cleanValue(event.fields.Path) || undefined,
          });
          break;
        }
        default: {
          if (event.callback.startsWith("Pragma")) {
            pushCapped(pragmas, {
              kind: event.callback,
              loc: cleanValue(event.fields.Loc) || undefined,
              namespace: cleanValue(event.fields.Namespace) || undefined,
              detail:
                cleanValue(event.fields.Str) ||
                cleanValue(event.fields.WarningSpec) ||
                cleanValue(event.fields.DebugType) ||
                cleanValue(event.fields.Value) ||
                undefined,
            });
          }
          break;
        }
      }

      if (options.includeEvents) {
        if (events.length < options.maxEvents) {
          events.push(event);
        } else {
          truncated = true;
        }
      }
    },
    finish(): AggregatedTrace {
      return {
        totalEvents,
        userEvents,
        truncated,
        counts,
        macros,
        includes,
        conditionals,
        pragmas,
        modules,
        events,
      };
    },
  };
}

/** Normalizes the `callbacks` parameter (array or comma string) into a clean list. */
function normalizeCallbacks(value: string[] | string | undefined): string[] {
  if (!value) {
    return [];
  }
  const parts = Array.isArray(value) ? value : value.split(",");
  return parts.map((part) => part.trim()).filter(Boolean);
}

/** True when a positive pp-trace callback glob (no `-` prefix) matches a callback name. */
function patternMatches(name: string, pattern: string): boolean {
  const cleaned = pattern.trim();
  if (!cleaned || cleaned.startsWith("-")) {
    return false;
  }
  if (cleaned === name) {
    return true;
  }
  if (cleaned.includes("*") || cleaned.includes("?")) {
    const escaped = cleaned.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    const regexSource = `^${escaped.replace(/\*/g, ".*").replace(/\?/g, ".")}$`;
    return new RegExp(regexSource).test(name);
  }
  return false;
}

interface RunOutcome {
  exitCode: number;
  stderr: string;
  timedOut: boolean;
  hardKilled: boolean;
}

/** Spawns pp-trace, streaming stdout through the aggregator without buffering the dump. */
function runPpTrace(opts: {
  binaryPath: string;
  args: string[];
  cwd: string;
  timeoutMs: number;
  aggregator: { push(event: PpTraceEvent): void };
}): Promise<RunOutcome> {
  return new Promise((resolve) => {
    const child = spawn(opts.binaryPath, opts.args, {
      cwd: opts.cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });

    const parser = createEventParser((event) => opts.aggregator.push(event));
    let stdoutBuffer = "";
    let stderr = "";
    let bytes = 0;
    let hardKilled = false;
    let timedOut = false;
    let settled = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, opts.timeoutMs);

    const finish = (code: number) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      if (stdoutBuffer) {
        parser.line(stdoutBuffer);
        stdoutBuffer = "";
      }
      parser.finish();
      resolve({ exitCode: code, stderr, timedOut, hardKilled });
    };

    child.stdout?.setEncoding("utf-8");
    child.stdout?.on("data", (chunk: string) => {
      bytes += Buffer.byteLength(chunk);
      if (bytes > MAX_OUTPUT_BYTES) {
        hardKilled = true;
        child.kill("SIGKILL");
        return;
      }
      stdoutBuffer += chunk;
      let newlineIndex = stdoutBuffer.indexOf("\n");
      while (newlineIndex !== -1) {
        parser.line(stdoutBuffer.slice(0, newlineIndex));
        stdoutBuffer = stdoutBuffer.slice(newlineIndex + 1);
        newlineIndex = stdoutBuffer.indexOf("\n");
      }
    });

    child.stderr?.setEncoding("utf-8");
    child.stderr?.on("data", (chunk: string) => {
      if (stderr.length < MAX_STDERR_BYTES) {
        stderr += chunk;
      }
    });

    child.on("error", (err) => {
      stderr += err instanceof Error ? err.message : String(err);
      finish(-1);
    });

    child.on("close", (code) => {
      finish(code ?? -1);
    });
  });
}

/**
 * Traces the preprocessor activity of a single translation unit and returns an
 * aggregated, filtered summary instead of the raw YAML callback stream.
 */
export async function tracePreprocessor(
  params: TracePreprocessorParams,
): Promise<PreprocessorTraceResult> {
  const workspaceDir = path.resolve(params.workspace ?? process.cwd());
  const source = path.isAbsolute(params.file)
    ? params.file
    : path.resolve(workspaceDir, params.file ?? "");

  const tool: PreprocessorTraceResult["tool"] = { name: "pp-trace" };
  const emptySummary = { totalEvents: 0, userEvents: 0, truncated: false, counts: {} };

  const fail = (error: string, warnings: string[] = []): PreprocessorTraceResult => ({
    success: false,
    source,
    tool,
    summary: emptySummary,
    macros: [],
    includes: [],
    conditionals: [],
    pragmas: [],
    modules: [],
    warnings,
    error,
  });

  if (!params.file?.trim()) {
    return fail("Missing required parameter 'file'.");
  }

  if (!existsSync(source)) {
    return fail(`Source file not found: ${source}`);
  }

  const binary = await findPpTrace(params.ppTracePath);
  if (!binary.available || !binary.path) {
    return fail(
      "pp-trace binary was not found. Install the LLVM clang tools:\n" +
        "  - Arch Linux: sudo pacman -S clang-tools-extra\n" +
        "  - Ubuntu/Debian: sudo apt install clang-tools\n" +
        "  - macOS: brew install llvm",
    );
  }
  tool.path = binary.path;
  tool.version = binary.version;

  const userFilesOnly = params.userFilesOnly ?? true;
  const includeEvents = params.includeEvents ?? false;
  const requestedMax = params.maxEvents ?? DEFAULT_MAX_EVENTS;
  const maxEvents = Math.max(0, Math.min(requestedMax, MAX_EVENTS_LIMIT));
  const timeoutMs = params.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const warnings: string[] = [];
  const args: string[] = [];

  const callbacks = normalizeCallbacks(params.callbacks);
  // FileChanged is needed to attribute location-less events (MacroDefined, ...) to
  // their file. Add it internally when the caller restricts callbacks, but keep it
  // out of the output unless it was explicitly requested.
  const wantsFileChanged = callbacks.some((pattern) => patternMatches("FileChanged", pattern));
  const tracedCallbacks =
    callbacks.length > 0 && !wantsFileChanged ? [...callbacks, "FileChanged"] : callbacks;
  const suppressCallbacks = callbacks.length > 0 && !wantsFileChanged ? ["FileChanged"] : undefined;
  if (tracedCallbacks.length > 0) {
    args.push(`--callbacks=${tracedCallbacks.join(",")}`);
  }

  const compilationDb = findExistingCompilationDb(workspaceDir);
  if (compilationDb) {
    args.push("-p", path.dirname(compilationDb));
  } else {
    warnings.push("No compile_commands.json found; pp-trace ran without compilation flags.");
  }

  for (const extraArg of params.extraArgs ?? []) {
    if (extraArg) {
      args.push(`--extra-arg=${extraArg}`);
    }
  }

  args.push(source);

  const aggregator = createTraceAggregator({
    userFilesOnly,
    includeEvents,
    maxEvents,
    suppressCallbacks,
  });
  const run = await runPpTrace({
    binaryPath: binary.path,
    args,
    cwd: workspaceDir,
    timeoutMs,
    aggregator,
  });

  const aggregated = aggregator.finish();

  const warningSet = new Set<string>(warnings);
  for (const line of run.stderr.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    if (/warning:/i.test(trimmed) || /error while trying to load/i.test(trimmed)) {
      warningSet.add(trimmed);
    }
  }
  if (run.timedOut) {
    warningSet.add(`pp-trace timed out after ${timeoutMs} ms.`);
  }
  if (run.hardKilled) {
    warningSet.add("pp-trace output exceeded the size limit and was truncated.");
  }

  const truncated = aggregated.truncated || run.hardKilled;
  let success = true;
  let error: string | undefined;

  if (aggregated.totalEvents === 0) {
    success = false;
    error = run.stderr.trim() || "pp-trace produced no preprocessor events.";
  } else if (run.exitCode !== 0 && aggregated.userEvents === 0) {
    success = false;
    error = run.stderr.trim() || `pp-trace exited with code ${run.exitCode}.`;
  }

  const result: PreprocessorTraceResult = {
    success,
    source,
    tool,
    summary: {
      totalEvents: aggregated.totalEvents,
      userEvents: aggregated.userEvents,
      truncated,
      counts: aggregated.counts,
    },
    macros: aggregated.macros,
    includes: aggregated.includes,
    conditionals: aggregated.conditionals,
    pragmas: aggregated.pragmas,
    modules: aggregated.modules,
    warnings: Array.from(warningSet).slice(0, MAX_WARNINGS),
    error,
  };

  if (includeEvents) {
    result.events = aggregated.events;
  }

  return result;
}
