// src/tools/module-toolchain.ts
// Inspects the host toolchain to say which `import std;` / C++20 modules setup
// is actually viable here (compiler, std module source, libc++, clangd).
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface ModuleToolchainOptions {
  /** Extra candidate paths probed for a modularized libc++. */
  libcxxIncludeCandidates?: string[];
}

export interface ToolchainProbeResult {
  available: boolean;
  output: string;
}

export interface ModuleToolchainDeps {
  probe?: (command: string, args: string[]) => Promise<ToolchainProbeResult>;
  exists?: (candidate: string) => boolean;
}

export interface ToolchainComponent {
  available: boolean;
  version?: string;
}

export interface ModuleToolchainHost {
  clang: ToolchainComponent;
  gcc: ToolchainComponent & { stdModule: boolean };
  clangd: ToolchainComponent;
  libcxx: boolean;
}

export interface ModuleToolchainOption {
  id: "clang-libc++" | "gcc-native" | "hybrid";
  label: string;
  viable: boolean;
  reason: string;
  requirements: string[];
}

export interface ModuleToolchainResult {
  success: boolean;
  host: ModuleToolchainHost;
  /** id of the option that best fits this host. */
  recommended: ModuleToolchainOption["id"];
  options: ModuleToolchainOption[];
  notes: string[];
  error?: string;
}

const DEFAULT_LIBCXX_CANDIDATES = [
  "/usr/include/c++/v1/iostream",
  "/usr/local/include/c++/v1/iostream",
];

/** Extracts the leading `major.minor.patch` (or `major.minor`) from a version banner. */
export function parseToolVersion(output: string): string | undefined {
  const match = output.match(/(\d+)\.(\d+)(?:\.(\d+))?/);
  if (!match) return undefined;
  return match[3] ? `${match[1]}.${match[2]}.${match[3]}` : `${match[1]}.${match[2]}`;
}

function majorOf(version: string | undefined): number | undefined {
  if (!version) return undefined;
  const major = Number.parseInt(version.split(".")[0] ?? "", 10);
  return Number.isNaN(major) ? undefined : major;
}

async function defaultProbe(command: string, args: string[]): Promise<ToolchainProbeResult> {
  try {
    const { stdout, stderr } = await execFileAsync(command, args, { timeout: 3000 });
    return { available: true, output: `${stdout}${stderr}` };
  } catch {
    return { available: false, output: "" };
  }
}

/**
 * Inspects the host for the compilers, std-module source, libc++ and clangd,
 * then reports which `import std;` strategy is viable.
 */
export async function checkModuleToolchain(
  options: ModuleToolchainOptions = {},
  deps: ModuleToolchainDeps = {},
): Promise<ModuleToolchainResult> {
  const probe = deps.probe ?? defaultProbe;
  const exists = deps.exists ?? existsSync;

  const [clangProbe, gccProbe, clangdProbe] = await Promise.all([
    probe("clang++", ["--version"]),
    probe("g++", ["--version"]),
    probe("clangd", ["--version"]),
  ]);

  const clangVersion = clangProbe.available ? parseToolVersion(clangProbe.output) : undefined;
  const gccVersion = gccProbe.available ? parseToolVersion(gccProbe.output) : undefined;
  const clangdVersion = clangdProbe.available ? parseToolVersion(clangdProbe.output) : undefined;

  const candidates = [...DEFAULT_LIBCXX_CANDIDATES, ...(options.libcxxIncludeCandidates ?? [])];
  const libcxx = candidates.some((candidate) => exists(candidate));

  const gccMajor = majorOf(gccVersion);
  const gccStdModule =
    gccMajor !== undefined &&
    ["/usr/include/c++", "/usr/local/include/c++"].some((base) =>
      exists(`${base}/${gccMajor}/bits/std.cc`),
    );

  const gccFourteenPlus = gccMajor !== undefined && gccMajor >= 14;
  const clangViable = clangProbe.available && libcxx;

  const options_: ModuleToolchainOption[] = [
    {
      id: "clang-libc++",
      label: "Clang + modularized libc++",
      viable: clangViable,
      reason: clangViable
        ? `Clang ${clangVersion} with libc++ headers lets one compiler build the std module and serve clangd, so no BMI is shared between toolchains.`
        : !clangProbe.available
          ? "clang++ is not on PATH."
          : "No modularized libc++ found; libstdc++ ships the `std` module for GCC, not for Clang.",
      requirements: ["clang++ 17+", "libc++/libc++abi (libc++-dev)", "c++23"],
    },
    {
      id: "gcc-native",
      label: "GCC 14+ native `import std;`",
      viable: gccFourteenPlus,
      reason: !gccProbe.available
        ? "g++ is not on PATH."
        : gccFourteenPlus
          ? `g++ ${gccVersion} can build the std module${gccStdModule ? " (bits/std.cc present)" : ""}, but clangd cannot read GCC's .gcm BMIs.`
          : `g++ ${gccVersion} is older than 14, which is the baseline for the std module.`,
      requirements: ["g++ 14+", "c++23", "compiler-aware IDE/tooling (clangd won't read .gcm)"],
    },
    {
      id: "hybrid",
      label: "Hybrid: std module for std, #include for the rest",
      viable: true,
      reason:
        "Always possible: `import std;` where the compiler supports it, `#include` for POSIX/third-party headers in the global module fragment.",
      requirements: ["A compiler with std-module support for `import std;`"],
    },
  ];

  const recommended: ModuleToolchainOption["id"] = clangViable
    ? "clang-libc++"
    : gccFourteenPlus
      ? "gcc-native"
      : "hybrid";

  const notes: string[] = [];
  if (gccFourteenPlus && clangProbe.available && !libcxx) {
    notes.push(
      "GCC can build `import std;` but clangd/clang cannot read GCC `.gcm` BMIs: expect `module_not_found` in the editor even when the build succeeds. Install libc++ (libc++-dev) if you want clangd and the build to agree.",
    );
  }
  if (!gccFourteenPlus && !clangViable) {
    notes.push(
      "No std-module-capable toolchain detected. Use `#include` (or `import` for your own modules only) until you install GCC 14+ or Clang + libc++.",
    );
  }
  if (clangdProbe.available && recommended === "clang-libc++") {
    notes.push(
      `clangd ${clangdVersion} matches the Clang toolchain, so module navigation stays consistent.`,
    );
  }

  return {
    success: true,
    host: {
      clang: { available: clangProbe.available, version: clangVersion },
      gcc: { available: gccProbe.available, version: gccVersion, stdModule: gccStdModule },
      clangd: { available: clangdProbe.available, version: clangdVersion },
      libcxx,
    },
    recommended,
    options: options_,
    notes,
  };
}
