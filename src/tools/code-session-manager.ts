import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { inferLanguageId } from "../lsp/language-id.js";
import { ClangdSession } from "../lsp/session.js";
import {
  isExecutableAvailable,
  readCompilationDatabase,
  resolveProjectBuildInfo,
} from "../project/xmake.js";

export interface SessionAcquisitionResult {
  session: ClangdSession | null;
  workspaceDir: string;
  buildSystem: string;
  compileCommandsPath?: string;
  error?: string;
}

export interface EvictionCandidate {
  key: string;
  lastUsedAt: number;
}

export interface EvictionOptions {
  now: number;
  maxSessions: number;
  idleTimeoutMs: number;
}

export interface EvictionPlan {
  idle: string[];
  overflow: string[];
}

/**
 * Decides which cached sessions should be closed: those idle for longer than
 * `idleTimeoutMs`, plus the least recently used ones above `maxSessions`.
 * A non-positive `idleTimeoutMs` or `maxSessions` disables that rule.
 */
export function selectEvictions(
  candidates: EvictionCandidate[],
  options: EvictionOptions,
): EvictionPlan {
  const idle: string[] = [];
  const active: EvictionCandidate[] = [];

  for (const candidate of candidates) {
    if (options.idleTimeoutMs > 0 && options.now - candidate.lastUsedAt > options.idleTimeoutMs) {
      idle.push(candidate.key);
    } else {
      active.push(candidate);
    }
  }

  const overflow: string[] = [];
  if (options.maxSessions > 0 && active.length > options.maxSessions) {
    const oldestFirst = [...active].sort((a, b) => a.lastUsedAt - b.lastUsedAt);
    const excess = active.length - options.maxSessions;
    for (let i = 0; i < excess; i++) {
      overflow.push((oldestFirst[i] as EvictionCandidate).key);
    }
  }

  return { idle, overflow };
}

/**
 * Waits for clangd to finish parsing the preloaded translation units by
 * awaiting their first diagnostics, capped at `timeoutMs` so a silent clangd
 * never blocks session acquisition indefinitely.
 */
export async function awaitPreloadReadiness(
  uris: string[],
  waitForDiagnostics: (uri: string, timeoutMs: number) => Promise<unknown>,
  timeoutMs: number,
): Promise<void> {
  if (uris.length === 0) {
    return;
  }

  const diagnostics = Promise.all(uris.map((uri) => waitForDiagnostics(uri, timeoutMs))).then(
    () => undefined,
  );
  const cap = new Promise<void>((resolve) => setTimeout(resolve, timeoutMs));

  await Promise.race([diagnostics, cap]);
}

export interface SessionManagerOptions {
  /** Maximum number of clangd sessions kept alive at once. Default 8; 0 disables. */
  maxSessions?: number;
  /** Close sessions unused for this many milliseconds. Default 10 minutes; 0 disables. */
  idleTimeoutMs?: number;
  /** How long to wait for preloaded files to report diagnostics. Default 1500 ms. */
  readinessTimeoutMs?: number;
  /** Clock injection for tests. */
  now?: () => number;
}

const DEFAULT_MAX_SESSIONS = 8;
const DEFAULT_IDLE_TIMEOUT_MS = 10 * 60 * 1000;
const DEFAULT_READINESS_TIMEOUT_MS = 1500;

class SessionManager {
  private activeSessions = new Map<string, ClangdSession>();
  private pendingInitializations = new Map<string, Promise<SessionAcquisitionResult>>();
  private lastUsedAt = new Map<string, number>();
  private maxSessions: number;
  private idleTimeoutMs: number;
  private readinessTimeoutMs: number;
  private now: () => number;

  constructor(options: SessionManagerOptions = {}) {
    this.maxSessions = options.maxSessions ?? DEFAULT_MAX_SESSIONS;
    this.idleTimeoutMs = options.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS;
    this.readinessTimeoutMs = options.readinessTimeoutMs ?? DEFAULT_READINESS_TIMEOUT_MS;
    this.now = options.now ?? Date.now;
  }

  /**
   * Acquires or launches a ClangdSession for the given workspace directory.
   * Concurrently deduplicates simultaneous requests for the same workspace.
   */
  public async getSession(workspaceDir = process.cwd()): Promise<SessionAcquisitionResult> {
    const resolvedWs = path.resolve(workspaceDir);

    // Reclaim idle/overflowing sessions before serving another request.
    await this.pruneSessions(resolvedWs);

    // 1. Reuse cached session if already running
    const existing = this.activeSessions.get(resolvedWs);
    if (existing?.isRunning()) {
      this.touch(resolvedWs);
      return {
        session: existing,
        workspaceDir: resolvedWs,
        buildSystem: "cached",
      };
    }

    // 2. Share in-flight initialization promise to prevent race conditions and duplicate processes
    const inFlight = this.pendingInitializations.get(resolvedWs);
    if (inFlight) {
      return inFlight;
    }

    const initPromise = this.initSession(resolvedWs);
    this.pendingInitializations.set(resolvedWs, initPromise);

    try {
      const result = await initPromise;
      if (result.session) {
        this.touch(resolvedWs);
      }
      return result;
    } finally {
      this.pendingInitializations.delete(resolvedWs);
    }
  }

  private touch(key: string): void {
    this.lastUsedAt.set(key, this.now());
  }

  /**
   * Closes idle and least-recently-used sessions, never the requested one.
   */
  private async pruneSessions(keepKey?: string): Promise<void> {
    if (this.activeSessions.size === 0) {
      return;
    }

    const candidates: EvictionCandidate[] = [];
    for (const [key, session] of this.activeSessions) {
      if (session.isRunning()) {
        candidates.push({ key, lastUsedAt: this.lastUsedAt.get(key) ?? 0 });
      }
    }

    const plan = selectEvictions(candidates, {
      now: this.now(),
      maxSessions: this.maxSessions,
      idleTimeoutMs: this.idleTimeoutMs,
    });

    const toClose = [...plan.idle, ...plan.overflow].filter((key) => key !== keepKey);
    for (const key of toClose) {
      const session = this.activeSessions.get(key);
      this.activeSessions.delete(key);
      this.lastUsedAt.delete(key);
      try {
        await session?.close();
      } catch {
        // Eviction is best-effort; a failed close must not block new sessions.
      }
    }
  }

  private async initSession(resolvedWs: string): Promise<SessionAcquisitionResult> {
    // Check if clangd is installed
    const hasClangd = await isExecutableAvailable("clangd");
    if (!hasClangd) {
      return {
        session: null,
        workspaceDir: resolvedWs,
        buildSystem: "unknown",
        error:
          "clangd executable is not installed or not in PATH. Please install LLVM/clangd to use semantic code tools.",
      };
    }

    // Resolve project build info (xmake / cmake / manual)
    const buildInfo = await resolveProjectBuildInfo({
      workspaceDir: resolvedWs,
      autoGenerate: true,
    });

    if (!buildInfo.found || !buildInfo.compileCommandsPath) {
      return {
        session: null,
        workspaceDir: resolvedWs,
        buildSystem: buildInfo.buildSystem,
        error:
          buildInfo.error ||
          "Could not locate or generate compile_commands.json. Ensure xmake or CMake is configured.",
      };
    }

    const compileCommandsDir = path.dirname(buildInfo.compileCommandsPath);
    const session = new ClangdSession({
      workspaceDir: resolvedWs,
      compileCommandsDir,
    });

    try {
      await session.start();

      // Preload primary translation units into clangd memory so cold queries find symbols immediately
      if (buildInfo.compileCommandsPath && existsSync(buildInfo.compileCommandsPath)) {
        try {
          const dbEntries = await readCompilationDatabase(buildInfo.compileCommandsPath);
          const seen = new Set<string>();
          const openedUris: string[] = [];
          for (const entry of dbEntries.slice(0, 20)) {
            const absFile = path.isAbsolute(entry.file)
              ? entry.file
              : path.resolve(entry.directory || resolvedWs, entry.file);
            if (!seen.has(absFile) && existsSync(absFile)) {
              seen.add(absFile);
              const uri = pathToFileURL(absFile).toString();
              const code = await fs.readFile(absFile, "utf-8");
              session.openDocument(uri, inferLanguageId(absFile), code);
              openedUris.push(uri);
            }
          }
          if (openedUris.length > 0) {
            await awaitPreloadReadiness(
              openedUris,
              (uri, timeoutMs) => session.waitForDiagnostics(uri, timeoutMs),
              this.readinessTimeoutMs,
            );
          }
        } catch {
          // Preload failure is non-fatal; clangd background indexer will continue
        }
      }

      this.activeSessions.set(resolvedWs, session);
      return {
        session,
        workspaceDir: resolvedWs,
        buildSystem: buildInfo.buildSystem,
        compileCommandsPath: buildInfo.compileCommandsPath,
      };
    } catch (err) {
      return {
        session: null,
        workspaceDir: resolvedWs,
        buildSystem: buildInfo.buildSystem,
        compileCommandsPath: buildInfo.compileCommandsPath,
        error: `Failed to initialize clangd session: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  /**
   * Closes all active sessions.
   */
  public async closeAll(): Promise<void> {
    for (const [_ws, session] of this.activeSessions.entries()) {
      try {
        await session.close();
      } catch {
        // Ignored during teardown
      }
    }
    this.activeSessions.clear();
    this.lastUsedAt.clear();
  }
}

export const sessionManager = new SessionManager();
