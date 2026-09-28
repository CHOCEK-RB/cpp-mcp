import { beforeEach, describe, expect, it } from "bun:test";
import { htmlCache, pageCache, searchCache } from "../src/cache.js";
import { lookupHeader } from "../src/tools/header.js";
import { getCppreferencePage } from "../src/tools/page.js";
import { checkCppStandard } from "../src/tools/standards.js";

// Regression coverage for the pageCache/htmlCache collision: the same cppreference
// URL used to be cached as Markdown by get_cppreference_page and as raw HTML by
// lookup_header/check_cpp_standard, so whichever tool ran second read the other's
// format. Each direction is asserted below.

const TARGET_URL = "https://en.cppreference.com/w/cpp/customsymbol";
const UNINDEXED_SYMBOL = "customsymbol";

const SEARCH_HTML =
  '<div class="mw-search-result-heading"><a href="/w/cpp/customsymbol">customsymbol</a></div>';

const PAGE_HTML = `
  <html>
    <body>
      <div id="content">
        <h1>customsymbol</h1>
        <div class="t-dcl-header">Defined in header &lt;custom_hdr&gt; (since C++26)</div>
        <p>Description of customsymbol.</p>
      </div>
    </body>
  </html>
`;

function makeMockFetch() {
  const fetchFn = async (url: string | URL | Request) => {
    const urlStr = decodeURIComponent(url.toString());
    const body = urlStr.includes("Special:Search") ? SEARCH_HTML : PAGE_HTML;
    return new Response(body, { status: 200, headers: { "Content-Type": "text/html" } });
  };
  return fetchFn as unknown as typeof fetch;
}

beforeEach(async () => {
  await searchCache.clear();
  await pageCache.clear();
  await htmlCache.clear();
});

describe("pageCache / htmlCache collision", () => {
  it("should keep pageCache and htmlCache in distinct namespaces", () => {
    expect(pageCache.getNamespace()).not.toBe(htmlCache.getNamespace());
  });

  it("should return Markdown from getCppreferencePage after lookupHeader cached the URL as HTML", async () => {
    const fetchFn = makeMockFetch();

    const header = await lookupHeader(UNINDEXED_SYMBOL, fetchFn);
    expect(header.found).toBe(true);
    expect(header.source).toBe("cppreference_scrape");

    const page = await getCppreferencePage(TARGET_URL, null, fetchFn);
    expect(page.content).toContain("# customsymbol");
    expect(page.content).not.toContain("<div");
    expect(page.content).not.toContain("<html");
  });

  it("should let lookupHeader scrape HTML after getCppreferencePage cached the URL as Markdown", async () => {
    const fetchFn = makeMockFetch();

    const page = await getCppreferencePage(TARGET_URL, null, fetchFn);
    expect(page.content).toContain("# customsymbol");

    const header = await lookupHeader(UNINDEXED_SYMBOL, fetchFn);
    expect(header.found).toBe(true);
    expect(header.header).toBe("<custom_hdr>");
    expect(header.source).toBe("cppreference_scrape");
  });

  it("should return Markdown from getCppreferencePage after checkCppStandard cached the URL as HTML", async () => {
    const fetchFn = makeMockFetch();

    const check = await checkCppStandard(UNINDEXED_SYMBOL, undefined, fetchFn);
    expect(check.source).toBe("cppreference_scrape");

    const page = await getCppreferencePage(TARGET_URL, null, fetchFn);
    expect(page.content).toContain("# customsymbol");
    expect(page.content).not.toContain("<div");
  });
});
