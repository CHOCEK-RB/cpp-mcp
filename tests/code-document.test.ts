import { describe, expect, it } from "bun:test";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  openFileAndAwaitReady,
  openFileInSession,
  SESSION_READY_TIMEOUT_MS,
} from "../src/tools/code-document.js";

describe("openFileInSession", () => {
  it("reads a file and syncs it with its inferred language id", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "code-document-test-"));
    try {
      const file = path.join(dir, "main.c");
      await fs.writeFile(file, "int main(void) { return 0; }\n");

      const calls: Array<{ uri: string; languageId: string; text: string }> = [];
      const session = {
        openOrUpdateDocument: (uri: string, languageId: string, text: string) => {
          calls.push({ uri, languageId, text });
        },
      };

      const opened = await openFileInSession(session, "file:///workspace/main.c", file);

      expect(opened).toBe(true);
      expect(calls).toHaveLength(1);
      expect(calls[0]?.uri).toBe("file:///workspace/main.c");
      expect(calls[0]?.languageId).toBe("c");
      expect(calls[0]?.text).toContain("int main");
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("returns false and does not touch the session when the file is missing", async () => {
    const calls: string[] = [];
    const session = {
      openOrUpdateDocument: () => {
        calls.push("called");
      },
    };

    const opened = await openFileInSession(session, "file:///missing.cpp", "/nonexistent/file.cpp");

    expect(opened).toBe(false);
    expect(calls).toHaveLength(0);
  });
});

describe("openFileAndAwaitReady", () => {
  it("opens the file and waits for diagnostics with the default timeout", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "code-document-ready-"));
    try {
      const file = path.join(dir, "main.cpp");
      await fs.writeFile(file, "int main() { return 0; }\n");

      const opened: string[] = [];
      const waits: Array<{ uri: string; timeoutMs?: number }> = [];
      const session = {
        openOrUpdateDocument: (uri: string) => {
          opened.push(uri);
        },
        waitForDiagnostics: async (uri: string, timeoutMs?: number) => {
          waits.push({ uri, timeoutMs });
          return [];
        },
      };

      const result = await openFileAndAwaitReady(session, "file:///workspace/main.cpp", file);

      expect(result).toBe(true);
      expect(opened).toEqual(["file:///workspace/main.cpp"]);
      expect(waits).toHaveLength(1);
      expect(waits[0]?.uri).toBe("file:///workspace/main.cpp");
      expect(waits[0]?.timeoutMs).toBe(SESSION_READY_TIMEOUT_MS);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("passes a custom timeout through", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "code-document-ready-"));
    try {
      const file = path.join(dir, "main.cpp");
      await fs.writeFile(file, "int main() { return 0; }\n");

      let seenTimeout: number | undefined;
      const session = {
        openOrUpdateDocument: () => {},
        waitForDiagnostics: async (_uri: string, timeoutMs?: number) => {
          seenTimeout = timeoutMs;
          return [];
        },
      };

      await openFileAndAwaitReady(session, "file:///workspace/main.cpp", file, 1234);
      expect(seenTimeout).toBe(1234);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("does not wait when the file cannot be opened", async () => {
    let waited = false;
    const session = {
      openOrUpdateDocument: () => {},
      waitForDiagnostics: async () => {
        waited = true;
        return [];
      },
    };

    const result = await openFileAndAwaitReady(session, "file:///missing.cpp", "/nonexistent.cpp");
    expect(result).toBe(false);
    expect(waited).toBe(false);
  });

  it("swallows diagnostics wait failures and still reports the file as opened", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "code-document-ready-"));
    try {
      const file = path.join(dir, "main.cpp");
      await fs.writeFile(file, "int main() { return 0; }\n");

      const session = {
        openOrUpdateDocument: () => {},
        waitForDiagnostics: async () => {
          throw new Error("clangd crashed");
        },
      };

      const result = await openFileAndAwaitReady(session, "file:///workspace/main.cpp", file);
      expect(result).toBe(true);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});
