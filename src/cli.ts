// src/cli.ts
// Direct CLI mode for cpp-mcp without an MCP client.
import pkg from "../package.json" with { type: "json" };
import { checkSecureCoding } from "./tools/cert.js";
import { type CompilerName, checkCompilerSupport } from "./tools/compiler-support.js";
import { demangleSymbol } from "./tools/demangle.js";
import { getGuideline } from "./tools/guidelines.js";
import { lookupHeader } from "./tools/header.js";
import { getCppModulesGuide } from "./tools/modules.js";
import { searchCppreference } from "./tools/search.js";
import { checkCppStandard } from "./tools/standards.js";
import { getCppToolingGuide } from "./tools/tooling.js";

export function printHelp(): void {
  console.log(`cpp-mcp v${pkg.version} - Fast offline C/C++ reference and developer tools

Usage:
  cpp-mcp [command] [arguments] [options]
  cpp-mcp <symbol>                  # Fast header lookup (e.g. cpp-mcp std::span)

Commands:
  header <symbol>                   Lookup standard header for a symbol (e.g. std::span -> <span>)
  query <symbol|concept>            Comprehensive lookup across headers and documentation
  search <query>                    Search cppreference.com for documentation and URLs
  compiler <feature> [options]      Check compiler support matrix (GCC, Clang, MSVC, Apple Clang)
  demangle <symbol|->               Demangle Itanium or MSVC mangled symbols (or stdin)
  cert <rule_id|cwe|category>       Audit against SEI CERT C++ rules and CWEs
  guideline <rule_id|query>         Lookup C++ Core Guidelines rules and enforcement
  standard <version>                Inspect C or C++ standard features and test macros
  module <topic>                    Inspect C++20/23/26 modules architecture guides
  tooling <tool>                    Inspect modern C++ tooling starter recipes (xmake, etc.)

Options:
  --json                            Output response in raw JSON format
  --raw                             Print only primary scalar value (e.g. only header name)
  --compiler <name>                 Compiler name for compatibility checks (gcc, clang, msvc, apple_clang)
  --version <ver>                   Compiler version to evaluate against feature requirement
  -v, --version                     Print version and exit
  -h, --help                        Print this help message and exit

When executed without arguments, cpp-mcp runs as an MCP stdio server.`);
}

async function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    let data = "";
    process.stdin.setEncoding("utf-8");
    process.stdin.on("data", (chunk) => {
      data += chunk;
    });
    process.stdin.on("end", () => {
      resolve(data);
    });
  });
}

export async function runCli(args: string[]): Promise<number> {
  if (args.length === 0 || args[0] === "-h" || args[0] === "--help" || args[0] === "help") {
    printHelp();
    return 0;
  }

  if (args[0] === "-v" || args[0] === "--version" || args[0] === "version") {
    console.log(`cpp-mcp v${pkg.version}`);
    return 0;
  }

  const isJson = args.includes("--json");
  const isRaw = args.includes("--raw");

  // Filter out known flags to extract command and positional arguments
  const positionalArgs: string[] = [];
  let flagCompiler: string | undefined;
  let flagVersion: string | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (!arg || arg === "--json" || arg === "--raw") {
      continue;
    }
    if (arg === "--compiler" && i + 1 < args.length) {
      flagCompiler = args[++i];
      continue;
    }
    if (arg === "--version" && i + 1 < args.length) {
      flagVersion = args[++i];
      continue;
    }
    if (!arg.startsWith("-")) {
      positionalArgs.push(arg);
    }
  }

  const command = positionalArgs[0]?.toLowerCase() || "";
  const target = positionalArgs.slice(1).join(" ").trim();

  try {
    switch (command) {
      case "header": {
        if (!target) {
          console.error(
            "Error: 'header' command requires a symbol argument (e.g. 'cpp-mcp header std::span')",
          );
          return 1;
        }
        const res = await lookupHeader(target);
        if (isJson) {
          console.log(JSON.stringify(res, null, 2));
          return res.found ? 0 : 1;
        }
        if (!res.found || !res.header) {
          console.error(`Header for symbol '${target}' not found.`);
          return 1;
        }
        if (isRaw) {
          console.log(res.header);
        } else {
          const sinceInfo = res.since ? ` (${res.since})` : "";
          console.log(`${res.header}${sinceInfo}`);
        }
        return 0;
      }

      case "query": {
        const queryTerm = target;
        if (!queryTerm) {
          console.error(
            "Error: 'query' command requires an argument (e.g. 'cpp-mcp query std::span')",
          );
          return 1;
        }
        const headerRes = await lookupHeader(queryTerm);
        if (isJson) {
          console.log(JSON.stringify(headerRes, null, 2));
          return headerRes.found ? 0 : 1;
        }
        if (headerRes.found) {
          console.log(`Symbol:   ${headerRes.matchedSymbol || queryTerm}`);
          console.log(`Header:   ${headerRes.header}`);
          if (headerRes.since) console.log(`Standard: ${headerRes.since}`);
          if (headerRes.category) console.log(`Category: ${headerRes.category}`);
          if (headerRes.cEquivalent) console.log(`C Header: ${headerRes.cEquivalent}`);
          return 0;
        }

        // Fallback to cppreference search
        const searchRes = await searchCppreference(queryTerm);
        if (searchRes.result_urls.length > 0) {
          console.log(
            `No direct static header found. Top documentation matches for '${queryTerm}':`,
          );
          for (const url of searchRes.result_urls.slice(0, 3)) {
            console.log(`- ${url}`);
          }
          return 0;
        }

        console.error(`No documentation or header found for '${queryTerm}'.`);
        return 1;
      }

      case "demangle": {
        let symbolToDemangle = target;
        if (target === "-" || (!target && !process.stdin.isTTY)) {
          symbolToDemangle = await readStdin();
        }
        if (!symbolToDemangle.trim()) {
          console.error("Error: 'demangle' command requires a mangled symbol or piped input.");
          return 1;
        }
        const res = demangleSymbol({ symbol: symbolToDemangle });
        if (isJson) {
          console.log(JSON.stringify(res, null, 2));
          return 0;
        }
        console.log(res.demangled);
        return 0;
      }

      case "compiler": {
        if (!target) {
          console.error(
            "Error: 'compiler' command requires a feature name (e.g. 'cpp-mcp compiler constexpr')",
          );
          return 1;
        }
        const res = checkCompilerSupport({
          feature: target,
          compiler: flagCompiler as CompilerName | undefined,
          version: flagVersion,
        });
        if (isJson) {
          console.log(JSON.stringify(res, null, 2));
          return res.found ? 0 : 1;
        }
        if (!res.found || !res.entry) {
          console.error(`Compiler support feature '${target}' not found.`);
          return 1;
        }
        const f = res.entry;
        console.log(`Feature:     ${f.name} (${f.standard})`);
        if (f.notes) console.log(`Description: ${f.notes}`);
        console.log(`GCC:         ${f.compilers.gcc}`);
        console.log(`Clang:       ${f.compilers.clang}`);
        console.log(`MSVC:        ${f.compilers.msvc}`);
        console.log(`Apple Clang: ${f.compilers.apple_clang}`);
        if (f.paper) console.log(`Paper:       ${f.paper}`);
        if (f.macro) console.log(`Macro:       ${f.macro}`);
        if (res.compatibility) {
          const c = res.compatibility;
          console.log(`\nCompatibility check for ${c.compiler} ${c.userVersion}:`);
          console.log(
            `Result:      ${c.compatible ? "COMPATIBLE ✓" : "INCOMPATIBLE ✗"} (Min required: ${c.minVersion})`,
          );
        }
        return 0;
      }

      case "cert": {
        if (!target) {
          console.error(
            "Error: 'cert' command requires a rule ID, CWE, or category (e.g. 'cpp-mcp cert MEM50-CPP')",
          );
          return 1;
        }
        const res = checkSecureCoding({ rule_id: target, query: target });
        if (isJson) {
          console.log(JSON.stringify(res, null, 2));
          return res.found ? 0 : 1;
        }
        if (!res.found) {
          console.error(`SEI CERT rule or query '${target}' not found.`);
          return 1;
        }
        if (res.rule) {
          const r = res.rule;
          console.log(`[${r.id}] ${r.title}`);
          console.log(
            `Category:      ${r.category} | Severity: ${r.severity} | Likelihood: ${r.likelihood}`,
          );
          console.log(`CWE:           ${r.cwe}`);
          console.log(`Vulnerability: ${r.vulnerability}`);
          if (r.url) console.log(`URL:           ${r.url}`);
          console.log(`\nSummary:\n${r.summary}`);
          console.log(`\nCompliant Solution:\n${r.compliantSolution}`);
          return 0;
        }
        if (res.matches && res.matches.length > 0) {
          console.log(`Found ${res.matches.length} matching CERT rules:`);
          for (const m of res.matches.slice(0, 5)) {
            console.log(`- ${m.id}: ${m.title} (${m.severity}, ${m.cwe})`);
          }
          return 0;
        }
        return 0;
      }

      case "guideline": {
        if (!target) {
          console.error(
            "Error: 'guideline' command requires a rule ID or query (e.g. 'cpp-mcp guideline F.16')",
          );
          return 1;
        }
        const res = getGuideline({ ruleId: target, query: target });
        if (isJson) {
          console.log(JSON.stringify(res, null, 2));
          return res.found ? 0 : 1;
        }
        if (!res.found) {
          console.error(`C++ Core Guideline '${target}' not found.`);
          return 1;
        }
        if (res.rule) {
          const r = res.rule;
          console.log(`[${r.id}] ${r.title}`);
          console.log(`Section: ${r.section}`);
          console.log(`URL:     ${r.url}`);
          if (r.reason) console.log(`\nReason:\n${r.reason}`);
          if (r.enforcement) console.log(`\nEnforcement:\n${r.enforcement}`);
          return 0;
        }
        if (res.rules && res.rules.length > 0) {
          console.log(`Found ${res.rules.length} matching Core Guidelines:`);
          for (const m of res.rules.slice(0, 5)) {
            console.log(`- ${m.id}: ${m.title}`);
          }
          return 0;
        }
        return 0;
      }

      case "standard": {
        if (!target) {
          console.error(
            "Error: 'standard' command requires a symbol and optional target standard (e.g. 'cpp-mcp standard std::span C++20')",
          );
          return 1;
        }
        const parts = target.split(/\s+/);
        const symbol = parts[0] ?? "";
        const targetStd = parts[1];
        const res = await checkCppStandard(symbol, targetStd);
        if (isJson) {
          console.log(JSON.stringify(res, null, 2));
          return res.status !== "not_found" ? 0 : 1;
        }
        if (res.status === "not_found") {
          console.error(`Standard information for symbol '${symbol}' not found.`);
          return 1;
        }
        console.log(`Symbol:   ${res.symbol} (${res.standard})`);
        console.log(`Since:    ${res.since}`);
        console.log(
          `Status:   ${res.status}${res.targetStandard ? ` (Target: ${res.targetStandard})` : ""}`,
        );
        if (res.deprecatedIn) console.log(`Deprecated: ${res.deprecatedIn}`);
        if (res.removedIn) console.log(`Removed:    ${res.removedIn}`);
        if (res.featureTestMacro) {
          console.log(`Macro:    ${res.featureTestMacro.macro} = ${res.featureTestMacro.value}`);
        }
        console.log(`Summary:  ${res.summary}`);
        return 0;
      }

      case "module": {
        const res = getCppModulesGuide({ topic: target || undefined, query: target || undefined });
        if (isJson) {
          console.log(JSON.stringify(res, null, 2));
          return res.found ? 0 : 1;
        }
        if (!res.found) {
          console.error(`Module guide topic '${target}' not found.`);
          return 1;
        }
        if (res.title) {
          console.log(`[Module Topic: ${res.title}]`);
          console.log(`Summary: ${res.summary}`);
          if (res.rules && res.rules.length > 0) {
            console.log(`\nKey Rules:\n${res.rules.map((b) => `- ${b}`).join("\n")}`);
          }
          if (res.content) {
            console.log(`\n${res.content}`);
          }
          return 0;
        }
        if (res.matches && res.matches.length > 0) {
          console.log("C++ Modules Topics:");
          for (const t of res.matches) {
            console.log(`- ${t.id}: ${t.title}`);
          }
          return 0;
        }
        return 0;
      }

      case "tooling": {
        const res = getCppToolingGuide({ tool: target || undefined });
        if (isJson) {
          console.log(JSON.stringify(res, null, 2));
          return res.found ? 0 : 1;
        }
        if (!res.found) {
          console.error(`Tooling guide '${target}' not found.`);
          return 1;
        }
        if (res.tool) {
          console.log(`Tool: ${res.tool}`);
          if (res.content) console.log(`\n${res.content}`);
          if (res.commands && res.commands.length > 0) {
            console.log(`\nCommon Commands:`);
            for (const c of res.commands.slice(0, 6)) {
              console.log(`- ${c.command}: ${c.description}`);
            }
          }
          return 0;
        }
        if (res.matches && res.matches.length > 0) {
          console.log(`Available tools: ${res.matches.map((m) => m.id).join(", ")}`);
          return 0;
        }
        return 0;
      }

      case "search": {
        if (!target) {
          console.error(
            "Error: 'search' command requires a query (e.g. 'cpp-mcp search std::vector')",
          );
          return 1;
        }
        const res = await searchCppreference(target);
        if (isJson) {
          console.log(JSON.stringify(res, null, 2));
          return res.result_urls.length > 0 ? 0 : 1;
        }
        if (res.result_urls.length === 0) {
          console.log(`No search results found for '${target}'.`);
          return 1;
        }
        console.log(`Found ${res.result_urls.length} results for '${target}':`);
        for (let i = 0; i < res.result_urls.length; i++) {
          console.log(`${i + 1}. ${res.result_urls[i]}`);
        }
        return 0;
      }

      default: {
        // Direct shorthand query: e.g. `cpp-mcp std::span`
        const queryTerm = positionalArgs.join(" ").trim();
        const headerRes = await lookupHeader(queryTerm);
        if (isJson) {
          console.log(JSON.stringify(headerRes, null, 2));
          return headerRes.found ? 0 : 1;
        }
        if (headerRes.found && headerRes.header) {
          if (isRaw) {
            console.log(headerRes.header);
          } else {
            const sinceInfo = headerRes.since ? ` (${headerRes.since})` : "";
            console.log(`${headerRes.header}${sinceInfo}`);
          }
          return 0;
        }

        console.error(`Unknown command or symbol '${command}'. Run 'cpp-mcp --help' for usage.`);
        return 1;
      }
    }
  } catch (error) {
    console.error(
      `Error executing command '${command}': ${error instanceof Error ? error.message : String(error)}`,
    );
    return 1;
  }
}
