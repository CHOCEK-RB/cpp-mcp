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

class SessionManager {
  private activeSessions = new Map<string, ClangdSession>();
  private pendingInitializations = new Map<string, Promise<SessionAcquisitionResult>>();

  /**
   * Acquires or launches a ClangdSession for the given workspace directory.
   * Concurrently deduplicates simultaneous requests for the same workspace.
   */
  public async getSession(workspaceDir = process.cwd()): Promise<SessionAcquisitionResult> {
    const resolvedWs = path.resolve(workspaceDir);

    // 1. Reuse cached session if already running
    const existing = this.activeSessions.get(resolvedWs);
    if (existing?.isRunning()) {
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
      return await initPromise;
    } finally {
      this.pendingInitializations.delete(resolvedWs);
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
          for (const entry of dbEntries.slice(0, 20)) {
            const absFile = path.isAbsolute(entry.file)
              ? entry.file
              : path.resolve(entry.directory || resolvedWs, entry.file);
            if (!seen.has(absFile) && existsSync(absFile)) {
              seen.add(absFile);
              const code = await fs.readFile(absFile, "utf-8");
              session.openDocument(
                pathToFileURL(absFile).toString(),
                inferLanguageId(absFile),
                code,
              );
            }
          }
          if (seen.size > 0) {
            await new Promise((resolve) => setTimeout(resolve, 200));
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
  }
}

export const sessionManager = new SessionManager();
