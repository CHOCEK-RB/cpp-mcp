// tests/project-scaffold.test.ts
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { existsSync, promises as fs } from "node:fs";
import path from "node:path";
import { runCli } from "../src/cli.js";
import { type BuildSystem, scaffoldProject } from "../src/tools/project-scaffold.js";

const TEST_SCRATCH_DIR = path.resolve(process.cwd(), ".tmp-scaffold-tests");

beforeAll(async () => {
  await fs.mkdir(TEST_SCRATCH_DIR, { recursive: true });
});

afterAll(async () => {
  if (existsSync(TEST_SCRATCH_DIR)) {
    await fs.rm(TEST_SCRATCH_DIR, { recursive: true, force: true });
  }
});

describe("scaffoldProject - In-Memory / Dry Run", () => {
  it("generates default modern xmake C++20 project with Catch2 and Clang tools", async () => {
    const res = await scaffoldProject({
      projectName: "sample_app",
      dryRun: true,
    });

    expect(res.success).toBe(true);
    expect(res.projectName).toBe("sample_app");
    expect(res.buildSystem).toBe("xmake");
    expect(res.cppStandard).toBe("20");
    expect(res.projectType).toBe("executable");
    expect(res.testFramework).toBe("catch2");

    expect(res.filesCreated).toContain("xmake.lua");
    expect(res.filesCreated).toContain(".clang-format");
    expect(res.filesCreated).toContain(".clangd");
    expect(res.filesCreated).toContain(".gitignore");
    expect(res.filesCreated).toContain("README.md");
    expect(res.filesCreated).toContain("src/main.cpp");
    expect(res.filesCreated).toContain("src/sample_app.cpp");
    expect(res.filesCreated).toContain("include/sample_app/sample_app.hpp");
    expect(res.filesCreated).toContain("tests/test_main.cpp");

    const xmakeContent = res.files["xmake.lua"];
    expect(xmakeContent).toContain('set_languages("c++20")');
    expect(xmakeContent).toContain('add_requires("catch2 3.x")');
    expect(xmakeContent).toContain('target("sample_app")');
    expect(xmakeContent).toContain('target("sample_app_tests")');

    const clangFormat = res.files[".clang-format"];
    expect(clangFormat).toContain("Standard: c++20");

    const clangd = res.files[".clangd"];
    expect(clangd).toContain("- -std=c++20");
  });

  it("generates CMake project with GoogleTest and C++23", async () => {
    const res = await scaffoldProject({
      projectName: "my_cmake_lib",
      buildSystem: "cmake",
      projectType: "library",
      cppStandard: "23",
      testFramework: "gtest",
      dryRun: true,
    });

    expect(res.success).toBe(true);
    expect(res.buildSystem).toBe("cmake");
    expect(res.cppStandard).toBe("23");
    expect(res.projectType).toBe("library");
    expect(res.testFramework).toBe("gtest");

    expect(res.filesCreated).toContain("CMakeLists.txt");
    expect(res.filesCreated).not.toContain("src/main.cpp");
    expect(res.filesCreated).toContain("src/my_cmake_lib.cpp");
    expect(res.filesCreated).toContain("include/my_cmake_lib/my_cmake_lib.hpp");
    expect(res.filesCreated).toContain("tests/test_main.cpp");

    const cmakeContent = res.files["CMakeLists.txt"];
    expect(cmakeContent).toContain("set(CMAKE_CXX_STANDARD 23)");
    expect(cmakeContent).toContain("add_library(my_cmake_lib STATIC");
    expect(cmakeContent).toContain("googletest");
    expect(cmakeContent).toContain("GTest::gtest_main");

    const testContent = res.files["tests/test_main.cpp"];
    expect(testContent).toContain("<gtest/gtest.h>");
    expect(testContent).toContain("EXPECT_EQ");
  });

  it("generates C++20 modules project with doctest", async () => {
    const res = await scaffoldProject({
      projectName: "mod_demo",
      projectType: "cxx-modules",
      cppStandard: "20",
      testFramework: "doctest",
      dryRun: true,
    });

    expect(res.success).toBe(true);
    expect(res.filesCreated).toContain("src/mod_demo.mpp");
    expect(res.filesCreated).toContain("src/main.cpp");
    expect(res.filesCreated).toContain("tests/test_main.cpp");

    const moduleContent = res.files["src/mod_demo.mpp"];
    expect(moduleContent).toContain("export module mod_demo;");

    const mainContent = res.files["src/main.cpp"];
    expect(mainContent).toContain("import mod_demo;");

    const testContent = res.files["tests/test_main.cpp"];
    expect(testContent).toContain("import mod_demo;");
    expect(testContent).toContain("<doctest/doctest.h>");
  });

  it("generates header-only library without source cpp", async () => {
    const res = await scaffoldProject({
      projectName: "hdr_only_lib",
      projectType: "header-only",
      testFramework: "none",
      dryRun: true,
    });

    expect(res.success).toBe(true);
    expect(res.filesCreated).toContain("include/hdr_only_lib/hdr_only_lib.hpp");
    expect(res.filesCreated).not.toContain("src/hdr_only_lib.cpp");
    expect(res.filesCreated).not.toContain("src/main.cpp");
    expect(res.filesCreated).not.toContain("tests/test_main.cpp");

    const xmakeContent = res.files["xmake.lua"];
    expect(xmakeContent).toContain('set_kind("headeronly")');
  });

  it("generates Qt application project", async () => {
    const res = await scaffoldProject({
      projectName: "qt_gui_app",
      projectType: "qt",
      testFramework: "none",
      dryRun: true,
    });

    expect(res.success).toBe(true);
    expect(res.filesCreated).toContain("src/mainwindow.hpp");
    expect(res.filesCreated).toContain("src/mainwindow.cpp");
    expect(res.filesCreated).toContain("src/main.cpp");

    const xmakeContent = res.files["xmake.lua"];
    expect(xmakeContent).toContain('add_rules("qt.widgetapp")');
  });

  it("generates CUDA project", async () => {
    const res = await scaffoldProject({
      projectName: "cuda_app",
      projectType: "cuda",
      testFramework: "none",
      dryRun: true,
    });

    expect(res.success).toBe(true);
    expect(res.filesCreated).toContain("src/kernel.cu");
    expect(res.filesCreated).toContain("include/cuda_app/kernel.cuh");
    expect(res.filesCreated).toContain("src/main.cpp");

    const xmakeContent = res.files["xmake.lua"];
    expect(xmakeContent).toContain('add_rules("cuda")');
  });

  it("generates vcpkg and conan manifest files when requested", async () => {
    const vcpkgRes = await scaffoldProject({
      projectName: "vcpkg_demo",
      packageManager: "vcpkg",
      dryRun: true,
    });
    expect(vcpkgRes.filesCreated).toContain("vcpkg.json");
    const vcpkgJson = JSON.parse(vcpkgRes.files["vcpkg.json"] ?? "{}");
    expect(vcpkgJson.name).toBe("vcpkg-demo");

    const conanRes = await scaffoldProject({
      projectName: "conan_demo",
      packageManager: "conan",
      dryRun: true,
    });
    expect(conanRes.filesCreated).toContain("conanfile.txt");
    expect(conanRes.files["conanfile.txt"]).toContain("[requires]");
  });

  it("respects initClangTools: false", async () => {
    const res = await scaffoldProject({
      projectName: "no_clang",
      initClangTools: false,
      dryRun: true,
    });
    expect(res.filesCreated).not.toContain(".clang-format");
    expect(res.filesCreated).not.toContain(".clangd");
  });
});

describe("scaffoldProject - Validation & Edge Cases", () => {
  it("throws error for empty project name", () => {
    expect(
      scaffoldProject({
        projectName: "  ",
        dryRun: true,
      }),
    ).rejects.toThrow("Project name cannot be empty");
  });

  it("throws error for invalid project name characters", () => {
    expect(
      scaffoldProject({
        projectName: "bad name with spaces!",
        dryRun: true,
      }),
    ).rejects.toThrow("Invalid project name");
  });

  it("sanitizes project names starting with numbers", async () => {
    const res = await scaffoldProject({
      projectName: "123_proj",
      dryRun: true,
    });
    expect(res.success).toBe(true);
    expect(res.filesCreated).toContain("src/_123_proj.cpp");
  });

  it("sanitizes C++ reserved keywords with leading underscore", async () => {
    const res = await scaffoldProject({
      projectName: "class",
      dryRun: true,
    });
    expect(res.success).toBe(true);
    expect(res.filesCreated).toContain("src/_class.cpp");
    expect(res.filesCreated).toContain("include/_class/_class.hpp");
    expect(res.files["include/_class/_class.hpp"]).toContain("namespace _class {");
  });

  it("throws error for invalid build system or options", () => {
    expect(
      scaffoldProject({
        projectName: "valid_name",
        buildSystem: "meson" as unknown as BuildSystem,
        dryRun: true,
      }),
    ).rejects.toThrow("Invalid build system 'meson'");
  });

  it("uses CMake 3.28 minimum for cxx-modules", async () => {
    const res = await scaffoldProject({
      projectName: "mod_cmake",
      buildSystem: "cmake",
      projectType: "cxx-modules",
      dryRun: true,
    });
    expect(res.files["CMakeLists.txt"]).toContain("cmake_minimum_required(VERSION 3.28)");
  });
});

describe("scaffoldProject - Disk Creation & Overwrite", () => {
  it("writes actual files to disk and verifies existence", async () => {
    const targetDir = path.join(TEST_SCRATCH_DIR, "real_proj");
    const res = await scaffoldProject({
      projectName: "real_proj",
      targetDir,
      dryRun: false,
      initGit: false,
    });

    expect(res.success).toBe(true);
    expect(existsSync(path.join(targetDir, "xmake.lua"))).toBe(true);
    expect(existsSync(path.join(targetDir, "src", "main.cpp"))).toBe(true);
    expect(existsSync(path.join(targetDir, ".clang-format"))).toBe(true);

    const xmakeContent = await fs.readFile(path.join(targetDir, "xmake.lua"), "utf-8");
    expect(xmakeContent).toContain('target("real_proj")');
  });

  it("refuses to overwrite existing non-empty directory without overwrite: true", () => {
    const targetDir = path.join(TEST_SCRATCH_DIR, "real_proj");
    expect(
      scaffoldProject({
        projectName: "real_proj",
        targetDir,
        dryRun: false,
        overwrite: false,
      }),
    ).rejects.toThrow("already exists and contains");
  });

  it("successfully overwrites existing directory when overwrite: true", async () => {
    const targetDir = path.join(TEST_SCRATCH_DIR, "real_proj");
    const res = await scaffoldProject({
      projectName: "real_proj",
      targetDir,
      buildSystem: "cmake",
      dryRun: false,
      overwrite: true,
    });

    expect(res.success).toBe(true);
    expect(existsSync(path.join(targetDir, "CMakeLists.txt"))).toBe(true);
  });
});

describe("CLI - scaffold and init commands", () => {
  it("runs 'scaffold' in dry-run mode and exits with 0", async () => {
    const code = await runCli(["scaffold", "cli_demo", "--dry-run"]);
    expect(code).toBe(0);
  });

  it("runs 'init' alias with --json and exits with 0", async () => {
    const code = await runCli(["init", "cli_demo_json", "--dry-run", "--json"]);
    expect(code).toBe(0);
  });

  it("fails when project name is missing", async () => {
    const code = await runCli(["scaffold"]);
    expect(code).toBe(1);
  });

  it("fails when an invalid enum option is passed via CLI", async () => {
    const code = await runCli(["scaffold", "cli_demo", "--build", "meson"]);
    expect(code).toBe(1);

    const code2 = await runCli(["scaffold", "cli_demo", "--type", "invalid_type"]);
    expect(code2).toBe(1);
  });
});
