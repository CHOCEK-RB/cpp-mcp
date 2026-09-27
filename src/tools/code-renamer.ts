import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { Position, TextEdit, WorkspaceEdit } from "../lsp/types.js";
import { sessionManager } from "./code-session-manager.js";

export interface CodeRenameOptions {
  symbol: string;
  newName: string;
  workspaceDir?: string;
  file?: string;
  line?: number;
  character?: number;
  dryRun?: boolean;
}

export interface FormattedFileEdit {
  line: number;
  character: number;
  endLine: number;
  endCharacter: number;
  oldText: string;
  newText: string;
  snippet?: string;
}

export interface AffectedFile {
  file: string;
  absolutePath: string;
  editCount: number;
  edits: FormattedFileEdit[];
}

export interface CodeRenameResult {
  success: boolean;
  symbol: string;
  newName: string;
  dryRun: boolean;
  workspaceDir: string;
  totalEdits: number;
  affectedFiles: AffectedFile[];
  error?: string;
}

const CXX_IDENTIFIER_REGEX = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

function computeLineOffsets(content: string): number[] {
  const offsets = [0];
  for (let i = 0; i < content.length; i++) {
    if (content[i] === "\n") {
      offsets.push(i + 1);
    }
  }
  return offsets;
}

function positionToOffset(lineOffsets: number[], pos: Position): number {
  if (pos.line >= lineOffsets.length) {
    return lineOffsets[lineOffsets.length - 1] ?? 0;
  }
  return (lineOffsets[pos.line] ?? 0) + pos.character;
}

function applyTextEdits(content: string, edits: TextEdit[]): string {
  const lineOffsets = computeLineOffsets(content);

  const sorted = [...edits].sort((a, b) => {
    if (a.range.start.line !== b.range.start.line) {
      return b.range.start.line - a.range.start.line;
    }
    return b.range.start.character - a.range.start.character;
  });

  let result = content;
  for (const edit of sorted) {
    const start = positionToOffset(lineOffsets, edit.range.start);
    const end = positionToOffset(lineOffsets, edit.range.end);
    result = result.slice(0, start) + edit.newText + result.slice(end);
  }
  return result;
}

function buildEditSnippet(
  content: string,
  startLine: number,
  startCol: number,
  endCol: number,
  newText: string,
): string {
  const lines = content.split("\n");
  if (startLine < 0 || startLine >= lines.length) return "";

  const snippetLines: string[] = [];
  const lineNumWidth = String(startLine + 2).length;

  if (startLine > 0) {
    const prevNum = String(startLine).padStart(lineNumWidth, " ");
    snippetLines.push(`  ${prevNum} | ${lines[startLine - 1]}`);
  }

  const currNum = String(startLine + 1).padStart(lineNumWidth, " ");
  snippetLines.push(`- ${currNum} | ${lines[startLine]}`);

  // Construct replaced preview
  const originalLine = lines[startLine] || "";
  const before = originalLine.slice(0, startCol);
  const after = originalLine.slice(endCol);
  const modifiedLine = `${before}${newText}${after}`;
  snippetLines.push(`+ ${currNum} | ${modifiedLine}`);

  if (startLine + 1 < lines.length) {
    const nextNum = String(startLine + 2).padStart(lineNumWidth, " ");
    snippetLines.push(`  ${nextNum} | ${lines[startLine + 1]}`);
  }

  return snippetLines.join("\n");
}

function extractEditsMap(workspaceEdit: WorkspaceEdit): Map<string, TextEdit[]> {
  const map = new Map<string, TextEdit[]>();

  if (workspaceEdit.changes) {
    for (const [uri, edits] of Object.entries(workspaceEdit.changes)) {
      if (Array.isArray(edits) && edits.length > 0) {
        map.set(uri, edits);
      }
    }
  }

  if (workspaceEdit.documentChanges) {
    for (const docEdit of workspaceEdit.documentChanges) {
      if (docEdit.textDocument?.uri && Array.isArray(docEdit.edits)) {
        const existing = map.get(docEdit.textDocument.uri) || [];
        map.set(docEdit.textDocument.uri, [...existing, ...docEdit.edits]);
      }
    }
  }

  return map;
}

/**
 * Performs AST-based semantic symbol rename across the workspace using clangd LSP.
 */
export async function renameCodeSymbol(options: CodeRenameOptions): Promise<CodeRenameResult> {
  const wsDir = path.resolve(options.workspaceDir || process.cwd());
  const dryRun = options.dryRun ?? true;

  if (!CXX_IDENTIFIER_REGEX.test(options.newName)) {
    return {
      success: false,
      symbol: options.symbol,
      newName: options.newName,
      dryRun,
      workspaceDir: wsDir,
      totalEdits: 0,
      affectedFiles: [],
      error: `'${options.newName}' is not a valid C/C++ identifier. Identifiers must begin with a letter or underscore and contain only alphanumeric characters or underscores.`,
    };
  }

  const { session, error } = await sessionManager.getSession(wsDir);
  if (!session) {
    return {
      success: false,
      symbol: options.symbol,
      newName: options.newName,
      dryRun,
      workspaceDir: wsDir,
      totalEdits: 0,
      affectedFiles: [],
      error,
    };
  }

  try {
    let targetUri: string | null = null;
    let targetPos: Position | null = null;

    // 1. Resolve target position via file & line if provided
    if (options.file && options.line !== undefined) {
      const absFile = path.isAbsolute(options.file)
        ? options.file
        : path.resolve(wsDir, options.file);
      targetUri = pathToFileURL(absFile).toString();
      let col = Math.max(0, (options.character || 1) - 1);

      if (!options.character && existsSync(absFile)) {
        try {
          const content = await fs.readFile(absFile, "utf-8");
          const lineContent = content.split("\n")[options.line - 1];
          if (lineContent) {
            const unqualified = options.symbol.split("::").pop() || options.symbol;
            const idx = lineContent.indexOf(unqualified);
            if (idx !== -1) {
              col = idx;
            } else {
              const firstNonSpace = lineContent.search(/\S/);
              if (firstNonSpace !== -1) {
                col = firstNonSpace;
              }
            }
          }
        } catch {
          // Fall back to default col
        }
      }

      targetPos = {
        line: Math.max(0, options.line - 1),
        character: col,
      };
    } else {
      // 2. Otherwise locate symbol via workspace symbol search
      const rawSymbols = await session.searchSymbols(options.symbol);
      if (rawSymbols.length === 0) {
        return {
          success: false,
          symbol: options.symbol,
          newName: options.newName,
          dryRun,
          workspaceDir: wsDir,
          totalEdits: 0,
          affectedFiles: [],
          error: `No symbol matching '${options.symbol}' found in workspace index.`,
        };
      }

      const matched =
        rawSymbols.find(
          (s) => s.name === options.symbol || s.name.endsWith(`::${options.symbol}`),
        ) || rawSymbols[0];

      if (!matched?.location) {
        return {
          success: false,
          symbol: options.symbol,
          newName: options.newName,
          dryRun,
          workspaceDir: wsDir,
          totalEdits: 0,
          affectedFiles: [],
          error: `Symbol '${options.symbol}' matched in index but has no source location.`,
        };
      }

      targetUri = matched.location.uri;
      targetPos = matched.location.range.start;
    }

    if (!targetUri || !targetPos) {
      return {
        success: false,
        symbol: options.symbol,
        newName: options.newName,
        dryRun,
        workspaceDir: wsDir,
        totalEdits: 0,
        affectedFiles: [],
        error: `Could not resolve source location for symbol '${options.symbol}'.`,
      };
    }

    // Ensure the target file (especially headers .hpp/.h) is opened in clangd session
    try {
      const localFilePath = fileURLToPath(targetUri);
      if (existsSync(localFilePath)) {
        const fileContent = await fs.readFile(localFilePath, "utf-8");
        const ext = path.extname(localFilePath).toLowerCase();
        const langId = ext === ".c" ? "c" : "cpp";
        session.openOrUpdateDocument(targetUri, langId, fileContent);
        await new Promise((r) => setTimeout(r, 100));
      }
    } catch {
      // Fallback to background index
    }

    // 3. Request rename from clangd
    const workspaceEdit = await session.renameSymbol(targetUri, targetPos, options.newName);
    if (!workspaceEdit) {
      return {
        success: false,
        symbol: options.symbol,
        newName: options.newName,
        dryRun,
        workspaceDir: wsDir,
        totalEdits: 0,
        affectedFiles: [],
        error: `Clangd rejected renaming '${options.symbol}' to '${options.newName}'. The symbol might be non-renameable or the new name might introduce a conflict.`,
      };
    }

    const editsMap = extractEditsMap(workspaceEdit);
    if (editsMap.size === 0) {
      return {
        success: false,
        symbol: options.symbol,
        newName: options.newName,
        dryRun,
        workspaceDir: wsDir,
        totalEdits: 0,
        affectedFiles: [],
        error: `No occurrences of '${options.symbol}' were affected by the rename.`,
      };
    }

    // 4. Format affected files and previews
    const affectedFiles: AffectedFile[] = [];
    let totalEdits = 0;

    for (const [uri, edits] of editsMap.entries()) {
      let absPath: string;
      try {
        absPath = fileURLToPath(uri);
      } catch {
        absPath = uri;
      }
      const relPath = path.relative(wsDir, absPath);

      let content = "";
      if (existsSync(absPath)) {
        try {
          content = await fs.readFile(absPath, "utf-8");
        } catch {
          // File reading is optional for preview
        }
      }

      const lineOffsets = content ? computeLineOffsets(content) : [];

      const formattedEdits: FormattedFileEdit[] = edits.map((e) => {
        const startLine = e.range.start.line;
        const startChar = e.range.start.character;
        const endLine = e.range.end.line;
        const endChar = e.range.end.character;

        let oldText = "";
        if (content && lineOffsets.length > 0) {
          const start = positionToOffset(lineOffsets, e.range.start);
          const end = positionToOffset(lineOffsets, e.range.end);
          oldText = content.slice(start, end);
        }

        const snippet = content
          ? buildEditSnippet(content, startLine, startChar, endChar, e.newText)
          : undefined;

        return {
          line: startLine + 1,
          character: startChar + 1,
          endLine: endLine + 1,
          endCharacter: endChar + 1,
          oldText,
          newText: e.newText,
          snippet,
        };
      });

      totalEdits += formattedEdits.length;
      affectedFiles.push({
        file: relPath,
        absolutePath: absPath,
        editCount: formattedEdits.length,
        edits: formattedEdits,
      });

      // 5. If not dryRun, apply edits to disk and notify clangd session
      if (!dryRun && content) {
        const updatedContent = applyTextEdits(content, edits);
        await fs.writeFile(absPath, updatedContent, "utf-8");
        const ext = path.extname(absPath).toLowerCase();
        const langId = ext === ".c" ? "c" : "cpp";
        session.openOrUpdateDocument(uri, langId, updatedContent);
      }
    }

    return {
      success: true,
      symbol: options.symbol,
      newName: options.newName,
      dryRun,
      workspaceDir: wsDir,
      totalEdits,
      affectedFiles,
    };
  } catch (err) {
    return {
      success: false,
      symbol: options.symbol,
      newName: options.newName,
      dryRun,
      workspaceDir: wsDir,
      totalEdits: 0,
      affectedFiles: [],
      error: `Rename error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
