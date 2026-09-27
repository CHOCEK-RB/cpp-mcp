// src/tools/doc-generator.ts
// Documentation generator for C/C++ projects using clang-doc (LLVM AST-driven documentation engine).

import { execFile } from "node:child_process";
import { existsSync, promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { resolveProjectBuildInfo } from "../project/xmake.js";
import { resolveClangTool } from "./clang-tool-resolver.js";

const execFileAsync = promisify(execFile);

export type DocFormat = "md" | "html" | "json" | "yaml";

export interface GenerateDocsParams {
  workspace?: string;
  files?: string[];
  outputDir?: string;
  format?: DocFormat;
  publicOnly?: boolean;
  doxygenOnly?: boolean;
  dryRun?: boolean;
  clangDocPath?: string;
}

export interface GeneratedDocFile {
  relativePath: string;
  absolutePath: string;
  sizeBytes: number;
}

export interface GenerateDocsResult {
  success: boolean;
  tool: string;
  version?: string;
  format: DocFormat;
  outputDir: string;
  filesGenerated: GeneratedDocFile[];
  totalFiles: number;
  summary: string;
  previewMarkdown?: string;
  error?: string;
}

/**
 * Discovers clang-doc executable in PATH or custom candidate paths.
 */
export async function findClangDoc(customPath?: string): Promise<{
  available: boolean;
  path?: string;
  version?: string;
}> {
  const info = await resolveClangTool({ name: "clang-doc", customPath });
  if (!info.available) {
    return { available: false };
  }
  return { available: true, path: info.path, version: info.version ?? "unknown" };
}

export const FORMAT_EXTENSIONS: Record<DocFormat, string[]> = {
  md: [".md"],
  html: [".html", ".htm", ".css", ".js"],
  json: [".json"],
  yaml: [".yaml", ".yml"],
};

/**
 * Name of the manifest that records the files produced by this tool. It lets a later
 * run remove only its own stale output instead of recursively deleting every file that
 * happens to share the target extension.
 */
const DOCS_MANIFEST_FILE = ".cpp-mcp-docs.json";

/**
 * Reads the list of files produced by a previous run. Returns an empty list when the
 * manifest is absent or unreadable.
 */
async function readDocsManifest(dir: string): Promise<string[]> {
  try {
    const raw = await fs.readFile(path.join(dir, DOCS_MANIFEST_FILE), "utf-8");
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((entry): entry is string => typeof entry === "string");
  } catch {
    return [];
  }
}

/**
 * Persists the list of files produced by the current run. Best-effort: a failure to
 * write the manifest must never fail generation.
 */
async function writeDocsManifest(dir: string, files: string[]): Promise<void> {
  try {
    await fs.writeFile(
      path.join(dir, DOCS_MANIFEST_FILE),
      `${JSON.stringify([...files].sort(), null, 2)}\n`,
      "utf-8",
    );
  } catch {
    // Ignore manifest write errors.
  }
}

/**
 * Removes documentation files produced by a previous run that clang-doc no longer
 * regenerates. Only paths recorded in the manifest are touched, so hand-written files
 * sharing the same extension survive.
 */
async function removeStaleDocs(
  dir: string,
  previousFiles: string[],
  currentFiles: Set<string>,
): Promise<void> {
  const baseDir = path.resolve(dir);
  for (const relativePath of previousFiles) {
    if (currentFiles.has(relativePath)) continue;
    const target = path.resolve(baseDir, relativePath);
    // Never follow a manifest entry outside the output directory.
    if (!target.startsWith(`${baseDir}${path.sep}`)) continue;
    try {
      await fs.rm(target, { force: true });
      await pruneEmptyDirs(path.dirname(target), baseDir);
    } catch {
      // Best-effort cleanup.
    }
  }
}

/**
 * Removes directories left empty after stale files were deleted, stopping at `stopDir`.
 */
async function pruneEmptyDirs(startDir: string, stopDir: string): Promise<void> {
  let current = startDir;
  while (current !== stopDir && current.startsWith(stopDir)) {
    try {
      const remaining = await fs.readdir(current);
      if (remaining.length > 0) return;
      await fs.rmdir(current);
    } catch {
      return;
    }
    current = path.dirname(current);
  }
}

/**
 * Recursively copies `source` into `destination`, overwriting files that already exist.
 * Used to publish the staging directory produced by clang-doc into the output directory.
 */
async function copyTree(source: string, destination: string): Promise<void> {
  const stats = await fs.stat(source);
  if (stats.isDirectory()) {
    await fs.mkdir(destination, { recursive: true });
    for (const entry of await fs.readdir(source)) {
      await copyTree(path.join(source, entry), path.join(destination, entry));
    }
  } else {
    await fs.copyFile(source, destination);
  }
}

/**
 * Recursively collects files generated in the output directory matching the target format.
 */
async function collectGeneratedFiles(
  dir: string,
  baseDir: string,
  format: DocFormat,
): Promise<GeneratedDocFile[]> {
  const results: GeneratedDocFile[] = [];
  if (!existsSync(dir)) {
    return results;
  }

  const validExtensions = new Set(FORMAT_EXTENSIONS[format]);
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const nested = await collectGeneratedFiles(fullPath, baseDir, format);
      results.push(...nested);
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase();
      if (entry.name !== DOCS_MANIFEST_FILE && validExtensions.has(ext)) {
        const stats = await fs.stat(fullPath);
        results.push({
          relativePath: path.relative(baseDir, fullPath),
          absolutePath: fullPath,
          sizeBytes: stats.size,
        });
      }
    }
  }

  return results.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
}

/**
 * Generates API documentation from C/C++ source code using clang-doc.
 */
export async function generateDocumentation(
  params: GenerateDocsParams,
): Promise<GenerateDocsResult> {
  const format: DocFormat = params.format ?? "md";
  const workspaceDir = path.resolve(params.workspace ?? process.cwd());
  const outputDir = path.resolve(workspaceDir, params.outputDir ?? "docs/api");

  // 1. Verify clang-doc availability
  const clangDocInfo = await findClangDoc(params.clangDocPath);
  if (!clangDocInfo.available || !clangDocInfo.path) {
    return {
      success: false,
      tool: "clang-doc",
      format,
      outputDir,
      filesGenerated: [],
      totalFiles: 0,
      summary: "clang-doc is not installed or not found in system PATH.",
      error:
        "clang-doc binary was not found. Install it via your package manager:\n" +
        "  - Arch Linux: sudo pacman -S clang\n" +
        "  - Ubuntu/Debian: sudo apt install clang-tools\n" +
        "  - macOS: brew install llvm",
    };
  }

  // 2. Resolve Compilation Database or File List
  let compileCommandsDir: string | undefined;
  let compileCommandsPath: string | undefined;

  try {
    const buildInfo = await resolveProjectBuildInfo({
      workspaceDir,
      autoGenerate: true,
    });
    if (buildInfo.found && buildInfo.compileCommandsPath) {
      compileCommandsPath = buildInfo.compileCommandsPath;
      compileCommandsDir = path.dirname(buildInfo.compileCommandsPath);
    }
  } catch {
    // Gracefully handle resolution errors
  }

  const inputFiles =
    params.files?.map((f) => (path.isAbsolute(f) ? f : path.resolve(workspaceDir, f))) ?? [];

  // Dry run preview
  if (params.dryRun) {
    return {
      success: true,
      tool: `clang-doc (v${clangDocInfo.version})`,
      version: clangDocInfo.version,
      format,
      outputDir,
      filesGenerated: [],
      totalFiles: 0,
      summary: `[Dry Run] Ready to generate ${format.toUpperCase()} documentation into ${outputDir} using clang-doc (${clangDocInfo.path}).`,
    };
  }

  // 3. Stage generation in a temporary directory so a failed run never touches the
  // existing documentation, and files clang-doc produced can be told apart from
  // hand-written ones before publishing.
  await fs.mkdir(outputDir, { recursive: true });
  const previousDocs = await readDocsManifest(outputDir);
  const stagingDir = await fs.mkdtemp(path.join(os.tmpdir(), "cpp-mcp-clang-doc-"));

  // 4. Construct clang-doc command arguments
  const args: string[] = [`--format=${format}`, `--output=${stagingDir}`];

  if (params.publicOnly) {
    args.push("--public");
  }

  if (params.doxygenOnly) {
    args.push("--doxygen");
  }

  if (inputFiles.length > 0) {
    // Specific files passed
    args.push(...inputFiles);
    if (compileCommandsDir) {
      args.push("-p", compileCommandsDir);
    } else {
      // Standalone files without compilation database: append standard C++ compiler flags
      args.push("--", "-std=c++20", `-I${path.join(workspaceDir, "include")}`);
    }
  } else if (compileCommandsPath) {
    // Whole workspace using executor over all translation units
    args.push("--executor=all-TUs", compileCommandsPath);
  } else {
    // Scan workspace for C/C++ header files to document if neither files nor compilation database exist
    const discoveredHeaders: string[] = [];
    const searchDirs = [path.join(workspaceDir, "include"), path.join(workspaceDir, "src")];
    for (const d of searchDirs) {
      if (existsSync(d)) {
        const found = await collectHeaderFiles(d);
        discoveredHeaders.push(...found);
      }
    }

    if (discoveredHeaders.length === 0) {
      return {
        success: false,
        tool: `clang-doc (v${clangDocInfo.version})`,
        version: clangDocInfo.version,
        format,
        outputDir,
        filesGenerated: [],
        totalFiles: 0,
        summary: "No source/header files or compile_commands.json found to document.",
        error:
          "Could not locate compile_commands.json or C/C++ source/header files in the workspace. Provide specific files via the 'files' parameter or run a build system (xmake / cmake) first.",
      };
    }

    args.push(...discoveredHeaders);
    args.push("--", "-std=c++20", `-I${path.join(workspaceDir, "include")}`);
  }

  // 5. Execute clang-doc into the staging directory, then publish the result.
  try {
    await execFileAsync(clangDocInfo.path, args, {
      cwd: workspaceDir,
      timeout: 60000,
    });

    const stagedFiles = await collectGeneratedFiles(stagingDir, stagingDir, format);

    const hasMeaningfulDocs =
      stagedFiles.length > 0 &&
      stagedFiles.some((f) => {
        const rel = f.relativePath.toLowerCase();
        return (
          rel !== "index.md" &&
          rel !== "all_files.md" &&
          rel !== "index.html" &&
          rel !== "index_sidebar.html"
        );
      });

    if (!hasMeaningfulDocs) {
      return {
        success: false,
        tool: `clang-doc (v${clangDocInfo.version})`,
        version: clangDocInfo.version,
        format,
        outputDir,
        filesGenerated: [],
        totalFiles: 0,
        summary:
          "No documentation files were generated. No documentable C/C++ declarations or symbols found.",
        error:
          "clang-doc finished with exit code 0 but emitted no symbol documentation. Ensure the source files contain valid C/C++ declarations, or check if --public excluded private symbols.",
      };
    }

    // Publish the staged files into the output directory, then remove files this tool
    // generated on a previous run that clang-doc no longer emits. Hand-written files are
    // never recorded in the manifest, so they are left untouched.
    const producedRelPaths = new Set(stagedFiles.map((file) => file.relativePath));
    await copyTree(stagingDir, outputDir);
    const generatedFiles = (await collectGeneratedFiles(outputDir, outputDir, format)).filter(
      (file) => producedRelPaths.has(file.relativePath),
    );

    await removeStaleDocs(outputDir, previousDocs, producedRelPaths);
    await writeDocsManifest(outputDir, [...producedRelPaths]);

    // Read index.md or primary documentation file for instant preview
    let previewMarkdown: string | undefined;
    if (format === "md" && generatedFiles.length > 0) {
      const indexCandidate =
        generatedFiles.find((f) => f.relativePath === "index.md") ?? generatedFiles[0];
      if (indexCandidate) {
        try {
          const content = await fs.readFile(indexCandidate.absolutePath, "utf-8");
          previewMarkdown = content.slice(0, 3000);
        } catch {
          // Ignore preview read failure
        }
      }
    }

    const summary = `Successfully generated ${generatedFiles.length} documentation file(s) in ${format.toUpperCase()} format into '${outputDir}'.`;

    return {
      success: true,
      tool: `clang-doc (v${clangDocInfo.version})`,
      version: clangDocInfo.version,
      format,
      outputDir,
      filesGenerated: generatedFiles,
      totalFiles: generatedFiles.length,
      summary,
      previewMarkdown,
    };
  } catch (error) {
    const errObj = error as { message?: string; stderr?: string; stdout?: string };
    const errDetails = errObj.stderr || errObj.message || String(error);

    return {
      success: false,
      tool: `clang-doc (v${clangDocInfo.version})`,
      version: clangDocInfo.version,
      format,
      outputDir,
      filesGenerated: [],
      totalFiles: 0,
      summary: `clang-doc execution failed: ${errDetails.slice(0, 300)}`,
      error: errDetails,
    };
  } finally {
    await fs.rm(stagingDir, { recursive: true, force: true });
  }
}

/**
 * Helper to discover header files in directories.
 */
async function collectHeaderFiles(dir: string): Promise<string[]> {
  const files: string[] = [];
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        const nested = await collectHeaderFiles(fullPath);
        files.push(...nested);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if ([".h", ".hpp", ".hxx", ".hh", ".h++", ".mpp", ".cppm"].includes(ext)) {
          files.push(fullPath);
        }
      }
    }
  } catch {
    // Ignore read errors
  }
  return files;
}
