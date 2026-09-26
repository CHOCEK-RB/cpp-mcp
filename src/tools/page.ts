import * as cheerio from "cheerio";
import TurndownService from "turndown";
import { type PageResultPayload, pageCache } from "../cache.js";

export const PAGE_SIZE = 1024 * 16;
export const USER_AGENT = "cpp-mcp/0.1.0 (+https://github.com/CHOCEK-RB/cpp-mcp)";
export const HTTP_TIMEOUT_MS = 15_000;

const turndownService = new TurndownService({
  headingStyle: "atx",
  codeBlockStyle: "fenced",
  hr: "---",
});

/**
 * Validates that a URL is a secure HTTPS link to cppreference.com or a valid subdomain.
 */
export function isValidCppReferenceUrl(urlStr: string): boolean {
  try {
    const parsed = new URL(urlStr);
    const isHttps = parsed.protocol === "https:";
    const isCppRef =
      parsed.hostname === "cppreference.com" || parsed.hostname.endsWith(".cppreference.com");
    return isHttps && isCppRef;
  } catch {
    return false;
  }
}

/**
 * Retrieves a cppreference documentation page, strips MediaWiki clutter,
 * converts the main content to Markdown, and returns paginated fragments.
 */
export async function getCppreferencePage(
  rawUrl: string,
  cursor?: string | null,
  fetchFn: typeof fetch = fetch,
): Promise<PageResultPayload> {
  const url = rawUrl.trim();
  if (!isValidCppReferenceUrl(url)) {
    throw new Error(
      `Invalid URL: "${url}". Only HTTPS URLs from cppreference.com (e.g. en.cppreference.com) are allowed.`,
    );
  }

  let startIndex = 0;
  if (cursor) {
    const parsedCursor = Number.parseInt(cursor, 10);
    if (Number.isNaN(parsedCursor) || parsedCursor < 0) {
      throw new Error(`Invalid pagination cursor: "${cursor}". Expected a non-negative integer.`);
    }
    startIndex = parsedCursor;
  }

  let fullMarkdown = await pageCache.get(url);

  if (!fullMarkdown) {
    const response = await fetchFn(url, {
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "text/html,application/xhtml+xml",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    });

    if (!response.ok) {
      throw new Error(`Failed to retrieve page "${url}" (HTTP Status ${response.status})`);
    }

    const html = await response.text();
    const $ = cheerio.load(html);

    // Isolate documentation content and eliminate navigation chrome
    const content = $("#content").length ? $("#content") : $("#mw-content-text");

    content
      .find(
        "#toc, #catlinks, .printfooter, .mw-editsection, #siteNotice, .noprint, #mw-navigation, nav, footer, header",
      )
      .remove();

    // Rewrite relative links to absolute HTTPS URLs
    content.find("a").each((_, el) => {
      const href = $(el).attr("href");
      if (
        href &&
        (href.startsWith("/c/") ||
          href.startsWith("/cpp/") ||
          href.startsWith("/w/") ||
          href === "/c" ||
          href === "/cpp")
      ) {
        try {
          $(el).attr("href", new URL(href, url).toString());
        } catch {
          // Keep original href if URL resolution fails
        }
      }
    });

    const cleanHtml = content.html() || "";
    fullMarkdown = turndownService.turndown(cleanHtml).trim();
    await pageCache.set(url, fullMarkdown);
  }

  const endIndex = Math.min(startIndex + PAGE_SIZE, fullMarkdown.length);
  const contentChunk = fullMarkdown.slice(startIndex, endIndex);
  const nextCursor = endIndex < fullMarkdown.length ? endIndex.toString() : null;

  return {
    content: contentChunk,
    next_cursor: nextCursor,
  };
}
