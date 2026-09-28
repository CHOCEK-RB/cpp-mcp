import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { TieredCache } from "../src/cache.js";

describe("TieredCache", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = path.join(
      os.tmpdir(),
      `cpp-mcp-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    await fs.mkdir(tempDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("should return undefined on cache miss", async () => {
    const cache = new TieredCache<string>({
      maxMemory: 10,
      ttlMs: 60_000,
      namespace: "test-miss",
      customBaseDir: tempDir,
    });

    const result = await cache.get("non-existent-key");
    expect(result).toBeUndefined();
  });

  it("should cache in memory and retrieve without error", async () => {
    const cache = new TieredCache<{ foo: string }>({
      maxMemory: 10,
      ttlMs: 60_000,
      namespace: "test-mem",
      customBaseDir: tempDir,
    });

    await cache.set("key1", { foo: "bar" });
    const result = await cache.get("key1");
    expect(result).toEqual({ foo: "bar" });
  });

  it("should persist to disk and restore when memory is cleared", async () => {
    const cache = new TieredCache<string>({
      maxMemory: 10,
      ttlMs: 60_000,
      namespace: "test-persist",
      customBaseDir: tempDir,
    });

    await cache.set("persistent-key", "persisted-data");

    // Clear L1 memory only
    cache.clearMemory();

    // Should read from disk and reload into L1
    const fromDisk = await cache.get("persistent-key");
    expect(fromDisk).toBe("persisted-data");
  });

  it("should respect TTL and expire items", async () => {
    const cache = new TieredCache<string>({
      maxMemory: 10,
      ttlMs: 25, // 25ms TTL
      namespace: "test-ttl",
      customBaseDir: tempDir,
    });

    await cache.set("expiring-key", "temp-data");
    cache.clearMemory();

    // Wait 40ms to guarantee expiry
    await new Promise((resolve) => setTimeout(resolve, 40));

    const expired = await cache.get("expiring-key");
    expect(expired).toBeUndefined();
  });

  it("should remove items from both memory and disk on delete", async () => {
    const cache = new TieredCache<string>({
      maxMemory: 10,
      ttlMs: 60_000,
      namespace: "test-del",
      customBaseDir: tempDir,
    });

    await cache.set("del-key", "del-val");
    await cache.delete("del-key");

    cache.clearMemory();
    const result = await cache.get("del-key");
    expect(result).toBeUndefined();
  });

  it("should gracefully handle corrupted disk files without throwing", async () => {
    const cache = new TieredCache<string>({
      maxMemory: 10,
      ttlMs: 60_000,
      namespace: "test-corrupt",
      customBaseDir: tempDir,
    });

    await cache.set("corrupt-key", "valid-initially");
    cache.clearMemory();

    // Corrupt the file on disk
    const files = await fs.readdir(cache.getCacheDir());
    const fileName = files[0];
    if (!fileName) throw new Error("Expected cached file");
    await fs.writeFile(path.join(cache.getCacheDir(), fileName), "not valid json {{{", "utf-8");

    const result = await cache.get("corrupt-key");
    expect(result).toBeUndefined();
  });

  it("should purge all entries on clear", async () => {
    const cache = new TieredCache<string>({
      maxMemory: 10,
      ttlMs: 60_000,
      namespace: "test-clear",
      customBaseDir: tempDir,
    });

    await cache.set("k1", "v1");
    await cache.set("k2", "v2");
    await cache.clear();

    expect(await cache.get("k1")).toBeUndefined();
    expect(await cache.get("k2")).toBeUndefined();
  });

  it("should expose namespace and cache directory getters", () => {
    const cache = new TieredCache<string>({
      maxMemory: 5,
      ttlMs: 10_000,
      namespace: "test-meta",
      customBaseDir: tempDir,
    });

    expect(cache.getNamespace()).toBe("test-meta");
    expect(cache.getCacheDir()).toContain("test-meta");
  });

  it("should sweep expired disk entries and keep live ones", async () => {
    const cache = new TieredCache<string>({
      maxMemory: 10,
      ttlMs: 20,
      namespace: "test-sweep-ttl",
      customBaseDir: tempDir,
      sweepIntervalMs: Number.MAX_SAFE_INTEGER,
    });

    await cache.set("expired-a", "a");
    await cache.set("expired-b", "b");
    await cache.set("live", "c", 60_000);

    await new Promise((resolve) => setTimeout(resolve, 40));

    const result = await cache.sweepDisk();
    expect(result.removed).toBe(2);
    expect(result.remaining).toBe(1);

    const files = await fs.readdir(cache.getCacheDir());
    expect(files.length).toBe(1);
  });

  it("should evict soonest-to-expire entries beyond maxDiskEntries", async () => {
    const cache = new TieredCache<string>({
      maxMemory: 10,
      ttlMs: 60_000,
      namespace: "test-sweep-cap",
      customBaseDir: tempDir,
      maxDiskEntries: 3,
      sweepIntervalMs: Number.MAX_SAFE_INTEGER,
    });

    for (let i = 0; i < 6; i++) {
      await cache.set(`key-${i}`, `value-${i}`, 60_000 + i * 1_000);
    }

    const result = await cache.sweepDisk();
    expect(result.removed).toBe(3);
    expect(result.remaining).toBe(3);

    const files = await fs.readdir(cache.getCacheDir());
    expect(files.length).toBe(3);
  });

  it("should remove corrupt disk entries during sweep", async () => {
    const cache = new TieredCache<string>({
      maxMemory: 10,
      ttlMs: 60_000,
      namespace: "test-sweep-corrupt",
      customBaseDir: tempDir,
      sweepIntervalMs: Number.MAX_SAFE_INTEGER,
    });

    await cache.set("corrupt", "value");
    const files = await fs.readdir(cache.getCacheDir());
    const fileName = files[0];
    if (!fileName) throw new Error("Expected cached file");
    await fs.writeFile(path.join(cache.getCacheDir(), fileName), "not valid json {{{", "utf-8");

    const result = await cache.sweepDisk();
    expect(result.removed).toBe(1);
    expect(result.remaining).toBe(0);
  });

  it("should not throw when sweeping a missing cache directory", async () => {
    const cache = new TieredCache<string>({
      maxMemory: 10,
      ttlMs: 60_000,
      namespace: "test-sweep-missing",
      customBaseDir: path.join(tempDir, "does-not-exist"),
      sweepIntervalMs: Number.MAX_SAFE_INTEGER,
    });

    const result = await cache.sweepDisk();
    expect(result).toEqual({ removed: 0, remaining: 0 });
  });
});
