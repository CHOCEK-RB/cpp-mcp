// tests/clang-tool-resolver.test.ts
import { describe, expect, it } from "bun:test";
import {
  clangToolCandidates,
  parseClangToolVersion,
  resolveClangTool,
} from "../src/tools/clang-tool-resolver.js";

describe("clangToolCandidates", () => {
  it("prefers the bare name and falls back to absolute and versioned paths", () => {
    const candidates = clangToolCandidates("clang-format");
    expect(candidates[0]).toBe("clang-format");
    expect(candidates).toContain("/usr/bin/clang-format");
    expect(candidates).toContain("/usr/local/bin/clang-format");
    expect(candidates).toContain("clang-format-22");
    expect(candidates).toContain("clang-format-17");
    // Versioned fallbacks must be tried newest-first.
    expect(candidates.indexOf("clang-format-22")).toBeLessThan(
      candidates.indexOf("clang-format-18"),
    );
  });

  it("probes only the explicit custom path when provided", () => {
    expect(clangToolCandidates("clang-format", "/opt/llvm/bin/clang-format")).toEqual([
      "/opt/llvm/bin/clang-format",
    ]);
  });

  it("reads the override from an environment variable", () => {
    process.env.CPP_MCP_TEST_TOOL_PATH = "/custom/bin/tool";
    try {
      expect(clangToolCandidates("tool", undefined, "CPP_MCP_TEST_TOOL_PATH")).toEqual([
        "/custom/bin/tool",
      ]);
    } finally {
      delete process.env.CPP_MCP_TEST_TOOL_PATH;
    }
  });
});

describe("parseClangToolVersion", () => {
  it("parses clang-format style version banners", () => {
    expect(parseClangToolVersion("clang-format version 22.1.8")).toBe("22.1.8");
  });

  it("parses LLVM version banners", () => {
    expect(parseClangToolVersion("LLVM (http://llvm.org/):\n  LLVM version 18.1.0")).toBe("18.1.0");
  });

  it("returns undefined when no version is present", () => {
    expect(parseClangToolVersion("not a version banner")).toBeUndefined();
  });
});

describe("resolveClangTool", () => {
  it("returns the first candidate that responds and reports its version", async () => {
    const probed: string[] = [];
    const info = await resolveClangTool({ name: "pp-trace" }, async (file) => {
      probed.push(file);
      if (file === "/usr/bin/pp-trace") {
        return { stdout: "", stderr: "LLVM version 17.0.1" };
      }
      throw new Error("ENOENT");
    });

    expect(info).toEqual({ available: true, path: "/usr/bin/pp-trace", version: "17.0.1" });
    expect(probed[0]).toBe("pp-trace");
    expect(probed).toContain("/usr/bin/pp-trace");
  });

  it("returns unavailable when every candidate fails", async () => {
    const info = await resolveClangTool({ name: "clang-format" }, async () => {
      throw new Error("ENOENT");
    });
    expect(info).toEqual({ available: false });
  });
});
