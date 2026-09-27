// src/tools/demangle.ts
// C++ Symbol Demangler for Itanium ABI (GCC, Clang) and MSVC ABI.
import { spawnSync } from "node:child_process";

export interface DemangleParams {
  symbol: string;
  strip_params?: boolean;
}

export interface DemangleResult {
  original: string;
  demangled: string;
  abi: "itanium" | "msvc" | "rust" | "unknown";
  method: "cxxfilt" | "llvm-undname" | "fallback" | "unmangled" | "text_translation";
  extractedSymbols?: Array<{
    mangled: string;
    demangled: string;
    abi: string;
  }>;
  translatedText?: string;
  isMangled: boolean;
}

const ITANIUM_PRIMITIVES: Record<string, string> = {
  v: "void",
  w: "wchar_t",
  b: "bool",
  c: "char",
  a: "signed char",
  h: "unsigned char",
  s: "short",
  t: "unsigned short",
  i: "int",
  j: "unsigned int",
  l: "long",
  m: "unsigned long",
  x: "long long",
  y: "unsigned long long",
  f: "float",
  d: "double",
  e: "long double",
  z: "...",
};

const ITANIUM_OPERATORS: Record<string, string> = {
  nw: "operator new",
  na: "operator new[]",
  dl: "operator delete",
  da: "operator delete[]",
  ps: "operator+",
  ng: "operator-",
  ad: "operator&",
  de: "operator*",
  co: "operator~",
  pl: "operator+",
  mi: "operator-",
  ml: "operator*",
  dv: "operator/",
  rm: "operator%",
  an: "operator&",
  eo: "operator^",
  or: "operator|",
  as: "operator=",
  pL: "operator+=",
  mI: "operator-=",
  mL: "operator*=",
  dV: "operator/=",
  rM: "operator%=",
  aN: "operator&=",
  eO: "operator^=",
  oR: "operator|=",
  ls: "operator<<",
  rs: "operator>>",
  lS: "operator<<=",
  rS: "operator>>=",
  eq: "operator==",
  ne: "operator!=",
  lt: "operator<",
  gt: "operator>",
  le: "operator<=",
  ge: "operator>=",
  ss: "operator<=>",
  nt: "operator!",
  aa: "operator&&",
  oo: "operator||",
  pp: "operator++",
  mm: "operator--",
  cm: "operator,",
  pm: "operator->*",
  pt: "operator->",
  cl: "operator()",
  ix: "operator[]",
  qu: "operator?",
};

const MSVC_PRIMITIVES: Record<string, string> = {
  X: "void",
  H: "int",
  D: "char",
  C: "signed char",
  E: "unsigned char",
  F: "short",
  G: "unsigned short",
  I: "unsigned int",
  J: "long",
  K: "unsigned long",
  M: "float",
  N: "double",
  _N: "bool",
  _J: "__int64",
  _K: "unsigned __int64",
};

export function detectSymbolAbi(symbol: string): "itanium" | "msvc" | "rust" | "unknown" {
  const trimmed = symbol.trim();
  if (trimmed.startsWith("_Z") || trimmed.startsWith("__Z") || trimmed.startsWith("___Z")) {
    return "itanium";
  }
  if (trimmed.startsWith("?") && trimmed.includes("@")) {
    return "msvc";
  }
  if (trimmed.startsWith("_R")) {
    return "rust";
  }
  return "unknown";
}

function demangleItaniumWithSystemTool(symbol: string, stripParams = false): string | null {
  try {
    const args = stripParams ? ["-p", symbol] : [symbol];
    const proc = spawnSync("c++filt", args, {
      encoding: "utf-8",
      timeout: 2000,
    });

    if (proc.status === 0 && proc.stdout) {
      const output = proc.stdout.trim();
      if (output && output !== symbol) {
        return output;
      }
    }
  } catch {
    // c++filt not available or timed out
  }
  return null;
}

function demangleMsvcWithSystemTool(symbol: string, stripParams = false): string | null {
  for (const cmd of ["llvm-undname", "undname"]) {
    try {
      const proc = spawnSync(cmd, [symbol], {
        encoding: "utf-8",
        timeout: 2000,
      });

      if (proc.status === 0 && proc.stdout) {
        const lines = proc.stdout
          .split("\n")
          .map((l) => l.trim())
          .filter(Boolean);
        const match = lines.find(
          (l) => l !== symbol && !l.startsWith("?") && !l.startsWith("Undecoration"),
        );
        if (match) {
          if (stripParams) {
            return match
              .replace(/\(.*?\)/g, "")
              .replace(/^(public|protected|private):\s*/, "")
              .replace(/^.*?\s+([A-Za-z0-9_:]+)$/, "$1");
          }
          return match.replace(/^(public|protected|private):\s*/, "");
        }
      }
    } catch {
      // try next
    }
  }
  return null;
}

/**
 * Fallback parser for standard Itanium ABI symbols (_Z...)
 */
export function demangleItaniumFallback(mangled: string): string {
  let rest = mangled.trim();

  // Strip leading underscores
  if (rest.startsWith("___Z")) rest = rest.slice(4);
  else if (rest.startsWith("__Z")) rest = rest.slice(3);
  else if (rest.startsWith("_Z")) rest = rest.slice(2);
  else return mangled;

  let isConst = false;
  let isVolatile = false;

  if (rest.startsWith("K")) {
    isConst = true;
    rest = rest.slice(1);
  }
  if (rest.startsWith("V")) {
    isVolatile = true;
    rest = rest.slice(1);
  }

  // Handle nested name: N ... E
  if (rest.startsWith("N")) {
    rest = rest.slice(1);
    const parts: string[] = [];

    while (rest.length > 0 && !rest.startsWith("E")) {
      // Modifiers inside nested name
      if (rest.startsWith("K")) {
        isConst = true;
        rest = rest.slice(1);
        continue;
      }
      if (rest.startsWith("V")) {
        isVolatile = true;
        rest = rest.slice(1);
        continue;
      }

      // Standard substitutions
      if (rest.startsWith("St")) {
        parts.push("std");
        rest = rest.slice(2);
        continue;
      }
      if (rest.startsWith("Sa")) {
        parts.push("std::allocator");
        rest = rest.slice(2);
        continue;
      }
      if (rest.startsWith("Ss")) {
        parts.push("std::string");
        rest = rest.slice(2);
        continue;
      }

      // Constructors & Destructors
      if (rest.startsWith("C1") || rest.startsWith("C2")) {
        const className = parts[parts.length - 1] ?? "Constructor";
        parts.push(className);
        rest = rest.slice(2);
        continue;
      }
      if (rest.startsWith("D1") || rest.startsWith("D2")) {
        const className = parts[parts.length - 1] ?? "Destructor";
        parts.push(`~${className}`);
        rest = rest.slice(2);
        continue;
      }

      // Operators
      const op2 = rest.slice(0, 2);
      const op = ITANIUM_OPERATORS[op2];
      if (op) {
        parts.push(op);
        rest = rest.slice(2);
        continue;
      }

      // Parse length-prefixed identifier: <number><chars>
      const match = rest.match(/^(\d+)/);
      if (match?.[1]) {
        const len = Number.parseInt(match[1], 10);
        const start = match[1].length;
        const ident = rest.slice(start, start + len);
        parts.push(ident);
        rest = rest.slice(start + len);
      } else {
        break;
      }
    }

    if (rest.startsWith("E")) {
      rest = rest.slice(1);
    }

    const qualified = parts.join("::");
    const params = parseItaniumParamTypes(rest, parts);
    let result = qualified;
    if (params.length === 1 && params[0] === "void") {
      result += "()";
    } else if (params.length > 0) {
      result += `(${params.join(", ")})`;
    } else {
      result += "()";
    }

    if (isConst) result += " const";
    if (isVolatile) result += " volatile";
    return result;
  }

  // Simple non-nested function: _Z<len><name><params>
  const match = rest.match(/^(\d+)/);
  if (match?.[1]) {
    const len = Number.parseInt(match[1], 10);
    const start = match[1].length;
    const name = rest.slice(start, start + len);
    const paramStr = rest.slice(start + len);
    const params = parseItaniumParamTypes(paramStr);

    if (params.length === 1 && params[0] === "void") {
      return `${name}()`;
    }
    if (params.length > 0) {
      return `${name}(${params.join(", ")})`;
    }
    return `${name}()`;
  }

  return mangled;
}

function formatTypeWithPrefix(base: string, prefix: string): string {
  if (!prefix) return base;
  if (prefix.includes("const") && prefix.includes("&")) {
    return `const ${base}&`;
  }
  if (prefix.includes("const") && prefix.includes("*")) {
    return `const ${base}*`;
  }
  if (prefix.includes("const")) {
    return `const ${base}`;
  }
  return `${base}${prefix.trim()}`;
}

function parseItaniumParamTypes(raw: string, substitutions: string[] = []): string[] {
  const types: string[] = [];
  let i = 0;

  while (i < raw.length) {
    let prefix = "";
    while (
      i < raw.length &&
      (raw[i] === "P" || raw[i] === "R" || raw[i] === "O" || raw[i] === "K")
    ) {
      if (raw[i] === "P") prefix += "*";
      else if (raw[i] === "R") prefix += "&";
      else if (raw[i] === "O") prefix += "&&";
      else if (raw[i] === "K") prefix = `const ${prefix}`;
      i++;
    }

    const ch = raw[i];
    if (!ch) break;

    // Substitutions: S_ or S<seq>_
    if (raw.slice(i, i + 2) === "S_") {
      const base = substitutions[0] ?? "T";
      types.push(formatTypeWithPrefix(base, prefix));
      i += 2;
      continue;
    }

    const subMatch = raw.slice(i).match(/^S([0-9A-Z]+)_/);
    if (subMatch) {
      const base = substitutions[0] ?? "T";
      types.push(formatTypeWithPrefix(base, prefix));
      i += subMatch[0].length;
      continue;
    }

    const primitive = ITANIUM_PRIMITIVES[ch];
    if (primitive) {
      types.push(formatTypeWithPrefix(primitive, prefix));
      i++;
      continue;
    }

    // Length-prefixed custom type: <len><ident>
    const match = raw.slice(i).match(/^(\d+)/);
    if (match?.[1]) {
      const len = Number.parseInt(match[1], 10);
      const start = match[1].length;
      const ident = raw.slice(i + start, i + start + len);
      types.push(formatTypeWithPrefix(ident, prefix));
      i += start + len;
      continue;
    }

    // Skip unknown character to avoid infinite loop
    i++;
  }

  return types;
}

/**
 * Fallback parser for standard MSVC ABI symbols (?...)
 */
export function demangleMsvcFallback(mangled: string, stripParams = false): string {
  if (!mangled.startsWith("?")) return mangled;
  const atAt = mangled.indexOf("@@");
  if (atAt === -1) return mangled;

  const namesPart = mangled.slice(1, atAt);
  let rest = mangled.slice(atAt + 2);
  const nameSegments = namesPart.split("@").reverse();
  const qualifiedName = nameSegments.join("::");

  if (stripParams) {
    return qualifiedName;
  }

  let isConst = false;
  let convention = "__cdecl";

  if (rest.startsWith("Y")) {
    // Free function
    rest = rest.slice(1);
    if (rest.startsWith("A")) convention = "__cdecl";
    else if (rest.startsWith("G")) convention = "__stdcall";
    rest = rest.slice(1);
  } else if (rest.startsWith("Q") || rest.startsWith("I") || rest.startsWith("E")) {
    // Member function
    const cv = rest[1];
    if (cv === "B" || cv === "D") isConst = true;
    const callCode = rest[2];
    if (callCode === "E") convention = "__thiscall";
    else if (callCode === "A") convention = "__cdecl";
    else if (callCode === "G") convention = "__stdcall";
    rest = rest.slice(3);
  }

  let returnType = "";
  if (rest.startsWith("_N")) {
    returnType = "bool";
    rest = rest.slice(2);
  } else if (rest[0]) {
    const prim = MSVC_PRIMITIVES[rest[0]];
    if (prim) {
      returnType = prim;
      rest = rest.slice(1);
    }
  }

  const params: string[] = [];
  while (rest.length > 0 && rest[0] !== "Z") {
    if (rest[0] === "X") {
      params.push("void");
      rest = rest.slice(1);
      break;
    }
    if (rest.startsWith("_N")) {
      params.push("bool");
      rest = rest.slice(2);
      continue;
    }
    const p = rest[0];
    const prim = p ? MSVC_PRIMITIVES[p] : undefined;
    if (prim) {
      params.push(prim);
      rest = rest.slice(1);
      continue;
    }
    rest = rest.slice(1);
  }

  const paramStr = params.length > 0 ? params.join(", ") : "void";
  const constSuffix = isConst ? " const" : "";
  if (returnType) {
    return `${returnType} ${convention} ${qualifiedName}(${paramStr})${constSuffix}`;
  }
  return `${qualifiedName}(${paramStr})${constSuffix}`;
}

/**
 * Main demangling function. Automatically handles:
 * 1. Single mangled symbols (_Z..., ?...)
 * 2. Entire compiler/linker error trace snippets containing multiple mangled symbols
 */
export function demangleSymbol(params: DemangleParams): DemangleResult {
  const { symbol, strip_params = false } = params;
  const raw = symbol.trim();

  // Pattern with strict MSVC @ requirement avoiding false positives like "Error?Why"
  const mangledPattern =
    /(?:___Z[A-Za-z0-9_]+|__Z[A-Za-z0-9_]+|_Z[A-Za-z0-9_]+|\?[A-Za-z0-9_$]+@[A-Za-z0-9_@$]+)/g;
  const rawMatches = [...new Set(raw.match(mangledPattern) ?? [])];

  if (rawMatches.length > 1 || (rawMatches.length === 1 && raw !== rawMatches[0])) {
    // Multi-token or log trace text mode
    // Sort matches descending by length to prevent partial prefix replacement collisions
    const matches = rawMatches.sort((a, b) => b.length - a.length);
    const extractedSymbols: Array<{ mangled: string; demangled: string; abi: string }> = [];

    // Attempt single-pass stream translation via c++filt over stdin
    let translatedText = raw;
    try {
      const proc = spawnSync("c++filt", strip_params ? ["-p"] : [], {
        input: raw,
        encoding: "utf-8",
        timeout: 3000,
      });
      if (proc.status === 0 && proc.stdout && proc.stdout.trim() !== raw) {
        translatedText = proc.stdout;
      }
    } catch {
      // Fallback to per-symbol replacement below
    }

    // Now resolve each extracted symbol and replace any remaining (e.g. MSVC or fallback symbols)
    for (const match of matches) {
      const abi = detectSymbolAbi(match);
      let demangled: string | null = null;

      if (abi === "itanium") {
        demangled =
          demangleItaniumWithSystemTool(match, strip_params) ?? demangleItaniumFallback(match);
      } else if (abi === "msvc") {
        demangled =
          demangleMsvcWithSystemTool(match, strip_params) ??
          demangleMsvcFallback(match, strip_params);
      }

      const finalDemangled = demangled || match;

      extractedSymbols.push({
        mangled: match,
        demangled: finalDemangled,
        abi,
      });

      translatedText = translatedText.replaceAll(match, finalDemangled);
    }

    return {
      original: raw,
      demangled: translatedText,
      abi: "unknown",
      method: "text_translation",
      extractedSymbols,
      translatedText,
      isMangled: true,
    };
  }

  // Single symbol mode
  const abi = detectSymbolAbi(raw);
  if (abi === "unknown") {
    return {
      original: raw,
      demangled: raw,
      abi: "unknown",
      method: "unmangled",
      isMangled: false,
    };
  }

  // Try MSVC ABI
  if (abi === "msvc") {
    const sysResult = demangleMsvcWithSystemTool(raw, strip_params);
    if (sysResult) {
      return {
        original: raw,
        demangled: sysResult,
        abi,
        method: "llvm-undname",
        isMangled: true,
      };
    }
    const fallbackResult = demangleMsvcFallback(raw, strip_params);
    return {
      original: raw,
      demangled: fallbackResult,
      abi,
      method: "fallback",
      isMangled: true,
    };
  }

  // Try Itanium ABI (c++filt first, then pure JS fallback)
  const sysResult = demangleItaniumWithSystemTool(raw, strip_params);
  if (sysResult) {
    return {
      original: raw,
      demangled: sysResult,
      abi,
      method: "cxxfilt",
      isMangled: true,
    };
  }

  const fallbackResult = demangleItaniumFallback(raw);
  return {
    original: raw,
    demangled: fallbackResult,
    abi,
    method: "fallback",
    isMangled: true,
  };
}
