// tests/doc-generator.test.ts
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { runCli } from "../src/cli.js";
import { createServer } from "../src/index.js";
import { findClangDoc, generateDocumentation } from "../src/tools/doc-generator.js";

const TEST_WORKSPACE = path.join("/tmp", `cpp-mcp-doc-test-${Date.now()}`);

beforeAll(() => {
  fs.mkdirSync(path.join(TEST_WORKSPACE, "include"), { recursive: true });
  fs.writeFileSync(
    path.join(TEST_WORKSPACE, "include", "geometry.hpp"),
    `#pragma once

namespace geometry {

/// @brief Represents a point in 2D cartesian space.
struct Point {
    double x;
    double y;

    /// @brief Translates point by dx, dy.
    /// @param dx Delta x.
    /// @param dy Delta y.
    void translate(double dx, double dy);
};

/// @brief Computes euclidean distance between two points.
/// @param p1 Starting point.
/// @param p2 Destination point.
/// @return Euclidean distance.
double distance(const Point& p1, const Point& p2);

}
`,
    "utf-8",
  );
});

afterAll(() => {
  if (fs.existsSync(TEST_WORKSPACE)) {
    fs.rmSync(TEST_WORKSPACE, { recursive: true, force: true });
  }
});

describe("doc-generator - Tool Registration", () => {
  it("registers generate_documentation in McpServer", () => {
    const server = createServer();
    // @ts-expect-error private property access for testing
    const tools = server._registeredTools;
    expect(tools.generate_documentation).toBeDefined();
  });
});

describe("doc-generator - clang-doc Discovery & Execution", () => {
  it("detects clang-doc on the host system", async () => {
    const info = await findClangDoc();
    expect(info.available).toBe(true);
    expect(info.path).toBeDefined();
    expect(info.version).toBeDefined();
  });

  it("handles dry-run mode without writing files to disk", async () => {
    const res = await generateDocumentation({
      workspace: TEST_WORKSPACE,
      outputDir: "docs/dry-run",
      dryRun: true,
      format: "md",
    });

    expect(res.success).toBe(true);
    expect(res.summary).toContain("[Dry Run]");
    expect(res.totalFiles).toBe(0);
    expect(fs.existsSync(path.join(TEST_WORKSPACE, "docs/dry-run"))).toBe(false);
  });

  it("generates markdown documentation for workspace headers", async () => {
    const res = await generateDocumentation({
      workspace: TEST_WORKSPACE,
      outputDir: "docs/md-output",
      format: "md",
    });

    expect(res.success).toBe(true);
    expect(res.format).toBe("md");
    expect(res.totalFiles).toBeGreaterThan(0);
    expect(res.previewMarkdown).toBeDefined();

    const outputDir = path.join(TEST_WORKSPACE, "docs/md-output");
    expect(fs.existsSync(outputDir)).toBe(true);
    const generated = fs.readdirSync(outputDir);
    expect(generated.length).toBeGreaterThan(0);
  });

  it("generates documentation with specific input files", async () => {
    const targetFile = path.join(TEST_WORKSPACE, "include", "geometry.hpp");
    const res = await generateDocumentation({
      workspace: TEST_WORKSPACE,
      files: [targetFile],
      outputDir: "docs/files-output",
      format: "md",
      publicOnly: true,
    });

    expect(res.success).toBe(true);
    expect(res.totalFiles).toBeGreaterThan(0);
  });

  it("returns failure when no documentable declarations exist in source file", async () => {
    const emptyFile = path.join(TEST_WORKSPACE, "include", "empty.hpp");
    fs.writeFileSync(emptyFile, "// Just a comment\n\n", "utf-8");

    const res = await generateDocumentation({
      workspace: TEST_WORKSPACE,
      files: [emptyFile],
      outputDir: "docs/empty-output",
      format: "md",
    });

    expect(res.success).toBe(false);
    expect(res.totalFiles).toBe(0);
    expect(res.summary).toContain("No documentation files were generated");
  });

  it("cleans and filters stale documentation files across format changes", async () => {
    const outputDir = path.join(TEST_WORKSPACE, "docs/multi-format");
    fs.mkdirSync(outputDir, { recursive: true });
    // Simulate leftover html file
    fs.writeFileSync(path.join(outputDir, "stale.html"), "<html>old</html>", "utf-8");

    const res = await generateDocumentation({
      workspace: TEST_WORKSPACE,
      outputDir: "docs/multi-format",
      format: "md",
    });

    expect(res.success).toBe(true);
    // Generated files must only contain md files, not the stale html file
    expect(res.filesGenerated.every((f) => f.relativePath.endsWith(".md"))).toBe(true);
  });
});

describe("CLI - docs command", () => {
  it("runs docs --dry-run directly and exits with 0", async () => {
    const code = await runCli(["docs", "--workspace", TEST_WORKSPACE, "--dry-run"]);
    expect(code).toBe(0);
  });

  it("runs docs alias with --json and exits with 0", async () => {
    const code = await runCli([
      "generate-docs",
      "--workspace",
      TEST_WORKSPACE,
      "--dry-run",
      "--json",
    ]);
    expect(code).toBe(0);
  });

  it("returns error code 1 for invalid documentation format", async () => {
    const code = await runCli(["docs", "--format", "invalid_doc_format"]);
    expect(code).toBe(1);
  });
});
