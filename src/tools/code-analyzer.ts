import { existsSync, promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { DocumentSymbol, Position } from "../lsp/types.js";
import { symbolKindToString } from "../lsp/types.js";
import { openFileInSession } from "./code-document.js";
import { sessionManager } from "./code-session-manager.js";

export interface CodeAnalyzerOptions {
  symbol: string;
  workspaceDir?: string;
  file?: string;
  line?: number;
  character?: number;
  maxExamples?: number;
}

export interface CodeSnippet {
  file: string;
  line: number;
  preview?: string;
}

export interface HierarchyEntry {
  name: string;
  kind: string;
  detail?: string;
  file: string;
  line: number;
}

export interface MemberEntry {
  name: string;
  kind: string;
  detail?: string;
  line: number;
}

export interface CodeAnalysisResult {
  found: boolean;
  symbol: string;
  workspaceDir: string;
  kind?: string;
  signature?: string;
  documentation?: string;
  declaration?: {
    file: string;
    line: number;
    character: number;
  };
  definition?: {
    file: string;
    line: number;
    character: number;
  };
  inheritance?: {
    supertypes: HierarchyEntry[];
    subtypes: HierarchyEntry[];
  };
  callHierarchy?: {
    incomingCalls: Array<{
      from: HierarchyEntry;
      callCount: number;
    }>;
    outgoingCalls: Array<{
      to: HierarchyEntry;
    }>;
  };
  members?: MemberEntry[];
  usageExamples?: CodeSnippet[];
  error?: string;
}

async function extractLineSnippet(
  filePath: string,
  lineNumber: number,
): Promise<string | undefined> {
  try {
    if (!existsSync(filePath)) return undefined;
    const content = await fs.readFile(filePath, "utf-8");
    const lines = content.split("\n");
    const targetLine = lines[lineNumber - 1];
    return targetLine ? targetLine.trim() : undefined;
  } catch {
    return undefined;
  }
}

function findSymbolRecursive(
  symbols: DocumentSymbol[],
  targetName: string,
  targetLine?: number,
): DocumentSymbol | null {
  const unqualified = targetName.split("::").pop() || targetName;
  let fallback: DocumentSymbol | null = null;

  for (const s of symbols) {
    const matchesName =
      s.name === targetName ||
      s.name === unqualified ||
      targetName.endsWith(`::${s.name}`) ||
      s.name.endsWith(`::${targetName}`);

    if (matchesName) {
      if (
        targetLine !== undefined &&
        s.range.start.line <= targetLine &&
        targetLine <= s.range.end.line
      ) {
        return s;
      }
      if (s.children && s.children.length > 0) {
        fallback = s;
      } else if (!fallback) {
        fallback = s;
      }
    }

    if (s.children && s.children.length > 0) {
      const res = findSymbolRecursive(s.children, targetName, targetLine);
      if (res) return res;
    }
  }

  return fallback;
}

/**
 * Performs multi-dimensional semantic analysis of a C++ code symbol using clangd LSP.
 */
export async function analyzeCodeSymbol(options: CodeAnalyzerOptions): Promise<CodeAnalysisResult> {
  const wsDir = path.resolve(options.workspaceDir || process.cwd());
  const maxExamples = options.maxExamples || 5;

  const { session, error } = await sessionManager.getSession(wsDir);
  if (!session) {
    return {
      found: false,
      symbol: options.symbol,
      workspaceDir: wsDir,
      error,
    };
  }

  try {
    let targetUri: string | null = null;
    let targetPos: Position | null = null;
    let symbolKind = "symbol";

    // 1. If explicit file and line provided, use them
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
        line: Math.max(0, options.line - 1), // 0-indexed for LSP
        character: col,
      };
    } else {
      // 2. Otherwise locate symbol via workspace symbol search
      const rawSymbols = await session.searchSymbols(options.symbol);
      if (rawSymbols.length === 0) {
        return {
          found: false,
          symbol: options.symbol,
          workspaceDir: wsDir,
          error: `No symbol matching '${options.symbol}' found in workspace index.`,
        };
      }

      // Prioritize exact name match
      const matched =
        rawSymbols.find(
          (s) => s.name === options.symbol || s.name.endsWith(`::${options.symbol}`),
        ) || rawSymbols[0];

      if (!matched?.location) {
        return {
          found: false,
          symbol: options.symbol,
          workspaceDir: wsDir,
          error: `Could not resolve location for symbol '${options.symbol}'.`,
        };
      }

      targetUri = matched.location.uri;
      targetPos = matched.location.range.start;
      symbolKind = symbolKindToString(matched.kind);
    }

    const localFilePath = fileURLToPath(targetUri);

    // Notify clangd to open document so AST is built in memory for hover & definitions
    if (existsSync(localFilePath)) {
      const opened = await openFileInSession(session, targetUri, localFilePath);
      if (opened) {
        await new Promise((r) => setTimeout(r, 60));
      }
    }

    // 3. Concurrently fetch hover, definitions, references, type, call hierarchy, and document symbols
    const [hoverRes, defsRes, refsRes, typeHierRes, callHierRes, docSymbolsRes] = await Promise.all(
      [
        session.getHover(targetUri, targetPos).catch(() => null),
        session.getDefinition(targetUri, targetPos).catch(() => []),
        session.getReferences(targetUri, targetPos).catch(() => []),
        session.getTypeHierarchy(targetUri, targetPos).catch(() => ({
          item: null,
          supertypes: [],
          subtypes: [],
        })),
        session.getCallHierarchy(targetUri, targetPos).catch(() => ({
          item: null,
          incoming: [],
          outgoing: [],
        })),
        session.getDocumentSymbols(targetUri).catch(() => [] as DocumentSymbol[]),
      ],
    );

    // Refine symbol kind if unresolved
    if (docSymbolsRes.length > 0) {
      const matched = findSymbolRecursive(docSymbolsRes, options.symbol, targetPos.line);
      if (matched) {
        symbolKind = symbolKindToString(matched.kind);
      }
    }

    // Extract signature and documentation from hover
    let signature: string | undefined;
    let documentation: string | undefined;

    if (hoverRes?.contents) {
      const hoverStr =
        typeof hoverRes.contents === "string"
          ? hoverRes.contents
          : Array.isArray(hoverRes.contents)
            ? hoverRes.contents.map((c) => (typeof c === "string" ? c : c.value)).join("\n\n")
            : hoverRes.contents.value;

      const codeMatch = hoverStr.match(/```(?:cpp|c\+\+)?\n([\s\S]*?)\n```/);
      if (codeMatch?.[1]) {
        signature = codeMatch[1].trim();
        documentation = hoverStr.replace(codeMatch[0], "").trim() || undefined;
      } else {
        documentation = hoverStr;
      }
    }

    // Extract definition location
    let definitionLoc: { file: string; line: number; character: number } | undefined;
    if (defsRes && defsRes.length > 0 && defsRes[0]) {
      const def = defsRes[0];
      definitionLoc = {
        file: fileURLToPath(def.uri),
        line: def.range.start.line + 1,
        character: def.range.start.character + 1,
      };
    }

    // Extract inheritance (type hierarchy)
    const inheritance = {
      supertypes: typeHierRes.supertypes.map((item) => ({
        name: item.name,
        kind: symbolKindToString(item.kind),
        detail: item.detail,
        file: fileURLToPath(item.uri),
        line: item.range.start.line + 1,
      })),
      subtypes: typeHierRes.subtypes.map((item) => ({
        name: item.name,
        kind: symbolKindToString(item.kind),
        detail: item.detail,
        file: fileURLToPath(item.uri),
        line: item.range.start.line + 1,
      })),
    };

    // Extract call hierarchy
    const callHierarchy = {
      incomingCalls: callHierRes.incoming.map((call) => ({
        from: {
          name: call.from.name,
          kind: symbolKindToString(call.from.kind),
          detail: call.from.detail,
          file: fileURLToPath(call.from.uri),
          line: call.from.range.start.line + 1,
        },
        callCount: call.fromRanges.length,
      })),
      outgoingCalls: callHierRes.outgoing.map((call) => ({
        to: {
          name: call.to.name,
          kind: symbolKindToString(call.to.kind),
          detail: call.to.detail,
          file: fileURLToPath(call.to.uri),
          line: call.to.range.start.line + 1,
        },
      })),
    };

    // Extract usage examples from references
    const usageExamples: CodeSnippet[] = [];
    for (const ref of refsRes) {
      const refFile = fileURLToPath(ref.uri);
      const refLine = ref.range.start.line + 1;
      const preview = await extractLineSnippet(refFile, refLine);
      usageExamples.push({
        file: refFile,
        line: refLine,
        preview,
      });
      if (usageExamples.length >= maxExamples) break;
    }

    // Extract class/struct members if applicable
    let members: MemberEntry[] | undefined;
    if (["class", "struct"].includes(symbolKind)) {
      const container = findSymbolRecursive(docSymbolsRes, options.symbol, targetPos.line);
      if (container?.children) {
        members = container.children.map((child) => ({
          name: child.name,
          kind: symbolKindToString(child.kind),
          detail: child.detail,
          line: child.range.start.line + 1,
        }));
      }
    }

    return {
      found: true,
      symbol: options.symbol,
      workspaceDir: wsDir,
      kind: symbolKind,
      signature,
      documentation,
      declaration: {
        file: localFilePath,
        line: targetPos.line + 1,
        character: targetPos.character + 1,
      },
      definition: definitionLoc,
      inheritance:
        inheritance.supertypes.length > 0 || inheritance.subtypes.length > 0
          ? inheritance
          : undefined,
      callHierarchy:
        callHierarchy.incomingCalls.length > 0 || callHierarchy.outgoingCalls.length > 0
          ? callHierarchy
          : undefined,
      members: members && members.length > 0 ? members : undefined,
      usageExamples: usageExamples.length > 0 ? usageExamples : undefined,
    };
  } catch (err) {
    return {
      found: false,
      symbol: options.symbol,
      workspaceDir: wsDir,
      error: `Error analyzing symbol context: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
