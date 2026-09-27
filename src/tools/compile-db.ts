// src/tools/compile-db.ts
// Standalone compilation database (compile_commands.json) generator and resolver for C/C++ projects.

import { execFile } from "node:child_process";
import { existsSync, promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import {
  type CompileCommandEntry,
  findExistingCompilationDb,
  findUpwardFile,
  generateXmakeCompilationDb,
  isExecutableAvailable,
  readCompilationDatabase,
} from "../project/xmake.js";

const execFileAsync = promisify(execFile);

export type BuildSystemName = "auto" | "cmake" | "xmake" | "meson" | "bear" | "synthetic";
export const VALID_COMPILE_DB_SYSTEMS = new Set<string>([
  "auto",
  "cmake",
  "xmake",
  "meson",
  "bear",
  "synthetic",
]);

export interface GenerateCompileDbParams {
  workspace?: string;
  buildSystem?: BuildSystemName;
  buildDir?: string;
  compiler?: string;
  std?: string;
  includeDirs?: string[];
  symlinkToRoot?: boolean;
  dryRun?: boolean;
}

export interface GenerateCompileDbResult {
  success: boolean;
  buildSystem: string;
  compileCommandsPath?: string;
  entryCount: number;
  rootLinked: boolean;
  filesIndexed: string[];
  summary: string;
  error?: string;
}

export interface ScannedProjectFiles {
  sources: string[];
  headers: string[];
  includeDirs: string[];
}

const IGNORED_DIRECTORIES = new Set([
  ".git",
  ".github",
  ".vscode",
  ".xmake",
  "build",
  "build-debug",
  "build-release",
  "node_modules",
  "dist",
  ".cache",
  "target",
  "venv",
  ".venv",
]);

const SOURCE_EXTENSIONS = new Set([".c", ".cpp", ".cc", ".cxx", ".c++"]);
const HEADER_EXTENSIONS = new Set([".h", ".hpp", ".hxx", ".hh", ".h++", ".inl"]);

/**
 * Recursively scans a workspace directory for C/C++ source and header files,
 * inferring standard include directories.
 */
export async function scanSourceFiles(
  workspaceDir: string,
  maxFiles = 5000,
): Promise<ScannedProjectFiles> {
  const sources: string[] = [];
  const headers: string[] = [];
  const includeDirSet = new Set<string>();

  async function walk(currentDir: string): Promise<void> {
    if (sources.length + headers.length >= maxFiles) return;

    let entries: string[];
    try {
      entries = await fs.readdir(currentDir);
    } catch {
      return;
    }

    for (const entry of entries) {
      if (IGNORED_DIRECTORIES.has(entry)) continue;

      const fullPath = path.join(currentDir, entry);
      let stat: import("node:fs").Stats;
      try {
        stat = await fs.stat(fullPath);
      } catch {
        continue;
      }

      if (stat.isDirectory()) {
        const lowerName = entry.toLowerCase();
        if (lowerName === "include" || lowerName === "inc" || lowerName === "headers") {
          includeDirSet.add(path.resolve(fullPath));
        }
        await walk(fullPath);
      } else if (stat.isFile()) {
        const ext = path.extname(entry).toLowerCase();
        if (SOURCE_EXTENSIONS.has(ext)) {
          sources.push(path.resolve(fullPath));
        } else if (HEADER_EXTENSIONS.has(ext)) {
          headers.push(path.resolve(fullPath));
          // Add parent directory as potential include directory
          includeDirSet.add(path.resolve(currentDir));
        }
      }
    }
  }

  await walk(path.resolve(workspaceDir));

  // Ensure root directory is always considered as base include
  includeDirSet.add(path.resolve(workspaceDir));

  return {
    sources: sources.sort(),
    headers: headers.sort(),
    includeDirs: Array.from(includeDirSet).sort(),
  };
}

/**
 * Generates synthetic compilation database entries without requiring a build system.
 */
export async function generateSyntheticDb(
  workspaceDir: string,
  options: {
    compiler?: string;
    std?: string;
    includeDirs?: string[];
  } = {},
): Promise<{ entries: CompileCommandEntry[]; filesIndexed: string[] }> {
  const scanned = await scanSourceFiles(workspaceDir);
  const resolvedRoot = path.resolve(workspaceDir);

  const customIncludes = (options.includeDirs ?? []).map((dir) =>
    path.isAbsolute(dir) ? dir : path.resolve(resolvedRoot, dir),
  );

  const allIncludes = Array.from(new Set([...customIncludes, ...scanned.includeDirs]));

  let compiler = options.compiler;
  if (!compiler) {
    const hasClang = await isExecutableAvailable("clang++");
    compiler = hasClang ? "clang++" : "g++";
  }

  const std = options.std || "c++20";
  const includeFlags = allIncludes
    .map((dir) => (dir.includes(" ") ? `-I"${dir}"` : `-I${dir}`))
    .join(" ");

  const entries: CompileCommandEntry[] = [];
  const filesIndexed: string[] = [];

  // 1. Add compilation commands for all discovered source files
  for (const src of scanned.sources) {
    const rel = path.relative(resolvedRoot, src);
    const relArg = rel.includes(" ") ? `"${rel}"` : rel;
    const outArg = rel.includes(" ") ? `"${rel}.o"` : `${rel}.o`;
    const command = `${compiler} -std=${std} ${includeFlags} -c ${relArg} -o ${outArg}`.trim();
    entries.push({
      directory: resolvedRoot,
      file: src,
      command,
    });
    filesIndexed.push(rel);
  }

  // 2. If no source files exist but header files do, generate header validation entries
  if (entries.length === 0 && scanned.headers.length > 0) {
    for (const hdr of scanned.headers) {
      const rel = path.relative(resolvedRoot, hdr);
      const relArg = rel.includes(" ") ? `"${rel}"` : rel;
      const command =
        `${compiler} -std=${std} ${includeFlags} -fsyntax-only -x c++-header ${relArg}`.trim();
      entries.push({
        directory: resolvedRoot,
        file: hdr,
        command,
      });
      filesIndexed.push(rel);
    }
  }

  return { entries, filesIndexed };
}

/**
 * Invokes CMake to generate compile_commands.json.
 */
export async function generateCMakeCompilationDb(
  rootDir: string,
  buildDir = path.join(rootDir, "build"),
): Promise<string> {
  const resolvedRoot = path.resolve(rootDir);
  const resolvedBuildDir = path.resolve(resolvedRoot, buildDir);

  await fs.mkdir(resolvedBuildDir, { recursive: true });

  const cmakeArgs = ["-B", resolvedBuildDir, "-DCMAKE_EXPORT_COMPILE_COMMANDS=ON"];

  // Use Ninja if available for faster configuration ONLY when CMakeCache.txt does not already exist
  const cacheFile = path.join(resolvedBuildDir, "CMakeCache.txt");
  if (!existsSync(cacheFile)) {
    const hasNinja = await isExecutableAvailable("ninja");
    if (hasNinja) {
      cmakeArgs.push("-G", "Ninja");
    }
  }

  await execFileAsync("cmake", cmakeArgs, {
    cwd: resolvedRoot,
    timeout: 45000,
  });

  const outputPath = path.join(resolvedBuildDir, "compile_commands.json");
  if (!existsSync(outputPath)) {
    throw new Error(`CMake succeeded but compile_commands.json was not created at ${outputPath}`);
  }

  return outputPath;
}

/**
 * Invokes Meson to generate compile_commands.json.
 */
export async function generateMesonCompilationDb(
  rootDir: string,
  buildDir = path.join(rootDir, "build"),
): Promise<string> {
  const resolvedRoot = path.resolve(rootDir);
  const resolvedBuildDir = path.resolve(resolvedRoot, buildDir);

  const isConfigured = existsSync(path.join(resolvedBuildDir, "build.ninja"));
  const mesonArgs = isConfigured
    ? ["setup", "--reconfigure", resolvedBuildDir]
    : ["setup", resolvedBuildDir];

  await execFileAsync("meson", mesonArgs, {
    cwd: resolvedRoot,
    timeout: 30000,
  });

  const outputPath = path.join(resolvedBuildDir, "compile_commands.json");
  if (!existsSync(outputPath)) {
    throw new Error(`Meson succeeded but compile_commands.json was not created at ${outputPath}`);
  }

  return outputPath;
}

/**
 * Safely copies or updates compile_commands.json at root directory.
 */
export async function linkDbToRoot(sourcePath: string, rootDir: string): Promise<boolean> {
  const targetPath = path.join(rootDir, "compile_commands.json");
  if (path.resolve(sourcePath) === path.resolve(targetPath)) {
    return false;
  }

  try {
    await fs.copyFile(sourcePath, targetPath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Main compilation database generator supporting multi-build system detection and synthetic mode.
 */
export async function generateCompilationDatabase(
  params: GenerateCompileDbParams = {},
): Promise<GenerateCompileDbResult> {
  const workspaceDir = path.resolve(params.workspace ?? process.cwd());
  const symlinkToRoot = params.symlinkToRoot ?? true;
  const dryRun = params.dryRun ?? false;

  if (params.buildSystem && !VALID_COMPILE_DB_SYSTEMS.has(params.buildSystem)) {
    return {
      success: false,
      buildSystem: params.buildSystem,
      entryCount: 0,
      rootLinked: false,
      filesIndexed: [],
      summary: `Invalid build system '${params.buildSystem}'. Supported options: ${Array.from(VALID_COMPILE_DB_SYSTEMS).join(", ")}.`,
      error: `Unknown build system '${params.buildSystem}'. Supported options are: ${Array.from(VALID_COMPILE_DB_SYSTEMS).join(", ")}.`,
    };
  }

  let buildSystem: BuildSystemName = params.buildSystem ?? "auto";

  // 1. Auto-detection logic
  if (buildSystem === "auto") {
    const existingDb = findExistingCompilationDb(workspaceDir);
    if (existingDb && existsSync(existingDb)) {
      try {
        const entries = await readCompilationDatabase(existingDb);
        let rootLinked = false;
        if (symlinkToRoot && !dryRun) {
          rootLinked = await linkDbToRoot(existingDb, workspaceDir);
        }
        return {
          success: true,
          buildSystem: "existing",
          compileCommandsPath: existingDb,
          entryCount: entries.length,
          rootLinked,
          filesIndexed: entries.slice(0, 10).map((e) => path.relative(workspaceDir, e.file)),
          summary: `Reused existing compile_commands.json with ${entries.length} compilation units.`,
        };
      } catch {
        // Fallback to auto-detection if existing file is invalid
      }
    }

    if (findUpwardFile(workspaceDir, "xmake.lua", 2)) {
      buildSystem = "xmake";
    } else if (findUpwardFile(workspaceDir, "CMakeLists.txt", 2)) {
      buildSystem = "cmake";
    } else if (findUpwardFile(workspaceDir, "meson.build", 2)) {
      buildSystem = "meson";
    } else if (
      findUpwardFile(workspaceDir, "Makefile", 2) &&
      (await isExecutableAvailable("bear"))
    ) {
      buildSystem = "bear";
    } else {
      buildSystem = "synthetic";
    }
  }

  // 2. Dry-run early exit
  if (dryRun) {
    if (buildSystem === "synthetic") {
      const { entries, filesIndexed } = await generateSyntheticDb(workspaceDir, {
        compiler: params.compiler,
        std: params.std,
        includeDirs: params.includeDirs,
      });
      return {
        success: entries.length > 0,
        buildSystem: "synthetic",
        compileCommandsPath: path.join(workspaceDir, "compile_commands.json"),
        entryCount: entries.length,
        rootLinked: false,
        filesIndexed,
        summary: `[DRY-RUN] Would generate synthetic compile_commands.json with ${entries.length} entries.`,
      };
    }

    return {
      success: true,
      buildSystem,
      compileCommandsPath: path.join(
        workspaceDir,
        params.buildDir || "build",
        "compile_commands.json",
      ),
      entryCount: 0,
      rootLinked: symlinkToRoot,
      filesIndexed: [],
      summary: `[DRY-RUN] Would execute ${buildSystem} build tool to generate compile_commands.json.`,
    };
  }

  // 3. Execution per build system
  try {
    if (buildSystem === "xmake") {
      const hasXmake = await isExecutableAvailable("xmake");
      if (!hasXmake) {
        return {
          success: false,
          buildSystem: "xmake",
          entryCount: 0,
          rootLinked: false,
          filesIndexed: [],
          summary: "xmake build system detected, but 'xmake' executable was not found in PATH.",
          error: "Install xmake via: curl -fsSL https://xmake.io/shget.text | bash",
        };
      }

      const generatedPath = await generateXmakeCompilationDb(
        workspaceDir,
        params.buildDir ? path.resolve(workspaceDir, params.buildDir) : workspaceDir,
      );
      const entries = await readCompilationDatabase(generatedPath);
      let rootLinked = false;
      if (symlinkToRoot) {
        rootLinked = await linkDbToRoot(generatedPath, workspaceDir);
      }

      return {
        success: true,
        buildSystem: "xmake",
        compileCommandsPath: generatedPath,
        entryCount: entries.length,
        rootLinked,
        filesIndexed: entries.slice(0, 10).map((e) => path.relative(workspaceDir, e.file)),
        summary: `Successfully generated compile_commands.json via xmake (${entries.length} entries).`,
      };
    }

    if (buildSystem === "cmake") {
      const hasCmake = await isExecutableAvailable("cmake");
      if (!hasCmake) {
        return {
          success: false,
          buildSystem: "cmake",
          entryCount: 0,
          rootLinked: false,
          filesIndexed: [],
          summary: "CMakeLists.txt detected, but 'cmake' executable was not found in PATH.",
          error:
            "Install cmake via your system package manager (e.g. pacman -S cmake, apt install cmake).",
        };
      }

      const generatedPath = await generateCMakeCompilationDb(
        workspaceDir,
        params.buildDir || path.join(workspaceDir, "build"),
      );
      const entries = await readCompilationDatabase(generatedPath);
      let rootLinked = false;
      if (symlinkToRoot) {
        rootLinked = await linkDbToRoot(generatedPath, workspaceDir);
      }

      return {
        success: true,
        buildSystem: "cmake",
        compileCommandsPath: generatedPath,
        entryCount: entries.length,
        rootLinked,
        filesIndexed: entries.slice(0, 10).map((e) => path.relative(workspaceDir, e.file)),
        summary: `Successfully generated compile_commands.json via CMake (${entries.length} entries).`,
      };
    }

    if (buildSystem === "meson") {
      const hasMeson = await isExecutableAvailable("meson");
      if (!hasMeson) {
        return {
          success: false,
          buildSystem: "meson",
          entryCount: 0,
          rootLinked: false,
          filesIndexed: [],
          summary: "meson.build detected, but 'meson' executable was not found in PATH.",
          error: "Install meson via: pip install meson or system package manager.",
        };
      }

      const generatedPath = await generateMesonCompilationDb(
        workspaceDir,
        params.buildDir || path.join(workspaceDir, "build"),
      );
      const entries = await readCompilationDatabase(generatedPath);
      let rootLinked = false;
      if (symlinkToRoot) {
        rootLinked = await linkDbToRoot(generatedPath, workspaceDir);
      }

      return {
        success: true,
        buildSystem: "meson",
        compileCommandsPath: generatedPath,
        entryCount: entries.length,
        rootLinked,
        filesIndexed: entries.slice(0, 10).map((e) => path.relative(workspaceDir, e.file)),
        summary: `Successfully generated compile_commands.json via Meson (${entries.length} entries).`,
      };
    }

    if (buildSystem === "bear") {
      const hasBear = await isExecutableAvailable("bear");
      if (!hasBear) {
        return {
          success: false,
          buildSystem: "bear",
          entryCount: 0,
          rootLinked: false,
          filesIndexed: [],
          summary: "Makefile detected, but 'bear' compilation database interceptor was not found.",
          error: "Install bear via system package manager (e.g. pacman -S bear, apt install bear).",
        };
      }

      const outputPath = path.join(workspaceDir, "compile_commands.json");
      await execFileAsync("bear", ["--output", outputPath, "--", "make", "-k"], {
        cwd: workspaceDir,
        timeout: 45000,
      });

      if (!existsSync(outputPath)) {
        throw new Error("Bear completed but compile_commands.json was not created.");
      }

      const entries = await readCompilationDatabase(outputPath);
      return {
        success: true,
        buildSystem: "bear",
        compileCommandsPath: outputPath,
        entryCount: entries.length,
        rootLinked: false,
        filesIndexed: entries.slice(0, 10).map((e) => path.relative(workspaceDir, e.file)),
        summary: `Successfully generated compile_commands.json via Bear interception (${entries.length} entries).`,
      };
    }

    if (buildSystem === "synthetic") {
      const { entries, filesIndexed } = await generateSyntheticDb(workspaceDir, {
        compiler: params.compiler,
        std: params.std,
        includeDirs: params.includeDirs,
      });

      if (entries.length === 0) {
        return {
          success: false,
          buildSystem: "synthetic",
          entryCount: 0,
          rootLinked: false,
          filesIndexed: [],
          summary: "No C/C++ source or header files found to index in workspace.",
          error: "Ensure the workspace directory contains .cpp, .cc, .c, or .hpp files.",
        };
      }

      const outputPath = path.join(workspaceDir, "compile_commands.json");
      await fs.writeFile(outputPath, JSON.stringify(entries, null, 2), "utf-8");

      return {
        success: true,
        buildSystem: "synthetic",
        compileCommandsPath: outputPath,
        entryCount: entries.length,
        rootLinked: false,
        filesIndexed,
        summary: `Synthesized compile_commands.json with ${entries.length} compilation units from discovered sources.`,
      };
    }

    return {
      success: false,
      buildSystem,
      entryCount: 0,
      rootLinked: false,
      filesIndexed: [],
      summary: `Unsupported build system '${buildSystem}'.`,
      error: `Supported build systems are: ${Array.from(VALID_COMPILE_DB_SYSTEMS).join(", ")}.`,
    };
  } catch (err) {
    return {
      success: false,
      buildSystem,
      entryCount: 0,
      rootLinked: false,
      filesIndexed: [],
      summary: `Failed to generate compile_commands.json via ${buildSystem}.`,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
