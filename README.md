# cpp-mcp

[![CI Check](https://github.com/CHOCEK-RB/cpp-mcp/actions/workflows/check.yml/badge.svg)](https://github.com/CHOCEK-RB/cpp-mcp/actions)
[![NPM Version](https://img.shields.io/npm/v/cpp-mcp.svg?style=flat)](https://www.npmjs.com/package/cpp-mcp)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Runtime: Bun](https://img.shields.io/badge/runtime-bun-fbf0df?logo=bun)](https://bun.sh)
[![Model Context Protocol](https://img.shields.io/badge/MCP-Registry-purple.svg)](https://modelcontextprotocol.io)

Model Context Protocol (MCP) server providing real-time C and C++ documentation.

---

## Features

- **Symbol Lookup**: Fast access to C/C++ standard library documentation directly from cppreference.
- **Markdown Conversion**: Clean, LLM-optimized Markdown formatting stripped of web clutter.
- **Local In-Memory Cache**: Low latency responses powered by `lru-cache`.
- **Zero Heavy Dependencies**: Lightweight TypeScript bundle optimized for Node.js and Bun runtimes.

---

## Quickstart

Run directly without installation using `npx`:

```bash
npx -y cpp-mcp
```

Or using Bun:

```bash
bunx cpp-mcp
```

---

## Client Configuration

### Claude Desktop

Add this to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "cpp-mcp": {
      "command": "npx",
      "args": ["-y", "cpp-mcp"]
    }
  }
}
```

### Cursor / Windsurf / Zed

Configure the MCP server via stdio transport:

- **Command**: `npx`
- **Args**: `["-y", "cpp-mcp"]`

---

## Development

```bash
# Clone repository
git clone https://github.com/CHOCEK-RB/cpp-mcp.git
cd cpp-mcp

# Install dependencies and setup git hooks
bun install

# Development server (watch mode)
bun run dev

# Run quality checks
bun run check       # TypeScript types check
bun run lint        # Biome linter & formatter
bun test --coverage # Unit tests with coverage
bun run build       # Production bundle to dist/
```

---

## Contributing

Please read [CONTRIBUTING.md](CONTRIBUTING.md) for details on code style, Conventional Commits, and pull request guidelines.

---

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
