# Web Reference Client (React + Vite)

Status: Informative deep dive.

Canonical docs:
- [docs/contracts/semantics-contract.md](../../docs/contracts/semantics-contract.md)
- [docs/contracts/interactive-input-contract.md](../../docs/contracts/interactive-input-contract.md)
- [docs/contracts/app-server-interaction-contract.md](../../docs/contracts/app-server-interaction-contract.md)
- [docs/contracts/web-parity-adapter-contract.md](../../docs/contracts/web-parity-adapter-contract.md)
- [docs/frontend/app-server-ui-spec.md](../../docs/frontend/app-server-ui-spec.md)
- [docs/runbooks/app-server-manual-runbook.md](../../docs/runbooks/app-server-manual-runbook.md)
- [CODEMAP.md](./CODEMAP.md) (package-local "where to change what" index)

Use this README for local app bootstrap, test commands, and implementation-local performance notes. Stable protocol, Web adapter/reducer/cursor behavior, or UI behavior changes should update the linked docs first.

This is an isolated React client for Formax app-server development validation.
It uses its own `package.json` and does not share dependencies with the repo root.

## Run

1. Start app-server bridge (from repo root):

```bash
bun run app-server:bridge -- --host 127.0.0.1 --port 3777
```

2. In this folder:

```bash
npm install
npm run dev
```

3. Open the URL printed by Vite (default `http://127.0.0.1:3781`).

UI behavior note:

- The `Threads` header always renders the `Add project` action.
- In browser-only mode (this package default), project folder picking is not available; the button shows a `仅桌面客户端可用` tooltip.
- In desktop bridge mode (`window.formaxDesktop.pickProjectFolder` provided), the same button invokes native folder selection and starts a thread in that `cwd`.

## Test

```bash
npm run test
```

Watch mode:

```bash
npm run test:watch
```

E2E (Playwright):

```bash
npm run test:e2e:install
npm run test:e2e
npm run test:e2e:queue:guard
npm run test:perf:gate
```

Evidence screenshot (opt-in acceptance capture):

```bash
npm run evidence:after -- --task=TASK-0123-web-ui
npm run evidence:after -- --task=TASK-0123-web-ui --phase=before --label=01-repro
npm run evidence:after -- --task=TASK-0123-web-ui --external
```

Evidence policy (see `docs/runbooks/web-evidence-workflow.md` for the canonical rule set in this repo):

- A 类：可稳定复现 bug 修复 -> 建议 `before + after`
- B 类：新功能/常规验收 -> 默认 `after` 即可
- C 类：难以稳定复现问题 -> `after + 文字说明`（`before` 可省略）

Examples:

```bash
# A 类 bug：before + after
npm run evidence:after -- --task=TASK-0456-transcript-bug --phase=before
npm run evidence:after -- --task=TASK-0456-transcript-bug

# B 类 feature：after only
npm run evidence:after -- --task=TASK-0789-thread-panel
```

Notes:

- E2E config: `packages/web-reference-react/playwright.config.mjs`
- E2E specs:
  - `e2e/layout-overflow.spec.js` (horizontal overflow + composer visibility)
  - `e2e/add-project-tooltip.spec.js` (browser mode desktop-only tooltip for Add project)
  - `e2e/thread-history.spec.js` (thread select + load earlier messages)
  - `e2e/approval-submit.spec.js` (pending approval submit payload/status)
  - `e2e/diff-collapsible.spec.js` (diff file collapse/expand)
  - `e2e/markdown-render-worker.spec.js` (markdown worker path + fallback + copy button)
  - `e2e/tool-history-refresh.spec.js` (tool summary rows remain available after refresh)
  - `e2e/nested-scroll-boundary.spec.js` (center/right pane wheel scrolling isolation)
  - `e2e/rpc-queue-dev-tools.spec.js` (queue metrics helper + overload/drop stability guard)
  - `e2e/transcript-performance-gate.spec.js` (long transcript interaction budget gate)
  - `e2e/evidence.spec.js` (opt-in acceptance screenshot capture for task evidence)
- These tests auto-start Vite via Playwright `webServer` on `http://127.0.0.1:3781`.
- E2E uses an in-page WebSocket mock (`e2e/helpers/mockRpc.js`) so tests do not depend on a real app-server process.
- `evidence:after` stores screenshots under `packages/web-reference-react/evidence/tasks/<task>/<phase>/`.
- `evidence:before` (optional shortcut) equals `evidence:after -- --phase=before`.
- default labels: `phase=before -> 01-repro`, `phase=after -> 01-acceptance`.
- `evidence:after` supports `--task=...`, `--phase=...`, `--label=...`, `--scenario=default`, and `--external`.
- If you already started dev server manually, use:

```bash
PLAYWRIGHT_SKIP_WEBSERVER=1 npm run test:e2e
```

Bundle report (run after build):

```bash
npm run build
npm run perf:bundle:report
npm run perf:bundle:baseline:write
npm run perf:bundle:baseline:compare
npm run perf:bundle:baseline:check
npm run perf:bundle:baseline:sync
npm run perf:bundle:baseline:check:ci
```

Optional:

```bash
npm run perf:bundle:report -- --top=20
npm run perf:bundle:report -- --compare-baseline --baseline=./perf/web-reference-react-bundle-baseline.json
npm run perf:bundle:report -- --enforce-baseline --max-total-bytes-growth=1024 --max-entry-bytes-growth=1024
```

Notes:

- `perf:bundle:baseline:check` is strict (`0` growth allowed).
- `perf:bundle:baseline:sync` is strict baseline consistency (current build bytes must match committed baseline snapshot).
- `perf:bundle:baseline:check:ci` allows small drift (`1KB` total + `1KB` entry).

Current test coverage focus:

- state reducer transitions (`inputRequested -> inputResolved`, assistant delta merge)
- key component interactions (thread actions, send/interrupt states, input submit payload)
- guard against UI refactors breaking protocol-facing behavior

## Queue Tuning + Burst Benchmark

Queue runtime knobs can be injected before app bootstrap:

```html
<script>
  window.__FORMAX_RPC_QUEUE__ = {
    outboundQueueCapacity: 128,
    inboundNotificationQueueCapacity: 512,
  }
</script>
```

Put this block in `packages/web-reference-react/index.html` before:

```html
<script type="module" src="/src/main.tsx"></script>
```

In dev mode, the app exposes queue diagnostics helpers on `window`:

- `window.__formaxDevRpcQueueMetrics()` -> current queue metrics snapshot
- `window.__formaxDevRpcBurst(options)` -> runs a request burst and returns sampled metrics

`__formaxDevRpcBurst` defaults:

- `totalRequests = 200`
- `concurrency = 24`
- `sampleEveryMs = 100`
- `method = "thread/list"`
- `params = { limit: 20 }`

Browser snippet for pressure runs:

- `packages/web-reference-react/scripts/rpc-queue-burst.browser.js`

It prints summary + samples to the browser console.

## Scope

- JSON-RPC initialize/initialized handshake
- thread/list + thread/start
- turn/start + turn/interrupt
- streaming transcript notifications
- pending input (`approval` / `ask_user_question`) and `turn/input/submit`
- browser-safe parity adapters for tool presentation logic (`packages/web-reference-react/src/parity/tools/*`)

This client is for protocol verification, not production UI.

## Markdown Highlight Runtime

- Markdown code highlighting uses `shiki/core` with the JavaScript regex engine.
- Language packs are lazy-loaded from a curated set:
  - `bash`, `css`, `diff`, `go`, `html`, `java`, `javascript`, `json`, `jsx`, `markdown`, `python`, `rust`, `sql`, `toml`, `tsx`, `typescript`, `xml`, `yaml`
- Unsupported code fences fall back to plain text rendering (`text`) while preserving copy behavior.
