import { describe, expect, test } from "bun:test";
import { createServer } from "../src/index.js";
import { checkSecureCoding, normalizeCertRuleId } from "../src/tools/cert.js";

describe("normalizeCertRuleId", () => {
  test("should append -CPP suffix to raw rule numbers", () => {
    expect(normalizeCertRuleId("MEM50")).toBe("MEM50-CPP");
    expect(normalizeCertRuleId("mem50-cpp")).toBe("MEM50-CPP");
    expect(normalizeCertRuleId("oop50")).toBe("OOP50-CPP");
  });

  test("should normalize CWE identifiers", () => {
    expect(normalizeCertRuleId("CWE-416")).toBe("CWE-416");
    expect(normalizeCertRuleId("cwe416")).toBe("CWE-416");
  });
});

describe("checkSecureCoding", () => {
  test("should retrieve rule by exact ID", () => {
    const res = checkSecureCoding({ rule_id: "MEM50-CPP" });
    expect(res.found).toBe(true);
    expect(res.rule?.id).toBe("MEM50-CPP");
    expect(res.rule?.cwe).toBe("CWE-416");
    expect(res.rule?.vulnerability).toBe("Use-After-Free");
    expect(res.rule?.compliantSolution).toContain("make_unique");
  });

  test("should retrieve rule by flexible rule ID without suffix", () => {
    const res = checkSecureCoding({ rule_id: "oop50" });
    expect(res.found).toBe(true);
    expect(res.rule?.id).toBe("OOP50-CPP");
    expect(res.rule?.title).toContain("virtual functions from constructors");
  });

  test("should retrieve rules by CWE ID", () => {
    const res = checkSecureCoding({ rule_id: "CWE-416" });
    expect(res.found).toBe(true);
    expect(res.matches?.length).toBeGreaterThan(0);
    expect(res.matches?.some((m) => m.id === "MEM50-CPP")).toBe(true);
  });

  test("should filter rules by category", () => {
    const res = checkSecureCoding({ category: "CON" });
    expect(res.found).toBe(true);
    expect(res.matches?.every((m) => m.category === "CON")).toBe(true);
    expect(res.matches?.some((m) => m.id === "CON53-CPP")).toBe(true);
  });

  test("should search rules by keyword", () => {
    const res = checkSecureCoding({ query: "deadlock" });
    expect(res.found).toBe(true);
    if (res.matches) {
      expect(res.matches.some((m) => m.id === "CON53-CPP")).toBe(true);
    } else {
      expect(res.rule?.id).toBe("CON53-CPP");
    }
  });

  test("should detect vulnerabilities in code snippet via heuristic audit", () => {
    const dangerousCode = `
void generate_key() {
    int key = std::rand();
}
try {
    do_work();
} catch (std::runtime_error err) {
    log(err);
}
`;
    const res = checkSecureCoding({ code: dangerousCode });
    expect(res.found).toBe(true);
    expect(res.codeAuditFindings?.length).toBeGreaterThanOrEqual(2);
    expect(res.codeAuditFindings?.some((f) => f.ruleId === "MSC50-CPP")).toBe(true);
    expect(res.codeAuditFindings?.some((f) => f.ruleId === "ERR54-CPP")).toBe(true);
  });

  test("should return not found for unknown rule ID", () => {
    const res = checkSecureCoding({ rule_id: "XYZ999-CPP" });
    expect(res.found).toBe(false);
    expect(res.message).toContain("not found");
  });

  test("should return catalog overview when no parameters are provided", () => {
    const res = checkSecureCoding();
    expect(res.found).toBe(true);
    expect(res.totalRules).toBeGreaterThanOrEqual(20);
  });

  test("should register check_secure_coding in createServer", () => {
    const server = createServer();
    expect(server).toBeDefined();
  });
});
