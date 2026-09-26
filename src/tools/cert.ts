// src/tools/cert.ts
import {
  CERT_RULE_BY_ID,
  CERT_RULES,
  CERT_RULES_BY_CWE,
  type CertCategory,
  type CertRule,
} from "../data/cert_rules.js";

export interface CheckSecureCodingParams {
  rule_id?: string;
  category?: CertCategory;
  query?: string;
  code?: string;
}

export interface CheckSecureCodingResult {
  found: boolean;
  totalRules?: number;
  rule?: CertRule;
  matches?: Array<{
    id: string;
    category: string;
    title: string;
    severity: string;
    cwe: string;
    vulnerability: string;
    summary: string;
    matchedRules?: string[];
  }>;
  codeAuditFindings?: Array<{
    ruleId: string;
    cwe: string;
    severity: string;
    vulnerability: string;
    issue: string;
    recommendation: string;
  }>;
  message?: string;
}

export function normalizeCertRuleId(input: string): string {
  let trimmed = input.trim().toUpperCase();
  if (trimmed.startsWith("CWE-") || trimmed.startsWith("CWE")) {
    if (!trimmed.startsWith("CWE-")) {
      trimmed = `CWE-${trimmed.slice(3)}`;
    }
    return trimmed;
  }

  if (!trimmed.endsWith("-CPP")) {
    trimmed = `${trimmed}-CPP`;
  }
  return trimmed;
}

export function auditCodeSnippet(code: string): Array<{
  ruleId: string;
  cwe: string;
  severity: string;
  vulnerability: string;
  issue: string;
  recommendation: string;
}> {
  const findings: Array<{
    ruleId: string;
    cwe: string;
    severity: string;
    vulnerability: string;
    issue: string;
    recommendation: string;
  }> = [];

  // Pattern 1: std::rand() usage
  if (/\bstd::rand\s*\(/.test(code) || /\brand\s*\(/.test(code)) {
    findings.push({
      ruleId: "MSC50-CPP",
      cwe: "CWE-338",
      severity: "High",
      vulnerability: "Cryptographically Weak PRNG",
      issue: "Use of rand() produces predictable linear congruential sequences.",
      recommendation:
        "Replace with <random> engines (e.g. std::mt19937_64 seeded with std::random_device).",
    });
  }

  // Pattern 2: Catching exceptions by value
  if (/catch\s*\(\s*(?!const\b)[a-zA-Z0-9_:]+\s+[a-zA-Z0-9_]+\s*\)/.test(code)) {
    findings.push({
      ruleId: "ERR54-CPP",
      cwe: "CWE-391",
      severity: "Low",
      vulnerability: "Object Slicing on Exception",
      issue: "Exception caught by value instead of const reference.",
      recommendation:
        "Catch exceptions by const lvalue reference ('catch (const std::exception& ex)').",
    });
  }

  // Pattern 3: Manual delete or raw pointer deletion (including when delete[] is also present)
  const hasSingleDelete = /\bdelete\b/.test(code.replace(/delete\s*\[\s*\]/g, ""));
  if (hasSingleDelete) {
    findings.push({
      ruleId: "MEM50-CPP",
      cwe: "CWE-416",
      severity: "High",
      vulnerability: "Potential Use-After-Free / Manual Memory Management",
      issue: "Manual use of 'delete' operator exposes memory to use-after-free and leaks.",
      recommendation:
        "Adopt RAII smart pointers (std::unique_ptr, std::shared_ptr) instead of explicit delete.",
    });
  }

  // Pattern 4: Throw in destructor (supports nested inner blocks)
  const dtorMatch = code.match(/~[a-zA-Z0-9_]+\s*\([^)]*\)[^{]*\{/);
  if (dtorMatch && dtorMatch.index !== undefined) {
    const afterOpenBrace = code.slice(dtorMatch.index + dtorMatch[0].length);
    let depth = 1;
    let dtorBody = "";
    for (let i = 0; i < afterOpenBrace.length; i++) {
      const ch = afterOpenBrace[i];
      if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) {
          dtorBody = afterOpenBrace.slice(0, i);
          break;
        }
      }
    }
    if (depth > 0) dtorBody = afterOpenBrace;

    if (/\bthrow\b/.test(dtorBody)) {
      findings.push({
        ruleId: "ERR53-CPP",
        cwe: "CWE-398",
        severity: "High",
        vulnerability: "Immediate std::terminate during Stack Unwinding",
        issue: "Throwing an exception from inside a destructor.",
        recommendation:
          "Destructors must be noexcept. Catch and handle or suppress exceptions internally.",
      });
    }
  }

  // Pattern 5: Strict aliasing reinterpret_cast
  if (/reinterpret_cast\s*<\s*[^>]+[*&]/.test(code)) {
    findings.push({
      ruleId: "EXP55-CPP",
      cwe: "CWE-843",
      severity: "High",
      vulnerability: "Strict Aliasing / Type Confusion",
      issue: "Pointer type punning via reinterpret_cast violates strict aliasing.",
      recommendation: "Use std::bit_cast (C++20) or memcpy for type-safe byte reinterpretation.",
    });
  }

  return findings;
}

export function checkSecureCoding(params: CheckSecureCodingParams = {}): CheckSecureCodingResult {
  const { rule_id, category, query, code } = params;

  // Case 1: Code audit requested
  if (code?.trim()) {
    const findings = auditCodeSnippet(code);
    return {
      found: findings.length > 0,
      totalRules: findings.length,
      codeAuditFindings: findings,
      message:
        findings.length > 0
          ? `Detected ${findings.length} potential SEI CERT C++ security issue(s).`
          : "No immediate heuristic CERT security violations detected in snippet.",
    };
  }

  // Case 2: Specific rule_id or CWE lookup
  if (rule_id?.trim()) {
    const normalized = normalizeCertRuleId(rule_id);

    // Check by rule ID
    const rule = CERT_RULE_BY_ID.get(normalized);
    if (rule) {
      return {
        found: true,
        rule,
      };
    }

    // Check by CWE ID
    const cweRules = CERT_RULES_BY_CWE.get(normalized);
    if (cweRules && cweRules.length > 0) {
      return {
        found: true,
        totalRules: cweRules.length,
        matches: cweRules.map((r) => ({
          id: r.id,
          category: r.category,
          title: r.title,
          severity: r.severity,
          cwe: r.cwe,
          vulnerability: r.vulnerability,
          summary: r.summary,
        })),
      };
    }

    return {
      found: false,
      message: `SEI CERT rule or CWE '${rule_id}' (normalized '${normalized}') not found.`,
    };
  }

  // Case 3: Category filter or free-text keyword search
  if (category || query?.trim()) {
    const q = (query || "").trim().toLowerCase();
    const terms = q.split(/\s+/).filter(Boolean);
    const targetCat = category ? category.toUpperCase() : null;

    const scored: Array<{ rule: CertRule; score: number }> = [];

    for (const rule of CERT_RULES) {
      if (targetCat && rule.category !== targetCat) {
        continue;
      }

      if (terms.length === 0) {
        scored.push({ rule, score: 1 });
        continue;
      }

      let score = 0;
      if (rule.id.toLowerCase().includes(q)) score += 30;
      if (rule.cwe.toLowerCase().includes(q)) score += 25;
      if (rule.title.toLowerCase().includes(q)) score += 20;
      if (rule.vulnerability.toLowerCase().includes(q)) score += 20;
      if (rule.summary.toLowerCase().includes(q)) score += 10;

      for (const term of terms) {
        if (rule.id.toLowerCase().includes(term)) score += 8;
        if (rule.cwe.toLowerCase().includes(term)) score += 8;
        if (rule.title.toLowerCase().includes(term)) score += 6;
        if (rule.vulnerability.toLowerCase().includes(term)) score += 6;
        if (rule.summary.toLowerCase().includes(term)) score += 4;
        if (rule.noncompliantCode.toLowerCase().includes(term)) score += 2;
      }

      if (score > 0) {
        scored.push({ rule, score });
      }
    }

    scored.sort((a, b) => b.score - a.score);

    if (scored.length === 0) {
      return {
        found: false,
        message: `No SEI CERT rules found matching query '${query}'${category ? ` in category ${category}` : ""}.`,
      };
    }

    // If single exact match from search query, return full rule
    if (scored.length === 1 && scored[0] && q) {
      return {
        found: true,
        rule: scored[0].rule,
      };
    }

    return {
      found: true,
      totalRules: scored.length,
      matches: scored.slice(0, 5).map(({ rule }) => ({
        id: rule.id,
        category: rule.category,
        title: rule.title,
        severity: rule.severity,
        cwe: rule.cwe,
        vulnerability: rule.vulnerability,
        summary: rule.summary,
      })),
    };
  }

  // Case 4: Overview of all CERT categories
  return {
    found: true,
    totalRules: CERT_RULES.length,
    matches: CERT_RULES.slice(0, 10).map((r) => ({
      id: r.id,
      category: r.category,
      title: r.title,
      severity: r.severity,
      cwe: r.cwe,
      vulnerability: r.vulnerability,
      summary: r.summary,
    })),
    message:
      "Call check_secure_coding with rule_id='<ID>' or query='<keyword>' for in-depth vulnerability details, noncompliant code, and compliant solutions.",
  };
}
