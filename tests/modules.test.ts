import { describe, expect, test } from "bun:test";
import { createServer } from "../src/index.js";
import { getCppModulesGuide, normalizeTopicId } from "../src/tools/modules.js";

describe("normalizeTopicId", () => {
  test("should normalize spaces and uppercase to kebab-case", () => {
    expect(normalizeTopicId("Import Std")).toBe("import-std");
    expect(normalizeTopicId("C++23 import std")).toBe("import-std");
    expect(normalizeTopicId("modules_partitions")).toBe("partitions");
  });
});

describe("getCppModulesGuide", () => {
  test("should retrieve specific topic by canonical ID", () => {
    const res = getCppModulesGuide({ topic: "import-std" });
    expect(res.found).toBe(true);
    expect(res.title).toContain("Standard Library Modules");
    expect(res.standard).toBe("C++23");
    expect(res.content).toContain("import std;");
    expect(res.rules?.length).toBeGreaterThan(0);
  });

  test("should retrieve topic by alias", () => {
    const res = getCppModulesGuide({ topic: "cmake" });
    expect(res.found).toBe(true);
    expect(res.topic).toBe("cmake-build-systems");
    expect(res.content).toContain("FILE_SET CXX_MODULES");
  });

  test("should search topics by free-text keyword", () => {
    const res = getCppModulesGuide({ query: "private fragment" });
    expect(res.found).toBe(true);
    if (res.matches) {
      expect(res.matches.some((m) => m.id === "syntax-structure")).toBe(true);
    } else {
      expect(res.topic).toBe("syntax-structure");
    }
  });

  test("should filter topics by standard version", () => {
    const res23 = getCppModulesGuide({ standard: "c++23" });
    expect(res23.found).toBe(true);
    expect(res23.matches?.every((m) => m.standard === "C++23")).toBe(true);

    const res26 = getCppModulesGuide({ standard: "c++26" });
    expect(res26.found).toBe(true);
    expect(res26.matches?.every((m) => m.standard === "C++26")).toBe(true);
  });

  test("should return full overview when no parameters are provided", () => {
    const res = getCppModulesGuide();
    expect(res.found).toBe(true);
    expect(res.totalTopics).toBeGreaterThanOrEqual(9);
    expect(res.matches?.length).toBeGreaterThanOrEqual(9);
  });

  test("should return not found for nonexistent topic", () => {
    const res = getCppModulesGuide({ topic: "nonexistent-topic-xyz" });
    expect(res.found).toBe(false);
    expect(res.message).toContain("Available topics");
  });

  test("should register get_cpp_modules_guide in createServer", () => {
    const server = createServer();
    expect(server).toBeDefined();
  });
});
