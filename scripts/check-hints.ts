import ts from "typescript";

interface ProgramInternal extends ts.Program {
  getSuggestionDiagnostics(file: ts.SourceFile): ts.DiagnosticWithLocation[];
}

const configPath = ts.findConfigFile("./", ts.sys.fileExists, "tsconfig.json");
if (!configPath) {
  console.error("tsconfig.json not found");
  process.exit(1);
}

const configFile = ts.readConfigFile(configPath, ts.sys.readFile);
const parsed = ts.parseJsonConfigFileContent(configFile.config, ts.sys, "./");
const program = ts.createProgram(parsed.fileNames, parsed.options) as ProgramInternal;

let count = 0;
for (const file of program.getSourceFiles()) {
  if (file.fileName.includes("node_modules") || file.fileName.includes("dist")) {
    continue;
  }

  const diags = program.getSuggestionDiagnostics(file);
  for (const d of diags) {
    count++;
    const { line, character } = file.getLineAndCharacterOfPosition(d.start ?? 0);
    const message = ts.flattenDiagnosticMessageText(d.messageText, "\n");
    console.warn(
      `\x1b[33m${file.fileName}:${line + 1}:${character + 1}\x1b[0m - [TS${d.code}] ${message}`,
    );
  }
}

if (count === 0) {
  console.log("\x1b[32m✓ No deprecations or suggestion hints found.\x1b[0m");
} else {
  console.log(`\nFound ${count} suggestion(s)/deprecation(s).`);
}
