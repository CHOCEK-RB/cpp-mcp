import { describe, expect, it } from "bun:test";
import { TARGETS } from "../scripts/compile-binaries.js";

describe("Standalone Binary Compiler", () => {
  it("should define all 5 standard platform compilation targets", () => {
    expect(TARGETS).toHaveLength(5);
    const targetNames = TARGETS.map((t) => t.name);

    expect(targetNames).toContain("cpp-mcp-linux-x64");
    expect(targetNames).toContain("cpp-mcp-linux-arm64");
    expect(targetNames).toContain("cpp-mcp-darwin-x64");
    expect(targetNames).toContain("cpp-mcp-darwin-arm64");
    expect(targetNames).toContain("cpp-mcp-windows-x64.exe");
  });

  it("should configure official Bun compile target triplets", () => {
    const bunTargets = TARGETS.map((t) => t.target);

    expect(bunTargets).toContain("bun-linux-x64");
    expect(bunTargets).toContain("bun-linux-arm64");
    expect(bunTargets).toContain("bun-darwin-x64");
    expect(bunTargets).toContain("bun-darwin-arm64");
    expect(bunTargets).toContain("bun-windows-x64");
  });
});
