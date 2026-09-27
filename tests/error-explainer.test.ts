// tests/error-explainer.test.ts
import { describe, expect, it } from "bun:test";
import { runCli } from "../src/cli.js";
import { explainCompilerError } from "../src/tools/error-explainer.js";

describe("explainCompilerError - Linker Errors", () => {
  it("explains undefined reference and demangles mangled symbol", async () => {
    const errorText =
      "/usr/bin/ld: CMakeFiles/app.dir/main.cpp.o: in function `main':\n" +
      "main.cpp:(.text+0x15): undefined reference to `_Z3addii'";

    const res = await explainCompilerError({ error: errorText });

    expect(res.success).toBe(true);
    expect(res.category).toBe("linker_undefined_reference");
    expect(res.summary).toContain("undefined reference");
    expect(res.demangledSymbols).toBeDefined();
    expect(res.demangledSymbols?.[0]?.mangled).toBe("_Z3addii");
    expect(res.demangledSymbols?.[0]?.demangled).toContain("add(int, int)");
    expect(res.remediation).toContain("Missing source file");
  });

  it("explains MSVC unresolved external symbol error LNK2019", async () => {
    const errorText =
      'main.obj : error LNK2019: unresolved external symbol "void __cdecl compute(int)" (?compute@@YAXH@Z) referenced in function _main';

    const res = await explainCompilerError({ error: errorText });

    expect(res.success).toBe(true);
    expect(res.category).toBe("linker_undefined_reference");
    expect(res.detectedCompiler).toBe("msvc");
    expect(res.summary).toContain("undefined reference to");
  });

  it("explains missing vtable error caused by unfulfilled virtual methods", async () => {
    const errorText =
      "/usr/bin/ld: main.o: in function `Widget::Widget()':\n" +
      "main.cpp:8: undefined reference to `vtable for Widget'";

    const res = await explainCompilerError({ error: errorText });

    expect(res.success).toBe(true);
    expect(res.category).toBe("vtable_missing");
    expect(res.summary).toContain("vtable for 'Widget'");
    expect(res.remediation).toContain("virtual ~Widget() = default;");
    expect(res.pitfalls).toBeDefined();
  });

  it("explains multiple definition / ODR violation error", async () => {
    const errorText =
      "/usr/bin/ld: utils.o: in function `helper()':\n" +
      "utils.cpp:5: multiple definition of `helper()'; main.o:main.cpp:5: first defined here";

    const res = await explainCompilerError({ error: errorText });

    expect(res.success).toBe(true);
    expect(res.category).toBe("linker_multiple_definition");
    expect(res.summary).toContain("multiple definition of 'helper()'");
    expect(res.remediation).toContain("inline");
  });
});

describe("explainCompilerError - Concepts and Templates", () => {
  it("explains C++20 concept constraint violation", async () => {
    const errorText =
      "main.cpp:12:5: error: constraints not satisfied for class template 'vector' [with T = int]\n" +
      "note: concept 'std::ranges::range<int>' was not satisfied\n" +
      "note: because 'int' does not provide 'begin()'";

    const res = await explainCompilerError({ error: errorText });

    expect(res.success).toBe(true);
    expect(res.category).toBe("concept_constraint");
    expect(res.summary).toContain("Concept constraint failure");
    expect(res.remediation.toLowerCase()).toContain("inspect the notes section");
  });

  it("explains template instantiation error and simplifies STL noise", async () => {
    const errorText =
      "main.cpp:25:3: error: no matching function for call to 'print_elements'\n" +
      "in instantiation of function template specialization 'print_elements<std::__cxx11::basic_string<char, std::char_traits<char>, std::allocator<char> > >'\n" +
      "candidate template ignored: substitution failure [with T = int]: type 'int' cannot be used prior to '::'";

    const res = await explainCompilerError({ error: errorText });

    expect(res.success).toBe(true);
    expect(res.category).toBe("template_instantiation");
    expect(res.simplifiedError).toContain("std::string");
    expect(res.simplifiedError).not.toContain("std::__cxx11::basic_string");
  });
});

describe("explainCompilerError - Modules, Const, and Ownership", () => {
  it("explains C++20 module resolution failure", async () => {
    const errorText =
      "main.cpp:2:8: fatal error: module 'math_utils' not found\n" + "import math_utils;";

    const res = await explainCompilerError({ error: errorText });

    expect(res.success).toBe(true);
    expect(res.category).toBe("cxx_modules");
    expect(res.summary).toContain("C++20 Module error: 'math_utils'");
    expect(res.remediation).toContain("build.c++.modules");
    expect(res.remediation).toContain("FILE_SET CXX_MODULES");
  });

  it("explains const correctness violation", async () => {
    const errorText =
      "main.cpp:30:10: error: passing 'const Calculator' as 'this' argument discards qualifiers\n" +
      "calc.reset();";

    const res = await explainCompilerError({ error: errorText });

    expect(res.success).toBe(true);
    expect(res.category).toBe("const_correctness");
    expect(res.summary).toContain("Const-correctness violation");
    expect(res.remediation).toContain("mark it `const`");
  });

  it("explains copy of move-only type / deleted constructor", async () => {
    const errorText =
      "main.cpp:18:24: error: use of deleted function 'std::unique_ptr<int>::unique_ptr(const std::unique_ptr<int>&)'";

    const res = await explainCompilerError({ error: errorText });

    expect(res.success).toBe(true);
    expect(res.category).toBe("move_copy_violation");
    expect(res.summary).toContain("deleted copy/move constructor");
    expect(res.remediation).toContain("std::move");
  });

  it("explains incomplete type error", async () => {
    const errorText =
      "main.cpp:15:12: error: invalid use of incomplete type 'class ForwardNode'\n" +
      "node->next = nullptr;";

    const res = await explainCompilerError({ error: errorText });

    expect(res.success).toBe(true);
    expect(res.category).toBe("incomplete_type");
    expect(res.summary).toContain("Incomplete type error for 'ForwardNode'");
  });

  it("explains missing include and suggests standard header", async () => {
    const errorText =
      "main.cpp:8:5: error: 'vector' was not declared in this scope\n" + "vector<int> numbers;";

    const res = await explainCompilerError({ error: errorText });

    expect(res.success).toBe(true);
    expect(res.category).toBe("missing_include");
    expect(res.suggestedHeaders).toContain("<vector>");
    expect(res.remediation).toContain("<vector>");
  });
});

describe("explainCompilerError - Edge Cases & Robustness", () => {
  it("strips ANSI color escape codes from compiler logs", async () => {
    const coloredError =
      "\x1b[01m\x1b[K/home/user/main.cpp:10:5:\x1b[m\x1b[K \x1b[01;31m\x1b[Kerror:\x1b[m\x1b[K \x1b[01m\x1b[K'vector'\x1b[m\x1b[K was not declared in this scope";

    const res = await explainCompilerError({ error: coloredError });

    expect(res.success).toBe(true);
    expect(res.location?.file).toBe("/home/user/main.cpp");
    expect(res.location?.line).toBe(10);
    expect(res.location?.column).toBe(5);
    expect(res.category).toBe("missing_include");
    expect(res.simplifiedError).not.toContain("\x1b[");
  });

  it("extracts locations with spaces in directory and file names", async () => {
    const errorWithSpaces =
      "/home/user/My Awesome Project/src/sub folder/main.cpp:42:15: error: 'x' was not declared in this scope";

    const res = await explainCompilerError({ error: errorWithSpaces });

    expect(res.success).toBe(true);
    expect(res.location?.file).toBe("/home/user/My Awesome Project/src/sub folder/main.cpp");
    expect(res.location?.line).toBe(42);
    expect(res.location?.column).toBe(15);
  });

  it("parses MSVC fatal error C1083 for missing include headers", async () => {
    const msvcFatalError =
      "C:\\My Project\\app\\main.cpp(25,10): fatal error C1083: Cannot open include file: 'boost/asio.hpp': No such file or directory";

    const res = await explainCompilerError({ error: msvcFatalError });

    expect(res.success).toBe(true);
    expect(res.detectedCompiler).toBe("msvc");
    expect(res.category).toBe("missing_include");
    expect(res.location?.file).toBe("C:\\My Project\\app\\main.cpp");
    expect(res.location?.line).toBe(25);
    expect(res.location?.column).toBe(10);
    expect(res.summary).toContain("Missing header file 'boost/asio.hpp'");
    expect(res.remediation).toContain("add_includedirs");
  });

  it("populates explicit codeSnippet parameter", async () => {
    const snippet = "int main() {\n  std::vector<int> v;\n  return 0;\n}";
    const res = await explainCompilerError({
      error: "main.cpp:2:3: error: 'vector' was not declared in this scope",
      codeSnippet: snippet,
    });

    expect(res.success).toBe(true);
    expect(res.codeSnippet).toBe(snippet);
  });

  it("resolves and extracts code snippet with pointer from disk using workspaceDir", async () => {
    const tempDir = `/tmp/cpp-mcp-err-test-${Date.now()}`;
    const fs = await import("node:fs");
    fs.mkdirSync(tempDir, { recursive: true });
    const testFile = `${tempDir}/test.cpp`;
    fs.writeFileSync(testFile, "int a = 1;\nint b = 2;\nfoo_bar();\nint c = 4;\n", "utf-8");

    try {
      const res = await explainCompilerError({
        error: "test.cpp:3:1: error: 'foo_bar' was not declared in this scope",
        workspaceDir: tempDir,
      });

      expect(res.success).toBe(true);
      expect(res.codeSnippet).toBeDefined();
      expect(res.codeSnippet).toContain("> 3 | foo_bar();");
      expect(res.codeSnippet).toContain("^");
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});

describe("CLI - explain-error command", () => {
  it("runs explain-error directly and exits with 0", async () => {
    const code = await runCli([
      "explain-error",
      "main.cpp:5:10: error: 'vector' was not declared in this scope",
    ]);
    expect(code).toBe(0);
  });

  it("runs explain alias with --json and exits with 0", async () => {
    const code = await runCli(["explain", "main.o: undefined reference to `_Z3foov'", "--json"]);
    expect(code).toBe(0);
  });

  it("fails when error message is missing", async () => {
    const code = await runCli(["explain-error"]);
    expect(code).toBe(1);
  });
});
