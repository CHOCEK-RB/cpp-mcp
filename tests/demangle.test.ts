import { describe, expect, it } from "bun:test";
import { createServer } from "../src/index.js";
import {
  demangleItaniumFallback,
  demangleMsvcFallback,
  demangleSymbol,
  detectSymbolAbi,
} from "../src/tools/demangle.js";

describe("C++ Symbol Demangler", () => {
  it("should correctly detect symbol ABI family", () => {
    expect(detectSymbolAbi("_Z3addii")).toBe("itanium");
    expect(detectSymbolAbi("__Z3addii")).toBe("itanium");
    expect(detectSymbolAbi("?func@@YAHXZ")).toBe("msvc");
    expect(detectSymbolAbi("?bar@Foo@@QAEXXZ")).toBe("msvc");
    expect(detectSymbolAbi("Error?Why")).toBe("unknown"); // No @ separator
    expect(detectSymbolAbi("_RNvC4test4main")).toBe("rust");
    expect(detectSymbolAbi("regular_c_function")).toBe("unknown");
  });

  it("should demangle simple Itanium functions", () => {
    const res = demangleSymbol({ symbol: "_Z3addii" });
    expect(res.isMangled).toBe(true);
    expect(res.abi).toBe("itanium");
    expect(res.demangled).toContain("add");
    expect(res.demangled).toContain("int");
  });

  it("should demangle nested namespace and class methods", () => {
    const res = demangleSymbol({ symbol: "_ZN3Foo3barEv" });
    expect(res.isMangled).toBe(true);
    expect(res.abi).toBe("itanium");
    expect(res.demangled).toContain("Foo::bar");
  });

  it("should demangle complex std library symbols", () => {
    const res = demangleSymbol({ symbol: "_ZNSt6vectorIiSaIiEE9push_backERKi" });
    expect(res.isMangled).toBe(true);
    expect(res.abi).toBe("itanium");
    expect(res.demangled).toContain("vector");
    expect(res.demangled).toContain("push_back");
  });

  it("should demangle MSVC symbols using system tool or fallback parser", () => {
    const res1 = demangleSymbol({ symbol: "?func@@YAHXZ" });
    expect(res1.isMangled).toBe(true);
    expect(res1.abi).toBe("msvc");
    expect(res1.demangled).toContain("func");
    expect(res1.demangled).toContain("int");

    const res2 = demangleSymbol({ symbol: "?bar@Foo@@QAEXXZ" });
    expect(res2.isMangled).toBe(true);
    expect(res2.abi).toBe("msvc");
    expect(res2.demangled).toContain("Foo::bar");
  });

  it("should demangle MSVC symbols accurately via fallback parser", () => {
    expect(demangleMsvcFallback("?func@@YAHXZ")).toContain("int __cdecl func(void)");
    expect(demangleMsvcFallback("?bar@Foo@@QAEXXZ")).toContain("void __thiscall Foo::bar(void)");
    expect(demangleMsvcFallback("?bar@Foo@@QAEXXZ", true)).toBe("Foo::bar");
  });

  it("should strip parameters when strip_params is enabled", () => {
    const res = demangleSymbol({ symbol: "_Z3addii", strip_params: true });
    expect(res.isMangled).toBe(true);
    expect(res.demangled.trim()).toBe("add");

    const resMsvc = demangleSymbol({ symbol: "?func@@YAHXZ", strip_params: true });
    expect(resMsvc.isMangled).toBe(true);
    expect(resMsvc.demangled.trim()).toBe("func");
  });

  it("should extract and translate mangled symbols inside full linker error messages without prefix collisions", () => {
    // Both _Z3foo and _Z3foov are present; longer must be replaced first
    const errorSnippet = `
      /usr/bin/ld: /tmp/main.o: in function 'main':
      main.cpp:(.text+0x13): undefined reference to '_Z3foov'
      main.cpp:(.text+0x20): undefined reference to '_ZN3Bar3bazEi'
      main.cpp:(.text+0x35): unresolved external symbol '?func@@YAHXZ'
      Note: Error?Why should not be touched
      collect2: error: ld returned 1 exit status
    `;

    const res = demangleSymbol({ symbol: errorSnippet });
    expect(res.isMangled).toBe(true);
    expect(res.method).toBe("text_translation");
    expect(res.extractedSymbols).toBeDefined();
    expect(res.extractedSymbols?.length).toBe(3);

    expect(res.translatedText).toContain("foo()");
    expect(res.translatedText).toContain("Bar::baz");
    expect(res.translatedText).toContain("func");
    expect(res.translatedText).toContain("Error?Why");
    expect(res.translatedText).not.toContain("'_Z3foov'");
    expect(res.translatedText).not.toContain("'?func@@YAHXZ'");
  });

  it("should accurately demangle via pure JS Itanium fallback parser", () => {
    expect(demangleItaniumFallback("_Z3addii")).toBe("add(int, int)");
    expect(demangleItaniumFallback("_Z4funcv")).toBe("func()");
    expect(demangleItaniumFallback("_ZN3Foo3barEv")).toBe("Foo::bar()");
    expect(demangleItaniumFallback("_ZNK3Foo3getEv")).toBe("Foo::get() const");
    expect(demangleItaniumFallback("_ZN3FooC1Ev")).toBe("Foo::Foo()");
    expect(demangleItaniumFallback("_ZN3FooD1Ev")).toBe("Foo::~Foo()");
    expect(demangleItaniumFallback("_ZN3FooplERKS_")).toBe("Foo::operator+(const Foo&)");
  });

  it("should pass through already unmangled symbols safely", () => {
    const res = demangleSymbol({ symbol: "std::vector<int>::push_back" });
    expect(res.isMangled).toBe(false);
    expect(res.demangled).toBe("std::vector<int>::push_back");
    expect(res.method).toBe("unmangled");
  });

  it("should register demangle_symbol tool in createServer", () => {
    const server = createServer();
    const serverAny = server as unknown as {
      _registeredTools?: Record<string, unknown>;
    };

    expect(serverAny._registeredTools).toBeDefined();
    expect(serverAny._registeredTools?.demangle_symbol).toBeDefined();
  });
});
