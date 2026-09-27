import { describe, expect, it } from "bun:test";
import { pageCache, searchCache } from "../src/cache.js";
import { createServer } from "../src/index.js";
import { getCppreferencePage, isValidCppReferenceUrl } from "../src/tools/page.js";
import { searchCppreference } from "../src/tools/search.js";

describe("searchCppreference", () => {
  it("should return empty results for empty query", async () => {
    const result = await searchCppreference("   ");
    expect(result.query).toBe("");
    expect(result.result_urls).toEqual([]);
  });

  it("should extract search result links from HTML", async () => {
    await searchCache.clear();
    const mockHtml = `
      <html>
        <body>
          <div class="mw-search-result-heading"><a href="/w/cpp/container/vector">std::vector</a></div>
          <div class="mw-search-result-heading"><a href="/w/cpp/container/vector/push_back">push_back</a></div>
        </body>
      </html>
    `;

    const mockFetch = async () =>
      new Response(mockHtml, {
        status: 200,
        headers: { "Content-Type": "text/html" },
      });

    const result = await searchCppreference("std::vector", mockFetch as unknown as typeof fetch);
    expect(result.query).toBe("std::vector");
    expect(result.result_urls).toHaveLength(2);
    expect(result.result_urls[0]).toBe("https://en.cppreference.com/w/cpp/container/vector");
  });

  it("should handle direct redirects without search results", async () => {
    await searchCache.clear();
    const mockHtml = `<html><body><h1>std::vector</h1></body></html>`;
    const mockResponse = new Response(mockHtml, {
      status: 200,
      headers: { "Content-Type": "text/html" },
    });
    Object.defineProperty(mockResponse, "url", {
      value: "https://en.cppreference.com/w/cpp/container/vector",
    });

    const mockFetch = async () => mockResponse;

    const result = await searchCppreference("std::vector", mockFetch as unknown as typeof fetch);
    expect(result.result_urls).toEqual(["https://en.cppreference.com/w/cpp/container/vector"]);
  });

  it("should return cached results on repeated queries", async () => {
    await searchCache.clear();
    let callCount = 0;
    const mockFetch = async () => {
      callCount++;
      return new Response(
        '<div class="mw-search-result-heading"><a href="/w/cpp/string">std::string</a></div>',
        { status: 200 },
      );
    };

    await searchCppreference("string", mockFetch as unknown as typeof fetch);
    await searchCppreference("string", mockFetch as unknown as typeof fetch);

    expect(callCount).toBe(1);
  });
});

describe("getCppreferencePage", () => {
  it("should validate and allow cppreference.com and its subdomains", () => {
    expect(isValidCppReferenceUrl("https://cppreference.com/w/cpp/string")).toBe(true);
    expect(isValidCppReferenceUrl("https://en.cppreference.com/w/cpp/container/vector")).toBe(true);
    expect(isValidCppReferenceUrl("http://cppreference.com/insecure")).toBe(false);
    expect(isValidCppReferenceUrl("https://malicious.com")).toBe(false);
  });

  it("should throw error for invalid or non-cppreference URLs", async () => {
    expect(getCppreferencePage("https://example.com")).rejects.toThrow("Invalid URL");
    expect(getCppreferencePage("ftp://cppreference.com")).rejects.toThrow("Invalid URL");
  });

  it("should clean MediaWiki noise and convert HTML to Markdown", async () => {
    await pageCache.clear();
    const sampleHtml = `
      <html>
        <body>
          <div id="content">
            <div id="toc">Table of contents</div>
            <div class="mw-editsection">[edit]</div>
            <div id="siteNotice">Notice</div>
            <h1>std::vector</h1>
            <p>A sequence container that encapsulates dynamic size arrays.</p>
            <a href="/w/cpp/container">Containers</a>
          </div>
          <div id="mw-navigation">Navigation links</div>
        </body>
      </html>
    `;

    const mockFetch = async () =>
      new Response(sampleHtml, {
        status: 200,
        headers: { "Content-Type": "text/html" },
      });

    const result = await getCppreferencePage(
      "https://en.cppreference.com/w/cpp/container/vector",
      null,
      mockFetch as unknown as typeof fetch,
    );

    expect(result.content).toContain("# std::vector");
    expect(result.content).toContain("A sequence container");
    expect(result.content).not.toContain("Table of contents");
    expect(result.content).not.toContain("[edit]");
    expect(result.content).not.toContain("Navigation links");
    expect(result.content).toContain("(https://en.cppreference.com/w/cpp/container)");
    expect(result.next_cursor).toBeNull();
  });

  it("should support pagination cursor", async () => {
    await pageCache.clear();
    const longText = "A".repeat(20000);
    const mockHtml = `<div id="content"><p>${longText}</p></div>`;
    const mockFetch = async () => new Response(mockHtml, { status: 200 });

    const page1 = await getCppreferencePage(
      "https://en.cppreference.com/w/cpp/long",
      null,
      mockFetch as unknown as typeof fetch,
    );

    expect(page1.next_cursor).not.toBeNull();
    expect(page1.content.length).toBeLessThanOrEqual(16384);

    const page2 = await getCppreferencePage(
      "https://en.cppreference.com/w/cpp/long",
      page1.next_cursor,
      mockFetch as unknown as typeof fetch,
    );

    expect(page2.content.length).toBeGreaterThan(0);
  });
});

describe("McpServer setup", () => {
  it("should create server with registered tools", () => {
    const server = createServer();
    expect(server).toBeDefined();
    // @ts-expect-error accessing private property for test verification
    const tools = server._registeredTools;
    expect(tools.search_code_symbols).toBeDefined();
    expect(tools.analyze_code_symbol).toBeDefined();
  });
});
