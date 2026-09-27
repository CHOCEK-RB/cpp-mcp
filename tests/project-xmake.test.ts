import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  findExistingCompilationDb,
  findUpwardFile,
  getCandidateCompilationDbPaths,
  isExecutableAvailable,
  readCompilationDatabase,
  resolveProjectBuildInfo,
} from "../src/project/xmake.js";

describe("xmake and compilation database provider", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "xmake-test-"));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("should find marker file upward in parent directories", async () => {
    const rootMarker = path.join(tempDir, "xmake.lua");
    await fs.writeFile(rootMarker, 'target("app") set_kind("binary")');

    const nestedDir = path.join(tempDir, "src", "sub", "core");
    await fs.mkdir(nestedDir, { recursive: true });

    const found = findUpwardFile(nestedDir, "xmake.lua", 4);
    expect(found).toBe(rootMarker);

    const notFound = findUpwardFile(nestedDir, "nonexistent.marker", 4);
    expect(notFound).toBeNull();
  });

  it("should check if executable is available", async () => {
    const isBun = await isExecutableAvailable("bun");
    expect(isBun).toBe(true);

    const isNonExistent = await isExecutableAvailable("non_existent_binary_xyz_12345");
    expect(isNonExistent).toBe(false);
  });

  it("should inspect common compilation db candidate locations", () => {
    const candidates = getCandidateCompilationDbPaths("/test/project");
    expect(candidates).toContain("/test/project/compile_commands.json");
    expect(candidates).toContain("/test/project/.vscode/compile_commands.json");
    expect(candidates).toContain("/test/project/build/compile_commands.json");
  });

  it("should read and parse compilation database entries correctly", async () => {
    const dbPath = path.join(tempDir, "compile_commands.json");
    const sampleEntries = [
      {
        directory: "/project",
        file: "/project/src/main.cpp",
        command: "clang++ -c /project/src/main.cpp -o main.o",
      },
      {
        directory: "/project",
        file: "/project/src/utils.cpp",
        command: "clang++ -c /project/src/utils.cpp -o utils.o",
      },
    ];
    await fs.writeFile(dbPath, JSON.stringify(sampleEntries, null, 2));

    const parsed = await readCompilationDatabase(dbPath);
    expect(parsed).toHaveLength(2);
    expect(parsed[0]?.file).toBe("/project/src/main.cpp");
    expect(parsed[1]?.file).toBe("/project/src/utils.cpp");
  });

  it("should throw error when reading invalid compilation database", async () => {
    const invalidPath = path.join(tempDir, "invalid_commands.json");
    await fs.writeFile(invalidPath, JSON.stringify({ notAnArray: true }));

    expect(readCompilationDatabase(invalidPath)).rejects.toThrow("root must be a JSON array");
  });

  it("should resolve existing compile_commands.json in workspace", async () => {
    const dbPath = path.join(tempDir, "compile_commands.json");
    await fs.writeFile(
      dbPath,
      JSON.stringify([
        {
          directory: tempDir,
          file: path.join(tempDir, "main.cpp"),
          command: "clang++ main.cpp",
        },
      ]),
    );

    const info = await resolveProjectBuildInfo({ workspaceDir: tempDir });
    expect(info.found).toBe(true);
    expect(info.buildSystem).toBe("manual");
    expect(info.compileCommandsPath).toBe(dbPath);
    expect(info.entryCount).toBe(1);
    expect(info.generated).toBe(false);
  });

  it("should detect existing compile_commands.json inside .vscode folder", async () => {
    const vscodeDir = path.join(tempDir, ".vscode");
    await fs.mkdir(vscodeDir, { recursive: true });
    const dbPath = path.join(vscodeDir, "compile_commands.json");
    await fs.writeFile(
      dbPath,
      JSON.stringify([
        {
          directory: tempDir,
          file: path.join(tempDir, "main.cpp"),
          command: "clang++ main.cpp",
        },
      ]),
    );

    const found = findExistingCompilationDb(tempDir);
    expect(found).toBe(dbPath);

    const info = await resolveProjectBuildInfo({ workspaceDir: tempDir });
    expect(info.found).toBe(true);
    expect(info.compileCommandsPath).toBe(dbPath);
  });

  it("should return not found when neither build file nor compile_commands.json exists", async () => {
    const emptyDir = path.join(tempDir, "empty");
    await fs.mkdir(emptyDir);

    const info = await resolveProjectBuildInfo({
      workspaceDir: emptyDir,
      autoGenerate: false,
    });
    expect(info.found).toBe(false);
    expect(info.buildSystem).toBe("unknown");
    expect(info.error).toContain("No xmake.lua, CMakeLists.txt");
  });

  it("should detect CMake project and instruct user when compile_commands.json is missing", async () => {
    const cmakeDir = path.join(tempDir, "cmake_proj");
    await fs.mkdir(cmakeDir);
    await fs.writeFile(path.join(cmakeDir, "CMakeLists.txt"), "project(test CXX)");

    const info = await resolveProjectBuildInfo({
      workspaceDir: cmakeDir,
      autoGenerate: false,
    });
    expect(info.found).toBe(false);
    expect(info.buildSystem).toBe("cmake");
    expect(info.error).toContain("cmake -DCMAKE_EXPORT_COMPILE_COMMANDS=ON");
  });

  it("should auto-generate compile_commands.json in real xmake project if xmake is available", async () => {
    const hasXmake = await isExecutableAvailable("xmake");
    if (!hasXmake) {
      console.log("Skipping real xmake generation test: xmake not in PATH");
      return;
    }

    const xmakeProjDir = path.join(tempDir, "real_xmake_proj");
    await fs.mkdir(path.join(xmakeProjDir, "src"), { recursive: true });

    // Minimal xmake.lua
    await fs.writeFile(
      path.join(xmakeProjDir, "xmake.lua"),
      `add_rules("mode.debug", "mode.release")
target("hello")
    set_kind("binary")
    add_files("src/main.cpp")
`,
    );

    // Minimal main.cpp
    await fs.writeFile(
      path.join(xmakeProjDir, "src", "main.cpp"),
      `#include <iostream>
int main() {
    std::cout << "Hello xmake" << std::endl;
    return 0;
}
`,
    );

    const info = await resolveProjectBuildInfo({
      workspaceDir: xmakeProjDir,
      autoGenerate: true,
    });

    expect(info.found).toBe(true);
    expect(info.buildSystem).toBe("xmake");
    expect(info.generated).toBe(true);
    expect(info.compileCommandsPath).toBeDefined();
    expect(info.entryCount).toBeGreaterThanOrEqual(1);

    const dbPath = info.compileCommandsPath || "";
    const entries = await readCompilationDatabase(dbPath);
    expect(entries.length).toBeGreaterThanOrEqual(1);
    expect(entries[0]?.file).toContain("main.cpp");
  });
});
