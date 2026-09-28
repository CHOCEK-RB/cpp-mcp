import { htmlCache } from "../cache.js";
import { fetchWithRetry } from "./fetch-utils.js";
import { HTTP_TIMEOUT_MS, USER_AGENT } from "./page.js";

/**
 * Fetches a cppreference page as raw HTML, caching the response in the dedicated
 * HTML namespace. Returns null on a non-OK response or network failure.
 *
 * Callers must validate the URL with isValidCppReferenceUrl before calling this.
 * Raw HTML is cached here (not in pageCache, which stores Markdown) so scraper
 * tools never read a document converted by get_cppreference_page.
 */
export async function getHtmlCached(
  url: string,
  fetchFn: typeof fetch = fetch,
): Promise<string | null> {
  const cached = await htmlCache.get(url);
  if (cached) {
    return cached;
  }

  const response = await fetchWithRetry(
    url,
    {
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "text/html,application/xhtml+xml",
      },
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    },
    fetchFn,
  );

  if (!response.ok) {
    return null;
  }

  const html = await response.text();
  await htmlCache.set(url, html);
  return html;
}
