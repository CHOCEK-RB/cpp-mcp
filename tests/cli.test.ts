import { describe, expect, it } from "bun:test";
import { runCli } from "../src/cli.js";

describe("Direct CLI Mode", () => {
  it("should lookup header in standard format", async () => {
    let output = "";
    const origLog = console.log;
    console.log = (msg: string) => {
      output += `${msg}\n`;
    };

    try {
      const code = await runCli(["header", "std::span"]);
      expect(code).toBe(0);
      expect(output).toContain("<span>");
      expect(output).toContain("C++20");
    } finally {
      console.log = origLog;
    }
  });

  it("should lookup header in raw format", async () => {
    let output = "";
    const origLog = console.log;
    console.log = (msg: string) => {
      output += `${msg}\n`;
    };

    try {
      const code = await runCli(["header", "std::span", "--raw"]);
      expect(code).toBe(0);
      expect(output.trim()).toBe("<span>");
    } finally {
      console.log = origLog;
    }
  });

  it("should lookup header in json format", async () => {
    let output = "";
    const origLog = console.log;
    console.log = (msg: string) => {
      output += `${msg}\n`;
    };

    try {
      const code = await runCli(["header", "std::span", "--json"]);
      expect(code).toBe(0);
      const parsed = JSON.parse(output);
      expect(parsed.found).toBe(true);
      expect(parsed.header).toBe("<span>");
    } finally {
      console.log = origLog;
    }
  });

  it("should return code 1 for nonexistent header", async () => {
    let errOutput = "";
    const origErr = console.error;
    console.error = (msg: string) => {
      errOutput += `${msg}\n`;
    };

    try {
      const code = await runCli(["header", "unknown_bogus_symbol_xyz"]);
      expect(code).toBe(1);
      expect(errOutput).toContain("not found");
    } finally {
      console.error = origErr;
    }
  });

  it("should demangle mangled symbol", async () => {
    let output = "";
    const origLog = console.log;
    console.log = (msg: string) => {
      output += `${msg}\n`;
    };

    try {
      const code = await runCli(["demangle", "_Z3fooi"]);
      expect(code).toBe(0);
      expect(output).toContain("foo(int)");
    } finally {
      console.log = origLog;
    }
  });

  it("should check compiler support and compatibility", async () => {
    let output = "";
    const origLog = console.log;
    console.log = (msg: string) => {
      output += `${msg}\n`;
    };

    try {
      const code = await runCli([
        "compiler",
        "std-print",
        "--compiler",
        "gcc",
        "--version",
        "13.1",
      ]);
      expect(code).toBe(0);
      expect(output).toContain("std::print");
      expect(output).toContain("COMPATIBLE");
    } finally {
      console.log = origLog;
    }
  });

  it("should lookup SEI CERT rule", async () => {
    let output = "";
    const origLog = console.log;
    console.log = (msg: string) => {
      output += `${msg}\n`;
    };

    try {
      const code = await runCli(["cert", "MEM50-CPP"]);
      expect(code).toBe(0);
      expect(output).toContain("MEM50-CPP");
      expect(output).toContain("Use-After-Free");
      expect(output).toContain("make_unique");
    } finally {
      console.log = origLog;
    }
  });

  it("should lookup C++ Core Guideline rule", async () => {
    let output = "";
    const origLog = console.log;
    console.log = (msg: string) => {
      output += `${msg}\n`;
    };

    try {
      const code = await runCli(["guideline", "F.16"]);
      expect(code).toBe(0);
      expect(output).toContain("F.16");
      expect(output).toContain("Functions");
    } finally {
      console.log = origLog;
    }
  });

  it("should check language standard milestone", async () => {
    let output = "";
    const origLog = console.log;
    console.log = (msg: string) => {
      output += `${msg}\n`;
    };

    try {
      const code = await runCli(["standard", "std::span", "C++20"]);
      expect(code).toBe(0);
      expect(output).toContain("std::span");
      expect(output).toContain("supported");
      expect(output).toContain("__cpp_lib_span");
    } finally {
      console.log = origLog;
    }
  });

  it("should lookup module guide topic", async () => {
    let output = "";
    const origLog = console.log;
    console.log = (msg: string) => {
      output += `${msg}\n`;
    };

    try {
      const code = await runCli(["module", "partitions"]);
      expect(code).toBe(0);
      expect(output).toContain("partitions");
    } finally {
      console.log = origLog;
    }
  });

  it("should lookup tooling guide recipe", async () => {
    let output = "";
    const origLog = console.log;
    console.log = (msg: string) => {
      output += `${msg}\n`;
    };

    try {
      const code = await runCli(["tooling", "xmake"]);
      expect(code).toBe(0);
      expect(output).toContain("xmake");
    } finally {
      console.log = origLog;
    }
  });

  it("should execute shorthand symbol lookup", async () => {
    let output = "";
    const origLog = console.log;
    console.log = (msg: string) => {
      output += `${msg}\n`;
    };

    try {
      const code = await runCli(["std::span"]);
      expect(code).toBe(0);
      expect(output).toContain("<span>");
    } finally {
      console.log = origLog;
    }
  });

  it("should print help and version", async () => {
    let output = "";
    const origLog = console.log;
    console.log = (msg: string) => {
      output += `${msg}\n`;
    };

    try {
      const helpCode = await runCli(["--help"]);
      expect(helpCode).toBe(0);
      expect(output).toContain("Usage:");

      output = "";
      const verCode = await runCli(["--version"]);
      expect(verCode).toBe(0);
      expect(output).toContain("cpp-mcp v");
    } finally {
      console.log = origLog;
    }
  });

  it("should return code 1 when query is called without arguments", async () => {
    let errOutput = "";
    const origErr = console.error;
    console.error = (msg: string) => {
      errOutput += `${msg}\n`;
    };

    try {
      const code = await runCli(["query"]);
      expect(code).toBe(1);
      expect(errOutput).toContain("Error: 'query' command requires an argument");
    } finally {
      console.error = origErr;
    }
  });

  it("should execute directly via CLI process invocation", () => {
    const proc = Bun.spawnSync(["bun", "src/index.ts", "header", "std::span", "--raw"]);
    expect(proc.exitCode).toBe(0);
    expect(proc.stdout.toString().trim()).toBe("<span>");
  });

  it("should boot MCP stdio server when invoked with --stdio flag", () => {
    const payload = `${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" })}\n`;
    const proc = Bun.spawnSync(["bun", "src/index.ts", "--stdio"], {
      stdin: Buffer.from(payload),
      timeout: 10_000,
    });
    expect(proc.exitCode).toBe(0);
    expect(proc.stdout.toString()).toContain('"jsonrpc":"2.0"');
    expect(proc.stdout.toString()).toContain('"id":1');
  });

  it("should boot MCP stdio server when invoked with stdio argument", () => {
    const payload = `${JSON.stringify({ jsonrpc: "2.0", id: 2, method: "ping" })}\n`;
    const proc = Bun.spawnSync(["bun", "src/index.ts", "stdio"], {
      stdin: Buffer.from(payload),
      timeout: 10_000,
    });
    expect(proc.exitCode).toBe(0);
    expect(proc.stdout.toString()).toContain('"jsonrpc":"2.0"');
    expect(proc.stdout.toString()).toContain('"id":2');
  });
});
