import fs from "node:fs/promises";
import { inferLanguageId } from "../lsp/language-id.js";

/** Minimal clangd session surface needed to synchronize a document. */
export interface DocumentSyncSession {
  openOrUpdateDocument(uri: string, languageId: string, text: string): void;
}

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
