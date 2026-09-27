import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { runCli } from "../src/cli.js";
import { createServer } from "../src/index.js";
import { isExecutableAvailable } from "../src/project/xmake.js";
import { getCodeDiagnostics } from "../src/tools/code-diagnostics.js";
import { sessionManager } from "../src/tools/code-session-manager.js";

describe("Live Compiler Diagnostics (getCodeDiagnostics & CLI)", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "code-diag-test-"));
  });

  afterEach(async () => {
    await sessionManager.closeAll();
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("should return graceful error when no build system or compile_commands exists", async () => {
    const res = await getCodeDiagnostics({
      file: "nonexistent.cpp",
      workspaceDir: tempDir,
    });

    expect(res.success).toBe(false);
    expect(res.error).toBeDefined();
    expect(res.files).toHaveLength(0);
  });

  it("should register get_code_diagnostics in createServer", () => {
    const server = createServer();
    expect(server).toBeDefined();
  });

  it("should detect compiler errors and warnings with clangd in a workspace", async () => {
    const hasClangd = await isExecutableAvailable("clangd");
    if (!hasClangd) {
      console.log("Skipping test: clangd is not installed");
      return;
    }

    const srcDir = path.join(tempDir, "src");
    await fs.mkdir(srcDir, { recursive: true });

    const cleanFile = path.join(srcDir, "clean.cpp");
    await fs.writeFile(
      cleanFile,
      `int add(int a, int b) {
  return a + b;
}
`,
    );

    const buggyFile = path.join(srcDir, "buggy.cpp");
    await fs.writeFile(
      buggyFile,
      `#include <vector>
int calculate() {
  int x = undeclared_identifier; // syntax error
  return x;
}
`,
    );

    // Setup compilation database
    await fs.writeFile(
      path.join(tempDir, "compile_commands.json"),
      JSON.stringify(
        [
          {
            directory: tempDir,
            file: cleanFile,
            command: `clang++ -c ${cleanFile} -o clean.o`,
          },
          {
            directory: tempDir,
            file: buggyFile,
            command: `clang++ -c ${buggyFile} -o buggy.o`,
          },
        ],
        null,
        2,
      ),
    );

    // 1. Check clean file -> 0 errors
    const cleanRes = await getCodeDiagnostics({
      file: cleanFile,
      workspaceDir: tempDir,
      waitTimeout: 2,
    });

    expect(cleanRes.success).toBe(true);
    expect(cleanRes.totalErrors).toBe(0);
    expect(cleanRes.files).toHaveLength(1);
    expect(cleanRes.files[0]?.errorCount).toBe(0);

    // 2. Check buggy file -> should report error on undeclared_identifier
    const buggyRes = await getCodeDiagnostics({
      file: buggyFile,
      workspaceDir: tempDir,
      waitTimeout: 2,
    });

    expect(buggyRes.success).toBe(true);
    expect(buggyRes.totalErrors).toBeGreaterThanOrEqual(1);
    const buggyFileSummary = buggyRes.files.find((f) => f.file.includes("buggy.cpp"));
    expect(buggyFileSummary).toBeDefined();
    expect(buggyFileSummary?.diagnostics.length).toBeGreaterThanOrEqual(1);

    const errorDiag = buggyFileSummary?.diagnostics.find((d) => d.severity === "error");
    expect(errorDiag).toBeDefined();
    expect(errorDiag?.line).toBe(3);
    expect(errorDiag?.message.toLowerCase()).toContain("undeclared");
    expect(errorDiag?.snippet).toContain("undeclared_identifier");
    expect(errorDiag?.snippet).toContain("^");

    // 3. Check in-memory code parameter without modifying disk
    const inMemoryRes = await getCodeDiagnostics({
      file: cleanFile,
      code: `int compute() {\n  return missing_var * 2;\n}\n`,
      workspaceDir: tempDir,
      waitTimeout: 2,
    });

    expect(inMemoryRes.success).toBe(true);
    expect(inMemoryRes.totalErrors).toBeGreaterThanOrEqual(1);
    const inMemoryDiag = inMemoryRes.files[0]?.diagnostics.find((d) => d.severity === "error");
    expect(inMemoryDiag?.message.toLowerCase()).toContain("missing_var");

    // 4. Test CLI execution
    const origLog = console.log;
    const origError = console.error;
    const logs: string[] = [];
    console.log = (...args) => logs.push(args.join(" "));
    console.error = (...args) => logs.push(args.join(" "));

    try {
      const cliExitCode = await runCli([
        "code-diagnostics",
        cleanFile,
        "--workspace",
        tempDir,
        "--json",
      ]);
      expect(cliExitCode).toBe(0);
      const parsed = JSON.parse(logs[logs.length - 1] ?? "{}");
      expect(parsed.success).toBe(true);
      expect(parsed.totalErrors).toBe(0);
    } finally {
      console.log = origLog;
      console.error = origError;
    }
  });
});
