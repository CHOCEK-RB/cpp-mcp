import path from "node:path";

/**
 * Maps a source file path to the LSP `languageId` used when opening a document.
 *
 * clangd resolves the real language from `compile_commands.json`; this id only
 * controls how the document is parsed while it is open in the editor session.
 */
export function inferLanguageId(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".c") return "c";
  if (ext === ".cu" || ext === ".cuh") return "cuda";
  return "cpp";
}
