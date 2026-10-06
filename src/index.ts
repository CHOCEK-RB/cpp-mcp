#!/usr/bin/env node

import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import pkg from "../package.json" with { type: "json" };
import { runCli } from "./cli.js";
import { registerPrompts } from "./prompts/index.js";
import { registerResources } from "./resources/index.js";
import { registerToolDefinitions } from "./tool-registry.js";
import { sessionManager } from "./tools/code-session-manager.js";

export { runCli } from "./cli.js";
export const SERVER_NAME = "cpp-mcp";
export const SERVER_VERSION = pkg.version;

/**
 * Creates and configures the C/C++ Reference MCP Server with tools.
 */
export function createServer(): McpServer {
  const server = new McpServer({
    name: SERVER_NAME,
    version: SERVER_VERSION,
  });

  registerToolDefinitions(server);

  registerResources(server);
  registerPrompts(server);

  return server;
}

export async function main(): Promise<void> {
  const server = createServer();
  const transport = new StdioServerTransport();

  const cleanup = async () => {
    await sessionManager.closeAll();
  };

  process.on("SIGINT", async () => {
    await cleanup();
    process.exit(0);
  });

  process.on("SIGTERM", async () => {
    await cleanup();
    process.exit(0);
  });

  process.on("exit", () => {
    void sessionManager.closeAll();
  });

  await server.connect(transport);
}

function readOption(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index < 0 || index + 1 >= args.length) return undefined;
  return args[index + 1];
}

/**
 * Opt-in Streamable HTTP server (`--transport http`). Loaded lazily so the
 * default stdio path does not pay for the HTTP transport.
 */
export async function mainHttp(args: string[]): Promise<void> {
  const { DEFAULT_HTTP_HOST, DEFAULT_HTTP_PORT, startHttpServer } = await import("./http.js");

  const host = readOption(args, "--host") ?? DEFAULT_HTTP_HOST;
  const rawPort = readOption(args, "--port");
  const port = rawPort === undefined ? DEFAULT_HTTP_PORT : Number.parseInt(rawPort, 10);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`Invalid --port value: ${rawPort ?? ""}`);
  }
  const allowRemote = args.includes("--allow-remote");

  const running = await startHttpServer({
    host,
    port,
    allowRemote,
    createMcpServer: createServer,
  });

  const cleanup = async () => {
    await running.close().catch(() => {});
    await sessionManager.closeAll();
  };

  process.on("SIGINT", () => {
    void cleanup().finally(() => process.exit(0));
  });

  process.on("SIGTERM", () => {
    void cleanup().finally(() => process.exit(0));
  });

  process.on("exit", () => {
    void sessionManager.closeAll();
  });

  console.error(`cpp-mcp MCP Streamable HTTP server listening on ${running.url}`);
  if (allowRemote) {
    console.error(
      "Warning: --allow-remote is enabled; the server accepts connections from other hosts.",
    );
  }
}

const entryArg = typeof process !== "undefined" ? process.argv[1] : undefined;

/**
 * True when argv[1] resolves to this very module. Comparing real paths is
 * precise: import.meta.main is false under `bun test`, and the previous
 * substring heuristic (`arg.includes("test")`) silently disabled CLI mode for
 * any argument or path containing "test" (e.g. `code-diagnostics tests/a.cpp`).
 */
export function isEntryPoint(entry: string): boolean {
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

const isDirectExecution =
  (typeof import.meta !== "undefined" && Boolean(import.meta.main)) ||
  (typeof process !== "undefined" && entryArg !== undefined && isEntryPoint(entryArg));

if (isDirectExecution) {
  const args = typeof process !== "undefined" ? process.argv.slice(2) : [];
  const wantsHttp = readOption(args, "--transport") === "http";
  const isStdioMode =
    args.length === 0 ||
    args.includes("--stdio") ||
    args[0] === "stdio" ||
    args.includes("--transport");

  if (wantsHttp) {
    mainHttp(args).catch(async (err) => {
      await sessionManager.closeAll();
      console.error("Fatal error starting cpp-mcp HTTP server:", err);
      process.exit(1);
    });
  } else if (!isStdioMode) {
    runCli(args)
      .then(async (code) => {
        await sessionManager.closeAll();
        process.exit(code);
      })
      .catch(async (err) => {
        await sessionManager.closeAll();
        console.error("Fatal CLI error:", err);
        process.exit(1);
      });
  } else {
    main().catch(async (err) => {
      await sessionManager.closeAll();
      console.error("Fatal error starting cpp-mcp server:", err);
      process.exit(1);
    });
  }
}
