import { describe, expect, it } from "bun:test";
import { createServer } from "../src/index.js";
import { getGuideline, normalizeRuleId } from "../src/tools/guidelines.js";

describe("normalizeRuleId", () => {
  it("should normalize lowercase rule IDs with dot", () => {
    expect(normalizeRuleId("f.16")).toBe("F.16");
    expect(normalizeRuleId("r.1")).toBe("R.1");
    expect(normalizeRuleId("c.21")).toBe("C.21");
    expect(normalizeRuleId("es.20")).toBe("ES.20");
  });

  it("should normalize rule IDs missing the dot", () => {
    expect(normalizeRuleId("f16")).toBe("F.16");
    expect(normalizeRuleId("r1")).toBe("R.1");
    expect(normalizeRuleId("c21")).toBe("C.21");
    expect(normalizeRuleId("es20")).toBe("ES.20");
  });

  it("should strip leading hash tags", () => {
    expect(normalizeRuleId("#F.16")).toBe("F.16");
    expect(normalizeRuleId("#c21")).toBe("C.21");
  });

  it("should handle Enum and Introduction prefixes", () => {
    expect(normalizeRuleId("enum.1")).toBe("ENUM.1");
    expect(normalizeRuleId("in.0")).toBe("IN.0");
  });
});

describe("getGuideline", () => {
  it("should retrieve rule F.16 by exact ruleId", () => {
    const res = getGuideline({ ruleId: "F.16" });
    expect(res.found).toBe(true);
    expect(res.rule).toBeDefined();
    expect(res.rule?.id).toBe("F.16");
    expect(res.rule?.title).toContain("in");
    expect(res.rule?.section).toBe("F: Functions");
    expect(res.rule?.url).toContain("#");
    expect(res.rule?.content).toContain("Reason");
  });

  it("should retrieve rule R.1 by flexible ruleId (r1)", () => {
    const res = getGuideline({ ruleId: "r1" });
    expect(res.found).toBe(true);
    expect(res.rule?.id).toBe("R.1");
    expect(res.rule?.title).toContain("RAII");
    expect(res.rule?.section).toBe("R: Resource management");
  });

  it("should retrieve rule C.21 (rule of five) by ruleId", () => {
    const res = getGuideline({ ruleId: "C.21" });
    expect(res.found).toBe(true);
    expect(res.rule?.id).toBe("C.21");
    expect(res.rule?.content).toContain("rule of five");
  });

  it("should return not found for non-existent rule ID", () => {
    const res = getGuideline({ ruleId: "ZZ.999" });
    expect(res.found).toBe(false);
    expect(res.totalMatches).toBe(0);
    expect(res.message).toContain("not found");
  });

  it("should search rules by keyword (RAII)", () => {
    const res = getGuideline({ query: "RAII" });
    expect(res.found).toBe(true);
    expect(res.totalMatches).toBeGreaterThan(0);
    const ruleIds = res.rules?.map((r) => r.id) ?? (res.rule ? [res.rule.id] : []);
    expect(ruleIds).toContain("R.1");
  });

  it("should search rules by concept (ownership)", () => {
    const res = getGuideline({ query: "ownership" });
    expect(res.found).toBe(true);
    expect(res.totalMatches).toBeGreaterThan(0);
    const hasMatch =
      res.rules?.some(
        (r) =>
          r.title.toLowerCase().includes("ownership") ||
          r.reason?.toLowerCase().includes("ownership"),
      ) ?? Boolean(res.rule);
    expect(hasMatch).toBe(true);
  });

  it("should filter search by section", () => {
    const res = getGuideline({ query: "parameter", section: "Functions" });
    expect(res.found).toBe(true);
    expect(res.rules).toBeDefined();
    for (const r of res.rules ?? []) {
      expect(r.section.toLowerCase()).toContain("functions");
    }
  });

  it("should return section overview when no ruleId or query is provided", () => {
    const res = getGuideline({});
    expect(res.found).toBe(true);
    expect(res.availableSections).toBeDefined();
    expect(res.availableSections?.length).toBeGreaterThan(5);
    expect(res.totalMatches).toBeGreaterThan(500);
  });
});

describe("McpServer get_guideline registration", () => {
  it("should register get_guideline tool in createServer", () => {
    const server = createServer();
    // @ts-expect-error accessing private property for test inspection
    const tools = server._registeredTools;
    expect(tools).toHaveProperty("get_guideline");
  });
});
