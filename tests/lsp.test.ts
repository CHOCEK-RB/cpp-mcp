import { describe, expect, it } from "bun:test";
import { PassThrough } from "node:stream";
import {
  encodeLspMessage,
  LspClient,
  LspMessageParser,
  SymbolKind,
  symbolKindToString,
} from "../src/lsp/index.js";

describe("LSP Framing and Protocol", () => {
  it("should correctly encode object into Content-Length framed buffer", () => {
    const payload = { jsonrpc: "2.0", method: "test", params: { x: 1 } };
    const encoded = encodeLspMessage(payload);

    const str = encoded.toString("utf-8");
    expect(str).toContain("Content-Length: 50\r\n\r\n");
    expect(str).toContain('{"jsonrpc":"2.0","method":"test","params":{"x":1}}');
  });

  it("should parse single framed message", (done) => {
    const parser = new LspMessageParser();
    const payload = { jsonrpc: "2.0", id: 1, result: "ok" };

    parser.on("message", (msg) => {
      expect(msg).toEqual(payload);
      done();
    });

    parser.append(encodeLspMessage(payload));
  });

  it("should parse multiple concatenated messages in a single chunk", () => {
    const parser = new LspMessageParser();
    const msg1 = { jsonrpc: "2.0", id: 1, result: "first" };
    const msg2 = { jsonrpc: "2.0", id: 2, result: "second" };

    const received: unknown[] = [];
    parser.on("message", (msg) => received.push(msg));

    const combined = Buffer.concat([encodeLspMessage(msg1), encodeLspMessage(msg2)]);
    parser.append(combined);

    expect(received).toHaveLength(2);
    expect(received[0]).toEqual(msg1);
    expect(received[1]).toEqual(msg2);
  });

  it("should parse message fragmented across multiple chunks", () => {
    const parser = new LspMessageParser();
    const payload = {
      jsonrpc: "2.0",
      id: 99,
      result: { complex: [1, 2, 3], text: "fragmented" },
    };

    const received: unknown[] = [];
    parser.on("message", (msg) => received.push(msg));

    const fullBuffer = encodeLspMessage(payload);
    // Split into 3 small chunks
    const chunk1 = fullBuffer.subarray(0, 15);
    const chunk2 = fullBuffer.subarray(15, 35);
    const chunk3 = fullBuffer.subarray(35);

    parser.append(chunk1);
    expect(received).toHaveLength(0);

    parser.append(chunk2);
    expect(received).toHaveLength(0);

    parser.append(chunk3);
    expect(received).toHaveLength(1);
    expect(received[0]).toEqual(payload);
  });

  it("should map symbol kinds to human-readable strings", () => {
    expect(symbolKindToString(SymbolKind.Class)).toBe("class");
    expect(symbolKindToString(SymbolKind.Method)).toBe("method");
    expect(symbolKindToString(SymbolKind.Function)).toBe("function");
    expect(symbolKindToString(SymbolKind.Struct)).toBe("struct");
    expect(symbolKindToString(SymbolKind.Variable)).toBe("variable");
  });
});

describe("LspClient Communication", () => {
  it("should send request and resolve matching response by ID", async () => {
    const clientToServer = new PassThrough();
    const serverToClient = new PassThrough();

    const client = new LspClient(serverToClient, clientToServer);

    // Mock server receiving request and responding
    const serverParser = new LspMessageParser();
    clientToServer.on("data", (chunk) => serverParser.append(chunk));

    serverParser.on("message", (msg: unknown) => {
      const req = msg as { id: number; method: string; params: { position: { line: number } } };
      expect(req.method).toBe("textDocument/hover");
      expect(req.params.position.line).toBe(10);

      // Send back response with same ID
      const response = {
        jsonrpc: "2.0",
        id: req.id,
        result: { contents: "hover content" },
      };
      serverToClient.write(encodeLspMessage(response));
    });

    const result = await client.request<{ contents: string }>("textDocument/hover", {
      position: { line: 10, character: 5 },
    });

    expect(result.contents).toBe("hover content");
    client.destroy();
  });

  it("should handle error response and reject promise", async () => {
    const clientToServer = new PassThrough();
    const serverToClient = new PassThrough();

    const client = new LspClient(serverToClient, clientToServer);

    const serverParser = new LspMessageParser();
    clientToServer.on("data", (chunk) => serverParser.append(chunk));

    serverParser.on("message", (msg: unknown) => {
      const req = msg as { id: number };
      const errorResponse = {
        jsonrpc: "2.0",
        id: req.id,
        error: { code: -32601, message: "Method not found" },
      };
      serverToClient.write(encodeLspMessage(errorResponse));
    });

    expect(client.request("unknown/method")).rejects.toThrow("Method not found");
    client.destroy();
  });

  it("should timeout when server does not respond within timeout limit", async () => {
    const clientToServer = new PassThrough();
    const serverToClient = new PassThrough();

    const client = new LspClient(serverToClient, clientToServer);

    expect(client.request("slow/request", {}, 100)).rejects.toThrow("timed out");
    client.destroy();
  });
});

describe("LspMessageParser large and fragmented payloads", () => {
  it("parses a large message delivered across many small chunks", () => {
    const parser = new LspMessageParser();
    const payload = {
      jsonrpc: "2.0",
      id: 7,
      result: {
        items: Array.from({ length: 2000 }, (_, i) => ({ i, name: `symbol_${i}` })),
      },
    };
    const received: unknown[] = [];
    parser.on("message", (msg) => received.push(msg));

    const encoded = encodeLspMessage(payload);
    for (let offset = 0; offset < encoded.length; offset += 512) {
      parser.append(encoded.subarray(offset, offset + 512));
    }

    expect(received).toEqual([payload]);
  });

  it("recovers from a corrupted header and still parses the next message", () => {
    const parser = new LspMessageParser();
    const payload = { jsonrpc: "2.0", id: 1, result: "ok" };
    const received: unknown[] = [];
    parser.on("message", (msg) => received.push(msg));

    parser.append(Buffer.from("Not-A-Header\r\n\r\n", "ascii"));
    parser.append(encodeLspMessage(payload));

    expect(received).toEqual([payload]);
  });

  it("discards partial state on reset", () => {
    const parser = new LspMessageParser();
    const payload = { jsonrpc: "2.0", id: 2, result: "resynced" };
    const received: unknown[] = [];
    parser.on("message", (msg) => received.push(msg));

    const encoded = encodeLspMessage(payload);
    parser.append(encoded.subarray(0, 12));
    parser.reset();
    parser.append(encoded);

    expect(received).toEqual([payload]);
  });
});
