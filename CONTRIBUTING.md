# Contributing to cpp-mcp

Thank you for your interest in contributing!

## Development Workflow

This project uses [Bun](https://bun.sh) as its runtime and package manager.

### Prerequisites

- [Bun](https://bun.sh) (v1.2+)
- Git

### Setup

```bash
# Clone the repository
git clone https://github.com/CHOCEK-RB/cpp-mcp.git
cd cpp-mcp

# Install dependencies and setup git hooks
bun install
```

### Available Scripts

- `bun run dev`: Run server in watch mode
- `bun run check`: Typecheck with `tsc --noEmit`
- `bun run lint`: Run Biome linter and formatter check
- `bun run lint:fix`: Format and auto-fix linter issues
- `bun test`: Run unit test suite
- `bun test:coverage`: Run tests with coverage reporting
- `bun run build`: Bundle into `dist/index.js`
- `bun run check:publint`: Validate npm packaging standards

## Commit Guidelines (Conventional Commits)

All commit messages are strictly checked via `commitlint`. Follow the [Conventional Commits](https://www.conventionalcommits.org/) format:

- `feat: add new search filtering option`
- `fix: resolve domain validation issue`
- `docs: update tool argument descriptions`
- `refactor: optimize markdown conversion`
- `test: add unit tests for page retrieval`
- `chore: update dependencies`

Breaking changes must use `feat!:` or `fix!:`, or include `BREAKING CHANGE:` in the commit footer.
