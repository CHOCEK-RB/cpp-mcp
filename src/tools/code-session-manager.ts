import path from "node:path";
import { ClangdSession } from "../lsp/session.js";
import { isExecutableAvailable, resolveProjectBuildInfo } from "../project/xmake.js";

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
