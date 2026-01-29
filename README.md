# Formax

Formax is a terminal-first AI assistant for software engineering tasks, inspired by Claude Code.

[![CI](https://github.com/yusifeng/formax/actions/workflows/ci.yml/badge.svg)](https://github.com/yusifeng/formax/actions/workflows/ci.yml)
[![codecov](https://codecov.io/gh/yusifeng/formax/branch/main/graph/badge.svg)](https://codecov.io/gh/yusifeng/formax)
[![npm](https://img.shields.io/npm/v/@yusifeng/formax)](https://www.npmjs.com/package/@yusifeng/formax)
[![node](https://img.shields.io/badge/node-%3E%3D20-339933?logo=node.js&logoColor=white)](package.json)
[![license](https://img.shields.io/npm/l/@yusifeng/formax)](LICENSE)

<p align="center">
  <img src="./demo.gif" width="900" />
</p>

## Quickstart

```bash
# Install (beta)
npm i -g @yusifeng/formax@beta

# In your project directory
cd /path/to/your/project

# Start the REPL
formax
```

## Configuration

Formax will prompt you to configure missing credentials on first run.

Optional (writes to `~/.formax/` and runs connectivity checks):

```bash
formax setup
```

### Environment variables

```bash
export FORMAX_API_KEY="..."
export FORMAX_BASE_URL="https://api.anthropic.com"   # normalized to .../v1
export FORMAX_MODEL="..."                            # provider-specific model id

# optional
export FORMAX_TIMEOUT_MS="600000"
```

## REPL slash commands

Built-in commands (inside the REPL):

- `/agents` — create/manage sub-agents
- `/permissions` — manage tool permissions and workspace access
- `/hooks` — configure hooks
- `/todos` — list current todos
- `/clear` — clear the visible transcript
- `/compact [instructions]` — compact history into a summary in-context
- `/doctor` — run diagnostics from inside the REPL

## Customization (project-local)

Common `.formax/` folders:

- `.formax/commands/` — custom slash commands (`.md`)
- `.formax/agents/` — custom agents (`.md`)
- `.formax/hooks/` — hook scripts (e.g. `*.py`)
- `.formax/settings.local.json` — repo-local settings (permissions, hooks, etc.)

## Troubleshooting

Generate a redacted debug bundle:

```bash
formax doctor --bundle --bundle-tar
```

See `docs/troubleshooting.md` for details.

## License

MIT (see `LICENSE`).
