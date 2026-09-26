import { describe, expect, it } from "bun:test";
import { SERVER_NAME, SERVER_VERSION } from "../src/index.js";

describe("cpp-mcp server metadata", () => {
  it("should have correct server name and version", () => {
    expect(SERVER_NAME).toBe("cpp-mcp");
    expect(SERVER_VERSION).toBe("1.1.1");
  });
});
