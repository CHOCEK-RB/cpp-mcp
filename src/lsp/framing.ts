import { Buffer } from "node:buffer";
import { EventEmitter } from "node:events";

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
 */
export class LspMessageParser extends EventEmitter {
  private buffer: Buffer = Buffer.alloc(0);

  /**
   * Appends a new buffer chunk from the LSP server stdout stream.
   */
  public append(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    this.processBuffer();
  }

  private processBuffer(): void {
    while (this.buffer.length > 0) {
      // Find header terminator \r\n\r\n
      const headerEndIndex = this.buffer.indexOf("\r\n\r\n");
      if (headerEndIndex === -1) {
        // Incomplete header, wait for more data
        break;
      }

      const headerText = this.buffer.subarray(0, headerEndIndex).toString("ascii");
      const match = headerText.match(/Content-Length:\s*(\d+)/i);
      if (!match?.[1]) {
        // Corrupted header, skip past the separator to recover
        this.buffer = this.buffer.subarray(headerEndIndex + 4);
        continue;
      }

      const contentLength = Number.parseInt(match[1], 10);
      const messageStartIndex = headerEndIndex + 4;
      const totalMessageLength = messageStartIndex + contentLength;

      if (this.buffer.length < totalMessageLength) {
        // Message body is incomplete, wait for remaining chunks
        break;
      }

      const messageBody = this.buffer
        .subarray(messageStartIndex, totalMessageLength)
        .toString("utf-8");
      this.buffer = this.buffer.subarray(totalMessageLength);

      try {
        const parsed = JSON.parse(messageBody);
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
  }

  /**
   * Clears any buffered remaining data.
   */
  public reset(): void {
    this.buffer = Buffer.alloc(0);
  }
}
