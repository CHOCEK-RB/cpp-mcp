# Changelog

## [1.4.0](https://github.com/CHOCEK-RB/cpp-mcp/compare/cpp-mcp-v1.3.0...cpp-mcp-v1.4.0) (2026-09-27)


### Features

* add direct CLI mode, cert sync, demangler, and compiler support ([#29](https://github.com/CHOCEK-RB/cpp-mcp/issues/29)) ([523bdcc](https://github.com/CHOCEK-RB/cpp-mcp/commit/523bdccba6056e370dc751658a080b31fb0c7993))
* **build:** implement standalone binary compilation and release asset publishing ([#11](https://github.com/CHOCEK-RB/cpp-mcp/issues/11)) ([dd202ff](https://github.com/CHOCEK-RB/cpp-mcp/commit/dd202ff70a03c01e0a956576d6377469db114e29))
* **cache:** implement persistent tiered disk cache with TTL ([#7](https://github.com/CHOCEK-RB/cpp-mcp/issues/7)) ([6e9ead4](https://github.com/CHOCEK-RB/cpp-mcp/commit/6e9ead4f71d9ffdb57b5d0ba1f16caebaa95879d))
* implement modern C++ developer engine (guidelines, modules, cert, tooling, stability) ([a42c67d](https://github.com/CHOCEK-RB/cpp-mcp/commit/a42c67de43a439315a30ec080ef03de2d5167203))
* **mcp:** implement native MCP resources and prompt templates ([#10](https://github.com/CHOCEK-RB/cpp-mcp/issues/10)) ([6d7f521](https://github.com/CHOCEK-RB/cpp-mcp/commit/6d7f521fb4eea2f7dd53486bcae530a4a3a48d88))
* release v0.1.0 of cpp-mcp server ([#5](https://github.com/CHOCEK-RB/cpp-mcp/issues/5)) ([b670516](https://github.com/CHOCEK-RB/cpp-mcp/commit/b67051620e059eae1b6006100727119b04034646))
* **release:** 1.4.0 - xmake provider and clangd LSP semantic tools ([#32](https://github.com/CHOCEK-RB/cpp-mcp/issues/32)) ([05b4640](https://github.com/CHOCEK-RB/cpp-mcp/commit/05b4640cd398c5c559205e50e47e170d6f70cc55))
* **tools:** implement check_cpp_standard tool with language family validation ([#9](https://github.com/CHOCEK-RB/cpp-mcp/issues/9)) ([4a6dc46](https://github.com/CHOCEK-RB/cpp-mcp/commit/4a6dc46b646b9925dfc706cbeabd5a69a6f01c47))
* **tools:** implement lookup_header tool with static index and live fallback ([#8](https://github.com/CHOCEK-RB/cpp-mcp/issues/8)) ([3771d9c](https://github.com/CHOCEK-RB/cpp-mcp/commit/3771d9c6bcfd7d39e39b54abcaedfa65545710d4))


### Bug Fixes

* **build:** remove duplicate shebang and sync version 1.1.1 ([3ec2adb](https://github.com/CHOCEK-RB/cpp-mcp/commit/3ec2adb9f5562e0ce8c5e60da2f0f90c01f1577a))
* **ci:** avoid invalid secrets access in job if condition ([671808f](https://github.com/CHOCEK-RB/cpp-mcp/commit/671808f0a8da9570cc134b18fcbf5e68035ab4c2))

## [1.3.0](https://github.com/CHOCEK-RB/cpp-mcp/compare/v1.2.0...v1.3.0) (2026-09-27)


### Features

* add direct CLI mode, cert sync, demangler, and compiler support ([#29](https://github.com/CHOCEK-RB/cpp-mcp/issues/29)) ([523bdcc](https://github.com/CHOCEK-RB/cpp-mcp/commit/523bdccba6056e370dc751658a080b31fb0c7993))

## [1.2.0](https://github.com/CHOCEK-RB/cpp-mcp/compare/v1.1.1...v1.2.0) (2026-09-26)


### Features

* implement modern C++ developer engine (guidelines, modules, cert, tooling, stability) ([a42c67d](https://github.com/CHOCEK-RB/cpp-mcp/commit/a42c67de43a439315a30ec080ef03de2d5167203))

## [1.1.1](https://github.com/CHOCEK-RB/cpp-mcp/compare/v1.1.0...v1.1.1) (2026-09-26)


### Bug Fixes

* **build:** remove duplicate shebang and sync version 1.1.1 ([3ec2adb](https://github.com/CHOCEK-RB/cpp-mcp/commit/3ec2adb9f5562e0ce8c5e60da2f0f90c01f1577a))

## [1.1.0](https://github.com/CHOCEK-RB/cpp-mcp/compare/v1.0.0...v1.1.0) (2026-09-26)


### Features

* **build:** implement standalone binary compilation and release asset publishing ([#11](https://github.com/CHOCEK-RB/cpp-mcp/issues/11)) ([dd202ff](https://github.com/CHOCEK-RB/cpp-mcp/commit/dd202ff70a03c01e0a956576d6377469db114e29))
* **cache:** implement persistent tiered disk cache with TTL ([#7](https://github.com/CHOCEK-RB/cpp-mcp/issues/7)) ([6e9ead4](https://github.com/CHOCEK-RB/cpp-mcp/commit/6e9ead4f71d9ffdb57b5d0ba1f16caebaa95879d))
* **mcp:** implement native MCP resources and prompt templates ([#10](https://github.com/CHOCEK-RB/cpp-mcp/issues/10)) ([6d7f521](https://github.com/CHOCEK-RB/cpp-mcp/commit/6d7f521fb4eea2f7dd53486bcae530a4a3a48d88))
* **tools:** implement check_cpp_standard tool with language family validation ([#9](https://github.com/CHOCEK-RB/cpp-mcp/issues/9)) ([4a6dc46](https://github.com/CHOCEK-RB/cpp-mcp/commit/4a6dc46b646b9925dfc706cbeabd5a69a6f01c47))
* **tools:** implement lookup_header tool with static index and live fallback ([#8](https://github.com/CHOCEK-RB/cpp-mcp/issues/8)) ([3771d9c](https://github.com/CHOCEK-RB/cpp-mcp/commit/3771d9c6bcfd7d39e39b54abcaedfa65545710d4))


### Bug Fixes

* **ci:** avoid invalid secrets access in job if condition ([671808f](https://github.com/CHOCEK-RB/cpp-mcp/commit/671808f0a8da9570cc134b18fcbf5e68035ab4c2))

## 1.0.0 (2026-09-26)


### Features

* release v0.1.0 of cpp-mcp server ([#5](https://github.com/CHOCEK-RB/cpp-mcp/issues/5)) ([b670516](https://github.com/CHOCEK-RB/cpp-mcp/commit/b67051620e059eae1b6006100727119b04034646))
