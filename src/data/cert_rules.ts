// src/data/cert_rules.ts
// Structured SEI CERT C++ Coding Standard rules.
import rawRules from "./cert_rules.json" with { type: "json" };

export type CertCategory = "MEM" | "EXP" | "CTR" | "ERR" | "CON" | "OOP" | "MSC" | "DCL" | "FIO";

export interface CertRule {
  id: string;
  category: CertCategory;
  title: string;
  severity: "High" | "Medium" | "Low";
  likelihood: "Likely" | "Probable" | "Unlikely";
  remediationCost: "High" | "Medium" | "Low";
  cwe: string;
  vulnerability: string;
  summary: string;
  noncompliantCode: string;
  compliantSolution: string;
}

export const CERT_RULES: CertRule[] = rawRules as CertRule[];

export const CERT_RULE_BY_ID = new Map<string, CertRule>();
export const CERT_RULES_BY_CATEGORY = new Map<string, CertRule[]>();
export const CERT_RULES_BY_CWE = new Map<string, CertRule[]>();

for (const rule of CERT_RULES) {
  CERT_RULE_BY_ID.set(rule.id.toUpperCase(), rule);

  const catList = CERT_RULES_BY_CATEGORY.get(rule.category) || [];
  catList.push(rule);
  CERT_RULES_BY_CATEGORY.set(rule.category, catList);

  const cweList = CERT_RULES_BY_CWE.get(rule.cwe.toUpperCase()) || [];
  cweList.push(rule);
  CERT_RULES_BY_CWE.set(rule.cwe.toUpperCase(), cweList);
}
