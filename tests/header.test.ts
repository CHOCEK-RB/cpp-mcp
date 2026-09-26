import { beforeEach, describe, expect, it } from "bun:test";
import { searchCache } from "../src/cache.js";
import { createServer } from "../src/index.js";
import { extractHeaderFromHtml, lookupHeader } from "../src/tools/header.js";

beforeEach(async () => {
  await searchCache.clear();
});

describe("extractHeaderFromHtml", () => {
  it("should extract header and standard version from MediaWiki HTML", () => {
    const html = `
      <div class="t-dcl-header">
        <div>Defined in header &lt;coroutine&gt;</div>
        <div>(since C++20)</div>
      </div>
    `;
    const result = extractHeaderFromHtml(html);
    expect(result.header).toBe("<coroutine>");
    expect(result.since).toBe("C++20");
  });

  it("should return null when header is not found", () => {
    const html = `<div>No header definition here</div>`;
    const result = extractHeaderFromHtml(html);
    expect(result.header).toBeNull();
    expect(result.since).toBeNull();
  });
});

describe("lookupHeader", () => {
  it("should return empty result for empty query", async () => {
    const result = await lookupHeader("   ");
    expect(result.found).toBe(false);
    expect(result.source).toBe("not_found");
  });

  it("should resolve standard C++ containers from static index", async () => {
    const result = await lookupHeader("std::vector");
    expect(result.found).toBe(true);
    expect(result.header).toBe("<vector>");
    expect(result.category).toBe("Sequence containers");
    expect(result.source).toBe("static_index");
  });

  it("should resolve C compatibility symbols with cEquivalent header", async () => {
    const result = await lookupHeader("printf");
    expect(result.found).toBe(true);
    expect(result.header).toBe("<cstdio>");
    expect(result.cEquivalent).toBe("<stdio.h>");
    expect(result.source).toBe("static_index");
  });

  it("should resolve symbols without std:: prefix", async () => {
    const result = await lookupHeader("sort");
    expect(result.found).toBe(true);
    expect(result.header).toBe("<algorithm>");
    expect(result.source).toBe("static_index");
  });

  it("should resolve direct header queries", async () => {
    const result = await lookupHeader("<ranges>");
    expect(result.found).toBe(true);
    expect(result.header).toBe("<ranges>");
    expect(result.since).toBe("C++20");
    expect(result.symbols).toBeDefined();
    expect(result.symbols?.length).toBeGreaterThan(0);
  });

  it("should resolve C++23 features like print and expected", async () => {
    const printRes = await lookupHeader("std::print");
    expect(printRes.header).toBe("<print>");
    expect(printRes.since).toBe("C++23");

    const expRes = await lookupHeader("std::expected");
    expect(expRes.header).toBe("<expected>");
    expect(expRes.since).toBe("C++23");
  });

  it("should resolve dynamically via fetch fallback for unindexed symbols", async () => {
    const mockHtml = `
      <div class="t-dcl-header">Defined in header &lt;custom_hdr&gt; (since C++26)</div>
    `;

    const mockFetch = async (url: string | URL | Request) => {
      const urlStr = decodeURIComponent(url.toString());
      if (urlStr.includes("Special:Search")) {
        return new Response(
          '<div class="mw-search-result-heading"><a href="/w/cpp/custom_symbol">symbol</a></div>',
          { status: 200, headers: { "Content-Type": "text/html" } },
        );
      }
      return new Response(mockHtml, {
        status: 200,
        headers: { "Content-Type": "text/html" },
      });
    };

    const result = await lookupHeader(
      "custom_symbol_unknown",
      mockFetch as unknown as typeof fetch,
    );
    expect(result.found).toBe(true);
    expect(result.header).toBe("<custom_hdr>");
    expect(result.since).toBe("C++26");
    expect(result.source).toBe("cppreference_scrape");

    // Second call should hit pageCache without calling network fetch
    let networkHit = false;
    const trackingFetch = async (url: string | URL | Request) => {
      const urlStr = decodeURIComponent(url.toString());
      if (urlStr.includes("Special:Search")) {
        return new Response(
          '<div class="mw-search-result-heading"><a href="/w/cpp/custom_symbol">symbol</a></div>',
          { status: 200, headers: { "Content-Type": "text/html" } },
        );
      }
      networkHit = true;
      throw new Error("Should have used pageCache");
    };

    const cachedResult = await lookupHeader(
      "custom_symbol_unknown",
      trackingFetch as unknown as typeof fetch,
    );
    expect(cachedResult.found).toBe(true);
    expect(cachedResult.header).toBe("<custom_hdr>");
    expect(networkHit).toBe(false);
  });

  it("should return not_found for non-existent symbols with no search results", async () => {
    const mockFetch = async () =>
      new Response("<html><body>No results found</body></html>", { status: 200 });

    const result = await lookupHeader(
      "totally_fictional_symbol_xyz_123",
      mockFetch as unknown as typeof fetch,
    );
    expect(result.found).toBe(false);
    expect(result.source).toBe("not_found");
  });

  it("should prevent SSRF and reject non-cppreference URLs in fallback", async () => {
    const mockFetch = async (url: string | URL | Request) => {
      const urlStr = decodeURIComponent(url.toString());
      if (urlStr.includes("Special:Search")) {
        return new Response(
          '<div class="mw-search-result-heading"><a href="https://malicious.com/attack">malicious</a></div>',
          { status: 200, headers: { "Content-Type": "text/html" } },
        );
      }
      throw new Error("Should not fetch non-cppreference URL");
    };

    const result = await lookupHeader("malicious_symbol", mockFetch as unknown as typeof fetch);
    expect(result.found).toBe(false);
    expect(result.source).toBe("not_found");
  });
});

describe("McpServer tool registration", () => {
  it("should have lookup_header registered in createServer", () => {
    const server = createServer();
    // @ts-expect-error accessing private property for test verification
    const tools = server._registeredTools;
    expect(tools.lookup_header).toBeDefined();
    expect(tools.search_cppreference).toBeDefined();
    expect(tools.get_cppreference_page).toBeDefined();
  });
});
