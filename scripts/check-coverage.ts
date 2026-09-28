// scripts/check-coverage.ts
// Runs the suite with coverage and fails when overall coverage regresses.
// Bun (1.3.x) has no --coverage-threshold flag, so we parse the summary table.

const MIN_FUNCS = 89;
const MIN_LINES = 88;

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
