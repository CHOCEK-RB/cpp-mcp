import { describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { ListRootsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { createServer } from "../src/index.js";

interface ConnectedPair {
  client: Client;
  close: () => Promise<void>;
}

async function connect(options: { roots?: string[] } = {}): Promise<ConnectedPair> {
  const server = createServer();
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client(
    { name: "roots-inference-test", version: "0.0.0" },
    { capabilities: options.roots ? { roots: {} } : {} },
  );
  await client.connect(clientTransport);
  if (options.roots) {
    const roots = options.roots;
    client.setRequestHandler(ListRootsRequestSchema, async () => ({
      roots: roots.map((uri) => ({ uri })),
    }));
  }
  return {
    client,
    close: async () => {
      await client.close();
      await server.close();
    },
  };
}

async function makeTempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "cpp-mcp-roots-"));
}

describe("workspace inference from client roots", () => {
  it("uses the first file root when the workspace argument is omitted", async () => {
    const dir = await makeTempDir();
    const { client, close } = await connect({ roots: [pathToFileURL(dir).href] });
    try {
      const result = await client.callTool({ name: "get_project_details", arguments: {} });
      const structured = result.structuredContent as { rootDir?: string } | undefined;
      expect(structured?.rootDir).toBe(dir);
    } finally {
      await close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("keeps an explicit workspace argument over the client root", async () => {
    const rootDir = await makeTempDir();
    const explicitDir = await makeTempDir();
    const { client, close } = await connect({ roots: [pathToFileURL(rootDir).href] });
    try {
      const result = await client.callTool({
        name: "get_project_details",
        arguments: { workspaceDir: explicitDir },
      });
      const structured = result.structuredContent as { rootDir?: string } | undefined;
      expect(structured?.rootDir).toBe(explicitDir);
    } finally {
      await close();
      await rm(rootDir, { recursive: true, force: true });
      await rm(explicitDir, { recursive: true, force: true });
    }
  });

  it("falls back to the process cwd when the client has no roots", async () => {
    const { client, close } = await connect();
    try {
      const result = await client.callTool({ name: "get_project_details", arguments: {} });
      const structured = result.structuredContent as { rootDir?: string } | undefined;
      expect(structured?.rootDir).toBe(process.cwd());
    } finally {
      await close();
    }
  });

  it("emits progress notifications for long-running tools", async () => {
    const dir = await makeTempDir();
    const { client, close } = await connect();
    try {
      const progress: Array<{ progress: number; message?: string }> = [];
      await client.callTool(
        { name: "search_code_symbols", arguments: { query: "main", workspaceDir: dir } },
        undefined,
        {
          onprogress: (update) =>
            progress.push({ progress: update.progress, message: update.message }),
        },
      );
      expect(progress.length).toBeGreaterThan(0);
      expect(progress[0]?.message).toContain("search_code_symbols");
      expect(progress.at(-1)?.progress).toBe(1);
    } finally {
      await close();
      await rm(dir, { recursive: true, force: true });
    }
  });
});
