import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createServer } from "../src/index.js";
import { isExecutableAvailable } from "../src/project/xmake.js";
import {
  CLANG_TIDY_PRESETS,
  type ClangTidyDeps,
  isClangTidyPreset,
  parseClangTidyOutput,
  runClangTidy,
} from "../src/tools/clang-tidy.js";

const CANNED_OUTPUT = [
  "/tmp/proj/src/main.cpp:12:3: warning: use nullptr [modernize-use-nullptr]",
  "/tmp/proj/src/main.cpp:20:1: error: expected ';' [clang-diagnostic-error]",
  "/tmp/proj/src/main.cpp:12:3: note: this is a note",
  "2 warnings and 1 error generated.",
].join("\n");

function fakeDeps(
  onRun?: (files: string[], options: Record<string, unknown>) => void,
): ClangTidyDeps {
  return {
    resolveTool: async () => ({ available: true, path: "/fake/clang-tidy", version: "22.1.8" }),
    runProcess: async (files, options) => {
      onRun?.(files, options as unknown as Record<string, unknown>);
      return { stdout: CANNED_OUTPUT, stderr: "", code: 0 };
    },
  };
}

describe("parseClangTidyOutput", () => {
  it("extracts position, severity, message and check name", () => {
    const diagnostics = parseClangTidyOutput(CANNED_OUTPUT);

    expect(diagnostics).toHaveLength(3);
    expect(diagnostics[0]).toEqual({
      file: "/tmp/proj/src/main.cpp",
      line: 12,
      column: 3,
      severity: "warning",
      message: "use nullptr",
      check: "modernize-use-nullptr",
    });
    expect(diagnostics[1]?.severity).toBe("error");
    expect(diagnostics[1]?.check).toBe("clang-diagnostic-error");
    expect(diagnostics[2]?.severity).toBe("note");
    expect(diagnostics[2]?.check).toBeUndefined();
  });

  it("ignores summary and source-snippet lines", () => {
    expect(parseClangTidyOutput("1 warning generated.\n    int x = NULL;\n    ^~~~")).toHaveLength(
      0,
    );
  });
});

describe("isClangTidyPreset", () => {
  it("accepts known presets and rejects unknown ones", () => {
    expect(isClangTidyPreset("modernize")).toBe(true);
    expect(isClangTidyPreset("security")).toBe(true);
    expect(isClangTidyPreset("nonsense")).toBe(false);
    expect(CLANG_TIDY_PRESETS.security).toContain("clang-analyzer-security-*");
  });
});

describe("runClangTidy", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "clang-tidy-test-"));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("requires at least one file", async () => {
    const res = await runClangTidy({ workspace: tempDir }, fakeDeps());
    expect(res.success).toBe(false);
    expect(res.error).toContain("Either 'file' or 'files'");
  });

  it("fails fast when a file does not exist", async () => {
    const res = await runClangTidy(
      { file: path.join(tempDir, "missing.cpp"), workspace: tempDir },
      fakeDeps(),
    );
    expect(res.success).toBe(false);
    expect(res.error).toContain("File not found");
  });

  it("reports findings in dry-run mode without passing --fix", async () => {
    const file = path.join(tempDir, "main.cpp");
    await fs.writeFile(file, "int main() { return 0; }\n");

    let capturedFiles: string[] = [];
    let capturedOptions: Record<string, unknown> = {};
    const res = await runClangTidy(
      { file, workspace: tempDir },
      fakeDeps((files, options) => {
        capturedFiles = files;
        capturedOptions = options;
      }),
    );

    expect(res.success).toBe(true);
    expect(res.applied).toBe(false);
    expect(res.preset).toBe("modernize");
    expect(res.checks).toBe("modernize-*");
    expect(res.totalWarnings).toBe(1);
    expect(res.totalErrors).toBe(1);
    expect(res.version).toBe("22.1.8");
    expect(res.message).toContain("dry-run");
    expect(capturedFiles).toEqual([file]);
    expect(capturedOptions.fix).toBe(false);
    expect(capturedOptions.checks).toBe("modernize-*");
  });

  it("passes --fix flags and a checks override when apply is set", async () => {
    const file = path.join(tempDir, "main.cpp");
    await fs.writeFile(file, "int main() { return 0; }\n");

    let capturedOptions: Record<string, unknown> = {};
    const res = await runClangTidy(
      { file, workspace: tempDir, apply: true, checks: "-*,modernize-use-nullptr" },
      fakeDeps((_files, options) => {
        capturedOptions = options;
      }),
    );

    expect(res.success).toBe(true);
    expect(res.applied).toBe(true);
    expect(res.checks).toBe("-*,modernize-use-nullptr");
    expect(capturedOptions.fix).toBe(true);
    expect(res.message).toContain("Applied");
  });

  it("accepts several files", async () => {
    const a = path.join(tempDir, "a.cpp");
    const b = path.join(tempDir, "b.cpp");
    await fs.writeFile(a, "int a();\n");
    await fs.writeFile(b, "int b();\n");

    let capturedFiles: string[] = [];
    const res = await runClangTidy(
      { files: [a, b], workspace: tempDir },
      fakeDeps((files) => {
        capturedFiles = files;
      }),
    );

    expect(res.success).toBe(true);
    expect(capturedFiles).toEqual([a, b]);
  });

  it("returns an error when clang-tidy is unavailable", async () => {
    const file = path.join(tempDir, "main.cpp");
    await fs.writeFile(file, "int main() { return 0; }\n");

    const res = await runClangTidy(
      { file, workspace: tempDir },
      { resolveTool: async () => ({ available: false }) },
    );

    expect(res.success).toBe(false);
    expect(res.error).toContain("clang-tidy not found");
  });

  it("returns an error when the process fails without diagnostics", async () => {
    const file = path.join(tempDir, "main.cpp");
    await fs.writeFile(file, "int main() { return 0; }\n");

    const res = await runClangTidy(
      { file, workspace: tempDir },
      {
        resolveTool: async () => ({ available: true, path: "/fake/clang-tidy" }),
        runProcess: async () => ({ stdout: "", stderr: "boom: bad flag", code: 2 }),
      },
    );

    expect(res.success).toBe(false);
    expect(res.error).toContain("exited with code 2");
  });

  it("runs clang-tidy for real when the binary is available", async () => {
    if (!(await isExecutableAvailable("clang-tidy"))) {
      console.log("Skipping test: clang-tidy is not installed");
      return;
    }

    const file = path.join(tempDir, "main.cpp");
    await fs.writeFile(file, "#include <cstddef>\nint f() { int* p = NULL; return p ? 1 : 0; }\n");
    await fs.writeFile(
      path.join(tempDir, "compile_commands.json"),
      JSON.stringify(
        [
          {
            directory: tempDir,
            file,
            command: `clang++ -std=c++23 -c ${file} -o main.o`,
          },
        ],
        null,
        2,
      ),
    );

    const res = await runClangTidy({
      file,
      workspace: tempDir,
      checks: "-*,modernize-use-nullptr",
      timeoutMs: 60_000,
    });

    expect(res.success).toBe(true);
    expect(res.diagnostics.some((d) => d.check === "modernize-use-nullptr")).toBe(true);
  }, 90_000);
});

describe("McpServer run_clang_tidy registration", () => {
  it("should register run_clang_tidy in createServer", () => {
    const server = createServer();
    // @ts-expect-error accessing private property for test verification
    const tools = server._registeredTools;
    expect(tools.run_clang_tidy).toBeDefined();
  });
});
