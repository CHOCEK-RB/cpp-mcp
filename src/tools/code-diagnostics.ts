import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { type Diagnostic, DiagnosticSeverity, diagnosticSeverityToString } from "../lsp/types.js";
import { sessionManager } from "./code-session-manager.js";

export interface CodeDiagnosticsOptions {
  file?: string;
  code?: string;
  workspaceDir?: string;
  severity?: "all" | "error" | "warning";
  waitTimeout?: number; // in seconds, default 3
}

export interface FormattedDiagnostic {
  file: string;
  line: number;
  character: number;
  endLine: number;
  endCharacter: number;
  severity: "error" | "warning" | "information" | "hint";
  message: string;
  source?: string;
  code?: string | number;
  snippet?: string;
}

export interface FileDiagnosticsSummary {
  file: string;
  errorCount: number;
  warningCount: number;
  diagnostics: FormattedDiagnostic[];
}

export interface CodeDiagnosticsResult {
  success: boolean;
  workspaceDir: string;
  buildSystem?: string;
  totalErrors: number;
  totalWarnings: number;
  files: FileDiagnosticsSummary[];
  error?: string;
}

function inferLanguageId(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".c") return "c";
  if (ext === ".cu") return "cuda";
  return "cpp";
}

function buildSnippet(
  content: string,
  startLine: number,
  startCol: number,
  endCol: number,
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
  snippetLines.push(`> ${currNum} | ${lines[startLine]}`);

  const col = Math.max(0, startCol);
  const span = Math.max(1, endCol > startCol ? endCol - startCol : 1);
  const indent = " ".repeat(lineNumWidth + 5 + col);
  const pointer = `^${"~".repeat(span - 1)}`;
  snippetLines.push(`${indent}${pointer}`);

  if (startLine + 1 < lines.length) {
    const nextNum = String(startLine + 2).padStart(lineNumWidth, " ");
    snippetLines.push(`  ${nextNum} | ${lines[startLine + 1]}`);
  }

  return snippetLines.join("\n");
}

function formatDiagnostic(
  diag: Diagnostic,
  filePath: string,
  content?: string,
): FormattedDiagnostic {
  const startLine = diag.range.start.line;
  const startChar = diag.range.start.character;
  const endLine = diag.range.end.line;
  const endChar = diag.range.end.character;

  let snippet: string | undefined;
  if (content !== undefined) {
    snippet = buildSnippet(content, startLine, startChar, endChar);
  }

  return {
    file: filePath,
    line: startLine + 1,
    character: startChar + 1,
    endLine: endLine + 1,
    endCharacter: endChar + 1,
    severity: diagnosticSeverityToString(diag.severity),
    message: diag.message,
    source: diag.source || "clangd",
    code: diag.code,
    snippet,
  };
}

/**
 * Retrieves live compiler diagnostics (errors, warnings) using clangd LSP.
 */
export async function getCodeDiagnostics(
  options: CodeDiagnosticsOptions = {},
): Promise<CodeDiagnosticsResult> {
  const wsDir = path.resolve(options.workspaceDir || process.cwd());
  const waitTimeout = (options.waitTimeout ?? 3) * 1000;
  const severityFilter = options.severity ?? "all";

  const { session, buildSystem, error } = await sessionManager.getSession(wsDir);
  if (!session) {
    return {
      success: false,
      workspaceDir: wsDir,
      buildSystem: buildSystem || "unknown",
      totalErrors: 0,
      totalWarnings: 0,
      files: [],
      error,
    };
  }

  try {
    const fileSummaries: FileDiagnosticsSummary[] = [];

    if (options.file) {
      const resolvedPath = path.isAbsolute(options.file)
        ? options.file
        : path.resolve(wsDir, options.file);
      const relPath = path.relative(wsDir, resolvedPath);
      const uri = pathToFileURL(resolvedPath).toString();

      let content = options.code;
      if (content === undefined) {
        if (!existsSync(resolvedPath)) {
          return {
            success: false,
            workspaceDir: wsDir,
            buildSystem,
            totalErrors: 0,
            totalWarnings: 0,
            files: [],
            error: `File not found: ${resolvedPath}`,
          };
        }
        content = await fs.readFile(resolvedPath, "utf-8");
      }

      const langId = inferLanguageId(resolvedPath);
      session.openOrUpdateDocument(uri, langId, content);

      const rawDiagnostics = await session.waitForDiagnostics(uri, waitTimeout);

      const filtered = rawDiagnostics.filter((d) => {
        if (severityFilter === "error") {
          return d.severity === DiagnosticSeverity.Error;
        }
        if (severityFilter === "warning") {
          return d.severity === DiagnosticSeverity.Warning;
        }
        return true;
      });

      const formattedDiags = filtered.map((d) => formatDiagnostic(d, relPath, content));
      const errorCount = rawDiagnostics.filter(
        (d) => d.severity === DiagnosticSeverity.Error,
      ).length;
      const warningCount = rawDiagnostics.filter(
        (d) => d.severity === DiagnosticSeverity.Warning,
      ).length;

      fileSummaries.push({
        file: relPath,
        errorCount,
        warningCount,
        diagnostics: formattedDiags,
      });
    } else {
      // Query all tracked/open documents in session
      const cached = session.getCachedDiagnostics() as Map<string, Diagnostic[]>;

      for (const [uri, rawDiagnostics] of cached.entries()) {
        let filePath = uri;
        try {
          filePath = fileURLToPath(uri);
        } catch {
          // Keep raw uri if fileURLToPath fails
        }
        const relPath = path.relative(wsDir, filePath);

        let content: string | undefined;
        if (existsSync(filePath)) {
          try {
            content = await fs.readFile(filePath, "utf-8");
          } catch {
            // Content reading is optional for snippet generation
          }
        }

        const filtered = rawDiagnostics.filter((d) => {
          if (severityFilter === "error") {
            return d.severity === DiagnosticSeverity.Error;
          }
          if (severityFilter === "warning") {
            return d.severity === DiagnosticSeverity.Warning;
          }
          return true;
        });

        const formattedDiags = filtered.map((d) => formatDiagnostic(d, relPath, content));
        const errorCount = rawDiagnostics.filter(
          (d) => d.severity === DiagnosticSeverity.Error,
        ).length;
        const warningCount = rawDiagnostics.filter(
          (d) => d.severity === DiagnosticSeverity.Warning,
        ).length;

        fileSummaries.push({
          file: relPath,
          errorCount,
          warningCount,
          diagnostics: formattedDiags,
        });
      }
    }

    const totalErrors = fileSummaries.reduce((sum, f) => sum + f.errorCount, 0);
    const totalWarnings = fileSummaries.reduce((sum, f) => sum + f.warningCount, 0);

    return {
      success: true,
      workspaceDir: wsDir,
      buildSystem,
      totalErrors,
      totalWarnings,
      files: fileSummaries,
    };
  } catch (err) {
    return {
      success: false,
      workspaceDir: wsDir,
      buildSystem,
      totalErrors: 0,
      totalWarnings: 0,
      files: [],
      error: `Diagnostic error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
