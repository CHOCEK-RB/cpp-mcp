import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { request } from "node:http";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { isLoopbackHost, type RunningHttpServer, startHttpServer } from "../src/http.js";
import { createServer } from "../src/index.js";

function rawRequest(options: {
  port: number;
  method: string;
  path: string;
  headers?: Record<string, string>;
  body?: string;
}): Promise<{ status: number; text: string }> {
  return new Promise((resolve, reject) => {
    const req = request(
      {
        host: "127.0.0.1",
        port: options.port,
        method: options.method,
        path: options.path,
        headers: options.headers,
      },
      (res) => {
        let text = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          text += chunk;
        });
        res.on("end", () => resolve({ status: res.statusCode ?? 0, text }));
      },
    );
    req.on("error", reject);
    if (options.body !== undefined) req.write(options.body);
    req.end();
  });
}

describe("isLoopbackHost", () => {
  it("accepts loopback hosts", () => {
    expect(isLoopbackHost("127.0.0.1")).toBe(true);
    expect(isLoopbackHost("localhost")).toBe(true);
    expect(isLoopbackHost("::1")).toBe(true);
    expect(isLoopbackHost("  127.0.0.1  ")).toBe(true);
  });

  it("rejects non-loopback hosts", () => {
    expect(isLoopbackHost("0.0.0.0")).toBe(false);
    expect(isLoopbackHost("192.168.1.10")).toBe(false);
    expect(isLoopbackHost("example.com")).toBe(false);
  });
});

describe("startHttpServer", () => {
  it("refuses to bind a non-loopback host without allowRemote", async () => {
    await expect(
      startHttpServer({ host: "0.0.0.0", port: 0, createMcpServer: createServer }),
    ).rejects.toThrow(/allow-remote/);
  });
});

describe("HTTP transport (stateless)", () => {
  let running: RunningHttpServer;

  beforeAll(async () => {
    running = await startHttpServer({ host: "127.0.0.1", port: 0, createMcpServer: createServer });
  });

  afterAll(async () => {
    await running.close();
  });

  it("completes initialize -> tools/list -> tools/call over HTTP", async () => {
    const transport = new StreamableHTTPClientTransport(new URL(running.url));
    const client = new Client({ name: "http-test", version: "1.0.0" });
    try {
      await client.connect(transport);

      const tools = await client.listTools();
      expect(tools.tools.length).toBeGreaterThan(0);
      expect(tools.tools.some((tool) => tool.name === "lookup_header")).toBe(true);

      const result = await client.callTool({
        name: "lookup_header",
        arguments: { symbol: "std::vector" },
      });
      expect(result.isError).not.toBe(true);
      expect(result.structuredContent).toBeDefined();
      expect(result.structuredContent).toMatchObject({ found: true });
      expect(Array.isArray(result.content)).toBe(true);
    } finally {
      await client.close();
    }
  });

  it("rejects non-loopback Host headers (DNS rebinding)", async () => {
    const response = await rawRequest({
      port: running.port,
      method: "POST",
      path: "/mcp",
      headers: { host: "evil.example", "content-type": "application/json" },
      body: "{}",
    });
    expect(response.status).toBe(403);
  });

  it("answers 404 for unknown paths and 405 for non-POST methods", async () => {
    const notFound = await rawRequest({ port: running.port, method: "POST", path: "/nope" });
    expect(notFound.status).toBe(404);

    const methodNotAllowed = await rawRequest({ port: running.port, method: "GET", path: "/mcp" });
    expect(methodNotAllowed.status).toBe(405);
  });
});
