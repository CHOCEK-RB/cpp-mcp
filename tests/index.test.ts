import { describe, expect, it } from "bun:test";
import { fileURLToPath } from "node:url";
import pkg from "../package.json" with { type: "json" };
import serverJson from "../server.json" with { type: "json" };
import { createServer, isEntryPoint, SERVER_NAME, SERVER_VERSION } from "../src/index.js";

describe("cpp-mcp server metadata", () => {
  it("should have correct server name and version", () => {
    expect(SERVER_NAME).toBe("cpp-mcp");
    expect(SERVER_VERSION).toBe(pkg.version);
    expect(serverJson.version).toBe(pkg.version);
    expect(serverJson.packages[0]?.version).toBe(pkg.version);
  });
});

describe("direct execution detection", () => {
  it("recognizes this module's own file as the entry point", () => {
    const indexPath = fileURLToPath(new URL("../src/index.ts", import.meta.url));
    expect(isEntryPoint(indexPath)).toBe(true);
  });

  it("rejects unrelated files and missing paths", () => {
    expect(isEntryPoint(`${process.cwd()}/package.json`)).toBe(false);
    expect(isEntryPoint("/definitely/not/here/index.js")).toBe(false);
  });
});

describe("tool descriptions", () => {
  it("leads every registered tool description with its trigger", () => {
    const server = createServer();
    // @ts-expect-error accessing private property for test verification
    const tools = server._registeredTools as Record<string, { description?: string }>;
    const names = Object.keys(tools);

    expect(names.length).toBeGreaterThanOrEqual(24);
    for (const name of names) {
      expect(tools[name]?.description?.startsWith("Use when")).toBe(true);
    }
  });
});
