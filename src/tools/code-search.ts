import path from "node:path";
import { fileURLToPath } from "node:url";
import { symbolKindToString } from "../lsp/types.js";
import { sessionManager } from "./code-session-manager.js";

export interface CodeSearchOptions {
  query: string;
  workspaceDir?: string;
  files?: string[];
  limit?: number;
}

export interface FormattedCodeSymbol {
  name: string;
  kind: string;
  container?: string;
  file: string;
  line: number;
  character: number;
}

export interface CodeSearchResult {
  found: boolean;
  query: string;
  workspaceDir: string;
  totalMatches: number;
  symbols: FormattedCodeSymbol[];
  error?: string;
}

/**
 * Searches for C++ code symbols in the workspace using clangd LSP.
 */
export async function searchCodeSymbols(options: CodeSearchOptions): Promise<CodeSearchResult> {
  const wsDir = path.resolve(options.workspaceDir || process.cwd());
  const limit = options.limit || 25;

  const { session, error } = await sessionManager.getSession(wsDir);
  if (!session) {
    return {
      found: false,
      query: options.query,
      workspaceDir: wsDir,
      totalMatches: 0,
      symbols: [],
      error,
    };
  }

  try {
    const rawSymbols = await session.searchSymbols(options.query || "");

    const formatted: FormattedCodeSymbol[] = [];

    for (const sym of rawSymbols) {
      if (!sym.location?.uri) continue;

      let filePath = sym.location.uri;
      if (filePath.startsWith("file://")) {
        try {
          filePath = fileURLToPath(filePath);
        } catch {
          // Keep URI if conversion fails
        }
      }

      // Check file path filter if specified
      if (options.files && options.files.length > 0) {
        const matchesFile = options.files.some(
          (f) => filePath.includes(f) || path.basename(filePath) === path.basename(f),
        );
        if (!matchesFile) continue;
      }

      formatted.push({
        name: sym.name,
        kind: symbolKindToString(sym.kind),
        container: sym.containerName,
        file: filePath,
        line: sym.location.range.start.line + 1, // 1-indexed for human readability
        character: sym.location.range.start.character + 1,
      });

      if (formatted.length >= limit) {
        break;
      }
    }

    return {
      found: formatted.length > 0,
      query: options.query,
      workspaceDir: wsDir,
      totalMatches: formatted.length,
      symbols: formatted,
    };
  } catch (err) {
    return {
      found: false,
      query: options.query,
      workspaceDir: wsDir,
      totalMatches: 0,
      symbols: [],
      error: `Error querying workspace symbols: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
