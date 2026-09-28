import { type ChildProcess, spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { LspClient } from "./client.js";
import type {
  CallHierarchyIncomingCall,
  CallHierarchyItem,
  CallHierarchyOutgoingCall,
  Diagnostic,
  DocumentSymbol,
  Hover,
  Location,
  Position,
  PublishDiagnosticsParams,
  SymbolInformation,
  TypeHierarchyItem,
  WorkspaceEdit,
} from "./types.js";

export type SpawnProcess = (
  command: string,
  args: string[],
  options: { stdio: ["pipe", "pipe", "pipe"] },
) => ChildProcess;

/**
 * Normalizes the `queryDriver` option / `CLANGD_QUERY_DRIVER` env value into a
 * de-duplicated list of compiler paths or globs.
 */
function normalizeQueryDriver(value?: string | string[]): string[] {
  if (!value) return [];
  const raw = Array.isArray(value) ? value.join(",") : value;
  const parts = raw
    .split(/[,\s]+/)
    .map((part) => part.trim())
    .filter(Boolean);
  return [...new Set(parts)];
}

export interface ClangdSessionOptions {
  compileCommandsDir?: string;
  workspaceDir?: string;
  clangdPath?: string;
  backgroundIndex?: boolean;
  /** Overrides how the clangd child process is spawned (test seam). */
  spawnProcess?: SpawnProcess;
  /** Timeout for the LSP initialize handshake, in milliseconds. */
  initializeTimeoutMs?: number;
  /**
   * Compiler driver(s) clangd may query for builtin system includes
   * (gcc and cross-toolchains). Also read from `CLANGD_QUERY_DRIVER`
   * (comma- or whitespace-separated).
   */
  queryDriver?: string | string[];
}

export class ClangdSession extends EventEmitter {
  private process: ChildProcess | null = null;
  private client: LspClient | null = null;
  private initialized = false;
  private rootUri: string;
  private compileCommandsDir: string;
  private clangdPath: string;
  private diagnosticsMap = new Map<string, Diagnostic[]>();
  private publishedVersion = new Map<string, number>();
  private openDocuments = new Map<string, number>();
  private spawnFn: SpawnProcess;
  private initializeTimeoutMs: number;
  private queryDriver: string[];
  private closing = false;

  constructor(options: ClangdSessionOptions = {}) {
    super();
    const wsDir = path.resolve(options.workspaceDir || process.cwd());
    this.rootUri = pathToFileURL(wsDir).toString();
    this.compileCommandsDir = path.resolve(
      options.compileCommandsDir || options.workspaceDir || process.cwd(),
    );
    this.clangdPath = options.clangdPath || process.env.CLANGD_PATH || "clangd";
    this.spawnFn = options.spawnProcess ?? (spawn as unknown as SpawnProcess);
    this.initializeTimeoutMs = options.initializeTimeoutMs ?? 15000;
    this.queryDriver = normalizeQueryDriver(options.queryDriver ?? process.env.CLANGD_QUERY_DRIVER);
  }

  /**
   * Spawns clangd and completes the LSP initialize/initialized handshake.
   */
  public async start(): Promise<void> {
    if (this.initialized) return;

    const args = [
      `--compile-commands-dir=${this.compileCommandsDir}`,
      "--background-index",
      "--clang-tidy=false",
      "--header-insertion=never",
    ];

    // Without a query driver, clangd cannot resolve gcc/cross-toolchain builtin headers.
    if (this.queryDriver.length > 0) {
      args.push(`--query-driver=${this.queryDriver.join(",")}`);
    }

    const child = this.spawnFn(this.clangdPath, args, {
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.process = child;
    this.closing = false;

    try {
      await this.performHandshake(child);
      this.initialized = true;
    } catch (error) {
      // A failed handshake must not leave an orphaned clangd process behind.
      this.client?.destroy(error instanceof Error ? error : undefined);
      this.client = null;
      this.process = null;
      this.initialized = false;
      if (!child.killed) {
        child.kill("SIGKILL");
      }
      throw error;
    }
  }

  private async performHandshake(child: ChildProcess): Promise<void> {
    if (!child.stdin || !child.stdout) {
      throw new Error("Failed to initialize stdin/stdout pipes for clangd");
    }

    this.client = new LspClient(child.stdout, child.stdin);

    this.client.on("notification", (msg: { method?: string; params?: unknown }) => {
      if (msg.method === "textDocument/publishDiagnostics") {
        const params = msg.params as PublishDiagnosticsParams;
        if (params?.uri) {
          const diags = params.diagnostics || [];
          this.diagnosticsMap.set(params.uri, diags);
          // clangd may publish diagnostics for an older document version after
          // a didChange; only record the version that produced these diagnostics.
          const version =
            typeof params.version === "number"
              ? params.version
              : this.openDocuments.get(params.uri);
          if (typeof version === "number") {
            this.publishedVersion.set(params.uri, version);
          }
          this.emit("diagnostics", params);
          this.emit(`diagnostics:${params.uri}`, diags);
        }
      }
    });

    // An unexpected exit must invalidate the session so it is not reused as a zombie.
    child.once("exit", this.handleProcessExit);
    child.once("error", this.handleProcessExit);

    // Drain stderr to prevent 64KB OS pipe buffer saturation and deadlock
    child.stderr?.resume();

    // Initial handshake
    await this.client.request(
      "initialize",
      {
        processId: process.pid,
        rootUri: this.rootUri,
        capabilities: {
          textDocument: {
            publishDiagnostics: {
              relatedInformation: true,
              versionSupport: true,
            },
            hover: {
              contentFormat: ["markdown", "plaintext"],
            },
            definition: {
              dynamicRegistration: false,
            },
            references: {
              dynamicRegistration: false,
            },
            documentSymbol: {
              hierarchicalDocumentSymbolSupport: true,
            },
            typeHierarchy: {
              dynamicRegistration: false,
            },
            callHierarchy: {
              dynamicRegistration: false,
            },
            rename: {
              dynamicRegistration: false,
              prepareSupport: true,
            },
          },
          workspace: {
            symbol: {
              dynamicRegistration: false,
            },
          },
        },
      },
      this.initializeTimeoutMs,
    );

    this.client.notify("initialized", {});
  }

  private handleProcessExit = (): void => {
    const wasRunning = this.initialized;
    this.initialized = false;
    this.process = null;
    const error = new Error("clangd process exited unexpectedly");
    this.client?.destroy(error);
    this.client = null;
    if (wasRunning && !this.closing) {
      this.emit("exit", error);
    }
  };

  public isRunning(): boolean {
    return this.initialized && this.process !== null;
  }

  public getRootUri(): string {
    return this.rootUri;
  }

  /**
   * Notifies clangd that a text document was opened so it parses AST immediately.
   */
  public openDocument(uri: string, languageId: string, text: string, version = 1): void {
    if (!this.client) throw new Error("Clangd session is not running");
    this.openDocuments.set(uri, version);
    // A fresh didOpen supersedes any diagnostics published for a previous lifetime.
    this.publishedVersion.delete(uri);
    this.client.notify("textDocument/didOpen", {
      textDocument: {
        uri,
        languageId,
        version,
        text,
      },
    });
  }

  /**
   * Opens or updates a document in clangd. If already open, sends didChange; otherwise didOpen.
   */
  public openOrUpdateDocument(uri: string, languageId: string, text: string): void {
    if (!this.client) throw new Error("Clangd session is not running");
    const currentVersion = this.openDocuments.get(uri);
    // New content invalidates the previously published diagnostics until clangd
    // republishes for the new version.
    this.publishedVersion.delete(uri);
    if (currentVersion === undefined) {
      this.openDocuments.set(uri, 1);
      this.client.notify("textDocument/didOpen", {
        textDocument: {
          uri,
          languageId,
          version: 1,
          text,
        },
      });
    } else {
      const nextVersion = currentVersion + 1;
      this.openDocuments.set(uri, nextVersion);
      this.client.notify("textDocument/didChange", {
        textDocument: {
          uri,
          version: nextVersion,
        },
        contentChanges: [{ text }],
      });
    }
  }

  /**
   * Waits for diagnostics on a specific document URI.
   */
  public async waitForDiagnostics(uri: string, timeoutMs = 2000): Promise<Diagnostic[]> {
    if (!this.client) throw new Error("Clangd session is not running");

    // If clangd has already published for the current document version there is
    // nothing to wait for; return the cached result immediately.
    const currentVersion = this.openDocuments.get(uri);
    if (currentVersion !== undefined && this.publishedVersion.get(uri) === currentVersion) {
      return this.diagnosticsMap.get(uri) || [];
    }

    return new Promise<Diagnostic[]>((resolve) => {
      let resolved = false;
      const onDiag = (diags: Diagnostic[]) => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timer);
          this.removeListener(`diagnostics:${uri}`, onDiag);
          resolve(diags);
        }
      };

      const timer = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          this.removeListener(`diagnostics:${uri}`, onDiag);
          resolve(this.diagnosticsMap.get(uri) || []);
        }
      }, timeoutMs);

      this.once(`diagnostics:${uri}`, onDiag);
    });
  }

  /**
   * Returns cached diagnostics for a given URI or all tracked files.
   */
  public getCachedDiagnostics(uri?: string): Diagnostic[] | Map<string, Diagnostic[]> {
    if (uri) {
      return this.diagnosticsMap.get(uri) || [];
    }
    return new Map(this.diagnosticsMap);
  }

  /**
   * Searches workspace symbols using clangd's index.
   */
  public async searchSymbols(query: string): Promise<SymbolInformation[]> {
    if (!this.client) throw new Error("Clangd session is not running");
    const result = await this.client.request<SymbolInformation[]>("workspace/symbol", { query });
    return Array.isArray(result) ? result : [];
  }

  /**
   * Resolves definition location(s) for a symbol at a given file position.
   */
  public async getDefinition(uri: string, position: Position): Promise<Location[]> {
    if (!this.client) throw new Error("Clangd session is not running");
    const result = await this.client.request<Location | Location[] | null | undefined>(
      "textDocument/definition",
      {
        textDocument: { uri },
        position,
      },
    );

    if (!result) return [];
    return Array.isArray(result) ? result : [result];
  }

  /**
   * Retrieves hover documentation and signatures at a file position.
   */
  public async getHover(uri: string, position: Position): Promise<Hover | null> {
    if (!this.client) throw new Error("Clangd session is not running");
    const result = await this.client.request<Hover | null>("textDocument/hover", {
      textDocument: { uri },
      position,
    });
    return result || null;
  }

  /**
   * Retrieves flat or hierarchical document symbols in a file.
   */
  public async getDocumentSymbols(uri: string): Promise<DocumentSymbol[]> {
    if (!this.client) throw new Error("Clangd session is not running");
    const result = await this.client.request<DocumentSymbol[]>("textDocument/documentSymbol", {
      textDocument: { uri },
    });
    return Array.isArray(result) ? result : [];
  }

  /**
   * Finds references to the symbol at a position across the project.
   */
  public async getReferences(
    uri: string,
    position: Position,
    includeDeclaration = true,
  ): Promise<Location[]> {
    if (!this.client) throw new Error("Clangd session is not running");
    const result = await this.client.request<Location[]>("textDocument/references", {
      textDocument: { uri },
      position,
      context: { includeDeclaration },
    });
    return Array.isArray(result) ? result : [];
  }

  /**
   * Prepares and resolves incoming and outgoing calls in the call hierarchy.
   */
  public async getCallHierarchy(
    uri: string,
    position: Position,
  ): Promise<{
    item: CallHierarchyItem | null;
    incoming: CallHierarchyIncomingCall[];
    outgoing: CallHierarchyOutgoingCall[];
  }> {
    if (!this.client) throw new Error("Clangd session is not running");

    const items = await this.client.request<CallHierarchyItem[] | null>(
      "textDocument/prepareCallHierarchy",
      {
        textDocument: { uri },
        position,
      },
    );

    if (!items || items.length === 0) {
      return { item: null, incoming: [], outgoing: [] };
    }

    const item = items[0];

    const [incoming, outgoing] = await Promise.all([
      this.client
        .request<CallHierarchyIncomingCall[]>("callHierarchy/incomingCalls", {
          item,
        })
        .catch(() => []),
      this.client
        .request<CallHierarchyOutgoingCall[]>("callHierarchy/outgoingCalls", {
          item,
        })
        .catch(() => []),
    ]);

    return {
      item: item || null,
      incoming: Array.isArray(incoming) ? incoming : [],
      outgoing: Array.isArray(outgoing) ? outgoing : [],
    };
  }

  /**
   * Prepares and resolves supertypes and subtypes in the type hierarchy.
   */
  public async getTypeHierarchy(
    uri: string,
    position: Position,
  ): Promise<{
    item: TypeHierarchyItem | null;
    supertypes: TypeHierarchyItem[];
    subtypes: TypeHierarchyItem[];
  }> {
    if (!this.client) throw new Error("Clangd session is not running");

    const items = await this.client.request<TypeHierarchyItem[] | null>(
      "textDocument/prepareTypeHierarchy",
      {
        textDocument: { uri },
        position,
      },
    );

    if (!items || items.length === 0) {
      return { item: null, supertypes: [], subtypes: [] };
    }

    const item = items[0];

    const [supertypes, subtypes] = await Promise.all([
      this.client
        .request<TypeHierarchyItem[]>("typeHierarchy/supertypes", { item })
        .catch(() => []),
      this.client.request<TypeHierarchyItem[]>("typeHierarchy/subtypes", { item }).catch(() => []),
    ]);

    return {
      item: item || null,
      supertypes: Array.isArray(supertypes) ? supertypes : [],
      subtypes: Array.isArray(subtypes) ? subtypes : [],
    };
  }

  /**
   * Performs semantic symbol rename across the workspace.
   */
  public async renameSymbol(
    uri: string,
    position: Position,
    newName: string,
  ): Promise<WorkspaceEdit | null> {
    if (!this.client) throw new Error("Clangd session is not running");
    const result = await this.client.request<WorkspaceEdit | null>(
      "textDocument/rename",
      {
        textDocument: { uri },
        position,
        newName,
      },
      15000,
    );
    return result || null;
  }

  /**
   * Gracefully terminates the session and child process.
   */
  public async close(): Promise<void> {
    if (!this.initialized && !this.process) return;
    this.closing = true;

    if (this.client) {
      try {
        await this.client.request("shutdown", {}, 3000);
        this.client.notify("exit", {});
      } catch {
        // Ignored during teardown
      } finally {
        this.client.destroy();
        this.client = null;
      }
    }

    if (this.process) {
      this.process.kill("SIGTERM");
      this.process = null;
    }

    this.diagnosticsMap.clear();
    this.publishedVersion.clear();
    this.openDocuments.clear();
    this.removeAllListeners();
    this.initialized = false;
  }
}
