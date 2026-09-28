import fs from "node:fs/promises";
import { inferLanguageId } from "../lsp/language-id.js";

/** Minimal clangd session surface needed to synchronize a document. */
export interface DocumentSyncSession {
  openOrUpdateDocument(uri: string, languageId: string, text: string): void;
}

/** Minimal clangd session surface needed to await document synchronization. */
export interface DocumentReadySession extends DocumentSyncSession {
  waitForDiagnostics(uri: string, timeoutMs?: number): Promise<unknown>;
}

/**
 * Max time to wait for clangd to publish diagnostics for a freshly opened
 * document. Publishing diagnostics signals the in-memory AST is built; this is
 * an early-exit bound, so a warm server resolves in a few ms while a cold one
 * never waits longer than the fixed delay this replaced.
 */
export const SESSION_READY_TIMEOUT_MS = 60;

/**
 * Reads a file and synchronizes it to clangd. Documents already open are updated
 * via `didChange` instead of being re-opened with a duplicate `didOpen`. Returns
 * false when the file cannot be read, so callers can fall back to the background
 * index.
 */
export async function openFileInSession(
  session: DocumentSyncSession,
  uri: string,
  filePath: string,
): Promise<boolean> {
  try {
    const content = await fs.readFile(filePath, "utf-8");
    session.openOrUpdateDocument(uri, inferLanguageId(filePath), content);
    return true;
  } catch {
    return false;
  }
}

/**
 * Reads a file, synchronizes it to clangd, then waits for the server to publish
 * diagnostics for it (the signal that the AST is ready) instead of sleeping a
 * fixed amount. Falls back to the background index silently on timeout.
 */
export async function openFileAndAwaitReady(
  session: DocumentReadySession,
  uri: string,
  filePath: string,
  timeoutMs = SESSION_READY_TIMEOUT_MS,
): Promise<boolean> {
  const opened = await openFileInSession(session, uri, filePath);
  if (opened) {
    await session.waitForDiagnostics(uri, timeoutMs).catch(() => []);
  }
  return opened;
}
