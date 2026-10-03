// scripts/check-coverage.ts
// Runs the suite with coverage and fails when overall coverage regresses.
// Bun (1.3.x) has no --coverage-threshold flag, so we parse the summary table.
//
// The floor is calibrated against CI: GitHub runners ship no clangd, xmake or
// LLVM tools, so every test that exercises the spawn-heavy code paths skips
// there and coverage lands ~5 points below a developer machine. The registry
// refactor moved all 24 tool handlers into src/tool-registry.ts, which shifts
// the function denominator, so the funcs floor follows the runner. Override
// locally (e.g. `COVERAGE_MIN_FUNCS=88 COVERAGE_MIN_LINES=87 bun run check:coverage`)
// to ratchet up while working on those modules.
const MIN_FUNCS = Number(process.env.COVERAGE_MIN_FUNCS ?? 83);
const MIN_LINES = Number(process.env.COVERAGE_MIN_LINES ?? 81);

const projectRoot = `${import.meta.dir}/..`;

const proc = Bun.spawnSync(["bun", "test", "--coverage"], {
  cwd: projectRoot,
  stdout: "pipe",
  stderr: "pipe",
});

const ansi = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");
const stdout = proc.stdout.toString().replace(ansi, "");
const stderr = proc.stderr.toString().replace(ansi, "");
process.stdout.write(stdout);
process.stderr.write(stderr);

const match = `${stdout}\n${stderr}`.match(/^All files\s*\|\s*([\d.]+)\s*\|\s*([\d.]+)/m);
if (!match) {
  console.error("Could not parse the coverage summary from the test output.");
  process.exit(1);
}

const funcs = Number(match[1]);
const lines = Number(match[2]);
console.log(
  `Coverage ratchet: funcs ${funcs}% (min ${MIN_FUNCS}%), lines ${lines}% (min ${MIN_LINES}%).`,
);

if (proc.exitCode !== 0) {
  process.exit(proc.exitCode ?? 1);
}
if (funcs < MIN_FUNCS || lines < MIN_LINES) {
  console.error(
    `Coverage regressed below the ratchet: funcs ${funcs}% (min ${MIN_FUNCS}%), lines ${lines}% (min ${MIN_LINES}%).`,
  );
  process.exit(1);
}
