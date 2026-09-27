#!/usr/bin/env bun
import { promises as fs } from "node:fs";
import path from "node:path";
import pkg from "../package.json" with { type: "json" };
import type { CertCategory, CertRule } from "../src/data/cert_rules.js";

const TREE_URL =
  "https://api.github.com/repos/cmu-sei/secure-coding-standards/git/trees/main?recursive=1";
const RAW_BASE_URL = "https://raw.githubusercontent.com/cmu-sei/secure-coding-standards/main";
const OUTPUT_JSON = path.resolve(import.meta.dir, "../src/data/cert_rules.json");

const KNOWN_VULNERABILITIES: Record<string, string> = {
  "STR50-CPP": "Buffer Overflow / Missing Null Terminator",
  "STR51-CPP": "Null Pointer Dereference via std::string Constructor",
  "STR52-CPP": "Dangling Reference / Iterator Invalidation in basic_string",
  "STR53-CPP": "Out-of-Bounds String Element Access",
  "CON51-CPP": "Deadlock via Unreleased Lock on Exception",
  "CON55-CPP": "Data Race / Thread Safety Invalidation",
  "CON56-CPP": "Thread Lifetime Violation / Detached Thread Safety",
  "CTR52-CPP": "Buffer Overflow in Container Library Operations",
  "CTR53-CPP": "Out-of-Bounds Iterator Range Access",
  "CTR54-CPP": "Subtracted Pointers from Distinct Containers",
  "CTR55-CPP": "Container Invalidation during Concurrent Modification",
  "DCL51-CPP": "Identifier Collision / Reserved Identifier Misuse",
  "DCL52-CPP": "Variable Declaration Shadowing / Ambiguity",
  "DCL53-CPP": "Header Inclusion Guard Omission",
  "DCL54-CPP": "Overloaded Comma or Logical Operator Confusion",
  "DCL55-CPP": "Bit-field Type Specification Undefined Behavior",
  "DCL56-CPP": "Object Slicing via Function Parameter Passing",
  "DCL57-CPP": "Catch Parameter Modification / Inadvertent Mutation",
  "DCL58-CPP": "Modification of Standard Namespace / UB",
  "DCL59-CPP": "Unnamed Namespace in Header File Leakage",
  "DCL60-CPP": "One-Definition Rule (ODR) Violation",
  "ERR51-CPP": "Unhandled Exception leading to std::terminate",
  "ERR52-CPP": "setjmp / longjmp Bypassing Destructors",
  "ERR55-CPP": "Honoring Exception Specifications Violation",
  "ERR56-CPP": "Guarantee Exception Safety in Destructors",
  "ERR57-CPP": "Do Not Leak Resources when Handling Exceptions",
  "ERR58-CPP": "Static Object Initialization Exception UB",
  "ERR59-CPP": "Cross-boundary Exception Propagation UB",
  "ERR60-CPP": "Exception Class Copy Constructor Throw UB",
  "ERR61-CPP": "Catch by Value Object Slicing",
  "ERR62-CPP": "Detect and Handle Errors from String Conversions",
  "EXP51-CPP": "Array Pointer Invalidation / Slice Dereference",
  "EXP52-CPP": "Unsequenced Side Effects Evaluation Order",
  "EXP56-CPP": "Calling Unrelated Member Function Pointer",
  "EXP57-CPP": "Deleting Incomplete Type / Destructor Omission",
  "EXP58-CPP": "Passing Non-POD / Non-Trivially Copyable Object to Ellipsis",
  "EXP59-CPP": "Overloading Relational Operators Inconsistently",
  "EXP60-CPP": "Passing Non-Standard-Layout Types to memset / memcpy",
  "FIO50-CPP": "Unformatted I/O Function Format Incompatibility",
  "FIO51-CPP": "File Position and State Desynchronization",
  "INT50-CPP": "Out-of-Range Enum Value Cast Undefined Behavior",
  "MEM52-CPP": "Unchecked Dynamic Memory Allocation Failure",
  "MEM53-CPP": "Explicit Constructor / Destructor Invocation Misuse",
  "MEM54-CPP": "Placement New Buffer Size and Alignment Misuse",
  "MEM55-CPP": "Honor Replacement Allocation Function Requirements",
  "MEM57-CPP": "Avoid Over-aligned Allocation Misalignment",
  "MSC51-CPP": "Cryptographically Weak Pseudo-Random Seed",
  "MSC53-CPP": "Do Not Return from Non-void Function Without Return Value",
  "MSC54-CPP": "Signal Handler Undefined Behavior",
  "OOP53-CPP": "Write Member Initializers in Declaration Order",
  "OOP54-CPP": "Gracefully Handle Self-Assignment in operator=",
  "OOP55-CPP": "Non-Virtual Base Class Destructor Resource Leak",
  "OOP56-CPP": "Honor Exception Safety in Assignment Operators",
  "OOP57-CPP": "Prefer Non-Member Non-Friend Functions to Member Functions",
  "OOP58-CPP": "Copy Operations Must Be Exception-Safe",
};

const KNOWN_CWES: Record<string, string> = {
  "STR50-CPP": "CWE-119, CWE-120",
  "STR51-CPP": "CWE-476",
  "STR52-CPP": "CWE-672",
  "STR53-CPP": "CWE-125, CWE-129",
  "CON51-CPP": "CWE-667, CWE-764",
  "CON55-CPP": "CWE-362",
  "CON56-CPP": "CWE-362, CWE-672",
  "CTR52-CPP": "CWE-120",
  "CTR53-CPP": "CWE-125, CWE-129",
  "CTR54-CPP": "CWE-469",
  "CTR55-CPP": "CWE-672",
  "DCL51-CPP": "CWE-758",
  "DCL52-CPP": "CWE-758",
  "DCL53-CPP": "CWE-758",
  "DCL54-CPP": "CWE-758",
  "DCL55-CPP": "CWE-682",
  "DCL56-CPP": "CWE-682",
  "DCL57-CPP": "CWE-758",
  "DCL58-CPP": "CWE-758",
  "DCL59-CPP": "CWE-758",
  "DCL60-CPP": "CWE-758",
  "ERR51-CPP": "CWE-391",
  "ERR52-CPP": "CWE-398",
  "ERR55-CPP": "CWE-398",
  "ERR56-CPP": "CWE-398",
  "ERR57-CPP": "CWE-404",
  "ERR58-CPP": "CWE-398",
  "ERR59-CPP": "CWE-398",
  "ERR60-CPP": "CWE-398",
  "ERR61-CPP": "CWE-391",
  "ERR62-CPP": "CWE-704",
  "EXP51-CPP": "CWE-672",
  "EXP52-CPP": "CWE-758",
  "EXP56-CPP": "CWE-758",
  "EXP57-CPP": "CWE-404",
  "EXP58-CPP": "CWE-134",
  "EXP59-CPP": "CWE-682",
  "EXP60-CPP": "CWE-682",
  "FIO50-CPP": "CWE-134",
  "FIO51-CPP": "CWE-758",
  "INT50-CPP": "CWE-682",
  "MEM52-CPP": "CWE-400",
  "MEM53-CPP": "CWE-758",
  "MEM54-CPP": "CWE-758",
  "MEM55-CPP": "CWE-758",
  "MEM57-CPP": "CWE-758",
  "MSC51-CPP": "CWE-338",
  "MSC53-CPP": "CWE-758",
  "MSC54-CPP": "CWE-758",
  "OOP53-CPP": "CWE-457",
  "OOP54-CPP": "CWE-758",
  "OOP55-CPP": "CWE-404",
  "OOP56-CPP": "CWE-398",
  "OOP57-CPP": "CWE-758",
  "OOP58-CPP": "CWE-398",
};

function cleanMarkdown(raw: string): string {
  return raw
    .replace(/<[^>]+>/g, "")
    .replace(/\\\[\s*\[[^\]]+\]\([^)]+\)\s*\\\]/g, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\u00A0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanCode(raw: string): string {
  return raw.replace(/\u00A0/g, " ").trim();
}

function extractCodeBlock(markdown: string, quality: "bad" | "good"): string | null {
  const taggedPattern = new RegExp(
    `::code-block\\{quality="${quality}"\\}[\\s\\S]*?\`\`\`\\s*(?:[a-zA-Z0-9_+-]+)?\\s*\\n([\\s\\S]*?)\`\`\``,
    "i",
  );
  const taggedMatch = markdown.match(taggedPattern);
  if (taggedMatch?.[1]) {
    return cleanCode(taggedMatch[1]);
  }

  const sectionPattern =
    quality === "bad"
      ? /##\s*Noncompliant[\s\S]*?```\s*(?:[a-zA-Z0-9_+-]+)?\s*\n([\s\S]*?)```/i
      : /##\s*Compliant[\s\S]*?```\s*(?:[a-zA-Z0-9_+-]+)?\s*\n([\s\S]*?)```/i;
  const sectionMatch = markdown.match(sectionPattern);
  if (sectionMatch?.[1]) {
    return cleanCode(sectionMatch[1]);
  }

  return null;
}

function extractRiskAssessment(markdown: string) {
  const rowMatch = markdown.match(
    /\|\s*[A-Z0-9]+-CPP\s*\|\s*([^|]+)\|\s*([^|]+)\|\s*([^|]+)\|\s*([^|]+)\|\s*([^|]+)\|\s*([^|]+)\|/i,
  );

  let severity: "High" | "Medium" | "Low" = "Medium";
  let likelihood: "Likely" | "Probable" | "Unlikely" = "Probable";
  let remediationCost: "High" | "Medium" | "Low" = "Medium";
  let priority = "P6";
  let level = "L2";

  if (rowMatch) {
    const rawSev = cleanMarkdown(rowMatch[1] ?? "").toLowerCase();
    if (rawSev.includes("high")) severity = "High";
    else if (rawSev.includes("low")) severity = "Low";
    else severity = "Medium";

    const rawLik = cleanMarkdown(rowMatch[2] ?? "").toLowerCase();
    if (rawLik.includes("likely")) likelihood = "Likely";
    else if (rawLik.includes("unlikely")) likelihood = "Unlikely";
    else likelihood = "Probable";

    const repairable = cleanMarkdown(rowMatch[4] ?? "").toLowerCase();
    remediationCost = repairable.includes("yes") ? "Low" : "Medium";

    const rawPri = cleanMarkdown(rowMatch[5] ?? "").toUpperCase();
    const priMatch = rawPri.match(/\b(P[0-9]+)\b/);
    if (priMatch?.[1]) priority = priMatch[1];

    const rawLvl = cleanMarkdown(rowMatch[6] ?? "").toUpperCase();
    const lvlMatch = rawLvl.match(/\b(L[1-3])\b/);
    if (lvlMatch?.[1]) level = lvlMatch[1];
  }

  return { severity, likelihood, remediationCost, priority, level };
}

function extractCwes(markdown: string): string[] {
  const matches = [...markdown.matchAll(/cwe[ -]?([0-9]+)/gi)].map((m) => `CWE-${m[1]}`);
  return Array.from(new Set(matches));
}

function extractSummary(markdown: string): string {
  const titleEndIdx = markdown.search(/^#\s+[A-Za-z0-9]+-CPP\./m);
  if (titleEndIdx === -1) return "";

  const afterTitle = markdown.slice(titleEndIdx);
  const firstNewline = afterTitle.indexOf("\n");
  if (firstNewline === -1) return "";

  const bodyStart = afterTitle.slice(firstNewline).trim();
  const nextSectionMatch = bodyStart.match(/\n(?:##|::code-block|Noncompliant)/);
  const rawSummary = nextSectionMatch
    ? bodyStart.slice(0, nextSectionMatch.index)
    : bodyStart.slice(0, 500);

  return cleanMarkdown(rawSummary);
}

async function fetchWithRetry(url: string, retries = 2, delayMs = 1000): Promise<string> {
  const userAgent = `cpp-mcp-sync/${pkg.version} (+https://github.com/CHOCEK-RB/cpp-mcp)`;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": userAgent },
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status} ${res.statusText}`);
      }
      return await res.text();
    } catch (err) {
      if (attempt === retries) throw err;
      await new Promise((r) => setTimeout(r, delayMs * (attempt + 1)));
    }
  }
  throw new Error(`Failed to fetch ${url}`);
}

export async function syncCertRules(): Promise<CertRule[]> {
  console.log(`Fetching SEI CERT repository tree from ${TREE_URL}...`);

  let treeData: { tree?: Array<{ path: string }> };
  try {
    const rawJson = await fetchWithRetry(TREE_URL);
    treeData = JSON.parse(rawJson);
  } catch (err) {
    console.warn(
      `Could not fetch latest SEI CERT tree: ${err instanceof Error ? err.message : String(err)}. Checking for local cache...`,
    );
    try {
      const existing = await fs.readFile(OUTPUT_JSON, "utf-8");
      return JSON.parse(existing) as CertRule[];
    } catch {
      throw new Error("No cached SEI CERT rules found and network request failed.");
    }
  }

  const ruleFiles = (treeData.tree || []).filter(
    (item) =>
      item.path.startsWith("content/5.sei-cert-cpp-coding-standard/3.rules/") &&
      item.path.endsWith(".md") &&
      !item.path.endsWith("index.md"),
  );

  console.log(`Found ${ruleFiles.length} SEI CERT C++ rule files in upstream repository.`);

  // Load existing curated rules for lossless merge
  const existingMap = new Map<string, CertRule>();
  try {
    const existingRaw = await fs.readFile(OUTPUT_JSON, "utf-8");
    const existingList = JSON.parse(existingRaw) as CertRule[];
    for (const r of existingList) {
      existingMap.set(r.id.toUpperCase(), r);
    }
  } catch {
    // No prior file
  }

  // Fetch and parse all rule files with concurrency pool
  const concurrency = 10;
  const parsedRules: CertRule[] = [];

  for (let i = 0; i < ruleFiles.length; i += concurrency) {
    const batch = ruleFiles.slice(i, i + concurrency);
    const batchResults = await Promise.all(
      batch.map(async (fileItem) => {
        const rawUrl = `${RAW_BASE_URL}/${fileItem.path}`;
        const markdown = await fetchWithRetry(rawUrl);

        const titleMatch = markdown.match(/^#\s+([A-Za-z0-9]+-CPP)\.\s+(.*)$/m);
        const filenameMatch = fileItem.path.match(/([a-z0-9]+-cpp)\.md$/i);

        const id = (titleMatch?.[1] || filenameMatch?.[1] || "").toUpperCase();
        const rawTitle = titleMatch?.[2]?.trim() || "";
        const title = cleanMarkdown(rawTitle);

        const rawCategory = id.slice(0, 3).toUpperCase() as CertCategory;
        const validCategories = new Set([
          "MEM",
          "EXP",
          "CTR",
          "ERR",
          "CON",
          "OOP",
          "MSC",
          "DCL",
          "FIO",
          "STR",
          "INT",
        ]);
        const category: CertCategory = validCategories.has(rawCategory) ? rawCategory : "MSC";

        const risk = extractRiskAssessment(markdown);
        const noncompliantCode = extractCodeBlock(markdown, "bad") || "";
        const compliantSolution = extractCodeBlock(markdown, "good") || "";
        const summary = extractSummary(markdown);
        const cwes = extractCwes(markdown);

        // Check curated overrides
        const curated = existingMap.get(id);

        const ruleCwe =
          curated?.cwe || (cwes.length > 0 ? cwes.join(", ") : KNOWN_CWES[id] || "N/A");

        const vulnerability =
          curated?.vulnerability || KNOWN_VULNERABILITIES[id] || `Violation of ${id} (${title})`;

        const ruleSummary = curated?.summary || summary || title;
        const ruleNoncompliant = curated?.noncompliantCode || noncompliantCode;
        const ruleCompliant = curated?.compliantSolution || compliantSolution;
        const url = `https://wiki.sei.cmu.edu/confluence/display/cplusplus/${id}`;

        const rule: CertRule = {
          id,
          category,
          title: curated?.title || title,
          severity: curated?.severity || risk.severity,
          likelihood: curated?.likelihood || risk.likelihood,
          remediationCost: curated?.remediationCost || risk.remediationCost,
          priority: risk.priority,
          level: risk.level,
          cwe: ruleCwe,
          vulnerability,
          summary: ruleSummary,
          noncompliantCode: ruleNoncompliant,
          compliantSolution: ruleCompliant,
          url,
        };

        return rule;
      }),
    );

    parsedRules.push(...batchResults);
    process.stdout.write(
      `  Processed ${Math.min(i + concurrency, ruleFiles.length)}/${ruleFiles.length} rules...\r`,
    );
  }
  console.log("");

  // Sort rules logically: category then ID
  parsedRules.sort((a, b) => {
    if (a.category !== b.category) {
      return a.category.localeCompare(b.category);
    }
    return a.id.localeCompare(b.id, undefined, { numeric: true });
  });

  await fs.mkdir(path.dirname(OUTPUT_JSON), { recursive: true });
  await fs.writeFile(OUTPUT_JSON, `${JSON.stringify(parsedRules, null, 2)}\n`, "utf-8");

  console.log(`✓ Synchronized ${parsedRules.length} SEI CERT C++ rules to:`);
  console.log(`  - ${OUTPUT_JSON}`);

  return parsedRules;
}

const isDirect =
  typeof process !== "undefined" && process.argv[1] && process.argv[1].endsWith("sync-cert.ts");

if (isDirect) {
  syncCertRules().catch((err) => {
    console.error("Failed to sync SEI CERT rules:", err);
    process.exit(1);
  });
}
