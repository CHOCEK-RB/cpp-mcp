import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { runCli } from "../src/cli.js";
import { createServer } from "../src/index.js";
import {
  createTraceAggregator,
  findPpTrace,
  parsePpTraceYaml,
  tracePreprocessor,
} from "../src/tools/preprocessor-tracer.js";

// pp-trace ships with the LLVM clang tools and is not guaranteed to be installed on
// every machine (CI included). Skip binary-dependent tests when absent.
const hasPpTrace = (await findPpTrace()).available;
const skipMessage = "Skipping test: pp-trace is not installed";

const FIXTURE_YAML = `---
- Callback: FileChanged
  Loc: "/tmp/proj/main.cpp:1:1"
  Reason: EnterFile
  FileType: C_User
  PrevFID: (invalid)
- Callback: FileChanged
  Loc: "/usr/include/c++/22/iostream:38:1"
  Reason: EnterFile
  FileType: C_System
  PrevFID: (invalid)
- Callback: MacroDefined
  MacroNameTok: _GLIBCXX_IOSTREAM
  MacroDirective: MD_Define
- Callback: FileChanged
  Loc: "/usr/include/c++/22/iostream:200:1"
  Reason: ExitFile
  FileType: C_System
  PrevFID: (invalid)
- Callback: MacroDefined
  MacroNameTok: MAX
  MacroDirective: MD_Define
- Callback: InclusionDirective
  HashLoc: "/tmp/proj/main.cpp:2:1"
  IncludeTok: include
  FileName: "vector"
  IsAngled: true
  FilenameRange: "vector"
  File: "/usr/include/c++/22/vector"
  SearchPath: "/usr/include/c++/22"
  RelativePath: "vector"
  Imported: (null)
- Callback: If
  Loc: "/tmp/proj/main.cpp:5:2"
  ConditionRange: ["/tmp/proj/main.cpp:5:4", "/tmp/proj/main.cpp:6:1"]
  ConditionValue: CVK_False
- Callback: Endif
  Loc: "/tmp/proj/main.cpp:7:2"
  IfLoc: "/tmp/proj/main.cpp:5:2"
- Callback: moduleImport
  ImportLoc: "/tmp/proj/main.cpp:8:2"
  Path: [{Name: foo, Loc: "/tmp/proj/main.cpp:8:9"}, {Name: bar, Loc: "/tmp/proj/main.cpp:8:14"}]
  Imported: foo.bar
- Callback: EndOfMainFile
`;

const SOURCE_SNIPPET = `#define MAX 10
#if 0
int hidden;
#endif
#include <vector>
int main() { return MAX; }
`;

describe("pp-trace YAML parser", () => {
  it("parses callback records with their fields", () => {
    const events = parsePpTraceYaml(FIXTURE_YAML);
    expect(events).toHaveLength(10);
    expect(events[0]?.callback).toBe("FileChanged");
    expect(events[0]?.fields.Reason).toBe("EnterFile");
    const moduleEvent = events.find((e) => e.callback === "moduleImport");
    expect(moduleEvent).toBeDefined();
    expect(moduleEvent?.fields.Imported).toBe("foo.bar");
  });

  it("preserves nested flow values on a single field", () => {
    const events = parsePpTraceYaml(FIXTURE_YAML);
    const moduleEvent = events.find((e) => e.callback === "moduleImport");
    expect(moduleEvent?.fields.Path).toContain("foo");
    expect(moduleEvent?.fields.Path).toContain("bar");
  });

  it("returns an empty list for empty input", () => {
    expect(parsePpTraceYaml("")).toHaveLength(0);
    expect(parsePpTraceYaml("---\n")).toHaveLength(0);
  });
});

describe("pp-trace aggregator", () => {
  it("keeps only project-code events and tracks the active file", () => {
    const aggregator = createTraceAggregator({
      userFilesOnly: true,
      includeEvents: false,
      maxEvents: 10,
    });
    for (const event of parsePpTraceYaml(FIXTURE_YAML)) {
      aggregator.push(event);
    }
    const result = aggregator.finish();

    expect(result.macros).toHaveLength(1);
    expect(result.macros[0]?.name).toBe("MAX");
    expect(result.macros[0]?.action).toBe("define");

    expect(result.includes).toHaveLength(1);
    expect(result.includes[0]?.fileName).toBe("vector");
    expect(result.includes[0]?.angled).toBe(true);

    expect(result.conditionals.map((c) => c.kind)).toContain("If");
    expect(result.conditionals.find((c) => c.kind === "If")?.conditionValue).toBe(false);

    expect(result.modules).toHaveLength(1);
    expect(result.modules[0]?.imported).toBe("foo.bar");

    expect(result.counts.MacroDefined).toBe(1);
    expect(result.userEvents).toBeLessThan(result.totalEvents);
  });

  it("retains system events when userFilesOnly is disabled", () => {
    const aggregator = createTraceAggregator({
      userFilesOnly: false,
      includeEvents: false,
      maxEvents: 10,
    });
    for (const event of parsePpTraceYaml(FIXTURE_YAML)) {
      aggregator.push(event);
    }
    const result = aggregator.finish();

    expect(result.macros.map((m) => m.name)).toContain("_GLIBCXX_IOSTREAM");
    expect(result.userEvents).toBe(result.totalEvents);
  });

  it("caps raw events and flags truncation", () => {
    const aggregator = createTraceAggregator({
      userFilesOnly: false,
      includeEvents: true,
      maxEvents: 3,
    });
    for (const event of parsePpTraceYaml(FIXTURE_YAML)) {
      aggregator.push(event);
    }
    const result = aggregator.finish();

    expect(result.events).toHaveLength(3);
    expect(result.truncated).toBe(true);
  });

  it("records pragma events", () => {
    const yaml = `---
- Callback: PragmaMessage
  Loc: "/tmp/proj/main.cpp:3:1"
  Namespace: "GCC"
  Kind: PMK_Message
  Str: hello from pragma
`;
    const aggregator = createTraceAggregator({
      userFilesOnly: true,
      includeEvents: false,
      maxEvents: 10,
    });
    for (const event of parsePpTraceYaml(yaml)) {
      aggregator.push(event);
    }
    const result = aggregator.finish();
    expect(result.pragmas).toHaveLength(1);
    expect(result.pragmas[0]?.kind).toBe("PragmaMessage");
    expect(result.pragmas[0]?.detail).toBe("hello from pragma");
  });
});

describe("tracePreprocessor", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "pp-trace-test-"));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("fails gracefully when the source file is missing", async () => {
    const result = await tracePreprocessor({
      file: path.join(tempDir, "does-not-exist.cpp"),
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain("not found");
  });

  it("fails with an install hint when pp-trace cannot be found", async () => {
    const filePath = path.join(tempDir, "main.cpp");
    await fs.writeFile(filePath, SOURCE_SNIPPET, "utf-8");

    const result = await tracePreprocessor({
      file: filePath,
      ppTracePath: path.join(tempDir, "no-such-pp-trace"),
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("not found");
    expect(result.error).toContain("clang-tools");
  });

  it("traces macros, conditionals, and includes from a real file", async () => {
    if (!hasPpTrace) {
      console.log(skipMessage);
      return;
    }

    const filePath = path.join(tempDir, "main.cpp");
    await fs.writeFile(filePath, SOURCE_SNIPPET, "utf-8");

    const result = await tracePreprocessor({
      file: filePath,
      extraArgs: ["-std=c++20"],
    });

    expect(result.success).toBe(true);
    expect(result.tool.name).toBe("pp-trace");
    expect(result.tool.version).toBeDefined();
    expect(result.macros.map((m) => m.name)).toContain("MAX");
    expect(result.includes.map((i) => i.fileName)).toContain("vector");
    const ifBranch = result.conditionals.find((c) => c.kind === "If");
    expect(ifBranch?.conditionValue).toBe(false);
    // System-header noise must be filtered out by default.
    expect(result.summary.userEvents).toBeLessThan(result.summary.totalEvents);
    expect(result.macros.map((m) => m.name)).not.toContain("_GLIBCXX_IOSTREAM");
  });

  it("restricts callbacks when requested", async () => {
    if (!hasPpTrace) {
      console.log(skipMessage);
      return;
    }

    const filePath = path.join(tempDir, "main.cpp");
    await fs.writeFile(filePath, SOURCE_SNIPPET, "utf-8");

    const result = await tracePreprocessor({
      file: filePath,
      callbacks: ["MacroDefined"],
    });

    expect(result.success).toBe(true);
    expect(Object.keys(result.summary.counts)).toEqual(["MacroDefined"]);
  });

  it("caps raw events and marks the result as truncated", async () => {
    if (!hasPpTrace) {
      console.log(skipMessage);
      return;
    }

    const filePath = path.join(tempDir, "main.cpp");
    await fs.writeFile(filePath, SOURCE_SNIPPET, "utf-8");

    const result = await tracePreprocessor({
      file: filePath,
      callbacks: ["MacroDefined"],
      includeEvents: true,
      maxEvents: 3,
      userFilesOnly: false,
    });

    expect(result.success).toBe(true);
    expect(result.events).toHaveLength(3);
    expect(result.summary.truncated).toBe(true);
  });

  it("does not leak file contents in the serialized result", async () => {
    if (!hasPpTrace) {
      console.log(skipMessage);
      return;
    }

    const filePath = path.join(tempDir, "main.cpp");
    await fs.writeFile(filePath, SOURCE_SNIPPET, "utf-8");

    const result = await tracePreprocessor({ file: filePath });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("int hidden;");
    expect(serialized).not.toContain("return MAX;");
  });
});

describe("trace-preprocessor CLI", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "pp-trace-cli-test-"));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("executes the CLI command successfully with --json", async () => {
    if (!hasPpTrace) {
      console.log(skipMessage);
      return;
    }

    const filePath = path.join(tempDir, "main.cpp");
    await fs.writeFile(filePath, SOURCE_SNIPPET, "utf-8");

    let stdout = "";
    const originalLog = console.log;
    console.log = (msg: string) => {
      stdout += msg;
    };

    try {
      const exitCode = await runCli(["trace-preprocessor", filePath, "--json"]);
      expect(exitCode).toBe(0);
      const parsed = JSON.parse(stdout);
      expect(parsed.success).toBe(true);
      expect(parsed.macros.map((m: { name: string }) => m.name)).toContain("MAX");
    } finally {
      console.log = originalLog;
    }
  });

  it("registers trace_preprocessor in the MCP server", () => {
    const server = createServer();
    // @ts-expect-error accessing private property for test verification
    const registeredTools = server._registeredTools;
    expect(registeredTools).toBeDefined();
    expect(registeredTools.trace_preprocessor).toBeDefined();
  });
});
