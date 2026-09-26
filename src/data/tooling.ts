// src/data/tooling.ts
// Structured configuration and guides for modern C++ tooling (xmake, clang-format, clang-tidy, sanitizers).
import rawTooling from "./tooling.json" with { type: "json" };

export interface KeyDirective {
  name: string;
  description: string;
  syntax?: string;
}

export interface ToolCommand {
  command: string;
  description: string;
}

export interface ToolGuide {
  id: string;
  title: string;
  aliases: string[];
  description: string;
  configFileName: string;
  sampleConfig: string;
  keyDirectives: KeyDirective[];
  commands: ToolCommand[];
  content: string;
}

export const C_CPP_TOOLS: ToolGuide[] = rawTooling as ToolGuide[];

export const TOOL_BY_ID = new Map<string, ToolGuide>();

for (const tool of C_CPP_TOOLS) {
  TOOL_BY_ID.set(tool.id.toLowerCase(), tool);
  for (const alias of tool.aliases) {
    TOOL_BY_ID.set(alias.toLowerCase(), tool);
  }
}
