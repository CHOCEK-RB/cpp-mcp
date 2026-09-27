// tests/fetch-utils.test.ts
import { describe, expect, it } from "bun:test";
import { fetchWithRetry } from "../src/tools/fetch-utils.js";

describe("fetchWithRetry", () => {
  it("should return immediately when request succeeds on first attempt", async () => {
    let calls = 0;
    const mockFetch = async () => {
      calls++;
      return new Response("OK", { status: 200 });
    };

    const res = await fetchWithRetry(
      "https://example.com",
      {},
      mockFetch as unknown as typeof fetch,
    );
    expect(res.status).toBe(200);
    expect(calls).toBe(1);
  });

  it("should retry on HTTP 429 rate-limit and succeed on next attempt", async () => {
    let calls = 0;
    const mockFetch = async () => {
      calls++;
      if (calls === 1) {
        return new Response("Too Many Requests", { status: 429 });
      }
      return new Response("Success", { status: 200 });
    };

    const res = await fetchWithRetry(
      "https://example.com",
      {},
      mockFetch as unknown as typeof fetch,
      { backoffMs: [10, 20] },
    );
    expect(res.status).toBe(200);
    expect(calls).toBe(2);
  });

  it("should retry on HTTP 503 service unavailable and succeed", async () => {
    let calls = 0;
    const mockFetch = async () => {
      calls++;
      if (calls === 1) {
        return new Response("Service Unavailable", { status: 503 });
      }
      return new Response("Success", { status: 200 });
    };

    const res = await fetchWithRetry(
      "https://example.com",
      {},
      mockFetch as unknown as typeof fetch,
      { backoffMs: [10, 20] },
    );
    expect(res.status).toBe(200);
    expect(calls).toBe(2);
  });

  it("should retry on network error and recover", async () => {
    let calls = 0;
    const mockFetch = async () => {
      calls++;
      if (calls === 1) {
        throw new Error("Connection reset by peer");
      }
      return new Response("Recovered", { status: 200 });
    };

    const res = await fetchWithRetry(
      "https://example.com",
      {},
      mockFetch as unknown as typeof fetch,
      { backoffMs: [10, 20] },
    );
    expect(res.status).toBe(200);
    expect(calls).toBe(2);
  });

  it("should return the response if all retries remain 429", async () => {
    let calls = 0;
    const mockFetch = async () => {
      calls++;
      return new Response("Persistent Rate Limit", { status: 429 });
    };

    const res = await fetchWithRetry(
      "https://example.com",
      {},
      mockFetch as unknown as typeof fetch,
      { maxRetries: 2, backoffMs: [5, 10] },
    );
    expect(res.status).toBe(429);
    expect(calls).toBe(3); // Initial + 2 retries
  });
});
