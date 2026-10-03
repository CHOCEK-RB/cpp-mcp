import { describe, expect, it } from "bun:test";
import pkg from "../package.json" with { type: "json" };
import { CLI_COMMAND_BY_NAME, CLI_COMMANDS, renderHelp } from "../src/cli-registry.js";
import { createServer } from "../src/index.js";

/** The single MCP tool without a CLI command, documented in tests/tool-contract.test.ts. */
const DOCUMENTED_GAP = "get_cppreference_page";

function aliasesOf(spec: (typeof CLI_COMMANDS)[number]): readonly string[] {
  return "aliases" in spec ? (spec.aliases ?? []) : [];
}

function toolNames(): string[] {
  // @ts-expect-error accessing a private property for test verification
  return Object.keys(createServer()._registeredTools);
}

describe("CLI command registry", () => {
  it("has a unique canonical name for every command", () => {
    const names = CLI_COMMANDS.map((spec) => spec.command);
    expect(new Set(names).size).toBe(names.length);
  });

  it("has no alias that collides with another command or alias", () => {
    const owners = new Map<string, string>();
    for (const spec of CLI_COMMANDS) {
      for (const name of [spec.command, ...aliasesOf(spec)]) {
        expect(owners.get(name), `duplicate CLI name '${name}'`).toBeUndefined();
        owners.set(name, spec.command);
      }
    }
  });

  it("resolves every canonical name and every alias to its spec", () => {
    let expectedSize = 0;
    for (const spec of CLI_COMMANDS) {
      const names = [spec.command, ...aliasesOf(spec)];
      expectedSize += names.length;
      for (const name of names) {
        expect(CLI_COMMAND_BY_NAME.get(name)).toBe(spec);
      }
    }
    expect(CLI_COMMAND_BY_NAME.size).toBe(expectedSize);
  });

  it("fronts every MCP tool exactly once, except the documented gap", () => {
    const tools = toolNames();
    const bound: string[] = CLI_COMMANDS.flatMap((spec) =>
      "tool" in spec && spec.tool ? [spec.tool] : [],
    );

    expect(new Set(bound).size).toBe(bound.length);
    for (const tool of tools) {
      if (tool === DOCUMENTED_GAP) {
        expect(bound).not.toContain(tool);
      } else {
        expect(bound).toContain(tool);
      }
    }
    for (const tool of bound) {
      expect(tools).toContain(tool);
    }
  });

  it("keeps the CLI-only query command free of a tool binding", () => {
    const query = CLI_COMMANDS.find((spec) => spec.command === "query");
    expect(query).toBeDefined();
    expect(query && "tool" in query ? query.tool : undefined).toBeUndefined();
  });

  it("renders the whole help text from the catalog", () => {
    const help = renderHelp();
    expect(help).toContain(`cpp-mcp v${pkg.version}`);
    expect(help).toContain("--json");
    expect(help).toContain("When executed without arguments, cpp-mcp runs as an MCP stdio server.");
    for (const spec of CLI_COMMANDS) {
      expect(help).toContain(`  ${spec.usage}`);
    }
  });
});
