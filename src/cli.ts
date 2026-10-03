// src/cli.ts
// Direct CLI mode for cpp-mcp without an MCP client.
import pkg from "../package.json" with { type: "json" };
import { CLI_COMMAND_BY_NAME, type CliCommandName, renderHelp } from "./cli-registry.js";
import { isExecutableAvailable, resolveProjectBuildInfo } from "./project/xmake.js";
import { checkSecureCoding } from "./tools/cert.js";
import { isClangTidyPreset, runClangTidy } from "./tools/clang-tidy.js";
import { analyzeCodeSymbol } from "./tools/code-analyzer.js";
import { getCodeDiagnostics } from "./tools/code-diagnostics.js";
import { formatCode } from "./tools/code-formatter.js";
import { renameCodeSymbol } from "./tools/code-renamer.js";
import { searchCodeSymbols } from "./tools/code-search.js";
import { sessionManager } from "./tools/code-session-manager.js";
import {
  type BuildSystemName,
  generateCompilationDatabase,
  VALID_COMPILE_DB_SYSTEMS,
} from "./tools/compile-db.js";
import { type CompilerName, checkCompilerSupport } from "./tools/compiler-support.js";
import { demangleSymbol } from "./tools/demangle.js";
import { type DocFormat, generateDocumentation } from "./tools/doc-generator.js";
import { explainCompilerError } from "./tools/error-explainer.js";
import { reorderStructFields } from "./tools/field-reorderer.js";
import { getGuideline } from "./tools/guidelines.js";
import { lookupHeader } from "./tools/header.js";
import { checkModuleToolchain } from "./tools/module-toolchain.js";
import { getCppModulesGuide } from "./tools/modules.js";
import { tracePreprocessor } from "./tools/preprocessor-tracer.js";
import {
  type BuildSystem,
  type CppStandard,
  type PackageManager,
  type ProjectType,
  scaffoldProject,
  type TestFramework,
  VALID_BUILD_SYSTEMS,
  VALID_CPP_STANDARDS,
  VALID_PACKAGE_MANAGERS,
  VALID_PROJECT_TYPES,
  VALID_TEST_FRAMEWORKS,
} from "./tools/project-scaffold.js";
import { searchCppreference } from "./tools/search.js";
import { checkCppStandard } from "./tools/standards.js";
import { getCppToolingGuide } from "./tools/tooling.js";

export function printHelp(): void {
  console.log(renderHelp());
}

async function readStdin(timeoutMs?: number): Promise<string> {
  return new Promise((resolve) => {
    let data = "";
    let timer: ReturnType<typeof setTimeout> | undefined;

    const cleanup = () => {
      if (timer) clearTimeout(timer);
      process.stdin.off("data", onData);
      process.stdin.off("end", onEnd);
      process.stdin.off("error", onError);
    };

    const onData = (chunk: string | Buffer) => {
      data += chunk;
    };

    const onEnd = () => {
      cleanup();
      resolve(data);
    };

    const onError = () => {
      cleanup();
      resolve(data);
    };

    if (timeoutMs && timeoutMs > 0) {
      timer = setTimeout(() => {
        cleanup();
        resolve(data);
      }, timeoutMs);
    }

    process.stdin.setEncoding("utf-8");
    process.stdin.on("data", onData);
    process.stdin.on("end", onEnd);
    process.stdin.on("error", onError);

    if (process.stdin.readableEnded) {
      cleanup();
      resolve(data);
    }
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
  let flagWorkspace: string | undefined;
  let flagFile: string | undefined;
  let flagLine: number | undefined;
  let flagSeverity: string | undefined;
  let flagCode: string | undefined;
  let flagStyle: string | undefined;
  let flagLines: string | undefined;
  let flagPreset: string | undefined;
  let flagChecks: string | undefined;
  let flagCheckGate = false;
  let flagApply = false;
  let flagDir: string | undefined;
  let flagBuildSystem: string | undefined;
  let flagBuildDir: string | undefined;
  let flagNoRootLink = false;
  let flagProjectType: string | undefined;
  let flagCppStd: string | undefined;
  let flagTest: string | undefined;
  let flagPackageManager: string | undefined;
  let flagNoClang = false;
  let flagGit = false;
  let flagForce = false;
  let flagDryRun = false;
  let flagOutput: string | undefined;
  let flagFormat: string | undefined;
  let flagPublic = false;
  let flagDoxygen = false;
  let flagFieldsOrder: string | undefined;
  let flagCallbacks: string | undefined;
  let flagMaxEvents: number | undefined;
  let flagAllFiles = false;
  let flagIncludeEvents = false;
  const flagExtraArgs: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (!arg || arg === "--json" || arg === "--raw") {
      continue;
    }
    if (arg === "--public") {
      flagPublic = true;
      continue;
    }
    if (arg === "--doxygen") {
      flagDoxygen = true;
      continue;
    }
    if ((arg === "--output" || arg === "-o") && i + 1 < args.length) {
      flagOutput = args[++i];
      continue;
    }
    if (arg === "--format" && i + 1 < args.length) {
      flagFormat = args[++i];
      continue;
    }
    if (arg === "--apply") {
      flagApply = true;
      continue;
    }
    if (arg === "--dry-run") {
      flagDryRun = true;
      flagApply = false;
      continue;
    }
    if ((arg === "--order" || arg === "--fields-order") && i + 1 < args.length) {
      flagFieldsOrder = args[++i];
      continue;
    }
    if (arg === "--callbacks" && i + 1 < args.length) {
      flagCallbacks = args[++i];
      continue;
    }
    if (arg === "--max-events" && i + 1 < args.length) {
      flagMaxEvents = Number.parseInt(args[++i] ?? "0", 10);
      continue;
    }
    if (arg === "--include-events") {
      flagIncludeEvents = true;
      continue;
    }
    if (arg === "--all-files" || arg === "--no-user-files-only") {
      flagAllFiles = true;
      continue;
    }
    if (arg === "--extra-arg" && i + 1 < args.length) {
      const nextArg = args[++i];
      if (nextArg !== undefined) {
        flagExtraArgs.push(nextArg);
      }
      continue;
    }
    if (arg === "--git") {
      flagGit = true;
      continue;
    }
    if (arg === "--no-clang") {
      flagNoClang = true;
      continue;
    }
    if (arg === "--force" || arg === "--overwrite") {
      flagForce = true;
      continue;
    }
    if (arg === "--dir" && i + 1 < args.length) {
      flagDir = args[++i];
      continue;
    }
    if ((arg === "--build" || arg === "--build-system") && i + 1 < args.length) {
      flagBuildSystem = args[++i];
      continue;
    }
    if (arg === "--build-dir" && i + 1 < args.length) {
      flagBuildDir = args[++i];
      continue;
    }
    if (arg === "--no-root-link") {
      flagNoRootLink = true;
      continue;
    }
    if (arg === "--type" && i + 1 < args.length) {
      flagProjectType = args[++i];
      continue;
    }
    if (arg === "--std" && i + 1 < args.length) {
      flagCppStd = args[++i];
      continue;
    }
    if (arg === "--test" && i + 1 < args.length) {
      flagTest = args[++i];
      continue;
    }
    if ((arg === "--pm" || arg === "--package-manager") && i + 1 < args.length) {
      flagPackageManager = args[++i];
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
    if (arg === "--workspace" && i + 1 < args.length) {
      flagWorkspace = args[++i];
      continue;
    }
    if (arg === "--file" && i + 1 < args.length) {
      flagFile = args[++i];
      continue;
    }
    if (arg === "--line" && i + 1 < args.length) {
      flagLine = Number.parseInt(args[++i] ?? "0", 10);
      continue;
    }
    if (arg === "--severity" && i + 1 < args.length) {
      flagSeverity = args[++i];
      continue;
    }
    if (arg === "--code" && i + 1 < args.length) {
      flagCode = args[++i];
      continue;
    }
    if (arg === "--style" && i + 1 < args.length) {
      flagStyle = args[++i];
      continue;
    }
    if (arg === "--lines" && i + 1 < args.length) {
      flagLines = args[++i];
      continue;
    }
    if (arg === "--preset" && i + 1 < args.length) {
      flagPreset = args[++i];
      continue;
    }
    if (arg === "--checks" && i + 1 < args.length) {
      flagChecks = args[++i];
      continue;
    }
    if (arg === "--check") {
      flagCheckGate = true;
      continue;
    }
    if (!arg.startsWith("-")) {
      positionalArgs.push(arg);
    }
  }

  const command = positionalArgs[0]?.toLowerCase() || "";
  const target = positionalArgs.slice(1).join(" ").trim();

  try {
    const handlers: Record<CliCommandName, () => Promise<number> | number> = {
      header: async () => {
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
      },
      query: async () => {
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
      },
      demangle: async () => {
        let symbolToDemangle = target;
        if (target === "-" || (!target && !process.stdin.isTTY)) {
          symbolToDemangle = await readStdin();
        }
        if (!symbolToDemangle.trim()) {
          console.error("Error: 'demangle' command requires a mangled symbol or piped input.");
          return 1;
        }
        const res = await demangleSymbol({ symbol: symbolToDemangle });
        if (isJson) {
          console.log(JSON.stringify(res, null, 2));
          return 0;
        }
        console.log(res.demangled);
        return 0;
      },
      compiler: async () => {
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
      },
      cert: async () => {
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
      },
      guideline: async () => {
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
      },
      standard: async () => {
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
      },
      module: async () => {
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
      },
      "module-toolchain": async () => {
        const res = await checkModuleToolchain();

        if (isJson || isRaw) {
          console.log(JSON.stringify(res, null, 2));
          return 0;
        }

        const { host } = res;
        console.log("Host module toolchain:");
        console.log(
          `  clang++: ${host.clang.available ? (host.clang.version ?? "yes") : "not found"}`,
        );
        console.log(
          `  g++:     ${host.gcc.available ? `${host.gcc.version ?? "yes"}${host.gcc.stdModule ? " (std module)" : ""}` : "not found"}`,
        );
        console.log(`  libc++:  ${host.libcxx ? "present" : "missing"}`);
        console.log(
          `  clangd:  ${host.clangd.available ? (host.clangd.version ?? "yes") : "not found"}`,
        );
        console.log(`\nRecommended: ${res.recommended}`);
        for (const opt of res.options) {
          console.log(`  [${opt.viable ? "x" : " "}] ${opt.label} - ${opt.reason}`);
        }
        if (res.notes.length > 0) {
          console.log("\nNotes:");
          for (const note of res.notes) console.log(`- ${note}`);
        }
        return 0;
      },
      tooling: async () => {
        const parts = target ? target.split(/\s+/) : [];
        let toolArg: string | undefined;
        let topicArg: string | undefined;
        let categoryArg: string | undefined;

        if (parts.length > 0) {
          const first = parts[0]?.toLowerCase() || "";
          if (first === "xmake") {
            toolArg = "xmake";
            if (parts.length > 1) {
              const sub = parts.slice(1).join(" ");
              if (sub === "--list" || sub === "list" || sub === "skills") {
                categoryArg = undefined;
                topicArg = undefined;
              } else if (
                [
                  "ai",
                  "basics",
                  "cli",
                  "languages",
                  "ops",
                  "packages",
                  "packaging",
                  "performance",
                  "project-config",
                  "scripting",
                  "testing",
                  "toolchains",
                ].includes(sub)
              ) {
                categoryArg = sub;
              } else {
                topicArg = sub;
              }
            }
          } else {
            toolArg = parts[0];
            if (parts.length > 1) {
              topicArg = parts.slice(1).join(" ");
            }
          }
        }

        const res = getCppToolingGuide({
          tool: toolArg,
          topic: topicArg,
          category: categoryArg,
        });

        if (isJson) {
          console.log(JSON.stringify(res, null, 2));
          return res.found ? 0 : 1;
        }

        if (!res.found) {
          console.error(res.message || `Tooling guide '${target}' not found.`);
          return 1;
        }

        // Case A: Specific topic / official recipe found
        if (res.topic && res.content) {
          console.log(`[xmake recipe: ${res.topic}] ${res.title} (${res.category})`);
          if (res.description) console.log(`\n${res.description}`);
          console.log(`\n${res.content}`);
          return 0;
        }

        // Case B: Category listing
        if (res.category && res.skills) {
          console.log(
            `Official Xmake Recipes - Category: ${res.category} (${res.skills.length} recipes):`,
          );
          for (const s of res.skills) {
            console.log(`- ${s.id}: ${s.title}`);
          }
          console.log(`\nRun 'cpp-mcp tooling xmake <topic>' to view full recipe.`);
          return 0;
        }

        // Case C: Tool overview
        if (res.tool) {
          console.log(`Tool: ${res.title || res.tool}`);
          if (res.description) console.log(`Description: ${res.description}`);
          if (res.configFileName && res.configContent) {
            console.log(`\nStarter Config (${res.configFileName}):\n${res.configContent.trim()}`);
          }
          if (res.commands && res.commands.length > 0) {
            console.log(`\nCommon Commands:`);
            for (const c of res.commands.slice(0, 6)) {
              console.log(`- ${c.command}: ${c.description}`);
            }
          }
          if (res.categories && res.categories.length > 0) {
            console.log(
              `\nOfficial Xmake Skills (${res.skillsCount} recipes across ${res.categories.length} categories):`,
            );
            for (const cat of res.categories) {
              const sampleSkills = cat.skills
                .slice(0, 3)
                .map((s) => s.id)
                .join(", ");
              const more = cat.skills.length > 3 ? `, ... (+${cat.skills.length - 3})` : "";
              console.log(`- ${cat.category} (${cat.count}): ${sampleSkills}${more}`);
            }
            console.log(
              `\nRun 'cpp-mcp tooling xmake <topic>' (e.g. 'cxx-modules', 'cross-compilation', 'packages') to inspect full recipes.`,
            );
          }
          return 0;
        }

        if (res.matches && res.matches.length > 0) {
          console.log(`Available tools: ${res.matches.map((m) => m.id).join(", ")}`);
          return 0;
        }

        return 0;
      },
      search: async () => {
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
      },
      project: async () => {
        const ws = target || flagWorkspace || process.cwd();
        const info = await resolveProjectBuildInfo({ workspaceDir: ws });
        const [hasClangd, hasXmake] = await Promise.all([
          isExecutableAvailable("clangd"),
          isExecutableAvailable("xmake"),
        ]);
        const fullInfo = {
          ...info,
          toolchain: {
            clangd: hasClangd,
            xmake: hasXmake,
          },
        };

        if (isJson) {
          console.log(JSON.stringify(fullInfo, null, 2));
          return 0;
        }

        console.log("C/C++ Project Build Details:");
        console.log(`Build System:        ${fullInfo.buildSystem}`);
        console.log(`Root Directory:      ${fullInfo.rootDir}`);
        if (fullInfo.compileCommandsPath) {
          console.log(`Compilation DB:      ${fullInfo.compileCommandsPath}`);
        }
        if (fullInfo.entryCount !== undefined) {
          console.log(`Translation Units:   ${fullInfo.entryCount}`);
        }
        if (fullInfo.generated) {
          console.log("Auto-Generated:      yes (via xmake)");
        }
        console.log("Toolchain Status:");
        console.log(`  clangd:            ${hasClangd ? "available" : "not found in PATH"}`);
        console.log(`  xmake:             ${hasXmake ? "available" : "not found in PATH"}`);
        if (fullInfo.error) {
          console.log(`Note:                ${fullInfo.error}`);
        }
        return fullInfo.found ? 0 : 1;
      },
      "code-search": async () => {
        if (!target) {
          console.error(
            "Error: 'code-search' command requires a query (e.g. 'cpp-mcp code-search Calculator')",
          );
          return 1;
        }
        const res = await searchCodeSymbols({
          query: target,
          workspaceDir: flagWorkspace,
        });
        if (isJson) {
          console.log(JSON.stringify(res, null, 2));
          return res.found ? 0 : 1;
        }
        if (!res.found) {
          console.error(res.error || `No symbols found matching '${target}'.`);
          return 1;
        }
        if (isRaw) {
          for (const s of res.symbols) {
            console.log(`${s.name} ${s.file}:${s.line}`);
          }
          return 0;
        }
        console.log(`Found ${res.symbols.length} code symbols for '${target}':`);
        for (const s of res.symbols) {
          const container = s.container ? ` [${s.container}]` : "";
          console.log(`- ${s.name} (${s.kind})${container} -> ${s.file}:${s.line}`);
        }
        return 0;
      },
      "code-analyze": async () => {
        if (!target) {
          console.error(
            "Error: 'code-analyze' command requires a symbol name (e.g. 'cpp-mcp code-analyze Calculator::add')",
          );
          return 1;
        }
        const res = await analyzeCodeSymbol({
          symbol: target,
          workspaceDir: flagWorkspace,
          file: flagFile,
          line: flagLine,
        });
        if (isJson) {
          console.log(JSON.stringify(res, null, 2));
          return res.found ? 0 : 1;
        }
        if (!res.found) {
          console.error(res.error || `Symbol '${target}' not found in workspace.`);
          return 1;
        }
        if (isRaw) {
          console.log(res.signature || res.symbol);
          return 0;
        }
        console.log(`Symbol: ${res.symbol} (${res.kind || "symbol"})`);
        if (res.signature) console.log(`Signature: ${res.signature}`);
        if (res.declaration)
          console.log(`Declaration: ${res.declaration.file}:${res.declaration.line}`);
        if (res.definition)
          console.log(`Definition: ${res.definition.file}:${res.definition.line}`);
        if (res.members && res.members.length > 0) {
          console.log(`Members (${res.members.length}):`);
          for (const m of res.members.slice(0, 10)) {
            console.log(`  - ${m.name} (${m.kind}) [L${m.line}]`);
          }
        }
        if (res.callHierarchy?.incomingCalls?.length) {
          console.log("Incoming Calls:");
          for (const c of res.callHierarchy.incomingCalls.slice(0, 5)) {
            console.log(`  <- ${c.from.name} (${c.from.file}:${c.from.line})`);
          }
        }
        return 0;
      },
      "code-diagnostics": async () => {
        const targetFile = target || flagFile;
        const res = await getCodeDiagnostics({
          file: targetFile,
          code: flagCode,
          workspaceDir: flagWorkspace,
          severity: flagSeverity as "all" | "error" | "warning" | undefined,
        });

        if (isJson) {
          console.log(JSON.stringify(res, null, 2));
          return res.success ? (res.totalErrors > 0 ? 1 : 0) : 1;
        }

        if (!res.success) {
          console.error(res.error || "Failed to retrieve code diagnostics.");
          return 1;
        }

        if (res.totalErrors === 0 && res.totalWarnings === 0) {
          if (targetFile) {
            console.log(`✓ No errors or warnings found in ${targetFile}`);
          } else {
            console.log("✓ No errors or warnings found across tracked workspace files.");
          }
          return 0;
        }

        console.log(
          `Found ${res.totalErrors} error(s) and ${res.totalWarnings} warning(s) (workspace: ${res.workspaceDir}):\n`,
        );

        for (const fileSummary of res.files) {
          if (fileSummary.diagnostics.length === 0) continue;
          console.log(
            `File: ${fileSummary.file} (${fileSummary.errorCount} errors, ${fileSummary.warningCount} warnings)`,
          );
          for (const diag of fileSummary.diagnostics) {
            const sevTag =
              diag.severity === "error"
                ? "ERROR"
                : diag.severity === "warning"
                  ? "WARNING"
                  : "INFO";
            console.log(
              `  [${sevTag}] L${diag.line}:${diag.character} - ${diag.message} (${diag.source})`,
            );
            if (diag.snippet) {
              console.log(
                diag.snippet
                  .split("\n")
                  .map((l) => `    ${l}`)
                  .join("\n"),
              );
            }
          }
          console.log();
        }

        return res.totalErrors > 0 ? 1 : 0;
      },
      "code-rename": async () => {
        const symbolArg = positionalArgs[1];
        const newNameArg = positionalArgs[2];
        if (!symbolArg || !newNameArg) {
          console.error(
            "Error: 'code-rename' command requires a symbol and a new name (e.g. 'cpp-mcp code-rename Calculator::add sum')",
          );
          return 1;
        }

        const res = await renameCodeSymbol({
          symbol: symbolArg,
          newName: newNameArg,
          workspaceDir: flagWorkspace,
          file: flagFile,
          line: flagLine,
          dryRun: !flagApply,
        });

        if (isJson) {
          console.log(JSON.stringify(res, null, 2));
          return res.success ? 0 : 1;
        }

        if (!res.success) {
          console.error(res.error || `Failed to rename '${symbolArg}'.`);
          return 1;
        }

        const modeStr = res.dryRun ? "[DRY-RUN / PREVIEW]" : "[APPLIED]";
        console.log(
          `${modeStr} Renamed '${res.symbol}' to '${res.newName}' across ${res.affectedFiles.length} file(s) (${res.totalEdits} total edits):\n`,
        );

        for (const fileSummary of res.affectedFiles) {
          console.log(`File: ${fileSummary.file} (${fileSummary.editCount} edits)`);
          for (const edit of fileSummary.edits) {
            console.log(`  L${edit.line}:${edit.character} '${edit.oldText}' -> '${edit.newText}'`);
            if (edit.snippet) {
              console.log(
                edit.snippet
                  .split("\n")
                  .map((l) => `    ${l}`)
                  .join("\n"),
              );
            }
          }
          console.log();
        }

        if (res.dryRun) {
          console.log("Tip: Run with --apply to write changes to files on disk.");
        }
        return 0;
      },
      "code-format": async () => {
        let codeInput = flagCode;
        let fileInput = target || flagFile;

        // If target is "-" or piped stdin
        if (target === "-" || (!target && !flagCode && !flagFile && !process.stdin.isTTY)) {
          codeInput = await readStdin(target === "-" ? undefined : 50);
          fileInput = undefined;
        }

        if (!codeInput && !fileInput) {
          console.error(
            "Error: 'code-format' requires a file path, --code snippet, or piped stdin.",
          );
          return 1;
        }

        let range: { startLine: number; endLine: number } | undefined;
        if (flagLines) {
          const parts = flagLines.split(/[:-]/).map((n) => Number.parseInt(n, 10));
          const start = parts[0];
          const end = parts[1];
          if (
            parts.length !== 2 ||
            start === undefined ||
            end === undefined ||
            Number.isNaN(start) ||
            Number.isNaN(end)
          ) {
            console.error(
              `Error: Invalid --lines format '${flagLines}'. Expected '<start>:<end>' (e.g. --lines 5:20).`,
            );
            return 1;
          }
          if (start < 1 || end < 1 || start > end) {
            console.error(
              `Error: Invalid range '${flagLines}'. Start line must be >= 1 and <= end line.`,
            );
            return 1;
          }
          range = { startLine: start, endLine: end };
        }

        const res = await formatCode({
          code: codeInput,
          file: fileInput,
          workspace: flagWorkspace,
          style: flagStyle,
          apply: flagApply,
          range,
        });

        if (isJson) {
          console.log(JSON.stringify(res, null, 2));
          return res.formatted ? 0 : 1;
        }

        if (!res.formatted) {
          console.error(`Format error: ${res.error || "Unknown formatting error"}`);
          return 1;
        }

        if (isRaw) {
          if (res.formattedCode) process.stdout.write(res.formattedCode);
          return 0;
        }

        if (codeInput && !fileInput) {
          if (res.formattedCode) {
            console.log(res.formattedCode);
          }
          return 0;
        }

        if (res.applied) {
          console.log(`✓ Formatted and applied changes to '${res.file}'.`);
          if (res.diff) console.log(`\n${res.diff}`);
          return 0;
        }

        if (!res.changed) {
          console.log(`'${res.file}' is already well-formatted.`);
          return 0;
        }

        console.log(`Format Preview (Dry Run) for '${res.file}':\n`);
        if (res.diff) console.log(res.diff);
        console.log(`\nTip: Run with --apply to write formatting changes to disk.`);
        return 0;
      },
      "clang-tidy": async () => {
        const filesArg = positionalArgs.slice(1);
        if (!flagFile && filesArg.length === 0) {
          console.error(
            "Error: 'clang-tidy' requires at least one file (e.g. 'cpp-mcp clang-tidy src/main.cpp' or '--file src/main.cpp').",
          );
          return 1;
        }

        const preset = flagPreset ?? "modernize";
        if (!isClangTidyPreset(preset)) {
          console.error(
            `Error: Invalid preset '${preset}'. Supported: modernize, bugprone, performance, portability, cppcoreguidelines, cert, security, all.`,
          );
          return 1;
        }

        const res = await runClangTidy({
          file: flagFile ?? (filesArg.length === 1 ? filesArg[0] : undefined),
          files: flagFile ? undefined : filesArg,
          preset,
          checks: flagChecks,
          apply: flagApply,
          workspace: flagWorkspace,
          extraArgs: flagExtraArgs.length > 0 ? flagExtraArgs : undefined,
        });

        if (!res.success) {
          if (isJson) {
            console.log(JSON.stringify(res, null, 2));
          } else {
            console.error(`Error: ${res.error}`);
          }
          return 1;
        }

        if (isJson || isRaw) {
          console.log(JSON.stringify(res, null, 2));
        } else {
          console.log(
            `clang-tidy [${res.preset}] - ${res.files.length} file(s), checks: ${res.checks}`,
          );
          for (const d of res.diagnostics) {
            const check = d.check ? ` [${d.check}]` : "";
            console.log(`${d.file}:${d.line}:${d.column}: ${d.severity}: ${d.message}${check}`);
          }
          console.log(res.message ?? "");
        }

        if (flagCheckGate && res.totalWarnings + res.totalErrors > 0) {
          return 1;
        }
        return 0;
      },
      scaffold: async () => {
        const projectName = target || positionalArgs[1];
        if (!projectName) {
          console.error(
            "Error: 'scaffold' command requires a project name (e.g. 'cpp-mcp scaffold my_project').",
          );
          return 1;
        }

        if (flagBuildSystem && !VALID_BUILD_SYSTEMS.has(flagBuildSystem)) {
          console.error(
            `Error: Invalid build system '${flagBuildSystem}'. Supported: ${Array.from(VALID_BUILD_SYSTEMS).join(", ")}.`,
          );
          return 1;
        }
        if (flagProjectType && !VALID_PROJECT_TYPES.has(flagProjectType)) {
          console.error(
            `Error: Invalid project type '${flagProjectType}'. Supported: ${Array.from(VALID_PROJECT_TYPES).join(", ")}.`,
          );
          return 1;
        }
        if (flagCppStd && !VALID_CPP_STANDARDS.has(flagCppStd)) {
          console.error(
            `Error: Invalid C++ standard '${flagCppStd}'. Supported: ${Array.from(VALID_CPP_STANDARDS).join(", ")}.`,
          );
          return 1;
        }
        if (flagTest && !VALID_TEST_FRAMEWORKS.has(flagTest)) {
          console.error(
            `Error: Invalid test framework '${flagTest}'. Supported: ${Array.from(VALID_TEST_FRAMEWORKS).join(", ")}.`,
          );
          return 1;
        }
        if (flagPackageManager && !VALID_PACKAGE_MANAGERS.has(flagPackageManager)) {
          console.error(
            `Error: Invalid package manager '${flagPackageManager}'. Supported: ${Array.from(VALID_PACKAGE_MANAGERS).join(", ")}.`,
          );
          return 1;
        }

        const res = await scaffoldProject({
          projectName,
          targetDir: flagDir,
          buildSystem: flagBuildSystem as BuildSystem | undefined,
          projectType: flagProjectType as ProjectType | undefined,
          cppStandard: flagCppStd as CppStandard | undefined,
          testFramework: flagTest as TestFramework | undefined,
          packageManager: flagPackageManager as PackageManager | undefined,
          initClangTools: !flagNoClang,
          initGit: flagGit,
          dryRun: flagDryRun,
          overwrite: flagForce,
        });

        if (isJson) {
          console.log(JSON.stringify(res, null, 2));
          return res.success ? 0 : 1;
        }

        if (isRaw) {
          console.log(res.projectDir);
          return 0;
        }

        if (flagDryRun) {
          console.log(`Dry-run scaffold preview for '${res.projectName}':\n`);
          console.log(`Files to be created in ${res.projectDir}:`);
          for (const f of res.filesCreated) {
            console.log(`  - ${f}`);
          }
          return 0;
        }

        console.log(`✓ Scaffolded C++ project '${res.projectName}' successfully!`);
        console.log(`  Location:       ${res.projectDir}`);
        console.log(`  Build System:   ${res.buildSystem}`);
        console.log(`  Standard:       C++${res.cppStandard}`);
        console.log(`  Type:           ${res.projectType}`);
        console.log(`  Test Framework: ${res.testFramework}`);
        if (res.gitInitialized) {
          console.log(`  Git:            Initialized`);
        }
        console.log(`\nCreated ${res.filesCreated.length} file(s):`);
        for (const f of res.filesCreated) {
          console.log(`  + ${f}`);
        }
        console.log(`\nNext steps:`);
        for (const step of res.nextSteps) {
          console.log(`  $ ${step}`);
        }
        return 0;
      },
      "explain-error": async () => {
        let errorToExplain = target;
        if (target === "-" || (!target && !process.stdin.isTTY)) {
          errorToExplain = await readStdin(target === "-" ? undefined : 50);
        }

        if (!errorToExplain?.trim()) {
          console.error(
            "Error: 'explain-error' command requires compiler error text or piped stdin (e.g. 'cat build.log | cpp-mcp explain-error -').",
          );
          return 1;
        }

        const res = await explainCompilerError({
          error: errorToExplain,
          compiler: flagCompiler as "gcc" | "clang" | "msvc" | "auto" | undefined,
          codeSnippet: flagCode,
          workspaceDir: flagWorkspace,
        });

        if (isJson) {
          console.log(JSON.stringify(res, null, 2));
          return res.success ? 0 : 1;
        }

        if (isRaw) {
          console.log(res.summary);
          return 0;
        }

        console.log(
          `Diagnostic Analysis (${res.detectedCompiler.toUpperCase()} | ${res.category}):`,
        );
        if (res.location) {
          const locStr = `${res.location.file}${res.location.line ? `:${res.location.line}` : ""}${res.location.column ? `:${res.location.column}` : ""}`;
          console.log(`Location:     ${locStr}`);
        }
        if (res.codeSnippet) {
          console.log(`\nCode Context:\n${res.codeSnippet}`);
        }
        console.log(`Summary:      ${res.summary}`);
        console.log(`\nRoot Cause:\n${res.rootCause}`);
        console.log(`\nRemediation:\n${res.remediation}`);

        if (res.suggestedHeaders && res.suggestedHeaders.length > 0) {
          console.log(`\nSuggested Headers:`);
          for (const h of res.suggestedHeaders) {
            console.log(`  #include ${h}`);
          }
        }

        if (res.demangledSymbols && res.demangledSymbols.length > 0) {
          console.log(`\nDemangled Symbols:`);
          for (const s of res.demangledSymbols) {
            console.log(`  ${s.mangled} -> ${s.demangled}`);
          }
        }

        if (res.pitfalls && res.pitfalls.length > 0) {
          console.log(`\nCommon Pitfalls:`);
          for (const p of res.pitfalls) {
            console.log(`  - ${p}`);
          }
        }

        return 0;
      },
      docs: async () => {
        const VALID_FORMATS = new Set(["md", "html", "json", "yaml"]);
        if (flagFormat && !VALID_FORMATS.has(flagFormat)) {
          console.error(
            `Error: Invalid format '${flagFormat}'. Supported formats: ${Array.from(VALID_FORMATS).join(", ")}.`,
          );
          return 1;
        }

        const filesToDoc = positionalArgs.slice(1);
        const res = await generateDocumentation({
          workspace: flagWorkspace,
          files: filesToDoc.length > 0 ? filesToDoc : undefined,
          outputDir: flagOutput,
          format: flagFormat as DocFormat | undefined,
          publicOnly: flagPublic,
          doxygenOnly: flagDoxygen,
          dryRun: flagDryRun,
        });

        if (isJson) {
          console.log(JSON.stringify(res, null, 2));
          return res.success ? 0 : 1;
        }

        if (isRaw) {
          console.log(res.outputDir);
          return res.success ? 0 : 1;
        }

        if (!res.success) {
          console.error(`Error: ${res.summary}`);
          if (res.error) {
            console.error(`\n${res.error}`);
          }
          return 1;
        }

        console.log(`Documentation Generated (${res.tool}):`);
        console.log(`Format:       ${res.format.toUpperCase()}`);
        console.log(`Output Dir:   ${res.outputDir}`);
        console.log(`Total Files:  ${res.totalFiles} generated`);
        if (res.filesGenerated.length > 0) {
          console.log("\nGenerated Files:");
          for (const f of res.filesGenerated.slice(0, 10)) {
            console.log(`  + ${f.relativePath} (${f.sizeBytes} bytes)`);
          }
          if (res.filesGenerated.length > 10) {
            console.log(`  ... and ${res.filesGenerated.length - 10} more files`);
          }
        }
        if (res.previewMarkdown) {
          console.log("\nDocumentation Preview (index.md):");
          console.log(res.previewMarkdown);
        }
        return 0;
      },
      "compile-db": async () => {
        if (flagBuildSystem && !VALID_COMPILE_DB_SYSTEMS.has(flagBuildSystem)) {
          console.error(
            `Error: Invalid --build-system '${flagBuildSystem}'. Supported: ${Array.from(VALID_COMPILE_DB_SYSTEMS).join(", ")}.`,
          );
          return 1;
        }

        const workspaceTarget = positionalArgs[1] || flagWorkspace || target || process.cwd();
        const res = await generateCompilationDatabase({
          workspace: workspaceTarget,
          buildSystem: flagBuildSystem as BuildSystemName | undefined,
          buildDir: flagBuildDir,
          compiler: flagCompiler,
          std: flagCppStd,
          symlinkToRoot: !flagNoRootLink,
          dryRun: flagDryRun,
        });

        if (isJson) {
          console.log(JSON.stringify(res, null, 2));
          return res.success ? 0 : 1;
        }

        if (isRaw) {
          console.log(res.compileCommandsPath || "");
          return res.success ? 0 : 1;
        }

        if (!res.success) {
          console.error(`Error: ${res.summary}`);
          if (res.error) {
            console.error(`\n${res.error}`);
          }
          return 1;
        }

        console.log("Compilation Database Generated:");
        console.log(`Build System: ${res.buildSystem.toUpperCase()}`);
        console.log(`Path:         ${res.compileCommandsPath}`);
        console.log(`Total Units:  ${res.entryCount} compilation unit(s)`);
        if (res.rootLinked) {
          console.log("Root Link:    Copied/linked to workspace root");
        }
        if (res.filesIndexed.length > 0) {
          console.log("\nIndexed Files:");
          for (const f of res.filesIndexed.slice(0, 10)) {
            console.log(`  + ${f}`);
          }
          if (res.filesIndexed.length > 10) {
            console.log(`  ... and ${res.filesIndexed.length - 10} more files`);
          }
        }
        return 0;
      },
      "reorder-fields": async () => {
        const recordArg = positionalArgs[1];
        if (!recordArg) {
          console.error(
            "Error: 'reorder-fields' command requires a struct or class name (e.g. 'cpp-mcp reorder-fields Foo z,w,y,x')",
          );
          return 1;
        }

        let orderList: string[] = [];
        if (flagFieldsOrder) {
          orderList = flagFieldsOrder
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean);
        } else if (positionalArgs.length > 2) {
          const rest = positionalArgs.slice(2);
          if (rest.length === 1 && rest[0]?.includes(",")) {
            orderList = rest[0]
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean);
          } else {
            orderList = rest.map((s) => s.trim()).filter(Boolean);
          }
        }

        if (orderList.length < 2) {
          console.error(
            "Error: 'reorder-fields' requires at least 2 fields in order (e.g. 'cpp-mcp reorder-fields Foo z,w,y,x')",
          );
          return 1;
        }

        const filesToTarget = flagFile ? [flagFile] : undefined;
        const res = await reorderStructFields({
          recordName: recordArg,
          fieldsOrder: orderList,
          workspace: flagWorkspace,
          files: filesToTarget,
          extraArgs: flagExtraArgs.length > 0 ? flagExtraArgs : undefined,
          apply: flagApply,
        });

        if (isJson) {
          console.log(JSON.stringify(res, null, 2));
          return res.success ? 0 : 1;
        }

        if (!res.success) {
          console.error(`Error: ${res.summary}`);
          if (res.error) {
            console.error(`\n${res.error}`);
          }
          return 1;
        }

        const modeStr = res.dryRun ? "[DRY-RUN / PREVIEW]" : "[APPLIED]";
        console.log(
          `${modeStr} Reordered fields in '${res.recordName}' (${res.fieldsOrder.join(", ")}) across ${res.modifiedFiles.length} file(s):\n`,
        );

        for (const fileChange of res.changes) {
          console.log(`File: ${fileChange.file}`);
          if (fileChange.diff) {
            console.log(
              fileChange.diff
                .split("\n")
                .map((l) => `  ${l}`)
                .join("\n"),
            );
          }
          console.log();
        }

        if (res.warnings && res.warnings.length > 0) {
          console.log("\nWarnings:");
          for (const w of res.warnings) {
            console.log(`  ! ${w}`);
          }
        }

        if (res.dryRun) {
          console.log("Tip: Run with --apply to write changes to files on disk.");
        }
        return 0;
      },
      "trace-preprocessor": async () => {
        const traceFile = positionalArgs[1] ?? flagFile;
        if (!traceFile) {
          console.error(
            "Error: 'trace-preprocessor' command requires a source file (e.g. 'cpp-mcp trace-preprocessor main.cpp')",
          );
          return 1;
        }

        const callbacks = flagCallbacks
          ? flagCallbacks
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean)
          : undefined;

        const traceExtraArgs = [...flagExtraArgs];
        if (flagCppStd) {
          const std = flagCppStd.startsWith("-")
            ? flagCppStd
            : flagCppStd.startsWith("c++")
              ? `-std=${flagCppStd}`
              : `-std=c++${flagCppStd}`;
          traceExtraArgs.push(std);
        }

        const res = await tracePreprocessor({
          file: traceFile,
          workspace: flagWorkspace,
          callbacks,
          extraArgs: traceExtraArgs.length > 0 ? traceExtraArgs : undefined,
          maxEvents: flagMaxEvents,
          includeEvents: flagIncludeEvents,
          userFilesOnly: !flagAllFiles,
        });

        if (isJson) {
          console.log(JSON.stringify(res, null, 2));
          return res.success ? 0 : 1;
        }

        if (!res.success) {
          console.error(`Error: ${res.error ?? "Failed to trace preprocessor."}`);
          for (const w of res.warnings) {
            console.error(`  ! ${w}`);
          }
          return 1;
        }

        const versionStr = res.tool.version ? ` ${res.tool.version}` : "";
        console.log(`Preprocessor trace for ${res.source} (pp-trace${versionStr}):\n`);
        console.log(
          `Events: ${res.summary.totalEvents} parsed, ${res.summary.userEvents} from project code${
            res.summary.truncated ? " (truncated)" : ""
          }`,
        );

        const countEntries = Object.entries(res.summary.counts).sort((a, b) => b[1] - a[1]);
        if (countEntries.length > 0) {
          console.log("\nCallback counts:");
          for (const [name, count] of countEntries) {
            console.log(`  ${name}: ${count}`);
          }
        }

        if (res.macros.length > 0) {
          console.log("\nMacros:");
          for (const m of res.macros) {
            const where = m.loc ? ` (${m.loc})` : m.file ? ` (${m.file})` : "";
            console.log(`  ${m.action === "define" ? "#define" : "#undef "} ${m.name}${where}`);
          }
        }

        if (res.includes.length > 0) {
          console.log("\nIncludes:");
          for (const inc of res.includes) {
            const written = inc.angled ? `<${inc.fileName}>` : `"${inc.fileName}"`;
            console.log(`  ${written}${inc.resolved ? ` -> ${inc.resolved}` : ""}`);
          }
        }

        if (res.conditionals.length > 0) {
          console.log("\nConditionals:");
          for (const c of res.conditionals) {
            const value = c.conditionValue === undefined ? "" : ` => ${c.conditionValue}`;
            console.log(`  ${c.kind}${c.loc ? ` at ${c.loc}` : ""}${value}`);
          }
        }

        if (res.pragmas.length > 0) {
          console.log("\nPragmas:");
          for (const p of res.pragmas) {
            console.log(`  ${p.kind}${p.detail ? `: ${p.detail}` : ""}`);
          }
        }

        if (res.modules.length > 0) {
          console.log("\nModule imports:");
          for (const mod of res.modules) {
            console.log(`  import ${mod.imported}`);
          }
        }

        if (res.events && res.events.length > 0) {
          console.log(`\nRaw events: ${res.events.length}`);
        }

        if (res.warnings.length > 0) {
          console.log("\nWarnings:");
          for (const w of res.warnings) {
            console.log(`  ! ${w}`);
          }
        }
        return 0;
      },
    };

    const spec = CLI_COMMAND_BY_NAME.get(command);
    if (spec) {
      const handler = handlers[spec.command];
      if (handler) {
        return await handler();
      }
      console.error(`Internal error: the ${spec.command} command is registered without a handler.`);
      return 1;
    }

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
  } catch (error) {
    console.error(
      `Error executing command '${command}': ${error instanceof Error ? error.message : String(error)}`,
    );
    return 1;
  }
}

if (typeof import.meta !== "undefined" && import.meta.main) {
  runCli(process.argv.slice(2))
    .then(async (code) => {
      await sessionManager.closeAll();
      process.exit(code);
    })
    .catch(async (err) => {
      await sessionManager.closeAll();
      console.error("Fatal CLI error:", err);
      process.exit(1);
    });
}
