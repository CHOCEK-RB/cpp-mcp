import { describe, expect, it } from "bun:test";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { openFileInSession } from "../src/tools/code-document.js";

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
