import { describe, expect, test } from "bun:test";
import { promises as fs } from "node:fs";
import path from "node:path";
import { runCli } from "../src/cli.js";
import { createServer } from "../src/index.js";
import { formatCode, generateSimpleDiff } from "../src/tools/code-formatter.js";

describe("generateSimpleDiff", () => {
  test("should return empty string when original and modified are identical", () => {
    expect(generateSimpleDiff("int a = 1;", "int a = 1;")).toBe("");
  });

  test("should generate unified diff when code differs", () => {
    const orig = "int a=1;";
    const mod = "int a = 1;";
    const diff = generateSimpleDiff(orig, mod, "test.cpp");
    expect(diff).toContain("--- a/test.cpp");
    expect(diff).toContain("+++ b/test.cpp");
    expect(diff).toContain("- int a=1;");
    expect(diff).toContain("+ int a = 1;");
  });
});

describe("formatCode", () => {
  test("should return error when neither code nor file is provided", async () => {
    const res = await formatCode({});
    expect(res.formatted).toBe(false);
    expect(res.error).toContain("must be specified");
  });

  test("should format in-memory C++ code snippet with LLVM style", async () => {
    const raw = "int main(){int x=42;return x;}";
    const res = await formatCode({ code: raw, style: "LLVM" });
    expect(res.formatted).toBe(true);
    expect(res.changed).toBe(true);
    expect(res.formattedCode).toContain("int main() {");
    expect(res.formattedCode).toContain("  int x = 42;");
    expect(res.diff).toBeDefined();
    expect(res.applied).toBe(false);
  });

  test("should detect when code is already well-formatted", async () => {
    const wellFormatted = "int main() {\n  int x = 42;\n  return x;\n}\n";
    const res = await formatCode({ code: wellFormatted, style: "LLVM" });
    expect(res.formatted).toBe(true);
    expect(res.changed).toBe(false);
    expect(res.message).toContain("already well-formatted");
  });

  test("should format only selected line range", async () => {
    const raw = "int a=1;\nint b=2;\nint c=3;\n";
    const res = await formatCode({
      code: raw,
      style: "LLVM",
      range: { startLine: 1, endLine: 2 },
    });
    expect(res.formatted).toBe(true);
    expect(res.formattedCode).toContain("int a = 1;");
    expect(res.formattedCode).toContain("int b = 2;");
    expect(res.formattedCode).toContain("int c=3;");
  });

  test("should perform dry-run on file without modifying disk", async () => {
    const tmpDir = path.resolve(process.cwd(), "tests/.tmp_formatter_dryrun");
    await fs.mkdir(tmpDir, { recursive: true });
    const tmpFile = path.join(tmpDir, "test.cpp");
    const raw = "void foo(){int a=1;}";
    await fs.writeFile(tmpFile, raw, "utf-8");

    try {
      const res = await formatCode({ file: tmpFile, style: "LLVM", apply: false });
      expect(res.formatted).toBe(true);
      expect(res.changed).toBe(true);
      expect(res.applied).toBe(false);

      const diskContent = await fs.readFile(tmpFile, "utf-8");
      expect(diskContent).toBe(raw);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  test("should apply formatting changes to disk when apply is true", async () => {
    const tmpDir = path.resolve(process.cwd(), "tests/.tmp_formatter_apply");
    await fs.mkdir(tmpDir, { recursive: true });
    const tmpFile = path.join(tmpDir, "test.cpp");
    const raw = "void foo(){int a=1;}";
    await fs.writeFile(tmpFile, raw, "utf-8");

    try {
      const res = await formatCode({ file: tmpFile, style: "LLVM", apply: true });
      expect(res.formatted).toBe(true);
      expect(res.applied).toBe(true);

      const diskContent = await fs.readFile(tmpFile, "utf-8");
      expect(diskContent).not.toBe(raw);
      expect(diskContent).toContain("void foo() { int a = 1; }");
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  test("should return error when file does not exist", async () => {
    const res = await formatCode({ file: "/nonexistent/path/file.cpp" });
    expect(res.formatted).toBe(false);
    expect(res.error).toContain("File not found");
  });

  test("should register format_code in createServer", () => {
    const server = createServer();
    expect(server).toBeDefined();
  });
});

describe("Direct CLI Mode (code-format)", () => {
  test("should format code via CLI --code flag", async () => {
    const code = await runCli(["code-format", "--code", "int main(){return 0;}"]);
    expect(code).toBe(0);
  });

  test("should format code with JSON output via CLI", async () => {
    const code = await runCli(["code-format", "--code", "int main(){return 0;}", "--json"]);
    expect(code).toBe(0);
  });

  test("should format code with lines range via CLI", async () => {
    const code = await runCli([
      "code-format",
      "--code",
      "int a=1;\nint b=2;\nint c=3;\n",
      "--lines",
      "1:2",
    ]);
    expect(code).toBe(0);
  });

  test("should return error when range has startLine greater than endLine", async () => {
    const res = await formatCode({
      code: "int a=1;",
      range: { startLine: 10, endLine: 5 },
    });
    expect(res.formatted).toBe(false);
    expect(res.error).toContain("cannot be greater than");
  });

  test("should return error when style is invalid and clang-format fails with non-zero exit code", async () => {
    const res = await formatCode({
      code: "int a=1;",
      style: "{InvalidKeyThatDoesNotExist: 123",
    });
    expect(res.formatted).toBe(false);
    expect(res.error).toContain("clang-format failed with exit code");
  });

  test("should return exit code 1 when no code or file is provided", async () => {
    const code = await runCli(["code-format"]);
    expect(code).toBe(1);
  });

  test("should return exit code 1 when invalid --lines range is passed to CLI", async () => {
    const code1 = await runCli(["code-format", "--code", "int a=1;", "--lines", "10:5"]);
    expect(code1).toBe(1);

    const code2 = await runCli(["code-format", "--code", "int a=1;", "--lines", "invalid"]);
    expect(code2).toBe(1);
  });
});
