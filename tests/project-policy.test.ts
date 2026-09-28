import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  loadProjectPolicy,
  PROJECT_POLICY_FILENAME,
  parseProjectPolicy,
  resolveStandard,
} from "../src/tools/project-policy.js";

describe("parseProjectPolicy", () => {
  it("keeps recognized fields and drops unknown ones", () => {
    const policy = parseProjectPolicy(
      JSON.stringify({
        std: "c++23",
        clangTidy: { preset: "bugprone", checks: "bugprone-*", unknown: true },
        modernize: { prefer: ["std::print"], extra: 1 },
        unrelated: "ignored",
      }),
    );

    expect(policy).toEqual({
      std: "c++23",
      clangTidy: { preset: "bugprone", checks: "bugprone-*" },
      modernize: { prefer: ["std::print"] },
    });
  });

  it("drops fields of the wrong type", () => {
    const policy = parseProjectPolicy(
      JSON.stringify({ std: 23, clangTidy: "bugprone", modernize: { prefer: "std::print" } }),
    );
    expect(policy).toEqual({});
  });

  it("throws on invalid JSON", () => {
    expect(() => parseProjectPolicy("{ not json")).toThrow("Could not parse");
  });

  it("throws when the root value is not an object", () => {
    expect(() => parseProjectPolicy("[1, 2]")).toThrow(PROJECT_POLICY_FILENAME);
    expect(() => parseProjectPolicy("42")).toThrow(PROJECT_POLICY_FILENAME);
  });
});

describe("loadProjectPolicy", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "project-policy-test-"));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("returns an empty policy and null path when no file exists", async () => {
    const loaded = await loadProjectPolicy(tempDir);
    expect(loaded.policy).toEqual({});
    expect(loaded.path).toBeNull();
    expect(loaded.error).toBeUndefined();
  });

  it("finds the policy upward from a nested directory", async () => {
    const nested = path.join(tempDir, "src", "deep");
    await fs.mkdir(nested, { recursive: true });
    await fs.writeFile(
      path.join(tempDir, PROJECT_POLICY_FILENAME),
      JSON.stringify({ std: "c++23" }),
    );

    const loaded = await loadProjectPolicy(nested);
    expect(loaded.policy.std).toBe("c++23");
    expect(loaded.path).toBe(path.join(tempDir, PROJECT_POLICY_FILENAME));
  });

  it("reports a parse error without throwing", async () => {
    await fs.writeFile(path.join(tempDir, PROJECT_POLICY_FILENAME), "{ broken");

    const loaded = await loadProjectPolicy(tempDir);
    expect(loaded.policy).toEqual({});
    expect(loaded.path).toBe(path.join(tempDir, PROJECT_POLICY_FILENAME));
    expect(loaded.error).toContain("Could not read");
  });
});

describe("resolveStandard", () => {
  it("prefers the explicit flag, then env, then policy", () => {
    expect(resolveStandard({ flag: "26", env: "23", policy: { std: "c++20" } })).toBe("26");
    expect(resolveStandard({ env: "23", policy: { std: "c++20" } })).toBe("23");
    expect(resolveStandard({ policy: { std: "c++20" } })).toBe("c++20");
    expect(resolveStandard({})).toBeUndefined();
  });

  it("ignores blank values at every level", () => {
    expect(resolveStandard({ flag: "  ", env: "  ", policy: { std: "  " } })).toBeUndefined();
  });
});
