import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { runCli } from "../src/cli.js";
import { createServer } from "../src/index.js";
import { isExecutableAvailable, readCompilationDatabase } from "../src/project/xmake.js";
import {
  generateCompilationDatabase,
  generateSyntheticDb,
  scanSourceFiles,
} from "../src/tools/compile-db.js";

describe("compile-db generator", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "compile-db-test-"));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("should scan source and header files and infer include directories", async () => {
    const srcDir = path.join(tempDir, "src");
    const incDir = path.join(tempDir, "include", "myproject");
    await fs.mkdir(srcDir, { recursive: true });
    await fs.mkdir(incDir, { recursive: true });

    await fs.writeFile(path.join(srcDir, "main.cpp"), "int main() { return 0; }");
    await fs.writeFile(path.join(srcDir, "helper.cc"), "void helper() {}");
    await fs.writeFile(path.join(incDir, "header.hpp"), "#pragma once");

    const scanned = await scanSourceFiles(tempDir);
    expect(scanned.sources).toHaveLength(2);
    expect(scanned.headers).toHaveLength(1);
    expect(scanned.sources[0]).toContain("helper.cc");
    expect(scanned.sources[1]).toContain("main.cpp");
    expect(scanned.headers[0]).toContain("header.hpp");
    expect(scanned.includeDirs.some((d) => d.includes("include"))).toBe(true);
  });

  it("should generate synthetic compilation database entries without build system", async () => {
    const srcDir = path.join(tempDir, "src");
    await fs.mkdir(srcDir, { recursive: true });
    await fs.writeFile(path.join(srcDir, "app.cpp"), "int main() {}");

    const { entries, filesIndexed } = await generateSyntheticDb(tempDir, {
      compiler: "clang++",
      std: "c++23",
      includeDirs: ["custom/include"],
    });

    expect(entries).toHaveLength(1);
    expect(filesIndexed).toEqual(["src/app.cpp"]);
    expect(entries[0]?.file).toBe(path.join(srcDir, "app.cpp"));
    expect(entries[0]?.command).toContain("clang++");
    expect(entries[0]?.command).toContain("-std=c++23");
    expect(entries[0]?.command).toContain("-I");
    expect(entries[0]?.command).toContain("custom/include");
  });

  it("should support dry-run mode without creating files on disk", async () => {
    const srcDir = path.join(tempDir, "src");
    await fs.mkdir(srcDir, { recursive: true });
    await fs.writeFile(path.join(srcDir, "calc.cpp"), "int add(int a, int b) { return a + b; }");

    const result = await generateCompilationDatabase({
      workspace: tempDir,
      buildSystem: "synthetic",
      dryRun: true,
    });

    expect(result.success).toBe(true);
    expect(result.buildSystem).toBe("synthetic");
    expect(result.entryCount).toBe(1);
    expect(result.summary).toContain("[DRY-RUN]");
    expect(await fs.exists(path.join(tempDir, "compile_commands.json"))).toBe(false);
  });

  it("should generate real synthetic compile_commands.json on disk", async () => {
    const srcDir = path.join(tempDir, "src");
    await fs.mkdir(srcDir, { recursive: true });
    await fs.writeFile(path.join(srcDir, "math.cpp"), "double sq(double x) { return x * x; }");

    const result = await generateCompilationDatabase({
      workspace: tempDir,
      buildSystem: "synthetic",
      std: "c++20",
    });

    expect(result.success).toBe(true);
    expect(result.entryCount).toBe(1);
    const dbPath = path.join(tempDir, "compile_commands.json");
    expect(await fs.exists(dbPath)).toBe(true);

    const parsed = await readCompilationDatabase(dbPath);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]?.file).toBe(path.join(srcDir, "math.cpp"));
  });

  it("should reuse existing compile_commands.json when available in auto mode", async () => {
    const existingDb = path.join(tempDir, "compile_commands.json");
    await fs.writeFile(
      existingDb,
      JSON.stringify([
        {
          directory: tempDir,
          file: path.join(tempDir, "existing.cpp"),
          command: "clang++ -c existing.cpp",
        },
      ]),
    );

    const result = await generateCompilationDatabase({
      workspace: tempDir,
      buildSystem: "auto",
    });

    expect(result.success).toBe(true);
    expect(result.buildSystem).toBe("existing");
    expect(result.entryCount).toBe(1);
    expect(result.summary).toContain("Reused existing compile_commands.json");
  });

  it("should generate compile_commands.json via CMake when CMakeLists.txt is present", async () => {
    const hasCmake = await isExecutableAvailable("cmake");
    if (!hasCmake) {
      console.log("Skipping CMake test: cmake not installed");
      return;
    }

    const cmakeFile = path.join(tempDir, "CMakeLists.txt");
    await fs.writeFile(
      cmakeFile,
      `cmake_minimum_required(VERSION 3.15)
project(TestProj CXX)
add_executable(test_app main.cpp)
`,
    );
    await fs.writeFile(path.join(tempDir, "main.cpp"), "int main() { return 0; }\n");

    const result = await generateCompilationDatabase({
      workspace: tempDir,
      buildSystem: "cmake",
      buildDir: path.join(tempDir, "build"),
      symlinkToRoot: true,
    });

    expect(result.success).toBe(true);
    expect(result.buildSystem).toBe("cmake");
    expect(result.entryCount).toBeGreaterThanOrEqual(1);
    expect(result.rootLinked).toBe(true);
    expect(await fs.exists(path.join(tempDir, "compile_commands.json"))).toBe(true);
  });

  it("should execute CLI compile-db command successfully with --json", async () => {
    const srcDir = path.join(tempDir, "src");
    await fs.mkdir(srcDir, { recursive: true });
    await fs.writeFile(path.join(srcDir, "cli_test.cpp"), "int foo() { return 42; }");

    let stdout = "";
    const origLog = console.log;
    console.log = (msg: string) => {
      stdout += msg;
    };

    try {
      const exitCode = await runCli([
        "compile-db",
        tempDir,
        "--build-system",
        "synthetic",
        "--json",
      ]);
      expect(exitCode).toBe(0);
      const parsed = JSON.parse(stdout);
      expect(parsed.success).toBe(true);
      expect(parsed.buildSystem).toBe("synthetic");
      expect(parsed.entryCount).toBe(1);
    } finally {
      console.log = origLog;
    }
  });

  it("should register generate_compilation_database tool in MCP server", () => {
    const server = createServer();
    // @ts-expect-error accessing private property for test verification
    const registeredTools = server._registeredTools;
    expect(registeredTools).toBeDefined();
    expect(registeredTools.generate_compilation_database).toBeDefined();
  });

  it("should correctly quote paths and include directories with spaces in synthetic mode", async () => {
    const spacedSrcDir = path.join(tempDir, "spaced dir", "src files");
    const spacedIncDir = path.join(tempDir, "spaced include");
    await fs.mkdir(spacedSrcDir, { recursive: true });
    await fs.mkdir(spacedIncDir, { recursive: true });

    await fs.writeFile(
      path.join(spacedSrcDir, "my test app.cpp"),
      '#include "header.hpp"\nint main() {}',
    );
    await fs.writeFile(path.join(spacedIncDir, "header.hpp"), "#pragma once");

    const { entries } = await generateSyntheticDb(tempDir, {
      compiler: "clang++",
      includeDirs: [spacedIncDir],
    });

    expect(entries).toHaveLength(1);
    const entry = entries[0];
    expect(entry?.file).toContain("my test app.cpp");
    // Verify relative paths and includes with spaces are properly quoted
    expect(entry?.command).toContain('-I"');
    expect(entry?.command).toContain('-c "');
    expect(entry?.command).toContain('-o "');
  });

  it("should reject invalid build system names with error via API and CLI", async () => {
    // API validation
    const apiResult = await generateCompilationDatabase({
      workspace: tempDir,
      buildSystem:
        "invalid_build_xyz" as unknown as import("../src/tools/compile-db.js").BuildSystemName,
    });
    expect(apiResult.success).toBe(false);
    expect(apiResult.summary).toContain("Invalid build system 'invalid_build_xyz'");

    // CLI validation
    let stderr = "";
    const origError = console.error;
    console.error = (msg: string) => {
      stderr += msg;
    };

    try {
      const exitCode = await runCli(["compile-db", tempDir, "--build-system", "invalid_build_xyz"]);
      expect(exitCode).toBe(1);
      expect(stderr).toContain("Invalid --build-system 'invalid_build_xyz'");
    } finally {
      console.error = origError;
    }
  });

  it("should not force -G Ninja if CMakeCache.txt already exists in build dir", async () => {
    const hasCmake = await isExecutableAvailable("cmake");
    if (!hasCmake) return;

    const buildDir = path.join(tempDir, "build");
    await fs.mkdir(buildDir, { recursive: true });
    await fs.writeFile(
      path.join(tempDir, "CMakeLists.txt"),
      "cmake_minimum_required(VERSION 3.15)\nproject(CacheTest CXX)\nadd_executable(cache_app main.cpp)\n",
    );
    await fs.writeFile(path.join(tempDir, "main.cpp"), "int main() {}\n");

    // First configure with default/Unix generator
    const firstRes = await generateCompilationDatabase({
      workspace: tempDir,
      buildSystem: "cmake",
      buildDir,
    });
    expect(firstRes.success).toBe(true);

    // Verify CMakeCache.txt exists now
    expect(await fs.exists(path.join(buildDir, "CMakeCache.txt"))).toBe(true);

    // Re-running with existing CMakeCache.txt must succeed without generator conflict
    const secondRes = await generateCompilationDatabase({
      workspace: tempDir,
      buildSystem: "cmake",
      buildDir,
    });
    expect(secondRes.success).toBe(true);
    expect(secondRes.entryCount).toBeGreaterThanOrEqual(1);
  });
});
