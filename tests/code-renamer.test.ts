import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { runCli } from "../src/cli.js";
import { createServer } from "../src/index.js";
import { isExecutableAvailable } from "../src/project/xmake.js";
import { renameCodeSymbol } from "../src/tools/code-renamer.js";
import { sessionManager } from "../src/tools/code-session-manager.js";

describe("Semantic Symbol Renamer (renameCodeSymbol & CLI)", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "code-rename-test-"));
  });

  afterEach(async () => {
    await sessionManager.closeAll();
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("should reject invalid C/C++ identifiers", async () => {
    const res = await renameCodeSymbol({
      symbol: "foo",
      newName: "123invalid",
      workspaceDir: tempDir,
    });

    expect(res.success).toBe(false);
    expect(res.error).toContain("is not a valid C/C++ identifier");
  });

  it("should return graceful error when no build system or compile_commands exists", async () => {
    const res = await renameCodeSymbol({
      symbol: "MyClass",
      newName: "NewClass",
      workspaceDir: tempDir,
    });

    expect(res.success).toBe(false);
    expect(res.error).toBeDefined();
    expect(res.totalEdits).toBe(0);
  });

  it("should register rename_code_symbol in createServer", () => {
    const server = createServer();
    expect(server).toBeDefined();
  });

  it("should perform dry-run and apply multi-file symbol rename with clangd", async () => {
    const hasClangd = await isExecutableAvailable("clangd");
    if (!hasClangd) {
      console.log("Skipping test: clangd is not installed");
      return;
    }

    const srcDir = path.join(tempDir, "src");
    await fs.mkdir(srcDir, { recursive: true });

    const headerFile = path.join(srcDir, "math_utils.hpp");
    const sourceFile = path.join(srcDir, "math_utils.cpp");
    const mainFile = path.join(srcDir, "main.cpp");

    await fs.writeFile(
      headerFile,
      `#pragma once
namespace core {
  int calculate_total(int count, int price);
}
`,
    );

    await fs.writeFile(
      sourceFile,
      `#include "math_utils.hpp"
namespace core {
  int calculate_total(int count, int price) {
    return count * price;
  }
}
`,
    );

    await fs.writeFile(
      mainFile,
      `#include "math_utils.hpp"
int main() {
  int result = core::calculate_total(5, 10);
  return result;
}
`,
    );

    // Compilation database
    await fs.writeFile(
      path.join(tempDir, "compile_commands.json"),
      JSON.stringify(
        [
          {
            directory: tempDir,
            file: sourceFile,
            command: `clang++ -I${srcDir} -c ${sourceFile} -o math_utils.o`,
          },
          {
            directory: tempDir,
            file: mainFile,
            command: `clang++ -I${srcDir} -c ${mainFile} -o main.o`,
          },
        ],
        null,
        2,
      ),
    );

    // Warm up session
    const { session } = await sessionManager.getSession(tempDir);
    expect(session).not.toBeNull();

    // Notice: headerFile is NOT opened manually to test automatic didOpen inside renameCodeSymbol!
    session?.openDocument(
      pathToFileURL(sourceFile).toString(),
      "cpp",
      await fs.readFile(sourceFile, "utf-8"),
    );
    session?.openDocument(
      pathToFileURL(mainFile).toString(),
      "cpp",
      await fs.readFile(mainFile, "utf-8"),
    );

    await new Promise((r) => setTimeout(r, 600));

    // 1. Dry run: verify edits across all 3 files without changing disk
    const dryRunRes = await renameCodeSymbol({
      symbol: "calculate_total",
      newName: "compute_total",
      workspaceDir: tempDir,
      file: headerFile,
      line: 3,
      dryRun: true,
    });

    expect(dryRunRes.success).toBe(true);
    expect(dryRunRes.dryRun).toBe(true);
    expect(dryRunRes.totalEdits).toBeGreaterThanOrEqual(2);
    expect(dryRunRes.affectedFiles.length).toBeGreaterThanOrEqual(2);

    // Check snippets exist
    const affected = dryRunRes.affectedFiles[0];
    expect(affected?.edits[0]?.oldText).toBe("calculate_total");
    expect(affected?.edits[0]?.newText).toBe("compute_total");
    expect(affected?.edits[0]?.snippet).toContain("+ ");

    // Verify disk files remained untouched
    const headerBefore = await fs.readFile(headerFile, "utf-8");
    expect(headerBefore).toContain("calculate_total");
    expect(headerBefore).not.toContain("compute_total");

    // 2. Apply rename: modifies disk files
    const applyRes = await renameCodeSymbol({
      symbol: "calculate_total",
      newName: "compute_total",
      workspaceDir: tempDir,
      file: headerFile,
      line: 3,
      dryRun: false,
    });

    expect(applyRes.success).toBe(true);
    expect(applyRes.dryRun).toBe(false);

    // Verify disk files are now updated
    const headerAfter = await fs.readFile(headerFile, "utf-8");
    expect(headerAfter).toContain("compute_total");
    expect(headerAfter).not.toContain("calculate_total");

    const sourceAfter = await fs.readFile(sourceFile, "utf-8");
    expect(sourceAfter).toContain("compute_total");
    expect(sourceAfter).not.toContain("calculate_total");

    // 3. Test CLI execution
    const origLog = console.log;
    const origError = console.error;
    const logs: string[] = [];
    console.log = (...args) => logs.push(args.join(" "));
    console.error = (...args) => logs.push(args.join(" "));

    try {
      const cliExitCode = await runCli([
        "code-rename",
        "compute_total",
        "calc_total",
        "--workspace",
        tempDir,
        "--file",
        headerFile,
        "--line",
        "3",
        "--json",
      ]);
      expect(cliExitCode).toBe(0);
      const parsed = JSON.parse(logs[logs.length - 1] ?? "{}");
      expect(parsed.success).toBe(true);
      expect(parsed.newName).toBe("calc_total");
      expect(parsed.dryRun).toBe(true);
    } finally {
      console.log = origLog;
      console.error = origError;
    }
  });
});
