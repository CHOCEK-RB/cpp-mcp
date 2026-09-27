import { describe, expect, it } from "bun:test";
import { createServer } from "../src/index.js";

describe("MCP Resources & Prompts", () => {
  const server = createServer();

  it("should have native resources registered in server", () => {
    // @ts-expect-error accessing private property for test verification
    const resources = server._registeredResources;
    expect(resources["cppref://headers"]).toBeDefined();
    expect(resources["cppref://standards"]).toBeDefined();

    // @ts-expect-error accessing private property for test verification
    const templates = server._registeredResourceTemplates;
    expect(templates.cpp_standard_header_detail).toBeDefined();
  });

  it("should return complete headers index for cppref://headers", async () => {
    // @ts-expect-error accessing private property for test verification
    const handler = server._registeredResources["cppref://headers"].readCallback;
    const result = await handler(new URL("cppref://headers"));
    expect(result.contents).toHaveLength(1);
    expect(result.contents[0].uri).toBe("cppref://headers");

    const parsed = JSON.parse(result.contents[0].text);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.length).toBeGreaterThan(50);
  });

  it("should return detailed specification for cppref://headers/vector", async () => {
    // @ts-expect-error accessing private property for test verification
    const handler = server._registeredResourceTemplates.cpp_standard_header_detail.readCallback;
    const result = await handler(new URL("cppref://headers/vector"), { name: "vector" });
    expect(result.contents).toHaveLength(1);

    const parsed = JSON.parse(result.contents[0].text);
    expect(parsed.header).toBe("<vector>");
    expect(parsed.standard).toBe("C++");
    expect(parsed.category).toBe("Sequence containers");
    expect(parsed.symbols).toContain("std::vector");
  });

  it("should return error message for unknown header template request", async () => {
    // @ts-expect-error accessing private property for test verification
    const handler = server._registeredResourceTemplates.cpp_standard_header_detail.readCallback;
    const result = await handler(new URL("cppref://headers/nonexistent"), { name: "nonexistent" });
    const parsed = JSON.parse(result.contents[0].text);
    expect(parsed.error).toContain("is not recognized");
  });

  it("should return standards timeline for cppref://standards", async () => {
    // @ts-expect-error accessing private property for test verification
    const handler = server._registeredResources["cppref://standards"].readCallback;
    const result = await handler(new URL("cppref://standards"));
    const parsed = JSON.parse(result.contents[0].text);

    expect(parsed.cppStandards).toContain("C++20");
    expect(parsed.cStandards).toContain("C11");
    expect(parsed.featureTestMacros["std::span"]).toBeDefined();
  });

  it("should have native prompts registered in server", () => {
    // @ts-expect-error accessing private property for test verification
    const prompts = server._registeredPrompts;
    expect(prompts.cpp_explain_symbol).toBeDefined();
    expect(prompts.cpp_modernize_code).toBeDefined();
    expect(prompts.cpp_diagnose_compiler_error).toBeDefined();
  });

  it("should generate structured messages for cpp_explain_symbol", async () => {
    // @ts-expect-error accessing private property for test verification
    const handler = server._registeredPrompts.cpp_explain_symbol.callback;
    const result = await handler({ symbol: "std::ranges::views::filter", standard: "C++20" });

    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].role).toBe("user");
    expect(result.messages[0].content.text).toContain("std::ranges::views::filter");
    expect(result.messages[0].content.text).toContain("C++20");
    expect(result.messages[0].content.text).toContain("Header Requirement");
  });

  it("should generate modernization prompt for cpp_modernize_code", async () => {
    // @ts-expect-error accessing private property for test verification
    const handler = server._registeredPrompts.cpp_modernize_code.callback;
    const legacyCode = "char* str = (char*)malloc(10); printf(str); free(str);";
    const result = await handler({ code: legacyCode, targetStandard: "C++23" });

    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].content.text).toContain(legacyCode);
    expect(result.messages[0].content.text).toContain("C++23");
    expect(result.messages[0].content.text).toContain("RAII");
  });

  it("should generate diagnostic prompt for cpp_diagnose_compiler_error", async () => {
    // @ts-expect-error accessing private property for test verification
    const handler = server._registeredPrompts.cpp_diagnose_compiler_error.callback;
    const result = await handler({
      symbol: "std::println",
      errorMessage: "error: 'println' is not a member of 'std'",
      compiler: "GCC 13",
    });

    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].content.text).toContain("std::println");
    expect(result.messages[0].content.text).toContain("GCC 13");
    expect(result.messages[0].content.text).toContain("Root Cause");
  });

  it("should return complete guidelines index for cppref://guidelines", async () => {
    // @ts-expect-error accessing private property for test verification
    const handler = server._registeredResources["cppref://guidelines"].readCallback;
    const result = await handler(new URL("cppref://guidelines"));
    expect(result.contents).toHaveLength(1);
    const parsed = JSON.parse(result.contents[0].text);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.length).toBeGreaterThan(500);
  });

  it("should return detailed rule for cppref://guidelines/F.16", async () => {
    // @ts-expect-error accessing private property for test verification
    const handler = server._registeredResourceTemplates.cpp_core_guideline_detail.readCallback;
    const result = await handler(new URL("cppref://guidelines/F.16"), { id: "F.16" });
    expect(result.contents).toHaveLength(1);
    const parsed = JSON.parse(result.contents[0].text);
    expect(parsed.id).toBe("F.16");
    expect(parsed.title).toContain("in");
    expect(parsed.section).toBe("F: Functions");
  });

  it("should return error for unknown guideline id", async () => {
    // @ts-expect-error accessing private property for test verification
    const handler = server._registeredResourceTemplates.cpp_core_guideline_detail.readCallback;
    const result = await handler(new URL("cppref://guidelines/NONEXISTENT"), { id: "NONEXISTENT" });
    const parsed = JSON.parse(result.contents[0].text);
    expect(parsed.error).toContain("not found");
  });

  it("should generate audit prompt for cpp_audit_guidelines", async () => {
    // @ts-expect-error accessing private property for test verification
    const handler = server._registeredPrompts.cpp_audit_guidelines.callback;
    const code = "void func(int* ptr) { delete ptr; }";
    const result = await handler({ code, focus: "resource-management" });

    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].content.text).toContain(code);
    expect(result.messages[0].content.text).toContain("resource-management");
    expect(result.messages[0].content.text).toContain("Core Guidelines");
  });

  it("should return complete modules catalog for cppref://modules", async () => {
    // @ts-expect-error accessing private property for test verification
    const handler = server._registeredResources["cppref://modules"].readCallback;
    const result = await handler(new URL("cppref://modules"));
    expect(result.contents).toHaveLength(1);
    const parsed = JSON.parse(result.contents[0].text);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.length).toBeGreaterThanOrEqual(9);
  });

  it("should return detailed specification for cppref://modules/import-std", async () => {
    // @ts-expect-error accessing private property for test verification
    const handler = server._registeredResourceTemplates.cpp_modules_topic_detail.readCallback;
    const result = await handler(new URL("cppref://modules/import-std"), { topic: "import-std" });
    expect(result.contents).toHaveLength(1);
    const parsed = JSON.parse(result.contents[0].text);
    expect(parsed.id).toBe("import-std");
    expect(parsed.standard).toBe("C++23");
    expect(parsed.content).toContain("import std;");
  });

  it("should generate modularization prompt for cpp_modularize_code", async () => {
    // @ts-expect-error accessing private property for test verification
    const handler = server._registeredPrompts.cpp_modularize_code.callback;
    const code = "class Calculator { public: int add(int a, int b); };";
    const result = await handler({
      code,
      moduleName: "math.calc",
      targetStandard: "C++23",
    });

    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].content.text).toContain("math.calc");
    expect(result.messages[0].content.text).toContain("import std;");
    expect(result.messages[0].content.text).toContain("FILE_SET CXX_MODULES");
  });

  it("should return complete CERT catalog for cppref://cert", async () => {
    // @ts-expect-error accessing private property for test verification
    const handler = server._registeredResources["cppref://cert"].readCallback;
    const result = await handler(new URL("cppref://cert"));
    expect(result.contents).toHaveLength(1);
    const parsed = JSON.parse(result.contents[0].text);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.length).toBeGreaterThanOrEqual(20);
  });

  it("should return detailed rule for cppref://cert/MEM50-CPP", async () => {
    // @ts-expect-error accessing private property for test verification
    const handler = server._registeredResourceTemplates.cpp_cert_rule_detail.readCallback;
    const result = await handler(new URL("cppref://cert/MEM50-CPP"), { id: "MEM50-CPP" });
    expect(result.contents).toHaveLength(1);
    const parsed = JSON.parse(result.contents[0].text);
    expect(parsed.id).toBe("MEM50-CPP");
    expect(parsed.cwe).toBe("CWE-416");
    expect(parsed.vulnerability).toBe("Use-After-Free");
  });

  it("should generate security audit prompt for cpp_security_audit", async () => {
    // @ts-expect-error accessing private property for test verification
    const handler = server._registeredPrompts.cpp_security_audit.callback;
    const code = "int* p = new int; delete p; *p = 10;";
    const result = await handler({
      code,
      category: "MEM",
    });

    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].content.text).toContain("SEI CERT C++");
    expect(result.messages[0].content.text).toContain("CWE");
    expect(result.messages[0].content.text).toContain("category MEM");

    const strResult = await handler({
      code: "char buf[10]; std::cin >> buf;",
      category: "STR",
    });
    expect(strResult.messages[0].content.text).toContain("category STR");
  });

  it("should return complete tooling catalog for cppref://tooling", async () => {
    // @ts-expect-error accessing private property for test verification
    const handler = server._registeredResources["cppref://tooling"].readCallback;
    const result = await handler(new URL("cppref://tooling"));
    expect(result.contents).toHaveLength(1);
    const parsed = JSON.parse(result.contents[0].text);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.length).toBeGreaterThanOrEqual(4);
  });

  it("should return detailed guide for cppref://tooling/xmake", async () => {
    // @ts-expect-error accessing private property for test verification
    const handler = server._registeredResourceTemplates.cpp_tooling_detail.readCallback;
    const result = await handler(new URL("cppref://tooling/xmake"), { tool: "xmake" });
    expect(result.contents).toHaveLength(1);
    const parsed = JSON.parse(result.contents[0].text);
    expect(parsed.id).toBe("xmake");
    expect(parsed.configFileName).toBe("xmake.lua");
    expect(parsed.sampleConfig).toContain("c++23");
  });

  it("should generate tooling configuration prompt for cpp_generate_tooling_config", async () => {
    // @ts-expect-error accessing private property for test verification
    const handler = server._registeredPrompts.cpp_generate_tooling_config.callback;
    const result = await handler({
      tool: "xmake",
      standard: "C++23",
      projectType: "modular",
    });

    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].content.text).toContain("xmake");
    expect(result.messages[0].content.text).toContain("C++23");
    expect(result.messages[0].content.text).toContain("modular");
  });

  it("should return complete compiler support catalog for cppref://compiler-support", async () => {
    // @ts-expect-error accessing private property for test verification
    const handler = server._registeredResources["cppref://compiler-support"].readCallback;
    const result = await handler(new URL("cppref://compiler-support"));
    expect(result.contents).toHaveLength(1);
    const parsed = JSON.parse(result.contents[0].text);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.length).toBeGreaterThanOrEqual(10);
  });

  it("should return detailed feature info for cppref://compiler-support/std-print", async () => {
    // @ts-expect-error accessing private property for test verification
    const handler = server._registeredResourceTemplates.cpp_compiler_support_detail.readCallback;
    const result = await handler(new URL("cppref://compiler-support/std-print"), {
      feature: "std-print",
    });
    expect(result.contents).toHaveLength(1);
    const parsed = JSON.parse(result.contents[0].text);
    expect(parsed.id).toBe("std-print");
    expect(parsed.compilers.gcc).toBe("13");
    expect(parsed.compilers.clang).toBe("17");
  });

  it("should generate compiler compatibility prompt for cpp_check_compiler_compatibility", async () => {
    // @ts-expect-error accessing private property for test verification
    const handler = server._registeredPrompts.cpp_check_compiler_compatibility.callback;
    const result = await handler({
      features: "std::print, std::expected",
      compiler: "gcc",
      version: "12.2",
    });

    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].content.text).toContain("gcc 12.2");
    expect(result.messages[0].content.text).toContain("std::print, std::expected");
    expect(result.messages[0].content.text).toContain("Polyfills & Fallbacks");
  });
});
