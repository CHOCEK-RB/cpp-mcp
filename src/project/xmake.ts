import { execFile } from "node:child_process";
import { existsSync, promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface CompileCommandEntry {
  directory: string;
  file: string;
  command?: string;
  arguments?: string[];
  output?: string;
}

export type BuildSystemType = "xmake" | "cmake" | "manual" | "unknown";

export interface ProjectBuildInfo {
  found: boolean;
  buildSystem: BuildSystemType;
  rootDir: string;
  compileCommandsPath?: string;
  entryCount?: number;
  generated?: boolean;
  error?: string;
}

export interface ResolveBuildOptions {
  workspaceDir?: string;
  autoGenerate?: boolean;
  targetDir?: string;
  xmakePath?: string;
}

/**
 * Searches upward for a marker file starting at startDir up to maxDepth levels.
 */
export function findUpwardFile(startDir: string, marker: string, maxDepth = 4): string | null {
  let current = path.resolve(startDir);
  for (let i = 0; i < maxDepth; i++) {
    const candidate = path.join(current, marker);
    if (existsSync(candidate)) {
      return candidate;
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return null;
}

/**
 * Checks if a specific executable is present and callable in PATH.
 */
export async function isExecutableAvailable(executable: string): Promise<boolean> {
  try {
    await execFileAsync(executable, ["--version"], { timeout: 3000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * Common locations where compile_commands.json is traditionally placed.
 */
export function getCandidateCompilationDbPaths(rootDir: string): string[] {
  return [
    path.join(rootDir, "compile_commands.json"),
    path.join(rootDir, ".vscode", "compile_commands.json"),
    path.join(rootDir, "build", "compile_commands.json"),
    path.join(rootDir, ".xmake", "compile_commands.json"),
    path.join(rootDir, "build-debug", "compile_commands.json"),
    path.join(rootDir, "build-release", "compile_commands.json"),
  ];
}

/**
 * Detects existing compile_commands.json in standard locations.
 */
export function findExistingCompilationDb(rootDir: string): string | null {
  const candidates = getCandidateCompilationDbPaths(rootDir);
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

/**
 * Invokes xmake to generate compile_commands.json in the specified target directory.
 */
export async function generateXmakeCompilationDb(
  rootDir: string,
  outputDir = rootDir,
  xmakeBin = "xmake",
): Promise<string> {
  const outputPath = path.join(outputDir, "compile_commands.json");
  await execFileAsync(xmakeBin, ["project", "-k", "compile_commands", outputDir], {
    cwd: rootDir,
    timeout: 30000,
  });

  if (!existsSync(outputPath)) {
    throw new Error(`xmake completed but compile_commands.json was not created at ${outputPath}`);
  }

  return outputPath;
}

/**
 * Reads and parses compile_commands.json entries.
 */
export async function readCompilationDatabase(filePath: string): Promise<CompileCommandEntry[]> {
  const content = await fs.readFile(filePath, "utf-8");
  const parsed = JSON.parse(content);
  if (!Array.isArray(parsed)) {
    throw new Error("Invalid compile_commands.json: root must be a JSON array");
  }
  return parsed as CompileCommandEntry[];
}

/**
 * Detects the build environment and resolves compile_commands.json.
 * If xmake is detected and compile_commands.json is absent, can automatically generate it.
 */
export async function resolveProjectBuildInfo(
  options: ResolveBuildOptions = {},
): Promise<ProjectBuildInfo> {
  const workspaceDir = path.resolve(options.workspaceDir || process.cwd());

  // 1. Check for xmake.lua
  const xmakeLuaPath = findUpwardFile(workspaceDir, "xmake.lua");
  // 2. Check for CMakeLists.txt
  const cmakeListsPath = findUpwardFile(workspaceDir, "CMakeLists.txt");

  const rootDir = xmakeLuaPath
    ? path.dirname(xmakeLuaPath)
    : cmakeListsPath
      ? path.dirname(cmakeListsPath)
      : workspaceDir;

  const buildSystem: BuildSystemType = xmakeLuaPath
    ? "xmake"
    : cmakeListsPath
      ? "cmake"
      : "unknown";

  // 3. Look for existing compile_commands.json
  const existingDb = findExistingCompilationDb(rootDir);
  if (existingDb) {
    try {
      const entries = await readCompilationDatabase(existingDb);
      return {
        found: true,
        buildSystem: buildSystem === "unknown" ? "manual" : buildSystem,
        rootDir,
        compileCommandsPath: existingDb,
        entryCount: entries.length,
        generated: false,
      };
    } catch (err) {
      return {
        found: false,
        buildSystem,
        rootDir,
        compileCommandsPath: existingDb,
        error: `Failed to read existing compile_commands.json: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  // 4. If xmake project detected and autoGenerate is allowed (default true)
  if (buildSystem === "xmake" && options.autoGenerate !== false) {
    const xmakeBin = options.xmakePath || "xmake";
    const xmakeAvailable = await isExecutableAvailable(xmakeBin);

    if (!xmakeAvailable) {
      return {
        found: false,
        buildSystem: "xmake",
        rootDir,
        error: "Found xmake.lua, but 'xmake' executable is not available in PATH.",
      };
    }

    try {
      const targetDir = options.targetDir || rootDir;
      const generatedPath = await generateXmakeCompilationDb(rootDir, targetDir, xmakeBin);
      const entries = await readCompilationDatabase(generatedPath);
      return {
        found: true,
        buildSystem: "xmake",
        rootDir,
        compileCommandsPath: generatedPath,
        entryCount: entries.length,
        generated: true,
      };
    } catch (err) {
      return {
        found: false,
        buildSystem: "xmake",
        rootDir,
        error: `Failed to generate compile_commands.json via xmake: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  // 5. If CMake detected but no compile_commands.json
  if (buildSystem === "cmake") {
    return {
      found: false,
      buildSystem: "cmake",
      rootDir,
      error:
        "Found CMakeLists.txt, but compile_commands.json not found. Run 'cmake -DCMAKE_EXPORT_COMPILE_COMMANDS=ON -B build' first.",
    };
  }

  return {
    found: false,
    buildSystem: "unknown",
    rootDir,
    error: "No xmake.lua, CMakeLists.txt, or compile_commands.json detected in workspace.",
  };
}
