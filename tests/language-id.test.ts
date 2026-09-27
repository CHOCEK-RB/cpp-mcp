import { describe, expect, it } from "bun:test";
import { inferLanguageId } from "../src/lsp/index.js";

describe("inferLanguageId", () => {
  it("maps .c files to the C language id", () => {
    expect(inferLanguageId("/tmp/main.c")).toBe("c");
    expect(inferLanguageId("/tmp/MAIN.C")).toBe("c");
  });

  it("maps .cu files to the CUDA language id", () => {
    expect(inferLanguageId("/tmp/kernel.cu")).toBe("cuda");
    expect(inferLanguageId("/tmp/kernel.cuh")).toBe("cuda");
  });

  it("defaults C++ translation units and headers to cpp", () => {
    const cppFiles = [
      "a.cpp",
      "a.cc",
      "a.cxx",
      "a.c++",
      "a.hpp",
      "a.hxx",
      "a.hh",
      "a.h",
      "a.mpp",
      "a.cppm",
    ];
    for (const file of cppFiles) {
      expect(inferLanguageId(`/tmp/${file}`)).toBe("cpp");
    }
  });

  it("defaults unknown extensions to cpp", () => {
    expect(inferLanguageId("/tmp/no-extension")).toBe("cpp");
    expect(inferLanguageId("/tmp/data.txt")).toBe("cpp");
  });
});
