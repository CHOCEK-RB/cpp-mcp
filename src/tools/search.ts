import * as cheerio from "cheerio";
import { type SearchResultPayload, searchCache } from "../cache.js";
import { fetchWithRetry } from "./fetch-utils.js";
import { USER_AGENT } from "./page.js";

export const BASE_URL = "https://en.cppreference.com";
export { USER_AGENT };
export const MAX_SEARCH_RESULTS = 5;
export const HTTP_TIMEOUT_MS = 15_000;

/**
 * Searches cppreference.com for C/C++ language, library, and compiler symbols.
 */
export async function searchCppreference(
  query: string,
  fetchFn: typeof fetch = fetch,
): Promise<SearchResultPayload> {
  const normalizedQuery = query.trim();
  if (!normalizedQuery) {
    return { query: "", result_urls: [] };
  }

  const cached = await searchCache.get(normalizedQuery);
  if (cached) {
    return cached;
  }

  const searchUrl = new URL("/index.php", BASE_URL);
  searchUrl.searchParams.set("title", "Special:Search");
  searchUrl.searchParams.set("search", normalizedQuery);

  const response = await fetchWithRetry(
    searchUrl.toString(),
    {
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "text/html,application/xhtml+xml",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    },
    fetchFn,
  );

  if (!response.ok) {
    throw new Error(
      `Search request failed for query "${normalizedQuery}" with status ${response.status}`,
    );
  }

  const html = await response.text();
  const finalUrl = response.url || searchUrl.toString();

  // If MediaWiki redirected directly to an exact symbol documentation page
  const isDirectRedirect = !finalUrl.includes("Special:Search") && !finalUrl.includes("index.php");

  const $ = cheerio.load(html);
  const searchHeadings = $(".mw-search-result-heading a");

  if (isDirectRedirect && searchHeadings.length === 0) {
    const directResult: SearchResultPayload = {
      query: normalizedQuery,
      result_urls: [finalUrl],
    };
    await searchCache.set(normalizedQuery, directResult);
    return directResult;
  }

  const urls: string[] = [];
  const seen = new Set<string>();

  searchHeadings.each((_, el) => {
    if (urls.length >= MAX_SEARCH_RESULTS) {
      return false;
    }
    const href = $(el).attr("href");
    if (!href) {
      return;
    }

    try {
      const fullUrl = new URL(href, finalUrl).toString();
      if (!seen.has(fullUrl)) {
        seen.add(fullUrl);
        urls.push(fullUrl);
      }
    } catch {
      // Ignore invalid URL formatting
    }
  });

  const result: SearchResultPayload = {
    query: normalizedQuery,
    result_urls: urls,
  };

  await searchCache.set(normalizedQuery, result);
  return result;
}
