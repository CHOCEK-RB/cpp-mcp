import { beforeEach, describe, expect, it } from "bun:test";
import { searchCache } from "../src/cache.js";
import { createServer } from "../src/index.js";
import {
  checkCppStandard,
  normalizeStandard,
  parseStandardVersionsFromHtml,
} from "../src/tools/standards.js";

beforeEach(async () => {
  await searchCache.clear();
});

describe("normalizeStandard", () => {
  it("should normalize common C++ standard notations", () => {
    expect(normalizeStandard("c++20")).toBe("C++20");
    expect(normalizeStandard("cpp17")).toBe("C++17");
    expect(normalizeStandard("C++11")).toBe("C++11");
    expect(normalizeStandard("98")).toBe("C++98");
    expect(normalizeStandard("c++2a")).toBe("C++20");
    expect(normalizeStandard("c++2b")).toBe("C++23");
  });

  it("should normalize C standard notations", () => {
    expect(normalizeStandard("c99")).toBe("C99");
    expect(normalizeStandard("c11")).toBe("C11");
    expect(normalizeStandard("c23")).toBe("C23");
    expect(normalizeStandard("c89")).toBe("C89");
  });

  it("should return null for invalid standards", () => {
    expect(normalizeStandard("python3")).toBeNull();
    expect(normalizeStandard("c++77")).toBeNull();
  });
});

describe("parseStandardVersionsFromHtml", () => {
  it("should extract since, deprecated, and removed badges from HTML", () => {
    const html = `
      <div class="t-dcl-header">
        <span class="t-mark-rev">(since C++98)</span>
        <span class="t-mark-rev">(deprecated in C++11)</span>
        <span class="t-mark-rev">(removed in C++17)</span>
      </div>
    `;

    const result = parseStandardVersionsFromHtml(html);
    expect(result.since).toBe("C++98");
    expect(result.deprecatedIn).toBe("C++11");
    expect(result.removedIn).toBe("C++17");
  });

  it("should return null for pages without version badges", () => {
    const result = parseStandardVersionsFromHtml("<div>Regular content</div>");
    expect(result.since).toBeNull();
    expect(result.deprecatedIn).toBeNull();
    expect(result.removedIn).toBeNull();
  });
});

describe("checkCppStandard", () => {
  it("should return empty result for empty symbol", async () => {
    const result = await checkCppStandard("   ");
    expect(result.status).toBe("not_found");
  });

  it("should verify std::span availability and feature test macro", async () => {
    const general = await checkCppStandard("std::span");
    expect(general.status).toBe("supported");
    expect(general.since).toBe("C++20");
    expect(general.featureTestMacro?.macro).toBe("__cpp_lib_span");

    const inCpp17 = await checkCppStandard("std::span", "c++17");
    expect(inCpp17.status).toBe("unsupported");

    const inCpp20 = await checkCppStandard("std::span", "c++20");
    expect(inCpp20.status).toBe("supported");

    const inC11 = await checkCppStandard("std::span", "c11");
    expect(inC11.status).toBe("unsupported");
  });

  it("should correctly identify deprecated and removed historical symbols", async () => {
    const autoPtrCpp98 = await checkCppStandard("std::auto_ptr", "c++98");
    expect(autoPtrCpp98.status).toBe("supported");

    const autoPtrCpp14 = await checkCppStandard("std::auto_ptr", "c++14");
    expect(autoPtrCpp14.status).toBe("deprecated");

    const autoPtrCpp17 = await checkCppStandard("std::auto_ptr", "c++17");
    expect(autoPtrCpp17.status).toBe("removed");

    const autoPtrCpp20 = await checkCppStandard("std::auto_ptr", "c++20");
    expect(autoPtrCpp20.status).toBe("removed");

    const autoPtrC99 = await checkCppStandard("std::auto_ptr", "c99");
    expect(autoPtrC99.status).toBe("unsupported");
  });

  it("should correctly identify deprecated and removed historical symbols without std:: prefix", async () => {
    const shuffle = await checkCppStandard("random_shuffle", "c++17");
    expect(shuffle.status).toBe("removed");
    expect(shuffle.since).toBe("C++98");
    expect(shuffle.source).toBe("static_index");
  });

  it("should resolve feature test macros for bare symbol names", async () => {
    const span = await checkCppStandard("span", "c++20");
    expect(span.status).toBe("supported");
    expect(span.featureTestMacro?.macro).toBe("__cpp_lib_span");
  });

  it("should verify C++23 features like std::print and std::expected", async () => {
    const printCpp20 = await checkCppStandard("std::print", "c++20");
    expect(printCpp20.status).toBe("unsupported");

    const printCpp23 = await checkCppStandard("std::print", "c++23");
    expect(printCpp23.status).toBe("supported");
    expect(printCpp23.featureTestMacro?.macro).toBe("__cpp_lib_print");
  });

  it("should dynamically parse standards via fallback for unindexed symbols", async () => {
    const mockHtml = `
      <div class="t-dcl-header">
        <span class="t-mark-rev">(since C++20)</span>
        <span class="t-mark-rev">(deprecated in C++23)</span>
      </div>
    `;

    const mockFetch = async (url: string | URL | Request) => {
      const urlStr = decodeURIComponent(url.toString());
      if (urlStr.includes("Special:Search")) {
        return new Response(
          '<div class="mw-search-result-heading"><a href="/w/cpp/custom_feature">feature</a></div>',
          { status: 200, headers: { "Content-Type": "text/html" } },
        );
      }
      return new Response(mockHtml, {
        status: 200,
        headers: { "Content-Type": "text/html" },
      });
    };

    const res = await checkCppStandard(
      "custom_feature_foo",
      "c++23",
      mockFetch as unknown as typeof fetch,
    );
    expect(res.status).toBe("deprecated");
    expect(res.since).toBe("C++20");
    expect(res.deprecatedIn).toBe("C++23");
    expect(res.source).toBe("cppreference_scrape");
  });

  it("should protect against SSRF in fallback fetch", async () => {
    const mockFetch = async (url: string | URL | Request) => {
      const urlStr = decodeURIComponent(url.toString());
      if (urlStr.includes("Special:Search")) {
        return new Response(
          '<div class="mw-search-result-heading"><a href="https://attacker.com/evil">evil</a></div>',
          { status: 200, headers: { "Content-Type": "text/html" } },
        );
      }
      throw new Error("Should not fetch non-cppreference URL");
    };

    const res = await checkCppStandard(
      "attack_vector",
      "c++20",
      mockFetch as unknown as typeof fetch,
    );
    expect(res.status).toBe("not_found");
  });
});

describe("McpServer check_cpp_standard registration", () => {
  it("should have check_cpp_standard tool registered", () => {
    const server = createServer();
    // @ts-expect-error accessing private property for test verification
    const tools = server._registeredTools;
    expect(tools.check_cpp_standard).toBeDefined();
  });
});
