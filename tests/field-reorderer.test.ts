import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { runCli } from "../src/cli.js";
import { createServer } from "../src/index.js";
import { findClangReorderFields, reorderStructFields } from "../src/tools/field-reorderer.js";

// clang-reorder-fields ships with the LLVM clang tools and is not guaranteed to be
// installed on every machine (CI included). Skip binary-dependent tests when absent.
const hasClangReorderFields = (await findClangReorderFields()).available;
const skipMessage = "Skipping test: clang-reorder-fields is not installed";

describe("clang-reorder-fields refactoring tool", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "reorder-fields-test-"));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("should discover clang-reorder-fields binary in system PATH", async () => {
    if (!hasClangReorderFields) {
      console.log(skipMessage);
      return;
    }

    const info = await findClangReorderFields();
    expect(info.available).toBe(true);
    expect(info.path).toBeDefined();
    expect(info.version).toBeDefined();
  });

  it("should preview (dry-run) field reordering and aggregate initializers in C struct without modifying file", async () => {
    if (!hasClangReorderFields) {
      console.log(skipMessage);
      return;
    }

    const filePath = path.join(tempDir, "point.c");
    const originalCode = `struct Point {
  int x;
  double y;
  char z;
};

int main() {
  struct Point p = { 1, 2.5, 'a' };
  return 0;
}
`;
    await fs.writeFile(filePath, originalCode, "utf-8");

    const result = await reorderStructFields({
      recordName: "Point",
      fieldsOrder: ["y", "x", "z"],
      files: [filePath],
      apply: false,
    });

    expect(result.success).toBe(true);
    expect(result.dryRun).toBe(true);
    expect(result.modifiedFiles).toHaveLength(1);
    expect(result.unifiedDiff).toBeDefined();
    expect(result.unifiedDiff).toContain("double y;");
    expect(result.unifiedDiff).toContain("2.5, 1");

    // Verify file on disk remained unchanged in dry-run mode
    const contentOnDisk = await fs.readFile(filePath, "utf-8");
    expect(contentOnDisk).toBe(originalCode);
  });

  it("should not leak full file contents into the public result", async () => {
    if (!hasClangReorderFields) {
      console.log(skipMessage);
      return;
    }

    const filePath = path.join(tempDir, "leak.c");
    await fs.writeFile(filePath, "struct Leak {\n  int a;\n  int b;\n};\n", "utf-8");

    const result = await reorderStructFields({
      recordName: "Leak",
      fieldsOrder: ["b", "a"],
      files: [filePath],
      apply: false,
    });

    expect(result.success).toBe(true);
    for (const change of result.changes) {
      expect(change).not.toHaveProperty("originalContent");
      expect(change).not.toHaveProperty("rewrittenContent");
    }
    // The serialized MCP payload must stay diff-only.
    expect(JSON.stringify(result)).not.toContain("struct Leak");
  });

  it("should apply field reordering directly to disk when apply is true", async () => {
    if (!hasClangReorderFields) {
      console.log(skipMessage);
      return;
    }

    const filePath = path.join(tempDir, "data.c");
    await fs.writeFile(
      filePath,
      `struct Data {
  char a;
  double b;
  int c;
};
int main() {
  struct Data d = { 'x', 3.14, 42 };
  return 0;
}
`,
      "utf-8",
    );

    const result = await reorderStructFields({
      recordName: "Data",
      fieldsOrder: ["b", "a", "c"],
      files: [filePath],
      apply: true,
    });

    expect(result.success).toBe(true);
    expect(result.dryRun).toBe(false);
    expect(result.modifiedFiles).toHaveLength(1);

    const contentAfter = await fs.readFile(filePath, "utf-8");
    expect(contentAfter).toContain("double b;\n  char a;\n  int c;");
    expect(contentAfter).toContain("struct Data d = { 3.14, 'x', 42 };");
  });

  it("should reorder C++ class member declarations and constructor initializer lists", async () => {
    if (!hasClangReorderFields) {
      console.log(skipMessage);
      return;
    }

    const filePath = path.join(tempDir, "widget.cpp");
    await fs.writeFile(
      filePath,
      `class Widget {
public:
  Widget();
private:
  int id;
  double score;
};

Widget::Widget() : id(100), score(99.5) {}
`,
      "utf-8",
    );

    const result = await reorderStructFields({
      recordName: "Widget",
      fieldsOrder: ["score", "id"],
      files: [filePath],
      extraArgs: ["-std=c++20"],
      apply: true,
    });

    expect(result.success).toBe(true);
    const contentAfter = await fs.readFile(filePath, "utf-8");
    expect(contentAfter).toContain("double score;\n  int id;");
    expect(contentAfter).toContain("score(99.5), id(100)");
  });

  it("should reorder C++20 designated initializers correctly", async () => {
    if (!hasClangReorderFields) {
      console.log(skipMessage);
      return;
    }

    const filePath = path.join(tempDir, "coords.cpp");
    await fs.writeFile(
      filePath,
      `struct Coords {
  int x;
  int y;
};

int main() {
  Coords c = { .x = 10, .y = 20 };
  return 0;
}
`,
      "utf-8",
    );

    const result = await reorderStructFields({
      recordName: "Coords",
      fieldsOrder: ["y", "x"],
      files: [filePath],
      extraArgs: ["-std=c++20"],
      apply: true,
    });

    expect(result.success).toBe(true);
    const contentAfter = await fs.readFile(filePath, "utf-8");
    expect(contentAfter).toContain("int y;\n  int x;");
    expect(contentAfter).toContain("Coords c = { .y = 20, .x = 10 };");
  });

  it("should refactor across multiple files (header and source)", async () => {
    if (!hasClangReorderFields) {
      console.log(skipMessage);
      return;
    }

    const headerPath = path.join(tempDir, "item.h");
    const sourcePath = path.join(tempDir, "main.c");

    await fs.writeFile(
      headerPath,
      `struct Item {
  int id;
  const char *name;
};
`,
      "utf-8",
    );

    await fs.writeFile(
      sourcePath,
      `#include "item.h"
int main() {
  struct Item item = { 42, "ItemName" };
  return 0;
}
`,
      "utf-8",
    );

    const result = await reorderStructFields({
      recordName: "Item",
      fieldsOrder: ["name", "id"],
      files: [headerPath, sourcePath],
      extraArgs: [`-I${tempDir}`],
      apply: true,
    });

    expect(result.success).toBe(true);
    expect(result.modifiedFiles).toHaveLength(2);

    const hdrAfter = await fs.readFile(headerPath, "utf-8");
    const srcAfter = await fs.readFile(sourcePath, "utf-8");

    expect(hdrAfter).toContain("const char *name;\n  int id;");
    expect(srcAfter).toContain('struct Item item = { "ItemName", 42 };');
  });

  it("should fail gracefully when record name is not found", async () => {
    if (!hasClangReorderFields) {
      console.log(skipMessage);
      return;
    }

    const filePath = path.join(tempDir, "empty.c");
    await fs.writeFile(filePath, "int a = 1;\n", "utf-8");

    const result = await reorderStructFields({
      recordName: "NonExistentStruct",
      fieldsOrder: ["a", "b"],
      files: [filePath],
      apply: false,
    });

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
    expect(result.error).toContain("NonExistentStruct");
  });

  it("should fail gracefully when field names do not match struct definition", async () => {
    if (!hasClangReorderFields) {
      console.log(skipMessage);
      return;
    }

    const filePath = path.join(tempDir, "mismatch.c");
    await fs.writeFile(filePath, "struct Simple { int a; int b; };\n", "utf-8");

    const result = await reorderStructFields({
      recordName: "Simple",
      fieldsOrder: ["x", "y"],
      files: [filePath],
      apply: false,
    });

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
    expect(result.error).toContain("Field");
  });

  it("should execute CLI reorder-fields command successfully with --json", async () => {
    if (!hasClangReorderFields) {
      console.log(skipMessage);
      return;
    }

    const filePath = path.join(tempDir, "cli_test.c");
    await fs.writeFile(
      filePath,
      `struct Node {
  int val;
  double weight;
};
int main() {
  struct Node n = { 1, 0.5 };
  return 0;
}
`,
      "utf-8",
    );

    let stdout = "";
    const origLog = console.log;
    console.log = (msg: string) => {
      stdout += msg;
    };

    try {
      const exitCode = await runCli([
        "reorder-fields",
        "Node",
        "weight,val",
        "--file",
        filePath,
        "--json",
      ]);
      expect(exitCode).toBe(0);
      const parsed = JSON.parse(stdout);
      expect(parsed.success).toBe(true);
      expect(parsed.dryRun).toBe(true);
      expect(parsed.recordName).toBe("Node");
      expect(parsed.fieldsOrder).toEqual(["weight", "val"]);
    } finally {
      console.log = origLog;
    }
  });

  it("should register reorder_struct_fields tool in MCP server", () => {
    const server = createServer();
    // @ts-expect-error accessing private property for test verification
    const registeredTools = server._registeredTools;
    expect(registeredTools).toBeDefined();
    expect(registeredTools.reorder_struct_fields).toBeDefined();
  });
});
