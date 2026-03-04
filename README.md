# Formax

Formax is a terminal-first AI assistant for software engineering tasks.

It is inspired by (but not affiliated with) Claude Code v2.0.67. Some behaviors are implemented by observation (for example, network traces) rather than upstream source code.

This repository is primarily a learning and reference implementation for Claude Code-like architecture and behavior, not a production-recommended daily driver at this stage.

[![CI](https://github.com/yusifeng/formax/actions/workflows/ci.yml/badge.svg)](https://github.com/yusifeng/formax/actions/workflows/ci.yml)
[![codecov](https://codecov.io/gh/yusifeng/formax/branch/main/graph/badge.svg)](https://codecov.io/gh/yusifeng/formax)
[![npm](https://img.shields.io/npm/v/@yusifeng/formax)](https://www.npmjs.com/package/@yusifeng/formax)
[![node](https://img.shields.io/badge/node-%3E%3D20-339933?logo=node.js&logoColor=white)](package.json)
[![license](https://img.shields.io/github/license/yusifeng/formax)](LICENSE)

<p align="left">
  <img src="./demo.gif" width="600" />
</p>

## Project Positioning

- This codebase is intended for engineers who want to study how a Claude Code-style tool can be implemented.
- It focuses on architecture, behavior parity, and implementation transparency rather than polished end-user product experience.
- Current release status is Beta; behavior can change and regressions are still possible.
- If you are evaluating production usage, treat this project as experimental first.
- For code reading and extension, start with [`CODEMAP.md`](CODEMAP.md) and subsystem READMEs.

## Install

Formax is published as an npm package:

```bash
npm i -g @yusifeng/formax@beta
```

Runtime requirement:

- Node.js `>=20`

## Quickstart

Start in your project directory:

```bash
cd /path/to/your/project
formax
```

On first run, Formax will prompt for missing credentials and runtime config.  
Optional guided setup:

```bash
formax setup
```

Default config directory: `~/.formax/`

## Runtime Modes

| Command | Purpose | Default endpoint / transport |
| --- | --- | --- |
| `formax` / `formax repl` | Start terminal REPL | Local TUI session |
| `formax web` | Start local web UI with bridge | UI: `http://127.0.0.1:3781`, Bridge: `ws://127.0.0.1:3777` |
| `formax serve` | Start standalone WebSocket bridge | `ws://127.0.0.1:3777` |
| `formax app-server` | Start JSON-RPC app server for GUI/IDE clients | `stdio + JSONL + JSON-RPC 2.0` |

## Desktop Electron (MVP)

The desktop shell lives in `apps/desktop-electron` and reuses the existing web runtime (`apps/web-reference-react`).

Install desktop-shell dependencies once:

```bash
npm --prefix apps/desktop-electron install
```

Run from repository root:

```bash
bun run desktop:electron:dev
bun run desktop:electron:debug
bun run desktop:electron:preview
bun run desktop:electron:build
```

## Command Reference

All commands below are implemented in [`src/runtime/cli/help.ts`](src/runtime/cli/help.ts) and dispatched in [`src/runtime/cli/main.ts`](src/runtime/cli/main.ts).

| Area | Commands |
| --- | --- |
| General | `formax help`, `formax --version`, `formax version` |
| Runtime | `formax`, `formax repl`, `formax web`, `formax serve`, `formax app-server` |
| Diagnostics | `formax status`, `formax doctor [--bundle] [--bundle-tar]` |
| Config | `formax config show`, `formax config migrate` |
| Auth | `formax auth list`, `formax auth set <provider> <authRef> <apiKey>`, `formax auth delete <provider> <authRef>` |
| Policy | `formax policy list`, `formax policy explain ...`, `formax policy test ...`, `formax policy disable <ruleId>`, `formax policy delete <ruleId>` |

## Configuration

Common environment variables:

```bash
export FORMAX_API_KEY="..."
export FORMAX_BASE_URL="https://api.anthropic.com"
export FORMAX_TIMEOUT_MS="600000"
```

Model-tier overrides:

```bash
export ANTHROPIC_DEFAULT_HAIKU_MODEL="claude-3-5-haiku-latest"
export ANTHROPIC_DEFAULT_SONNET_MODEL="claude-sonnet-4-5-20250929"
export ANTHROPIC_DEFAULT_OPUS_MODEL="claude-3-opus-latest"
```

Complete runtime variable reference:

- [`docs/environment-variables.md`](docs/environment-variables.md)

## REPL Slash Commands

| Command | Description |
| --- | --- |
| `/agents` | Create and manage sub-agents |
| `/permissions` | Manage tool permissions and workspace access |
| `/hooks` | Configure hook behavior |
| `/todos` | List current todos |
| `/clear` | Clear visible transcript |
| `/compact [instructions]` | Compact history into a summary in context |
| `/doctor` | Run diagnostics from inside the REPL |

## Project-local Customization

Common `.formax/` folders:

- `.formax/commands/` - custom slash commands (`.md`)
- `.formax/agents/` - custom agents (`.md`)
- `.formax/hooks/` - hook scripts (for example, `*.py`)
- `.formax/settings.local.json` - repo-local settings (permissions, hooks, and related toggles)

## Development

```bash
bun install
bun run dev
bun run type-check
bun run test
```

Run a single test file:

```bash
bun run test -- src/tools/registry.test.ts
```

## Architecture & Deep Dives

- Code navigation index: [`CODEMAP.md`](CODEMAP.md)
- Core configuration and setup internals: [`src/core/README.md`](src/core/README.md)
- Tool registry/execution/presentation internals: [`src/tools/README.md`](src/tools/README.md)
- Streaming client and parser internals: [`src/streaming/README.md`](src/streaming/README.md)
- Sub-agent registry and runner internals: [`src/features/subagents/README.md`](src/features/subagents/README.md)

## Troubleshooting

Check effective runtime/config state:

```bash
formax status
```

Generate a redacted diagnostics bundle:

```bash
formax doctor --bundle --bundle-tar
```

Show config source-of-truth resolution:

```bash
formax config show
```

## Tooling Notes (Current Gaps)

- Tool execution behavior is not guaranteed to be fully identical to Claude Code.
- `WebFetch` and `WebSearch` currently have known stability and behavior gaps, and may not always match expected results.
- MCP is not supported in Formax at this stage.

## Safety & Limitations

Formax is experimental. Always review proposed commands and file changes before approval. You are responsible for any modifications made in your environment.

This project is currently better suited for learning, reverse-engineering, and experimentation than for stable production workflows.

Provider support notes:

- Anthropic and OpenAI-compatible paths are available in setup/runtime flows.
- Gemini is present in config surfaces but not fully supported in runtime execution yet.

## License

MIT (see [`LICENSE`](LICENSE)).
