import { describe, expect, it } from "bun:test";
import { createServer } from "../src/index.js";
import {
  checkModuleToolchain,
  type ModuleToolchainDeps,
  parseToolVersion,
} from "../src/tools/module-toolchain.js";

const CLANG_BANNER = "Ubuntu clang version 18.1.3 (1ubuntu1)";
const GCC13_BANNER = "g++ (Ubuntu 13.2.0-23ubuntu4) 13.2.0";
const GCC14_BANNER = "g++ (Ubuntu 14.2.0-4ubuntu2) 14.2.0";
const CLANGD_BANNER = "clangd version 22.1.8";

function deps(available: Record<string, string>, files: string[] = []): ModuleToolchainDeps {
  const present = new Set(files);
  return {
    probe: async (command) => ({
      available: command in available,
      output: available[command] ?? "",
    }),
    exists: (candidate) => present.has(candidate),
  };
}

describe("parseToolVersion", () => {
  it("reads the first major.minor.patch triple from a banner", () => {
    expect(parseToolVersion(GCC14_BANNER)).toBe("14.2.0");
    expect(parseToolVersion(CLANG_BANNER)).toBe("18.1.3");
    expect(parseToolVersion(CLANGD_BANNER)).toBe("22.1.8");
  });

  it("returns undefined when no version is present", () => {
    expect(parseToolVersion("no version here")).toBeUndefined();
  });
});

describe("checkModuleToolchain", () => {
  it("recommends clang + libc++ when both are present", async () => {
    const res = await checkModuleToolchain(
      {},
      deps({ "clang++": CLANG_BANNER, "g++": GCC14_BANNER, clangd: CLANGD_BANNER }, [
        "/usr/include/c++/v1/iostream",
        "/usr/include/c++/14/bits/std.cc",
      ]),
    );

    expect(res.success).toBe(true);
    expect(res.recommended).toBe("clang-libc++");
    expect(res.host.clang.available).toBe(true);
    expect(res.host.clang.version).toBe("18.1.3");
    expect(res.host.libcxx).toBe(true);
    expect(res.host.gcc.stdModule).toBe(true);
    expect(res.options.find((o) => o.id === "clang-libc++")?.viable).toBe(true);
  });

  it("recommends GCC when it is the only std-module-capable toolchain and warns about clangd", async () => {
    const res = await checkModuleToolchain(
      {},
      deps({ "clang++": CLANG_BANNER, "g++": GCC14_BANNER, clangd: CLANGD_BANNER }, [
        "/usr/include/c++/14/bits/std.cc",
      ]),
    );

    expect(res.recommended).toBe("gcc-native");
    expect(res.host.libcxx).toBe(false);
    expect(res.notes.some((n) => n.includes("clangd") && n.includes(".gcm"))).toBe(true);
  });

  it("falls back to the hybrid option when no std-module toolchain exists", async () => {
    const res = await checkModuleToolchain({}, deps({ "g++": GCC13_BANNER }));

    expect(res.recommended).toBe("hybrid");
    expect(res.options.find((o) => o.id === "hybrid")?.viable).toBe(true);
    expect(res.notes.some((n) => n.includes("No std-module-capable"))).toBe(true);
  });

  it("reports unavailable components without throwing", async () => {
    const res = await checkModuleToolchain({}, deps({}));

    expect(res.success).toBe(true);
    expect(res.host.clang.available).toBe(false);
    expect(res.host.gcc.available).toBe(false);
    expect(res.host.clangd.available).toBe(false);
    expect(res.host.libcxx).toBe(false);
  });

  it("inspects the real host when invoked without injected deps", async () => {
    const res = await checkModuleToolchain();

    expect(res.success).toBe(true);
    expect(["clang-libc++", "gcc-native", "hybrid"]).toContain(res.recommended);
    expect(res.options).toHaveLength(3);
  });
});

describe("McpServer check_module_toolchain registration", () => {
  it("should register check_module_toolchain in createServer", () => {
    const server = createServer();
    // @ts-expect-error accessing private property for test verification
    const tools = server._registeredTools;
    expect(tools.check_module_toolchain).toBeDefined();
  });
});
