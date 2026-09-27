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

  it("should boot standalone binary and respond to JSON-RPC ping over stdio", () => {
    const binPath = "./dist/bin/cpp-mcp";
    const payload = `${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" })}\n`;
    const proc = Bun.spawnSync([binPath], {
      stdin: Buffer.from(payload),
      timeout: 10_000,
    });

    expect(proc.exitCode).toBe(0);
    const stdout = proc.stdout.toString();
    expect(stdout).toContain('"jsonrpc":"2.0"');
    expect(stdout).toContain('"id":1');
  });
});
