#!/usr/bin/env bun
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

interface TargetConfig {
  target: string;
  name: string;
}

export const TARGETS: TargetConfig[] = [
  { target: "bun-linux-x64", name: "cpp-mcp-linux-x64" },
  { target: "bun-linux-arm64", name: "cpp-mcp-linux-arm64" },
  { target: "bun-darwin-x64", name: "cpp-mcp-darwin-x64" },
  { target: "bun-darwin-arm64", name: "cpp-mcp-darwin-arm64" },
  { target: "bun-windows-x64", name: "cpp-mcp-windows-x64.exe" },
];

export async function compileAll(outDir = "./dist/bin"): Promise<string[]> {
  await fs.mkdir(outDir, { recursive: true });
  const generatedFiles: string[] = [];
  const checksums: string[] = [];

  console.log(`Compiling standalone executables to ${outDir}...`);

  for (const { target, name } of TARGETS) {
    const outFile = path.join(outDir, name);
    console.log(`Building ${name} (${target})...`);

    const proc = Bun.spawnSync([
      "bun",
      "build",
      "--compile",
      "--minify",
      `--target=${target}`,
      "./src/index.ts",
      "--outfile",
      outFile,
    ]);

    if (proc.exitCode !== 0) {
      throw new Error(
        `Failed to compile ${name}: ${proc.stderr.toString() || proc.stdout.toString()}`,
      );
    }

    const fileBuffer = await fs.readFile(outFile);
    const hash = createHash("sha256").update(fileBuffer).digest("hex");
    checksums.push(`${hash}  ${name}`);
    generatedFiles.push(outFile);

    const sizeMb = (fileBuffer.length / (1024 * 1024)).toFixed(2);
    console.log(`  ✓ ${name} (${sizeMb} MB) [SHA256: ${hash.slice(0, 8)}...]`);
  }

  const checksumPath = path.join(outDir, "SHA256SUMS.txt");
  await fs.writeFile(checksumPath, `${checksums.join("\n")}\n`, "utf-8");
  generatedFiles.push(checksumPath);
  console.log(`  ✓ Checksums written to ${checksumPath}`);

  return generatedFiles;
}

const isDirect =
  typeof process !== "undefined" &&
  process.argv[1] &&
  process.argv[1].endsWith("compile-binaries.ts");

if (isDirect) {
  compileAll().catch((err) => {
    console.error("Compilation failed:", err);
    process.exit(1);
  });
}
