import { describe, expect, it } from "bun:test";
import { awaitPreloadReadiness, selectEvictions } from "../src/tools/code-session-manager.js";

const NOW = 1_000_000;

describe("selectEvictions", () => {
  it("keeps everything when under the cap and fresh", () => {
    const result = selectEvictions(
      [
        { key: "/a", lastUsedAt: NOW - 10 },
        { key: "/b", lastUsedAt: NOW - 20 },
      ],
      { now: NOW, maxSessions: 5, idleTimeoutMs: 60_000 },
    );
    expect(result).toEqual({ idle: [], overflow: [] });
  });

  it("marks sessions idle once past the idle timeout", () => {
    const result = selectEvictions(
      [
        { key: "/a", lastUsedAt: NOW - 60_001 },
        { key: "/b", lastUsedAt: NOW - 60_000 },
      ],
      { now: NOW, maxSessions: 5, idleTimeoutMs: 60_000 },
    );
    expect(result.idle).toEqual(["/a"]);
    expect(result.overflow).toEqual([]);
  });

  it("disables idle eviction when idleTimeoutMs is 0", () => {
    const result = selectEvictions([{ key: "/a", lastUsedAt: 0 }], {
      now: NOW,
      maxSessions: 5,
      idleTimeoutMs: 0,
    });
    expect(result.idle).toEqual([]);
  });

  it("evicts the least recently used sessions above the cap", () => {
    const result = selectEvictions(
      [
        { key: "/old", lastUsedAt: NOW - 300 },
        { key: "/mid", lastUsedAt: NOW - 200 },
        { key: "/new", lastUsedAt: NOW - 100 },
      ],
      { now: NOW, maxSessions: 2, idleTimeoutMs: 60_000 },
    );
    expect(result.overflow).toEqual(["/old"]);
    expect(result.idle).toEqual([]);
  });

  it("does not count idle sessions toward the cap", () => {
    const result = selectEvictions(
      [
        { key: "/idle", lastUsedAt: NOW - 120_000 },
        { key: "/a", lastUsedAt: NOW - 10 },
        { key: "/b", lastUsedAt: NOW - 20 },
      ],
      { now: NOW, maxSessions: 2, idleTimeoutMs: 60_000 },
    );
    expect(result.idle).toEqual(["/idle"]);
    expect(result.overflow).toEqual([]);
  });

  it("disables the cap when maxSessions is 0", () => {
    const result = selectEvictions(
      [
        { key: "/a", lastUsedAt: NOW },
        { key: "/b", lastUsedAt: NOW },
      ],
      { now: NOW, maxSessions: 0, idleTimeoutMs: 60_000 },
    );
    expect(result.overflow).toEqual([]);
  });
});

describe("awaitPreloadReadiness", () => {
  it("resolves immediately when there are no preloaded files", async () => {
    let called = false;
    await awaitPreloadReadiness(
      [],
      async () => {
        called = true;
      },
      10_000,
    );
    expect(called).toBe(false);
  });

  it("queries diagnostics for every preloaded uri with the readiness timeout", async () => {
    const calls: Array<{ uri: string; timeoutMs: number }> = [];
    await awaitPreloadReadiness(
      ["file:///a.cpp", "file:///b.cpp"],
      async (uri, timeoutMs) => {
        calls.push({ uri, timeoutMs });
      },
      1234,
    );
    expect(calls).toEqual([
      { uri: "file:///a.cpp", timeoutMs: 1234 },
      { uri: "file:///b.cpp", timeoutMs: 1234 },
    ]);
  });

  it("resolves as soon as diagnostics arrive, without waiting the full timeout", async () => {
    const outcome = await Promise.race([
      awaitPreloadReadiness(["file:///a.cpp"], async () => "diagnostics", 10_000).then(
        () => "resolved",
      ),
      new Promise<string>((resolve) => setTimeout(() => resolve("timeout"), 200)),
    ]);
    expect(outcome).toBe("resolved");
  });

  it("caps the wait when diagnostics never arrive", async () => {
    const start = Date.now();
    await awaitPreloadReadiness(["file:///a.cpp"], () => new Promise(() => {}), 40);
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(30);
    expect(elapsed).toBeLessThan(1000);
  });
});
