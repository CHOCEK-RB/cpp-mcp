import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { LRUCache } from "lru-cache";

export interface SearchResultPayload {
  query: string;
  result_urls: string[];
}

export interface PageResultPayload {
  content: string;
  next_cursor: string | null;
}

export interface CacheOptions {
  maxMemory: number;
  ttlMs: number;
  namespace: string;
  customBaseDir?: string;
}

interface DiskCacheEnvelope<T> {
  key: string;
  value: T;
  createdAt: number;
  expiresAt: number;
}

/**
 * Two-tiered cache system:
 * - L1: High-speed in-memory LRU cache.
 * - L2: Persistent JSON disk cache with TTL under ~/.cache/cpp-mcp/ or XDG_CACHE_HOME.
 */
export class TieredCache<T extends {}> {
  private readonly l1: LRUCache<string, T>;
  private readonly ttlMs: number;
  private readonly namespace: string;
  private readonly baseDir: string;
  private readonly disabled: boolean;

  constructor(options: CacheOptions) {
    this.l1 = new LRUCache<string, T>({
      max: options.maxMemory,
    });
    this.ttlMs = options.ttlMs;
    this.namespace = options.namespace;

    this.disabled =
      process.env.CPP_MCP_CACHE_DISABLE === "true" || process.env.CPP_MCP_CACHE_DISABLE === "1";

    const customBase = options.customBaseDir || process.env.CPP_MCP_CACHE_DIR;
    const xdgBase = process.env.XDG_CACHE_HOME;

    if (customBase) {
      this.baseDir = path.resolve(customBase, options.namespace);
    } else if (xdgBase) {
      this.baseDir = path.resolve(xdgBase, "cpp-mcp", options.namespace);
    } else {
      this.baseDir = path.resolve(os.homedir(), ".cache", "cpp-mcp", options.namespace);
    }
  }

  private hashKey(key: string): string {
    return createHash("sha256").update(key).digest("hex");
  }

  private getFilePath(key: string): string {
    return path.join(this.baseDir, `${this.hashKey(key)}.json`);
  }

  /**
   * Retrieves an item from L1 (memory) or L2 (disk).
   * Populates L1 if retrieved from L2.
   */
  async get(key: string): Promise<T | undefined> {
    const memoryHit = this.l1.get(key);
    if (memoryHit !== undefined) {
      return memoryHit;
    }

    if (this.disabled) {
      return undefined;
    }

    const filePath = this.getFilePath(key);
    try {
      const raw = await fs.readFile(filePath, "utf-8");
      const envelope: DiskCacheEnvelope<T> = JSON.parse(raw);

      if (Date.now() > envelope.expiresAt) {
        fs.unlink(filePath).catch(() => {});
        return undefined;
      }

      this.l1.set(key, envelope.value);
      return envelope.value;
    } catch {
      return undefined;
    }
  }

  /**
   * Stores an item into L1 (memory) and asynchronously to L2 (disk).
   */
  async set(key: string, value: T, customTtlMs?: number): Promise<void> {
    this.l1.set(key, value);

    if (this.disabled) {
      return;
    }

    const effectiveTtl = customTtlMs ?? this.ttlMs;
    const envelope: DiskCacheEnvelope<T> = {
      key,
      value,
      createdAt: Date.now(),
      expiresAt: Date.now() + effectiveTtl,
    };

    const filePath = this.getFilePath(key);
    try {
      await fs.mkdir(this.baseDir, { recursive: true });
      await fs.writeFile(filePath, JSON.stringify(envelope), "utf-8");
    } catch {
      // Silently fall back to memory-only on disk write failure
    }
  }

  /**
   * Removes an item from L1 and L2.
   */
  async delete(key: string): Promise<boolean> {
    const memDeleted = this.l1.delete(key);
    if (!this.disabled) {
      try {
        await fs.unlink(this.getFilePath(key));
      } catch {
        // Ignore missing file errors
      }
    }
    return memDeleted;
  }

  /**
   * Clears all in-memory entries immediately and purges disk entries for this namespace.
   */
  async clear(): Promise<void> {
    this.l1.clear();
    if (!this.disabled) {
      try {
        await fs.rm(this.baseDir, { recursive: true, force: true });
      } catch {
        // Ignore disk removal errors
      }
    }
  }

  /**
   * Synchronous clear for L1 memory only.
   */
  clearMemory(): void {
    this.l1.clear();
  }

  getCacheDir(): string {
    return this.baseDir;
  }

  getNamespace(): string {
    return this.namespace;
  }
}

// 24 hours for search queries
export const searchCache = new TieredCache<SearchResultPayload>({
  maxMemory: 200,
  ttlMs: 24 * 60 * 60 * 1000,
  namespace: "search",
});

// 7 days for documentation pages (sanitized Markdown, parsed by get_cppreference_page)
export const pageCache = new TieredCache<string>({
  maxMemory: 50,
  ttlMs: 7 * 24 * 60 * 60 * 1000,
  namespace: "pages-md",
});

// 7 days for raw cppreference HTML (scraped by lookup_header / check_cpp_standard).
// Kept in a separate namespace because the same URL yields Markdown in pageCache and
// HTML here; sharing a namespace would let each tool read the other's format.
export const htmlCache = new TieredCache<string>({
  maxMemory: 50,
  ttlMs: 7 * 24 * 60 * 60 * 1000,
  namespace: "html",
});
