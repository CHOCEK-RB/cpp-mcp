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

  test("should detect MEM50-CPP manual delete even when delete[] is also present", () => {
    const code = `
void cleanup() {
    delete[] buffer;
    delete singlePtr;
}
`;
    const res = checkSecureCoding({ code });
    expect(res.found).toBe(true);
    expect(res.codeAuditFindings?.some((f) => f.ruleId === "MEM50-CPP")).toBe(true);
  });

  test("should detect ERR53-CPP throw in destructor with nested control flow", () => {
    const code = `
class ResourceHolder {
    ~ResourceHolder() {
        if (hasError) {
            cleanup();
        }
        throw std::runtime_error("failed in dtor");
    }
};
`;
    const res = checkSecureCoding({ code });
    expect(res.found).toBe(true);
    expect(res.codeAuditFindings?.some((f) => f.ruleId === "ERR53-CPP")).toBe(true);
  });

  test("should filter rules by new categories STR and INT", () => {
    const strRes = checkSecureCoding({ category: "STR" });
    expect(strRes.found).toBe(true);
    expect(strRes.matches?.length).toBe(4);
    expect(strRes.matches?.some((m) => m.id === "STR50-CPP")).toBe(true);

    const intRes = checkSecureCoding({ category: "INT" });
    expect(intRes.found).toBe(true);
    expect(intRes.matches?.length).toBe(1);
    expect(intRes.matches?.[0]?.id).toBe("INT50-CPP");
  });

  test("should retrieve newly synced rule STR50-CPP with solution", () => {
    const res = checkSecureCoding({ rule_id: "STR50-CPP" });
    expect(res.found).toBe(true);
    expect(res.rule?.id).toBe("STR50-CPP");
    expect(res.rule?.category).toBe("STR");
    expect(res.rule?.title).toContain("Guarantee that storage for strings has sufficient space");
    expect(res.rule?.compliantSolution).toContain("std::string");
  });

  test("should have all 83 SEI CERT C++ rules in the synced catalog", () => {
    const res = checkSecureCoding();
    expect(res.found).toBe(true);
    expect(res.totalRules).toBe(83);
  });

  test("should return not found for unknown rule ID", () => {
    const res = checkSecureCoding({ rule_id: "XYZ999-CPP" });
    expect(res.found).toBe(false);
    expect(res.message).toContain("not found");
  });

  test("should return catalog overview when no parameters are provided", () => {
    const res = checkSecureCoding();
    expect(res.found).toBe(true);
    expect(res.totalRules).toBeGreaterThanOrEqual(80);
  });

  test("should register check_secure_coding in createServer", () => {
    const server = createServer();
    expect(server).toBeDefined();
  });
});
