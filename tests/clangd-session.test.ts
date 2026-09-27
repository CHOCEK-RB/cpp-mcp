import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type { ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { pathToFileURL } from "node:url";
import { ClangdSession, encodeLspMessage, LspMessageParser } from "../src/lsp/index.js";
import { isExecutableAvailable } from "../src/project/xmake.js";

/** Minimal fake of a spawned clangd child process for lifecycle tests (no real binary). */
class FakeChildProcess extends EventEmitter {
  public stdin = new PassThrough();
  public stdout = new PassThrough();
  public stderr = new PassThrough();
  public killed = false;
  public killSignals: string[] = [];

  public kill(signal?: NodeJS.Signals): boolean {
    this.killed = true;
    if (signal) this.killSignals.push(signal);
    return true;
  }

  public asChildProcess(): ChildProcess {
    return this as unknown as ChildProcess;
  }
}

/**
 * Wires the fake clangd so LSP requests get answers. The handler receives the method
 * name; returning `undefined` deliberately leaves that request unanswered.
 */
function wireFakeClangd(
  child: FakeChildProcess,
  handler: (method: string) => unknown = () => ({}),
): void {
  const parser = new LspMessageParser();
  child.stdin.on("data", (chunk: Buffer) => parser.append(chunk));
  parser.on("message", (msg: { id?: number; method?: string }) => {
    if (msg.id === undefined) return; // notification
    const result = handler(msg.method ?? "");
    if (result === undefined) return; // intentionally unanswered
    child.stdout.write(encodeLspMessage({ jsonrpc: "2.0", id: msg.id, result }));
  });
}

describe("ClangdSession Integration with Real Clangd", () => {
  let tempDir: string;
  let session: ClangdSession | null = null;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "clangd-session-test-"));
  });

  afterEach(async () => {
    if (session) {
      await session.close();
      session = null;
    }
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("should initialize clangd session, index symbols, and resolve definition and hover", async () => {
    const hasClangd = await isExecutableAvailable("clangd");
    if (!hasClangd) {
      console.log("Skipping test: clangd is not installed");
      return;
    }

    const srcDir = path.join(tempDir, "src");
    await fs.mkdir(srcDir, { recursive: true });

    const headerPath = path.join(srcDir, "calculator.hpp");
    const sourcePath = path.join(srcDir, "calculator.cpp");

    await fs.writeFile(
      headerPath,
      `#pragma once
namespace math {
  /// Simple calculator class
  class Calculator {
  public:
    /// Adds two numbers
    int add(int a, int b);
  };
}
`,
    );

    await fs.writeFile(
      sourcePath,
      `#include "calculator.hpp"
namespace math {
  int Calculator::add(int a, int b) {
    return a + b;
  }
}
`,
    );

    // Write compile_commands.json
    const compileCommandsPath = path.join(tempDir, "compile_commands.json");
    await fs.writeFile(
      compileCommandsPath,
      JSON.stringify(
        [
          {
            directory: tempDir,
            file: sourcePath,
            command: `clang++ -I${srcDir} -c ${sourcePath} -o calculator.o`,
          },
        ],
        null,
        2,
      ),
    );

    session = new ClangdSession({
      workspaceDir: tempDir,
      compileCommandsDir: tempDir,
    });

    await session.start();
    expect(session.isRunning()).toBe(true);

    const headerUri = pathToFileURL(headerPath).toString();
    const sourceUri = pathToFileURL(sourcePath).toString();

    const headerContent = await fs.readFile(headerPath, "utf-8");
    const sourceContent = await fs.readFile(sourcePath, "utf-8");

    session.openDocument(headerUri, "cpp", headerContent);
    session.openDocument(sourceUri, "cpp", sourceContent);

    // Give clangd brief moment to parse opened documents
    await new Promise((r) => setTimeout(r, 600));

    // 1. Search symbols
    const symbols = await session.searchSymbols("Calculator");
    expect(symbols.length).toBeGreaterThanOrEqual(1);
    const calcSymbol = symbols.find((s) => s.name === "Calculator");
    expect(calcSymbol).toBeDefined();

    // 2. Document symbols in header
    const docSymbols = await session.getDocumentSymbols(headerUri);
    expect(docSymbols.length).toBeGreaterThanOrEqual(1);

    // 3. Hover info on 'add' in source
    // In calculator.cpp: "int Calculator::add(int a, int b)"
    // line 2 (0-indexed is 2), character 18
    const hover = await session.getHover(sourceUri, { line: 2, character: 18 });
    expect(hover).not.toBeNull();
    const hoverText =
      typeof hover?.contents === "string" ? hover.contents : JSON.stringify(hover?.contents);
    expect(hoverText).toContain("add");

    // 4. Definition lookup from source to header declaration
    const defs = await session.getDefinition(sourceUri, { line: 2, character: 18 });
    expect(defs.length).toBeGreaterThanOrEqual(1);

    await session.close();
    expect(session.isRunning()).toBe(false);
    session = null;
  });
});

describe("ClangdSession lifecycle without a real clangd", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "clangd-fake-test-"));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("should stop reporting running and reject pending requests when clangd exits unexpectedly", async () => {
    const fake = new FakeChildProcess();
    // Answers the initialize handshake but leaves other requests unanswered.
    wireFakeClangd(fake, (method) => (method === "initialize" ? {} : undefined));
    const session = new ClangdSession({
      workspaceDir: tempDir,
      spawnProcess: () => fake.asChildProcess(),
    });

    await session.start();
    expect(session.isRunning()).toBe(true);

    // A request the fake never answers, so it would otherwise hang until the LSP timeout.
    const pending = session.searchSymbols("Anything");
    await new Promise((r) => setTimeout(r, 0));

    // clangd crashes.
    fake.emit("exit", 1, null);

    expect(session.isRunning()).toBe(false);
    await expect(pending).rejects.toThrow(/exited unexpectedly/i);

    await session.close();
  });

  it("should kill the spawned process and reject when the initialize handshake fails", async () => {
    const fake = new FakeChildProcess();
    wireFakeClangd(fake, () => undefined); // never answers initialize
    const session = new ClangdSession({
      workspaceDir: tempDir,
      spawnProcess: () => fake.asChildProcess(),
      initializeTimeoutMs: 60,
    });

    await expect(session.start()).rejects.toThrow(/timed out/i);

    expect(fake.killed).toBe(true);
    expect(session.isRunning()).toBe(false);

    await session.close();
  });
});
