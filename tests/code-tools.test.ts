import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { isExecutableAvailable } from "../src/project/xmake.js";
import { analyzeCodeSymbol } from "../src/tools/code-analyzer.js";
import { searchCodeSymbols } from "../src/tools/code-search.js";
import { sessionManager } from "../src/tools/code-session-manager.js";

describe("Semantic Code Tools (searchCodeSymbols & analyzeCodeSymbol)", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "code-tools-test-"));
  });

  afterEach(async () => {
    await sessionManager.closeAll();
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("should return graceful error when no build system or compile_commands exists", async () => {
    const res = await searchCodeSymbols({
      query: "MyClass",
      workspaceDir: tempDir,
    });

    expect(res.found).toBe(false);
    expect(res.totalMatches).toBe(0);
    expect(res.error).toBeDefined();
  });

  it("should search and analyze code symbols in a real project workspace", async () => {
    const hasClangd = await isExecutableAvailable("clangd");
    if (!hasClangd) {
      console.log("Skipping test: clangd is not installed");
      return;
    }

    const srcDir = path.join(tempDir, "src");
    await fs.mkdir(srcDir, { recursive: true });

    const headerFile = path.join(srcDir, "vector_math.hpp");
    const sourceFile = path.join(srcDir, "vector_math.cpp");

    await fs.writeFile(
      headerFile,
      `#pragma once
namespace math {
  /// 2D Vector representation
  struct Vec2 {
    float x;
    float y;
    /// Computes length squared
    float length_sq() const;
  };
}
`,
    );

    await fs.writeFile(
      sourceFile,
      `#include "vector_math.hpp"
namespace math {
  float Vec2::length_sq() const {
    return x * x + y * y;
  }
}
`,
    );

    // Provide compile_commands.json
    await fs.writeFile(
      path.join(tempDir, "compile_commands.json"),
      JSON.stringify(
        [
          {
            directory: tempDir,
            file: sourceFile,
            command: `clang++ -I${srcDir} -c ${sourceFile} -o vector_math.o`,
          },
        ],
        null,
        2,
      ),
    );

    // Warm up session and open files
    const { session } = await sessionManager.getSession(tempDir);
    expect(session).not.toBeNull();

    const headerUri = pathToFileURL(headerFile).toString();
    const sourceUri = pathToFileURL(sourceFile).toString();
    session?.openDocument(headerUri, "cpp", await fs.readFile(headerFile, "utf-8"));
    session?.openDocument(sourceUri, "cpp", await fs.readFile(sourceFile, "utf-8"));

    await new Promise((r) => setTimeout(r, 600));

    // 1. Search symbols
    const searchRes = await searchCodeSymbols({
      query: "Vec2",
      workspaceDir: tempDir,
    });

    expect(searchRes.found).toBe(true);
    expect(searchRes.totalMatches).toBeGreaterThanOrEqual(1);
    expect(searchRes.symbols.some((s) => s.name === "Vec2")).toBe(true);

    // 2. Analyze Vec2 struct
    const structAnalysis = await analyzeCodeSymbol({
      symbol: "Vec2",
      workspaceDir: tempDir,
    });

    expect(structAnalysis.found).toBe(true);
    expect(["struct", "class"]).toContain(structAnalysis.kind || "");
    expect(structAnalysis.members).toBeDefined();
    expect(structAnalysis.members?.some((m) => m.name === "length_sq")).toBe(true);

    // 3. Analyze length_sq method
    const methodAnalysis = await analyzeCodeSymbol({
      symbol: "length_sq",
      workspaceDir: tempDir,
    });

    expect(methodAnalysis.found).toBe(true);
    expect(methodAnalysis.definition).toBeDefined();
    expect(methodAnalysis.definition?.file).toMatch(/vector_math\.(cpp|hpp)/);
  });
});
