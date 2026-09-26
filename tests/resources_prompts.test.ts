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
});
