import * as cheerio from "cheerio";
import { CPP_STANDARD_HEADERS, SYMBOL_MAP } from "../data/headers.js";
import { isValidCppReferenceUrl } from "./page.js";
import { searchCppreference } from "./search.js";

export const CPP_STANDARDS = [
  "C++98",
  "C++03",
  "C++11",
  "C++14",
  "C++17",
  "C++20",
  "C++23",
  "C++26",
] as const;
export const C_STANDARDS = ["C89", "C90", "C99", "C11", "C17", "C23"] as const;

export type CppStandard = (typeof CPP_STANDARDS)[number];
export type CStandard = (typeof C_STANDARDS)[number];

export interface FeatureTestMacroInfo {
  macro: string;
  value: string;
  since: string;
}

export const FEATURE_TEST_MACROS: Record<string, FeatureTestMacroInfo> = {
  "std::span": { macro: "__cpp_lib_span", value: "202002L", since: "C++20" },
  "std::format": { macro: "__cpp_lib_format", value: "201907L", since: "C++20" },
  "std::print": { macro: "__cpp_lib_print", value: "202207L", since: "C++23" },
  "std::println": { macro: "__cpp_lib_print", value: "202207L", since: "C++23" },
  "std::expected": { macro: "__cpp_lib_expected", value: "202202L", since: "C++23" },
  "std::ranges": { macro: "__cpp_lib_ranges", value: "201911L", since: "C++20" },
  "std::optional": { macro: "__cpp_lib_optional", value: "201606L", since: "C++17" },
  "std::variant": { macro: "__cpp_lib_variant", value: "202102L", since: "C++17" },
  "std::any": { macro: "__cpp_lib_any", value: "201606L", since: "C++17" },
  "std::string_view": { macro: "__cpp_lib_string_view", value: "201606L", since: "C++17" },
  "std::filesystem": { macro: "__cpp_lib_filesystem", value: "201703L", since: "C++17" },
  "std::jthread": { macro: "__cpp_lib_jthread", value: "201911L", since: "C++20" },
  "std::mdspan": { macro: "__cpp_lib_mdspan", value: "202207L", since: "C++23" },
  "std::flat_map": { macro: "__cpp_lib_flat_map", value: "202207L", since: "C++23" },
  "std::generator": { macro: "__cpp_lib_generator", value: "202207L", since: "C++23" },
  "std::bit_cast": { macro: "__cpp_lib_bit_cast", value: "201806L", since: "C++20" },
  "std::source_location": { macro: "__cpp_lib_source_location", value: "201907L", since: "C++20" },
  "std::stacktrace": { macro: "__cpp_lib_stacktrace", value: "202011L", since: "C++23" },
};

// Known historical deprecations and removals
interface DeprecationRecord {
  since: string;
  deprecatedIn?: string;
  removedIn?: string;
  standard: "C++" | "C";
}

const HISTORICAL_SYMBOLS: Record<string, DeprecationRecord> = {
  "std::auto_ptr": { since: "C++98", deprecatedIn: "C++11", removedIn: "C++17", standard: "C++" },
  auto_ptr: { since: "C++98", deprecatedIn: "C++11", removedIn: "C++17", standard: "C++" },
  "std::random_shuffle": {
    since: "C++98",
    deprecatedIn: "C++14",
    removedIn: "C++17",
    standard: "C++",
  },
  "std::bind1st": { since: "C++98", deprecatedIn: "C++11", removedIn: "C++17", standard: "C++" },
  "std::bind2nd": { since: "C++98", deprecatedIn: "C++11", removedIn: "C++17", standard: "C++" },
  "std::raw_storage_iterator": {
    since: "C++98",
    deprecatedIn: "C++17",
    removedIn: "C++20",
    standard: "C++",
  },
  gets: { since: "C89", deprecatedIn: "C99", removedIn: "C11", standard: "C" },
  register: { since: "C++98", deprecatedIn: "C++11", removedIn: "C++17", standard: "C++" },
};

export interface StandardCheckResult {
  symbol: string;
  standard: "C++" | "C";
  since: string;
  deprecatedIn?: string;
  removedIn?: string;
  targetStandard?: string;
  status: "supported" | "unsupported" | "deprecated" | "removed" | "not_found";
  featureTestMacro?: { macro: string; value: string };
  summary: string;
  url?: string;
  source: "static_index" | "cppreference_scrape" | "not_found";
}

/**
 * Normalizes user input standard strings into canonical standard representation (e.g. "c++20" -> "C++20").
 */
export function normalizeStandard(stdStr: string): string | null {
  const clean = stdStr.trim().toUpperCase().replace(/\s+/g, "");

  // Match C++ standard variants
  if (/^C\+\+98$|^CPP98$|^98$/.test(clean)) return "C++98";
  if (/^C\+\+03$|^CPP03$|^03$/.test(clean)) return "C++03";
  if (/^C\+\+11$|^CPP11$|^11$|^C\+\+0X$/.test(clean)) return "C++11";
  if (/^C\+\+14$|^CPP14$|^14$|^C\+\+1Y$/.test(clean)) return "C++14";
  if (/^C\+\+17$|^CPP17$|^17$|^C\+\+1Z$/.test(clean)) return "C++17";
  if (/^C\+\+20$|^CPP20$|^20$|^C\+\+2A$/.test(clean)) return "C++20";
  if (/^C\+\+23$|^CPP23$|^23$|^C\+\+2B$/.test(clean)) return "C++23";
  if (/^C\+\+26$|^CPP26$|^26$|^C\+\+2C$/.test(clean)) return "C++26";

  // Match C standard variants
  if (/^C89$|^C90$/.test(clean)) return "C89";
  if (/^C99$/.test(clean)) return "C99";
  if (/^C11$/.test(clean)) return "C11";
  if (/^C17$|^C18$/.test(clean)) return "C17";
  if (/^C23$/.test(clean)) return "C23";

  return null;
}

function compareStandards(stdA: string, stdB: string): number {
  const cppIdxA = CPP_STANDARDS.indexOf(stdA as CppStandard);
  const cppIdxB = CPP_STANDARDS.indexOf(stdB as CppStandard);

  if (cppIdxA !== -1 && cppIdxB !== -1) {
    return cppIdxA - cppIdxB;
  }

  const cIdxA = C_STANDARDS.indexOf(stdA as CStandard);
  const cIdxB = C_STANDARDS.indexOf(stdB as CStandard);

  if (cIdxA !== -1 && cIdxB !== -1) {
    return cIdxA - cIdxB;
  }

  return 0;
}

/**
 * Parses standard revisions (since, deprecated, removed) from cppreference HTML markup.
 */
export function parseStandardVersionsFromHtml(html: string): {
  since: string | null;
  deprecatedIn: string | null;
  removedIn: string | null;
} {
  const $ = cheerio.load(html);
  let since: string | null = null;
  let deprecatedIn: string | null = null;
  let removedIn: string | null = null;

  // Search inside rev marks (.t-mark-rev)
  $(".t-mark-rev, .t-dcl-header, table.t-dcl-begin").each((_, el) => {
    const text = $(el).text().replace(/\s+/g, " ");

    const sinceMatch = text.match(/\((?:since|from)\s+([cC](?:\+\+)?\d{2})\)/i);
    if (sinceMatch?.[1] && !since) {
      since = normalizeStandard(sinceMatch[1]);
    }

    const depMatch = text.match(/\((?:deprecated in)\s+([cC](?:\+\+)?\d{2})\)/i);
    if (depMatch?.[1] && !deprecatedIn) {
      deprecatedIn = normalizeStandard(depMatch[1]);
    }

    const remMatch = text.match(/\((?:removed in|until)\s+([cC](?:\+\+)?\d{2})\)/i);
    if (remMatch?.[1] && !removedIn) {
      removedIn = normalizeStandard(remMatch[1]);
    }
  });

  // Global regex fallback across HTML content
  if (!since) {
    const fallbackSince = html.match(/\((?:since|from)\s+([cC]\+\+\d{2}|[cC]\d{2})\)/i);
    if (fallbackSince?.[1]) since = normalizeStandard(fallbackSince[1]);
  }
  if (!deprecatedIn) {
    const fallbackDep = html.match(/\((?:deprecated in)\s+([cC]\+\+\d{2}|[cC]\d{2})\)/i);
    if (fallbackDep?.[1]) deprecatedIn = normalizeStandard(fallbackDep[1]);
  }
  if (!removedIn) {
    const fallbackRem = html.match(/\((?:removed in|until)\s+([cC]\+\+\d{2}|[cC]\d{2})\)/i);
    if (fallbackRem?.[1]) removedIn = normalizeStandard(fallbackRem[1]);
  }

  return { since, deprecatedIn, removedIn };
}

/**
 * Checks a C or C++ symbol or header against standard language versions.
 */
export async function checkCppStandard(
  rawSymbol: string,
  rawTargetStandard?: string,
  fetchFn: typeof fetch = fetch,
): Promise<StandardCheckResult> {
  const symbol = rawSymbol.trim();
  if (!symbol) {
    return {
      symbol: "",
      standard: "C++",
      since: "",
      status: "not_found",
      summary: "Empty symbol provided.",
      source: "not_found",
    };
  }

  const targetStandard = rawTargetStandard
    ? normalizeStandard(rawTargetStandard) || undefined
    : undefined;

  // 1. Check historical removals database
  const historical = HISTORICAL_SYMBOLS[symbol] || HISTORICAL_SYMBOLS[symbol.toLowerCase()];
  if (historical) {
    let status: StandardCheckResult["status"] = "supported";
    if (targetStandard) {
      const isTargetC = C_STANDARDS.includes(targetStandard as CStandard);
      const isSymbolCpp = historical.standard === "C++";

      if (isTargetC && isSymbolCpp) {
        status = "unsupported";
      } else if (compareStandards(targetStandard, historical.since) < 0) {
        status = "unsupported";
      } else if (
        historical.removedIn &&
        compareStandards(targetStandard, historical.removedIn) >= 0
      ) {
        status = "removed";
      } else if (
        historical.deprecatedIn &&
        compareStandards(targetStandard, historical.deprecatedIn) >= 0
      ) {
        status = "deprecated";
      }
    } else {
      status = historical.removedIn
        ? "removed"
        : historical.deprecatedIn
          ? "deprecated"
          : "supported";
    }

    return {
      symbol,
      standard: historical.standard,
      since: historical.since,
      deprecatedIn: historical.deprecatedIn,
      removedIn: historical.removedIn,
      targetStandard,
      status,
      summary: `${symbol} was introduced in ${historical.since}${
        historical.deprecatedIn ? `, deprecated in ${historical.deprecatedIn}` : ""
      }${historical.removedIn ? `, and removed in ${historical.removedIn}` : ""}. Status: ${status}.`,
      source: "static_index",
    };
  }

  // 2. Check static headers and symbol index
  const matchedSymbolEntry =
    SYMBOL_MAP.get(symbol) ||
    SYMBOL_MAP.get(symbol.toLowerCase()) ||
    SYMBOL_MAP.get(symbol.replace(/^std::/, ""));

  const matchedHeader = CPP_STANDARD_HEADERS.find(
    (h) =>
      h.header.toLowerCase() === symbol.toLowerCase() ||
      h.header.replace(/[<>]/g, "").toLowerCase() === symbol.toLowerCase(),
  );

  const staticSince = matchedSymbolEntry?.since || matchedHeader?.since;
  const staticStandard = matchedSymbolEntry?.standard || matchedHeader?.standard || "C++";

  if (staticSince) {
    let status: StandardCheckResult["status"] = "supported";
    if (targetStandard) {
      const isTargetC = C_STANDARDS.includes(targetStandard as CStandard);
      const isSymbolCpp = staticStandard === "C++";

      if (isTargetC && isSymbolCpp) {
        status = "unsupported";
      } else if (compareStandards(targetStandard, staticSince) < 0) {
        status = "unsupported";
      }
    }

    const macro = FEATURE_TEST_MACROS[symbol];
    return {
      symbol,
      standard: staticStandard,
      since: staticSince,
      targetStandard,
      status,
      featureTestMacro: macro ? { macro: macro.macro, value: macro.value } : undefined,
      summary: `${symbol} is available since ${staticSince}. Target standard ${
        targetStandard || "any"
      }: ${status}.`,
      source: "static_index",
    };
  }

  // 3. Fallback: Dynamic scraping of symbol documentation
  try {
    const searchResult = await searchCppreference(symbol, fetchFn);
    const targetUrl = searchResult.result_urls[0];
    if (targetUrl && isValidCppReferenceUrl(targetUrl)) {
      const pageResponse = await fetchFn(targetUrl, {
        headers: {
          "User-Agent": "cpp-mcp/1.0.0 (+https://github.com/CHOCEK-RB/cpp-mcp)",
          Accept: "text/html,application/xhtml+xml",
        },
        signal: AbortSignal.timeout(15_000),
      });

      if (pageResponse.ok) {
        const html = await pageResponse.text();
        const parsed = parseStandardVersionsFromHtml(html);
        const resolvedSince = parsed.since || "C++98";

        let status: StandardCheckResult["status"] = "supported";
        if (targetStandard) {
          const isTargetC = C_STANDARDS.includes(targetStandard as CStandard);
          const isSymbolCpp = true;

          if (isTargetC && isSymbolCpp) {
            status = "unsupported";
          } else if (compareStandards(targetStandard, resolvedSince) < 0) {
            status = "unsupported";
          } else if (parsed.removedIn && compareStandards(targetStandard, parsed.removedIn) >= 0) {
            status = "removed";
          } else if (
            parsed.deprecatedIn &&
            compareStandards(targetStandard, parsed.deprecatedIn) >= 0
          ) {
            status = "deprecated";
          }
        } else {
          status = parsed.removedIn ? "removed" : parsed.deprecatedIn ? "deprecated" : "supported";
        }

        const macro = FEATURE_TEST_MACROS[symbol];
        return {
          symbol,
          standard: "C++",
          since: resolvedSince,
          deprecatedIn: parsed.deprecatedIn || undefined,
          removedIn: parsed.removedIn || undefined,
          targetStandard,
          status,
          featureTestMacro: macro ? { macro: macro.macro, value: macro.value } : undefined,
          url: targetUrl,
          summary: `${symbol} is available since ${resolvedSince}${
            parsed.deprecatedIn ? `, deprecated in ${parsed.deprecatedIn}` : ""
          }${parsed.removedIn ? `, and removed in ${parsed.removedIn}` : ""}. Status: ${status}.`,
          source: "cppreference_scrape",
        };
      }
    }
  } catch {
    // Graceful fallback to not_found
  }

  return {
    symbol,
    standard: "C++",
    since: "unknown",
    status: "not_found",
    summary: `Could not determine language standard for symbol "${symbol}".`,
    source: "not_found",
  };
}
