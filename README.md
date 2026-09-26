# cpp-mcp

[![CI Check](https://github.com/CHOCEK-RB/cpp-mcp/actions/workflows/check.yml/badge.svg)](https://github.com/CHOCEK-RB/cpp-mcp/actions/workflows/check.yml)
[![CI Test](https://github.com/CHOCEK-RB/cpp-mcp/actions/workflows/test.yml/badge.svg)](https://github.com/CHOCEK-RB/cpp-mcp/actions/workflows/test.yml)
[![CI Lint](https://github.com/CHOCEK-RB/cpp-mcp/actions/workflows/lint.yml/badge.svg)](https://github.com/CHOCEK-RB/cpp-mcp/actions/workflows/lint.yml)
[![NPM Version](https://img.shields.io/npm/v/cpp-mcp.svg?style=flat)](https://www.npmjs.com/package/cpp-mcp)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Runtime: Bun](https://img.shields.io/badge/runtime-bun-fbf0df?logo=bun)](https://bun.sh)
[![MCP Protocol](https://img.shields.io/badge/MCP-Registry-purple.svg)](https://modelcontextprotocol.io)

Model Context Protocol (MCP) server that empowers AI coding assistants with authoritative, real-time C and C++ documentation directly from [cppreference.com](https://cppreference.com).

---

## Architecture

```mermaid
flowchart LR
    A["AI Client\n(VS Code / Claude / Zed)"] -- stdio / JSON-RPC --> B["cpp-mcp Server"]
    B --> C["search_cppreference"]
    B --> D["get_cppreference_page"]
    C --> E[("LRUCache\n(200 items)")]
    D --> F[("LRUCache\n(50 items)")]
    C -- HTTPS GET --> G["cppreference.com Search"]
    D -- HTTPS GET --> H["cppreference.com Articles"]
    D --> I["Cheerio DOM Sanitizer\n(Strips 60% HTML noise)"]
    I --> J["Turndown Markdown\n(16 KB Paginated Chunks)"]
```

---

## Features

- **Authoritative C/C++ Lookup**: Instant access to standard headers, containers, algorithms, keywords, and C++20/23/26 features.
- **Noise Elimination**: Strips MediaWiki navigation menus, edit buttons, login prompts, and notices before LLM consumption.
- **Optimized Markdown**: Converts tables, code blocks, and cross-references into clean Markdown with absolute links.
- **Cursor Pagination**: Transparently handles oversized documentation pages in 16 KB chunks.
- **In-Memory LRU Cache**: Instantaneous response times for repeated queries.
- **Zero Configuration**: Ready to use instantly via `npx` or `bunx`.

---

## Tools Catalog

### 1. `search_cppreference`

Searches cppreference.com for symbols, keywords, or headers and returns canonical documentation URLs.

- **Parameters**:
  - `query` (`string`, required): Search term (e.g. `"std::vector"`, `"constexpr"`, `"std::ranges::sort"`).

- **Output Example**:
  ```json
  {
    "query": "std::vector",
    "result_urls": [
      "https://cppreference.com/cpp/container/vector",
      "https://cppreference.com/cpp/experimental/execution_policy_tag_t"
    ]
  }
  ```

### 2. `get_cppreference_page`

Retrieves a documentation page, sanitizes the HTML, and returns LLM-ready Markdown.

- **Parameters**:
  - `url` (`string`, required): HTTPS URL from `cppreference.com` or `en.cppreference.com`.
  - `cursor` (`string`, optional): Pagination offset returned by a previous call (omit for first fragment).

- **Output Example**:
  ```json
  {
    "content": "# std::vector\n\n`std::vector` is a sequence container that encapsulates dynamic size arrays...",
    "next_cursor": "16384"
  }
  ```

### 3. `lookup_header`

Finds the canonical standard C or C++ header (`<vector>`, `<algorithm>`, `<cstdio>`, `<ranges>`, etc.) required for any function, type, class, or symbol, including standard version and category.

- **Parameters**:
  - `symbol` (`string`, required): C or C++ symbol, type, function, class, or header name (e.g. `"std::vector"`, `"printf"`, `"std::views::filter"`, `"<ranges>"`).

- **Output Example**:
  ```json
  {
    "query": "printf",
    "found": true,
    "header": "<cstdio>",
    "standard": "C++",
    "since": "C++98",
    "category": "C-style input/output",
    "cEquivalent": "<stdio.h>",
    "matchedSymbol": "printf",
    "source": "static_index"
  }
  ```

---

## Quickstart

Run directly without manual installation:

```bash
# Using npx (Node.js)
npx -y cpp-mcp

# Using bunx (Bun)
bunx cpp-mcp
```

---

## Client Configuration

### Claude Desktop

Add this entry to your `claude_desktop_config.json`:

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

### Visual Studio Code (GitHub Copilot / Cline / Roo Code)

Add to your MCP configuration file (`mcp_settings.json` or Cline MCP settings):

```json
{
  "mcpServers": {
    "cpp-mcp": {
      "command": "npx",
      "args": ["-y", "cpp-mcp"],
      "disabled": false,
      "autoApprove": [
        "search_cppreference",
        "get_cppreference_page"
      ]
    }
  }
}
```

### Zed

Add to your Zed `settings.json`:

```json
{
  "context_servers": {
    "cpp-mcp": {
      "command": {
        "path": "npx",
        "args": ["-y", "cpp-mcp"]
      }
    }
  }
}
```

---

## Development

```bash
# 1. Clone repository
git clone https://github.com/CHOCEK-RB/cpp-mcp.git
cd cpp-mcp

# 2. Install dependencies & initialize git hooks
bun install

# 3. Start development server in watch mode
bun run dev

# 4. Quality gates
bun run check        # TypeScript strict verification
bun run lint         # Biome formatting and lint check
bun run lint:fix     # Auto-fix formatting issues
bun test --coverage  # Run test suite with coverage
bun run build        # Compile self-contained bundle into dist/
bun run check:publint# Validate package distribution standards
```

---

## Contributing

Contributions are welcome! Please review [CONTRIBUTING.md](CONTRIBUTING.md) for details on our workflow, Conventional Commits, and code standards.

---

## Security

Please report any security vulnerabilities following our responsible disclosure policy in [SECURITY.md](SECURITY.md).

---

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
