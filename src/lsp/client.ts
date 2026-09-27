import { EventEmitter } from "node:events";
import type { Readable, Writable } from "node:stream";
import { encodeLspMessage, LspMessageParser } from "./framing.js";
import type { JsonRpcRequest, JsonRpcResponse } from "./types.js";

interface PendingRequest {
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
  method: string;
}

export class LspClient extends EventEmitter {
  private nextId = 1;
  private pendingRequests = new Map<number | string, PendingRequest>();
  private parser = new LspMessageParser();
  private writable: Writable;

  constructor(readable: Readable, writable: Writable) {
    super();
    this.writable = writable;

    this.parser.on("message", (msg: JsonRpcResponse) => {
      this.handleIncomingMessage(msg);
    });

    this.parser.on("error", (err: Error) => {
      this.emit("error", err);
    });

    readable.on("data", (chunk: Buffer) => {
      this.parser.append(chunk);
    });

    readable.on("error", (err: Error) => {
      this.emit("error", err);
    });
  }

  private handleIncomingMessage(msg: JsonRpcResponse): void {
    if (msg.id !== undefined && this.pendingRequests.has(msg.id)) {
      const pending = this.pendingRequests.get(msg.id);
      if (pending) {
        this.pendingRequests.delete(msg.id);
        clearTimeout(pending.timer);

        if (msg.error) {
          pending.reject(
            new Error(`LSP Error [${pending.method}] (${msg.error.code}): ${msg.error.message}`),
          );
        } else {
          pending.resolve(msg.result);
        }
      }
    } else {
      // Notification or unsolicited response
      this.emit("notification", msg);
    }
  }

  /**
   * Sends an LSP request and waits for the corresponding response.
   */
  public async request<T = unknown>(
    method: string,
    params?: unknown,
    timeoutMs = 15000,
  ): Promise<T> {
    const id = this.nextId++;
    const payload: JsonRpcRequest = {
      jsonrpc: "2.0",
      id,
      method,
      params,
    };

    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error(`LSP request timed out after ${timeoutMs}ms for method: ${method}`));
        }
      }, timeoutMs);

      this.pendingRequests.set(id, {
        resolve: resolve as (result: unknown) => void,
        reject,
        timer,
        method,
      });

      try {
        const framed = encodeLspMessage(payload);
        this.writable.write(framed);
      } catch (err) {
        this.pendingRequests.delete(id);
        clearTimeout(timer);
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  /**
   * Sends a one-way notification without waiting for a response.
   */
  public notify(method: string, params?: unknown): void {
    const payload: JsonRpcRequest = {
      jsonrpc: "2.0",
      method,
      params,
    };
    const framed = encodeLspMessage(payload);
    this.writable.write(framed);
  }

  /**
   * Rejects all pending requests and cleans up resources.
   */
  public destroy(error?: Error): void {
    for (const [id, pending] of this.pendingRequests.entries()) {
      clearTimeout(pending.timer);
      pending.reject(error || new Error("LSP client was destroyed before receiving response"));
      this.pendingRequests.delete(id);
    }
    this.parser.reset();
  }
}
