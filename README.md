# Formax

Formax is a terminal-first AI assistant for software engineering tasks. It is inspired by (but not affiliated with) Claude Code v2.0.67, and some behaviors are implemented by observation (e.g. network traces) rather than upstream source code. Formax is experimental—review changes and commands before approving them; you are responsible for any modifications it makes to your files or system.

[![CI](https://github.com/yusifeng/formax/actions/workflows/ci.yml/badge.svg)](https://github.com/yusifeng/formax/actions/workflows/ci.yml)
[![codecov](https://codecov.io/gh/yusifeng/formax/branch/main/graph/badge.svg)](https://codecov.io/gh/yusifeng/formax)
[![npm](https://img.shields.io/npm/v/@yusifeng/formax)](https://www.npmjs.com/package/@yusifeng/formax)
[![node](https://img.shields.io/badge/node-%3E%3D20-339933?logo=node.js&logoColor=white)](package.json)
[![license](https://img.shields.io/github/license/yusifeng/formax)](LICENSE)

<p align="left">
  <img src="./demo.gif" width="600" />
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

## App Server (GUI 集成入口)

Formax 支持以本地子进程方式启动 JSON-RPC 服务（stdio JSONL 传输），用于 IDE / GUI 客户端驱动：

```bash
formax app-server
```

握手顺序：

1. 客户端发送 `initialize`
2. 客户端发送 `initialized`（notification）
3. 调用 `thread/*`、`turn/*`、`turn/input/submit`

说明：

- 传输为 **stdio + JSONL + JSON-RPC 2.0**。
- 一期重点覆盖 thread/turn 流程、approval 与 ask_user_question 的 input 生命周期闭环。

开发期也可通过 WebSocket dev bridge 调试 GUI 客户端（非生产传输）：

```bash
bun run app-server:bridge -- --host 127.0.0.1 --port 3777
```

也可直接启动 Web 参考客户端（本地静态页面 + bridge，开发验证用途）：

```bash
bun run app-server:web-reference -- --host 127.0.0.1 --bridge-port 3777 --ui-port 3780
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

### Providers

Formax currently supports **Anthropic-compatible** APIs only. **OpenAI-compatible** and **Gemini** providers are not supported yet.

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
