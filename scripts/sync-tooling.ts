#!/usr/bin/env bun
// scripts/sync-tooling.ts
// Automatically syncs and extracts documentation for modern C++ tooling:
// 1. xmake: Directly fetches and parses official API specs from xmake-io/xmake-docs on GitHub.
// 2. clang-tidy: Inspects local/official check list with modern C++ categorization.
// 3. clang-format: Dumps and parses all active styling options.
// 4. sanitizers: Runtime address, thread, and undefined behavior sanitizers.

import { spawnSync } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";

interface KeyDirective {
  name: string;
  description: string;
  syntax?: string;
}

interface ToolCommand {
  command: string;
  description: string;
}

interface ToolGuide {
  id: string;
  title: string;
  aliases: string[];
  description: string;
  configFileName: string;
  sampleConfig: string;
  keyDirectives: KeyDirective[];
  commands: ToolCommand[];
  content: string;
}

const OUTPUT_JSON = path.resolve(import.meta.dir, "../src/data/tooling.json");

const XMAKE_DOC_FILES = [
  {
    file: "project-target.md",
    category: "Target Specification",
  },
  {
    file: "global-interfaces.md",
    category: "Global Interfaces",
  },
  {
    file: "package-dependencies.md",
    category: "Package Dependencies",
  },
  {
    file: "builtin-rules.md",
    category: "Built-in Rules",
  },
  {
    file: "configuration-option.md",
    category: "Configuration Options",
  },
  {
    file: "custom-rule.md",
    category: "Custom Build Rules",
  },
];

async function syncXmakeDirectives(): Promise<KeyDirective[]> {
  console.log("Fetching official xmake documentation from xmake-io/xmake-docs...");
  const directives: KeyDirective[] = [];
  const seen = new Set<string>();

  for (const { file, category } of XMAKE_DOC_FILES) {
    const url = `https://raw.githubusercontent.com/xmake-io/xmake-docs/master/docs/api/description/${file}`;
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
      if (!res.ok) {
        console.warn(`Could not fetch ${file}: HTTP ${res.status}`);
        continue;
      }
      const text = await res.text();
      const sections = text.split(/\n(?=## )/);

      for (const section of sections) {
        const headerMatch = section.match(
          /^##\s+([a-zA-Z0-9_.]+)(?:\{[^}]+\})?\s*(?:\n+###\s+([^\n]+))?/,
        );
        if (!headerMatch) continue;

        const name = headerMatch[1]?.trim();
        if (!name) continue;

        let desc = headerMatch[2]?.trim() || `xmake ${category} API`;

        if (name.startsWith("Visibility") || name === "Project Targets" || seen.has(name)) {
          continue;
        }

        // Clean up markdown anchor or tags in description
        desc = desc.replace(/\{#[^}]+\}/g, "").trim();

        // Extract prototype syntax if present
        let syntax: string | undefined;
        const protoMatch = section.match(/```lua\s*\n([\s\S]*?)\n```/);
        if (protoMatch?.[1]) {
          syntax = protoMatch[1].trim().split("\n").slice(0, 3).join(" ");
        }

        seen.add(name);
        directives.push({
          name,
          description: `[${category}] ${desc}`,
          syntax: syntax ? syntax.slice(0, 100) : undefined,
        });
      }
    } catch (err) {
      console.warn(
        `Failed fetching xmake doc ${file}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  console.log(`Extracted ${directives.length} official xmake directives.`);
  return directives;
}

function syncClangTidyChecks(): KeyDirective[] {
  console.log("Extracting clang-tidy checks from local/standard toolchain...");
  const directives: KeyDirective[] = [];

  try {
    const proc = spawnSync("clang-tidy", ["--list-checks", "-checks=*"], {
      encoding: "utf-8",
      timeout: 10_000,
    });

    if (proc.status === 0 && proc.stdout) {
      const lines = proc.stdout
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l && !l.startsWith("Enabled checks"));

      for (const check of lines) {
        let desc = "Clang-Tidy diagnostic check";
        if (check.startsWith("modernize-")) {
          desc = "C++ modern standard idiom & feature adoption (C++11/14/17/20/23/26)";
        } else if (check.startsWith("cppcoreguidelines-")) {
          desc = "Bjarne Stroustrup & Herb Sutter C++ Core Guidelines enforcement";
        } else if (check.startsWith("cert-")) {
          desc = "Carnegie Mellon SEI CERT C++ secure coding standard rule";
        } else if (check.startsWith("bugprone-")) {
          desc = "Static detection of bug-prone constructs, memory leaks, and UB";
        } else if (check.startsWith("performance-")) {
          desc = "Runtime efficiency, move semantics, and redundant copy elimination";
        } else if (check.startsWith("readability-")) {
          desc = "Code clarity, const correctness, and clean C++ style conventions";
        } else if (check.startsWith("concurrency-")) {
          desc = "Thread safety, race condition prevention, and concurrent memory models";
        }

        directives.push({ name: check, description: desc });
      }
    }
  } catch (err) {
    console.warn(
      `Could not run clang-tidy directly: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  if (directives.length === 0) {
    // Fallback if clang-tidy is not installed
    directives.push(
      {
        name: "modernize-*",
        description: "Enforces modern C++20/C++23 features (std::print, std::span, ranges, auto)",
      },
      {
        name: "cppcoreguidelines-*",
        description: "Enforces Bjarne Stroustrup and Herb Sutter's C++ Core Guidelines",
      },
      { name: "cert-*", description: "Enforces SEI CERT C++ secure coding standards" },
      {
        name: "bugprone-*",
        description: "Detects memory leaks, dangling references, and undefined behavior",
      },
      {
        name: "performance-*",
        description: "Flags unnecessary copies, missed move semantics, and sub-optimal algorithms",
      },
      {
        name: "readability-*",
        description: "Enforces const correctness, identifier naming, and clean readability",
      },
    );
  }

  console.log(`Extracted ${directives.length} clang-tidy checks.`);
  return directives;
}

function syncClangFormatOptions(): KeyDirective[] {
  console.log("Extracting clang-format configuration options...");
  const directives: KeyDirective[] = [];

  try {
    const proc = spawnSync("clang-format", ["--dump-config"], {
      encoding: "utf-8",
      timeout: 5_000,
    });

    if (proc.status === 0 && proc.stdout) {
      for (const line of proc.stdout.split("\n")) {
        const match = line.match(/^([A-Z][a-zA-Z0-9]+):\s*(.*)$/);
        if (match?.[1]) {
          const optName = match[1];
          const defaultVal = match[2]?.trim() || "Configurable";
          directives.push({
            name: optName,
            description: `Clang-Format styling option (Default / Active: ${defaultVal})`,
          });
        }
      }
    }
  } catch (err) {
    console.warn(
      `Could not run clang-format directly: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  if (directives.length === 0) {
    directives.push(
      {
        name: "BasedOnStyle",
        description: "Base styling standard (LLVM, Google, Chromium, Mozilla, WebKit, Microsoft)",
      },
      { name: "Standard", description: "C++ standard target (Latest, c++20, c++23, c++26)" },
      { name: "IndentWidth", description: "Number of spaces per indentation level (default 4)" },
      {
        name: "ColumnLimit",
        description: "Maximum column width for automatic line breaks (default 100)",
      },
      {
        name: "SortIncludes",
        description: "Sort #include directives alphabetically (CaseSensitive / CaseInsensitive)",
      },
    );
  }

  console.log(`Extracted ${directives.length} clang-format options.`);
  return directives;
}

export async function syncTooling(): Promise<void> {
  const [xmakeDirectives, clangTidyChecks, clangFormatOptions] = await Promise.all([
    syncXmakeDirectives(),
    Promise.resolve(syncClangTidyChecks()),
    Promise.resolve(syncClangFormatOptions()),
  ]);

  const xmakeConfig = `add_rules("mode.debug", "mode.release")

set_languages("c++23")

target("app")
    set_kind("binary")
    add_files("src/*.cpp")
    add_files("src/*.cppm") -- Zero-boilerplate native C++20/23 Modules support
    add_includedirs("include")
    add_packages("fmt")
`;

  const clangFormatConfig = `---
Language: Cpp
BasedOnStyle: LLVM
Standard: Latest
IndentWidth: 4
TabWidth: 4
UseTab: Never
ColumnLimit: 100
SortIncludes: CaseSensitive
IncludeBlocks: Regroup
AllowShortFunctionsOnASingleLine: Inline
AllowShortIfStatementsOnASingleLine: Never
AllowShortLoopsOnASingleLine: false
BreakBeforeBraces: Attach
SpaceAfterTemplateKeyword: true
SpaceBeforeRangeBasedForLoopColon: true
...
`;

  const clangTidyConfig = `---
Checks: >
  -*,
  modernize-*,
  cppcoreguidelines-*,
  cert-*,
  bugprone-*,
  performance-*,
  readability-*

WarningsAsErrors: 'cert-*,cppcoreguidelines-*'
HeaderFilterRegex: '.*'
FormatStyle: file
CheckOptions:
  modernize-use-std-print.Replacement: 'std::print'
...
`;

  const sanitizersConfig = `# Modern C++ Runtime Sanitizers Configuration

# 1. CMake Recipe (ASan + UBSan)
# set(CMAKE_CXX_FLAGS "\${CMAKE_CXX_FLAGS} -fsanitize=address,undefined -fno-omit-frame-pointer -g")
# set(CMAKE_LINKER_FLAGS "\${CMAKE_LINKER_FLAGS} -fsanitize=address,undefined")

# Alternative: TSan Recipe (ThreadSanitizer - Mutually exclusive with ASan)
# set(CMAKE_CXX_FLAGS "\${CMAKE_CXX_FLAGS} -fsanitize=thread -g")
# set(CMAKE_LINKER_FLAGS "\${CMAKE_LINKER_FLAGS} -fsanitize=thread")

# 2. xmake Recipe
# add_rules("mode.asan", "mode.ubsan")
# or for data race detection:
# add_rules("mode.tsan")

# 3. Recommended Environment Flags for Execution
export ASAN_OPTIONS="detect_leaks=1:abort_on_error=1:symbolize=1"
export UBSAN_OPTIONS="print_stacktrace=1:halt_on_error=1"
export TSAN_OPTIONS="second_deadlock_stack=1"
`;

  const toolingData: ToolGuide[] = [
    {
      id: "xmake",
      title: "xmake Modern C/C++ Build Utility",
      aliases: ["xmake", "xmake.lua", "xpack"],
      description:
        "Modern, lightweight, Lua-based C/C++ build system with first-class zero-boilerplate C++20/C++23 Modules support and built-in package management.",
      configFileName: "xmake.lua",
      sampleConfig: xmakeConfig,
      keyDirectives: xmakeDirectives,
      commands: [
        { command: "xmake", description: "Build current project targets" },
        { command: "xmake run <target>", description: "Run compiled binary target" },
        { command: "xmake f -m debug", description: "Configure project in debug mode" },
        { command: "xmake f -m release", description: "Configure project in release mode" },
        {
          command: "xmake f --policies=build.c++.modules",
          description: "Force enable C++20 modules scanning",
        },
        {
          command: "xmake project -k compile_commands",
          description: "Generate compile_commands.json for clangd and IDEs",
        },
      ],
      content:
        "xmake simplifies C++20 and C++23 modules compilation without Ninja or complex CMake 3.28 FILE_SET directives. It automatically tracks header units and module dependencies.",
    },
    {
      id: "clang-format",
      title: "Clang-Format Source Code Formatter",
      aliases: ["clang-format", ".clang-format", "format"],
      description:
        "Official LLVM code formatter for C, C++, and C++20/23/26 module files, providing deterministic formatting across large codebases.",
      configFileName: ".clang-format",
      sampleConfig: clangFormatConfig,
      keyDirectives: clangFormatOptions,
      commands: [
        {
          command: "clang-format -i $(find src -name '*.cpp' -o -name '*.cppm' -o -name '*.hpp')",
          description: "Format all source, module, and header files in-place",
        },
        {
          command: "clang-format --dry-run -Werror src/main.cpp",
          description: "Verify code formatting adherence in CI pipelines without editing",
        },
        {
          command: "clang-format --dump-config > .clang-format",
          description: "Dump full default configuration for customization",
        },
      ],
      content:
        "Clang-Format aligns C++ code according to standardized style guidelines. Supports C++20 module keywords `module`, `import`, and `export` natively.",
    },
    {
      id: "clang-tidy",
      title: "Clang-Tidy Static Linter & Modernizer",
      aliases: ["clang-tidy", ".clang-tidy", "tidy"],
      description:
        "LLVM-based static analysis engine enforcing C++ Core Guidelines, SEI CERT security rules, modernization (C++20/C++23), and bug-prone antipattern detection.",
      configFileName: ".clang-tidy",
      sampleConfig: clangTidyConfig,
      keyDirectives: clangTidyChecks,
      commands: [
        {
          command: "clang-tidy -p build src/main.cpp",
          description: "Run static analysis using compile_commands.json database",
        },
        {
          command: "clang-tidy -fix -p build src/*.cpp",
          description: "Automatically apply modernization and style fixes in-place",
        },
        {
          command: "clang-tidy --list-checks",
          description: "List all enabled checks in the current configuration",
        },
      ],
      content:
        "Clang-Tidy operates on AST level to find memory safety issues, modernize older codebases to C++20/C++23 features, and enforce Core Guidelines.",
    },
    {
      id: "sanitizers",
      title: "LLVM/GCC Runtime Sanitizers (ASan, UBSan, TSan, MSan)",
      aliases: ["sanitizers", "asan", "ubsan", "tsan", "msan"],
      description:
        "Compiler-instrumented runtime detectors for memory safety violations, undefined behavior, and multi-threaded race conditions.",
      configFileName: "sanitizers.env",
      sampleConfig: sanitizersConfig,
      keyDirectives: [
        {
          name: "-fsanitize=address",
          description:
            "AddressSanitizer (ASan): Detects out-of-bounds access, use-after-free, double-free, and memory leaks",
        },
        {
          name: "-fsanitize=undefined",
          description:
            "UndefinedBehaviorSanitizer (UBSan): Detects integer overflow, null pointer dereference, misaligned memory",
        },
        {
          name: "-fsanitize=thread",
          description:
            "ThreadSanitizer (TSan): Detects data races between threads (mutually exclusive with ASan)",
        },
        {
          name: "-fsanitize=memory",
          description: "MemorySanitizer (MSan): Detects reads of uninitialized memory (Clang only)",
        },
        {
          name: "-fno-omit-frame-pointer",
          description: "Preserves call stack frames for accurate debugging and backtraces",
        },
      ],
      commands: [
        {
          command: "clang++ -fsanitize=address,undefined -g src/main.cpp -o main",
          description: "Compile with Address and Undefined Behavior sanitizers enabled",
        },
        {
          command: "xmake f -m asan && xmake run",
          description: "Build and run with ASan under xmake",
        },
        {
          command: "ASAN_OPTIONS=detect_leaks=1 ./main",
          description: "Run executable with strict memory leak detection",
        },
      ],
      content:
        "Sanitizers catch critical memory corruption bugs at runtime with low overhead (~2x slowdown compared to ~20-50x with Valgrind). Always compile with `-g` and `-fno-omit-frame-pointer`.",
    },
  ];

  await fs.writeFile(OUTPUT_JSON, `${JSON.stringify(toolingData, null, 2)}\n`, "utf-8");
  console.log(`Successfully written synchronized tooling data to ${OUTPUT_JSON}`);
}

syncTooling().catch((err) => {
  console.error("Error during tooling synchronization:", err);
  process.exit(1);
});
