// src/http.ts
// Optional stateless Streamable HTTP transport for cpp-mcp (opt-in via `--transport http`).
// stdio remains the default; this module is only loaded when HTTP mode is requested.
import {
  createServer as createNodeHttpServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

export const DEFAULT_HTTP_HOST = "127.0.0.1";
export const DEFAULT_HTTP_PORT = 3333;
export const MCP_HTTP_PATH = "/mcp";

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "::1", "localhost", "0:0:0:0:0:0:0:1"]);

export interface HttpTransportOptions {
  /** Interface to bind. Defaults to 127.0.0.1 (loopback only). */
  host?: string;
  /** TCP port. Defaults to 3333. */
  port?: number;
  /** Required to bind a non-loopback interface. */
  allowRemote?: boolean;
  /** Factory building a fresh McpServer for each stateless request. */
  createMcpServer: () => McpServer;
}

export interface RunningHttpServer {
  server: Server;
  host: string;
  /** Actual bound port (useful when `port: 0` picks an ephemeral port). */
  port: number;
  url: string;
  close: () => Promise<void>;
}

/** True for hosts that only accept loopback traffic. */
export function isLoopbackHost(host: string): boolean {
  return LOOPBACK_HOSTS.has(host.trim().toLowerCase());
}

function stripBrackets(value: string): string {
  return value.replace(/^\[|\]$/g, "").toLowerCase();
}

function hostnameOf(header: string | undefined): string | undefined {
  if (!header) return undefined;
  try {
    return stripBrackets(new URL(`http://${header}`).hostname);
  } catch {
    return undefined;
  }
}

/**
 * DNS-rebinding guard: a browser page on another origin could send requests to
 * 127.0.0.1 with a forged Host header. Reject anything that is not loopback.
 */
function isLoopbackRequest(req: IncomingMessage): boolean {
  const host = hostnameOf(req.headers.host);
  if (host !== undefined && !isLoopbackHost(host)) return false;

  const origin = req.headers.origin;
  if (typeof origin === "string" && origin !== "null") {
    try {
      if (!isLoopbackHost(stripBrackets(new URL(origin).hostname))) return false;
    } catch {
      return false;
    }
  }
  return true;
}

function formatHostForUrl(host: string): string {
  return host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
}

/**
 * Starts the stateless Streamable HTTP server. Each POST to `/mcp` gets a fresh
 * McpServer + transport pair; no session is retained between requests.
 */
export async function startHttpServer(options: HttpTransportOptions): Promise<RunningHttpServer> {
  const host = options.host ?? DEFAULT_HTTP_HOST;
  const port = options.port ?? DEFAULT_HTTP_PORT;
  const allowRemote = options.allowRemote === true;

  if (!allowRemote && !isLoopbackHost(host)) {
    throw new Error(
      `Refusing to bind ${host} without --allow-remote. Use a loopback host (127.0.0.1) or pass --allow-remote.`,
    );
  }

  const handleRequest = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    try {
      const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
      if (url.pathname !== MCP_HTTP_PATH) {
        res.writeHead(404, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "Not found" }));
        return;
      }
      if (req.method !== "POST") {
        // Stateless mode serves no standalone SSE stream and keeps no sessions.
        res.writeHead(405, { "content-type": "application/json", allow: "POST" });
        res.end(JSON.stringify({ error: "Method not allowed" }));
        return;
      }
      if (!allowRemote && !isLoopbackRequest(req)) {
        res.writeHead(403, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "Forbidden: non-loopback request rejected" }));
        return;
      }

      const mcpServer = options.createMcpServer();
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      res.on("close", () => {
        void transport.close();
        void mcpServer.close();
      });

      await mcpServer.connect(transport);
      await transport.handleRequest(req, res);
    } catch (error) {
      if (!res.headersSent) {
        res.writeHead(500, { "content-type": "application/json" });
      }
      if (!res.writableEnded) {
        res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
      }
    }
  };

  const server = createNodeHttpServer((req, res) => {
    void handleRequest(req, res);
  });

  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => reject(error);
    server.once("error", onError);
    server.listen(port, host, () => {
      server.off("error", onError);
      resolve();
    });
  });

  const address = server.address();
  const boundPort = typeof address === "object" && address !== null ? address.port : port;

  return {
    server,
    host,
    port: boundPort,
    url: `http://${formatHostForUrl(host)}:${boundPort}${MCP_HTTP_PATH}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}
