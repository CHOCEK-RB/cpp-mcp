import { describe, expect, it } from "bun:test";
import pkg from "../package.json" with { type: "json" };
import serverJson from "../server.json" with { type: "json" };
import { SERVER_NAME, SERVER_VERSION } from "../src/index.js";

describe("cpp-mcp server metadata", () => {
  it("should have correct server name and version", () => {
    expect(SERVER_NAME).toBe("cpp-mcp");
    expect(SERVER_VERSION).toBe(pkg.version);
    expect(serverJson.version).toBe(pkg.version);
    expect(serverJson.packages[0]?.version).toBe(pkg.version);
  });
});
