// src/tools/fetch-utils.ts
// Resilient HTTP fetcher with exponential backoff for rate limiting (429) and transient server errors (5xx).

export interface RetryOptions {
  maxRetries?: number;
  backoffMs?: number[];
}

export const RETRYABLE_STATUS_CODES = new Set([429, 500, 502, 503, 504]);

export async function fetchWithRetry(
  url: string | URL | Request,
  init: RequestInit,
  fetchFn: typeof fetch = fetch,
  options: RetryOptions = {},
): Promise<Response> {
  const maxRetries = options.maxRetries ?? 2;
  const backoffMs = options.backoffMs ?? [500, 1500];

  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetchFn(url, init);

      if (RETRYABLE_STATUS_CODES.has(response.status)) {
        if (attempt < maxRetries) {
          const delay = backoffMs[attempt] ?? 1000;
          await new Promise((resolve) => setTimeout(resolve, delay));
          continue;
        }
      }

      return response;
    } catch (err) {
      lastError = err;
      if (attempt < maxRetries) {
        const delay = backoffMs[attempt] ?? 1000;
        await new Promise((resolve) => setTimeout(resolve, delay));
        continue;
      }
      throw err;
    }
  }

  throw lastError ?? new Error(`Request to ${url.toString()} failed after ${maxRetries} retries`);
}
