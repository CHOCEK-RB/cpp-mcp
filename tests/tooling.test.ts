import { describe, expect, test } from "bun:test";
import { runCli } from "../src/cli.js";
import { createServer } from "../src/index.js";
import { getCppToolingGuide, normalizeToolId } from "../src/tools/tooling.js";

describe("normalizeToolId", () => {
  test("should normalize various tool aliases", () => {
    expect(normalizeToolId("xmake.lua")).toBe("xmake");
    expect(normalizeToolId(".clang-format")).toBe("clang-format");
    expect(normalizeToolId("format")).toBe("clang-format");
    expect(normalizeToolId("clang-tidy")).toBe("clang-tidy");
    expect(normalizeToolId("tidy")).toBe("clang-tidy");
    expect(normalizeToolId("asan")).toBe("sanitizers");
    expect(normalizeToolId("ubsan")).toBe("sanitizers");
  });
});

describe("getCppToolingGuide", () => {
  test("should retrieve xmake tooling guide, sample config, and skills metadata", () => {
    const res = getCppToolingGuide({ tool: "xmake" });
    expect(res.found).toBe(true);
    expect(res.tool).toBe("xmake");
    expect(res.configFileName).toBe("xmake.lua");
    expect(res.configContent).toContain("add_rules");
    expect(res.configContent).toContain(".cppm");
    expect(res.keyDirectives?.length).toBeGreaterThan(0);
    expect(res.commands?.length).toBeGreaterThan(0);
    expect(res.skillsCount).toBe(58);
    expect(res.categories?.length).toBe(12);
  });

  test("should retrieve official xmake recipe by topic", () => {
    const res = getCppToolingGuide({ tool: "xmake", topic: "cxx-modules" });
    expect(res.found).toBe(true);
    expect(res.topic).toBe("cxx-modules");
    expect(res.category).toBe("toolchains");
    expect(res.title).toContain("C++20 Modules");
    expect(res.content).toContain("build.c++.modules");
    expect(res.path).toContain("xmake-cxx-modules");
  });

  test("should retrieve official xmake recipe by alias or positional tool string", () => {
    const res1 = getCppToolingGuide({ tool: "xmake cxx-modules" });
    expect(res1.found).toBe(true);
    expect(res1.topic).toBe("cxx-modules");

    const res2 = getCppToolingGuide({ topic: "cross-compilation" });
    expect(res2.found).toBe(true);
    expect(res2.topic).toBe("cross-compilation");
    expect(res2.category).toBe("toolchains");
  });

  test("should filter xmake recipes by category", () => {
    const res = getCppToolingGuide({ category: "toolchains" });
    expect(res.found).toBe(true);
    expect(res.category).toBe("toolchains");
    expect(res.skillsCount).toBe(4);
    expect(res.skills?.some((s) => s.id === "cxx-modules")).toBe(true);
    expect(res.skills?.some((s) => s.id === "cross-compilation")).toBe(true);
  });

  test("should retrieve clang-format guide and .clang-format config", () => {
    const res = getCppToolingGuide({ tool: "clang-format", generate_config: true });
    expect(res.found).toBe(true);
    expect(res.configFileName).toBe(".clang-format");
    expect(res.configContent).toContain("BasedOnStyle: LLVM");
    expect(res.message).toContain("Generated recommended configuration");
  });

  test("should retrieve clang-tidy guide and check categories", () => {
    const res = getCppToolingGuide({ tool: "clang-tidy" });
    expect(res.found).toBe(true);
    expect(res.configFileName).toBe(".clang-tidy");
    expect(res.configContent).toContain("modernize-*");
    expect(res.configContent).toContain("cert-*");
    expect(res.configContent).toContain("bugprone-*");
  });

  test("should retrieve runtime sanitizers flags and recipes", () => {
    const res = getCppToolingGuide({ tool: "sanitizers" });
    expect(res.found).toBe(true);
    expect(res.configContent).toContain("-fsanitize=address");
    expect(res.configContent).toContain("-fsanitize=thread");
  });

  test("should search tooling and skills by query keyword", () => {
    const res = getCppToolingGuide({ query: "compile_commands" });
    expect(res.found).toBe(true);
  });

  test("should return all tools in overview when no arguments provided", () => {
    const res = getCppToolingGuide();
    expect(res.found).toBe(true);
    expect(res.totalTools).toBeGreaterThanOrEqual(4);
    expect(res.matches?.length).toBeGreaterThanOrEqual(4);
    expect(res.skillsCount).toBe(58);
  });

  test("should return not found for unknown tool", () => {
    const res = getCppToolingGuide({ tool: "unknown-tool-xyz" });
    expect(res.found).toBe(false);
    expect(res.message).toContain("Available tools");
  });

  test("should register get_cpp_tooling_guide in createServer", () => {
    const server = createServer();
    expect(server).toBeDefined();
  });

  test("should run CLI tooling command for xmake overview, topic, and category", async () => {
    const codeOverview = await runCli(["tooling", "xmake"]);
    expect(codeOverview).toBe(0);

    const codeTopic = await runCli(["tooling", "xmake", "cxx-modules"]);
    expect(codeTopic).toBe(0);

    const codeCat = await runCli(["tooling", "xmake", "toolchains"]);
    expect(codeCat).toBe(0);

    const codeJson = await runCli(["tooling", "xmake", "cxx-modules", "--json"]);
    expect(codeJson).toBe(0);
  });
});
