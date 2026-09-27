import { Buffer } from "node:buffer";
import { EventEmitter } from "node:events";

/** The CRLF sequence that terminates an LSP header block. */
const HEADER_SEPARATOR = Buffer.from("\r\n\r\n", "ascii");
const EMPTY = Buffer.alloc(0);

/**
 * Encodes an object as a standard Language Server Protocol (LSP) framed message.
 * Format: `Content-Length: <n>\r\n\r\n<payload>`
 */
export function encodeLspMessage(message: unknown): Buffer {
  const json = JSON.stringify(message);
  const jsonBuffer = Buffer.from(json, "utf-8");
  const header = `Content-Length: ${jsonBuffer.length}\r\n\r\n`;
  const headerBuffer = Buffer.from(header, "ascii");
  return Buffer.concat([headerBuffer, jsonBuffer]);
}

/**
 * Stream parser that accumulates raw buffer chunks and parses framed LSP messages.
 *
 * Headers are accumulated (they are tiny) and the body is buffered as a list of
 * chunk slices, concatenating only once per message. This keeps parsing linear
 * when a large message is delivered across many stream chunks.
 */
export class LspMessageParser extends EventEmitter {
  private headerChunks: Buffer[] = [];
  private headerLength = 0;

  private bodyChunks: Buffer[] = [];
  private bodyReceived = 0;
  private bodyExpected = 0;
  private awaitingBody = false;

  /**
   * Appends a new buffer chunk from the LSP server stdout stream.
   */
  public append(chunk: Buffer): void {
    let pending: Buffer = chunk;

    while (pending.length > 0) {
      if (this.awaitingBody) {
        const need = this.bodyExpected - this.bodyReceived;
        const take = Math.min(need, pending.length);
        this.bodyChunks.push(pending.subarray(0, take));
        this.bodyReceived += take;
        pending = pending.subarray(take);
        if (this.bodyReceived >= this.bodyExpected) {
          this.emitMessage();
        }
        continue;
      }

      // Accumulate header bytes until the terminator is found (headers are small).
      this.headerChunks.push(pending);
      this.headerLength += pending.length;
      pending = EMPTY;

      const headerEnd = this.findHeaderEnd();
      if (headerEnd === -1) {
        return;
      }

      const headerBuffer =
        this.headerChunks.length === 1
          ? (this.headerChunks[0] as Buffer)
          : Buffer.concat(this.headerChunks, this.headerLength);
      const headerText = headerBuffer.subarray(0, headerEnd).toString("ascii");
      const match = headerText.match(/Content-Length:\s*(\d+)/i);
      const remainder = headerBuffer.subarray(headerEnd + HEADER_SEPARATOR.length);
      this.headerChunks = [];
      this.headerLength = 0;

      if (!match?.[1]) {
        // Corrupted header, skip past the separator to recover.
        pending = remainder;
        continue;
      }

      this.bodyExpected = Number.parseInt(match[1], 10);
      this.bodyChunks = [];
      this.bodyReceived = 0;
      this.awaitingBody = true;
      pending = remainder;

      if (this.bodyExpected === 0) {
        this.emitMessage();
      }
    }
  }

  /** Finds the offset of `\r\n\r\n` across buffered header chunks, or -1. */
  private findHeaderEnd(): number {
    let absolute = 0;
    let carry: Buffer = EMPTY;

    for (const chunk of this.headerChunks) {
      const search = carry.length > 0 ? Buffer.concat([carry, chunk]) : chunk;
      const index = search.indexOf(HEADER_SEPARATOR);
      if (index !== -1) {
        return absolute - carry.length + index;
      }
      carry = chunk.subarray(Math.max(0, chunk.length - (HEADER_SEPARATOR.length - 1)));
      absolute += chunk.length;
    }

    return -1;
  }

  private emitMessage(): void {
    const expected = this.bodyExpected;
    const chunks = this.bodyChunks;

    this.awaitingBody = false;
    this.bodyChunks = [];
    this.bodyReceived = 0;
    this.bodyExpected = 0;

    const body = chunks.length === 1 ? (chunks[0] as Buffer) : Buffer.concat(chunks, expected);
    try {
      const parsed = JSON.parse(body.toString("utf-8"));
      this.emit("message", parsed);
    } catch (err) {
      this.emit(
        "error",
        new Error(
          `Failed to parse LSP JSON payload: ${err instanceof Error ? err.message : String(err)}`,
        ),
      );
    }
  }

  /**
   * Clears any buffered remaining data.
   */
  public reset(): void {
    this.headerChunks = [];
    this.headerLength = 0;
    this.bodyChunks = [];
    this.bodyReceived = 0;
    this.bodyExpected = 0;
    this.awaitingBody = false;
  }
}
