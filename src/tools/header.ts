import * as cheerio from "cheerio";
import { HEADER_MAP, SYMBOL_MAP } from "../data/headers.js";
import { isValidCppReferenceUrl } from "./page.js";
import { searchCppreference } from "./search.js";

export interface HeaderLookupResult {
  query: string;
  found: boolean;
  header?: string;
  standard?: "C" | "C++";
  since?: string;
  category?: string;
  cEquivalent?: string;
  url?: string;
  matchedSymbol?: string;
  symbols?: string[];
  source: "static_index" | "cppreference_scrape" | "not_found";
}

/**
 * Extracts standard header from cppreference HTML documentation page.
 * cppreference typically places headers in .t-dsc-header or .t-dcl-header as "Defined in header <xyz>"
 */
export function extractHeaderFromHtml(html: string): {
  header: string | null;
  since: string | null;
} {
  const $ = cheerio.load(html);

  // Look for text in definition headers
  const headerText = $(".t-dsc-header, .t-dcl-header, table.t-dcl-begin")
    .text()
    .replace(/\s+/g, " ");

  const match = headerText.match(
    /Defined in header\s*(?:&lt;|<)\s*([a-zA-Z0-9_./]+)\s*(?:&gt;|>)/i,
  );
  let header: string | null = null;
  if (match?.[1]) {
    header = `<${match[1]}>`;
  }

  // Fallback: search anywhere in page for "Defined in header <...>"
  if (!header) {
    const rawMatch = html.match(
      /Defined in header\s*(?:&lt;|<|&lt;)?([a-zA-Z0-9_./]+)(?:&gt;|>|&gt;)?/i,
    );
    if (rawMatch?.[1]) {
      header = `<${rawMatch[1]}>`;
    }
  }

  // Extract C++ standard introduction if available (e.g. "(since C++20)")
  const sinceMatch = html.match(/\((?:since|deprecated in|until)\s+([cC]\+\+\d{2})\)/);
  const since = sinceMatch?.[1] ? sinceMatch[1].toUpperCase() : null;

  return { header, since };
}

/**
 * Resolves the standard C or C++ header for a given symbol, function, or header name.
 */
export async function lookupHeader(
  query: string,
  fetchFn: typeof fetch = fetch,
): Promise<HeaderLookupResult> {
  const rawQuery = query.trim();
  if (!rawQuery) {
    return { query: "", found: false, source: "not_found" };
  }

  const normalized = rawQuery.toLowerCase();

  // 1. Direct header match: "<vector>", "vector", "<stdio.h>", "stdio.h"
  const cleanHeader = normalized.replace(/[<>]/g, "");
  const directHeader = HEADER_MAP.get(cleanHeader) || HEADER_MAP.get(normalized);
  if (directHeader) {
    return {
      query: rawQuery,
      found: true,
      header: directHeader.header,
      standard: directHeader.standard,
      since: directHeader.since,
      category: directHeader.category,
      cEquivalent: directHeader.cEquivalent,
      url: `https://en.cppreference.com/w/cpp/header/${cleanHeader}`,
      symbols: directHeader.symbols,
      source: "static_index",
    };
  }

  // 2. Direct symbol match from static index: "std::vector", "printf", "sort"
  const matchedSymbolEntry =
    SYMBOL_MAP.get(rawQuery) ||
    SYMBOL_MAP.get(rawQuery.toLowerCase()) ||
    SYMBOL_MAP.get(rawQuery.replace(/^std::/, ""));

  if (matchedSymbolEntry) {
    return {
      query: rawQuery,
      found: true,
      header: matchedSymbolEntry.header,
      standard: matchedSymbolEntry.standard,
      since: matchedSymbolEntry.since,
      category: matchedSymbolEntry.category,
      cEquivalent: matchedSymbolEntry.cEquivalent,
      matchedSymbol: rawQuery,
      symbols: matchedSymbolEntry.symbols.slice(0, 10),
      source: "static_index",
    };
  }

  // 3. Fallback: Dynamic resolution via cppreference search & scrape
  try {
    const searchResult = await searchCppreference(rawQuery, fetchFn);
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
        const extracted = extractHeaderFromHtml(html);

        if (extracted.header) {
          return {
            query: rawQuery,
            found: true,
            header: extracted.header,
            standard: "C++",
            since: extracted.since || undefined,
            url: targetUrl,
            source: "cppreference_scrape",
          };
        }
      }
    }
  } catch {
    // Dynamic resolution failure falls back to not_found
  }

  return {
    query: rawQuery,
    found: false,
    source: "not_found",
  };
}
