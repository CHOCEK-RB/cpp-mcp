import { describe, expect, it } from "bun:test";
import { COMPILER_SUPPORT_ENTRIES } from "../src/data/compiler_support.js";
import { createServer } from "../src/index.js";
import {
  checkCompilerSupport,
  compareCompilerVersion,
  normalizeFeatureQuery,
} from "../src/tools/compiler-support.js";

describe("Compiler Support Matrix", () => {
  it("should normalize feature queries cleanly", () => {
    expect(normalizeFeatureQuery("std::print")).toBe("print");
    expect(normalizeFeatureQuery("std::expected")).toBe("expected");
    expect(normalizeFeatureQuery("  std::flat_map  ")).toBe("flat map");
    expect(normalizeFeatureQuery("import std")).toBe("import std");
  });

  it("should retrieve feature details by canonical ID", () => {
    const res = checkCompilerSupport({ feature: "std-print" });
    expect(res.found).toBe(true);
    expect(res.entry?.name).toBe("std::print & std::println");
    expect(res.entry?.standard).toBe("C++23");
    expect(res.entry?.macro).toBe("__cpp_lib_print");
    expect(res.entry?.compilers.gcc).toBe("13");
    expect(res.entry?.compilers.clang).toBe("17");
    expect(res.entry?.compilers.msvc).toBe("19.38");
    expect(res.entry?.compilers.apple_clang).toBe("15.0");
  });

  it("should retrieve feature details by symbol name and alias", () => {
    const res1 = checkCompilerSupport({ feature: "std::print" });
    expect(res1.found).toBe(true);
    expect(res1.entry?.id).toBe("std-print");

    const res2 = checkCompilerSupport({ feature: "expected" });
    expect(res2.found).toBe(true);
    expect(res2.entry?.id).toBe("std-expected");

    const res3 = checkCompilerSupport({ feature: "import std" });
    expect(res3.found).toBe(true);
    expect(res3.entry?.id).toBe("import-std");
  });

  it("should filter features by standard version", () => {
    const res23 = checkCompilerSupport({ standard: "C++23" });
    expect(res23.found).toBe(true);
    expect(res23.matches).toBeDefined();
    const matches23 = res23.matches ?? [];
    expect(matches23.length).toBeGreaterThanOrEqual(5);
    for (const m of matches23) {
      expect(m.standard).toBe("C++23");
    }

    const res26 = checkCompilerSupport({ standard: "C++26" });
    expect(res26.found).toBe(true);
    expect(res26.matches?.some((m) => m.id === "reflection-preview")).toBe(true);
  });

  it("should return catalog overview when no feature or standard is provided", () => {
    const res = checkCompilerSupport();
    expect(res.found).toBe(true);
    expect(res.totalEntries).toBe(COMPILER_SUPPORT_ENTRIES.length);
    expect(res.matches?.length).toBe(COMPILER_SUPPORT_ENTRIES.length);
  });

  it("should correctly evaluate version compatibility for compatible compiler", () => {
    const comp = compareCompilerVersion("13.2", "13", "gcc");
    expect(comp.compatible).toBe(true);
    expect(comp.message).toContain("meets the minimum requirement");

    const res = checkCompilerSupport({
      feature: "std::print",
      compiler: "gcc",
      version: "13.1",
    });
    expect(res.found).toBe(true);
    expect(res.compatibility?.compatible).toBe(true);
  });

  it("should correctly evaluate version compatibility for outdated compiler", () => {
    const comp = compareCompilerVersion("12.2", "13", "gcc");
    expect(comp.compatible).toBe(false);
    expect(comp.message).toContain("is older than the required");

    const res = checkCompilerSupport({
      feature: "std::print",
      compiler: "gcc",
      version: 12,
    });
    expect(res.found).toBe(true);
    expect(res.compatibility?.compatible).toBe(false);
  });

  it("should correctly evaluate multi-digit minor and patch version levels", () => {
    // 12.10 is newer than 12.2 (would fail with parseFloat where 12.10 == 12.1 < 12.2)
    const twoDigitMinor = compareCompilerVersion("12.10", "12.2", "gcc");
    expect(twoDigitMinor.compatible).toBe(true);

    const twoDigitMinorOlder = compareCompilerVersion("12.2", "12.10", "gcc");
    expect(twoDigitMinorOlder.compatible).toBe(false);

    // Three-part patch versions
    const patchNewer = compareCompilerVersion("13.2.1", "13.2.0", "clang");
    expect(patchNewer.compatible).toBe(true);

    const patchOlder = compareCompilerVersion("13.2.0", "13.2.1", "clang");
    expect(patchOlder.compatible).toBe(false);

    // MSVC version with build number
    const msvcBuild = compareCompilerVersion("19.38.33130", "19.38", "msvc");
    expect(msvcBuild.compatible).toBe(true);

    const msvcTwoDigit = compareCompilerVersion("19.10", "19.9", "msvc");
    expect(msvcTwoDigit.compatible).toBe(true);
  });

  it("should handle unsupported ('No') compilers gracefully", () => {
    const comp = compareCompilerVersion("16.0", "No", "apple_clang");
    expect(comp.compatible).toBe(false);
    expect(comp.message).toContain("does not support this feature yet");
  });

  it("should handle experimental and partial compilers gracefully", () => {
    const compExp = compareCompilerVersion("14", "Experimental", "gcc");
    expect(compExp.compatible).toBe(false);
    expect(compExp.message).toContain("experimental");

    const compPart = compareCompilerVersion("19.38", "Partial", "msvc");
    expect(compPart.compatible).toBe(false);
    expect(compPart.message).toContain("partial");
  });

  it("should return not found for unknown feature", () => {
    const res = checkCompilerSupport({ feature: "nonexistent_feature_xyz" });
    expect(res.found).toBe(false);
    expect(res.message).toContain("No compiler support data found");
  });

  it("should register check_compiler_support tool in createServer", () => {
    const server = createServer();
    const serverAny = server as unknown as {
      _registeredTools?: Record<string, unknown>;
    };

    expect(serverAny._registeredTools).toBeDefined();
    expect(serverAny._registeredTools?.check_compiler_support).toBeDefined();
  });
});
