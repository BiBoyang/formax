# Web Reference Client (React + Vite)

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
```

Notes:

- E2E config: `apps/web-reference-react/playwright.config.mjs`
- E2E specs:
  - `e2e/layout-overflow.spec.js` (horizontal overflow + composer visibility)
  - `e2e/thread-history.spec.js` (thread select + load earlier messages)
  - `e2e/approval-submit.spec.js` (pending approval submit payload/status)
  - `e2e/diff-collapsible.spec.js` (diff file collapse/expand)
  - `e2e/markdown-render-worker.spec.js` (markdown worker path + fallback + copy button)
  - `e2e/tool-history-refresh.spec.js` (tool summary rows remain available after refresh)
  - `e2e/nested-scroll-boundary.spec.js` (center/right pane wheel scrolling isolation)
- These tests auto-start Vite via Playwright `webServer` on `http://127.0.0.1:3781`.
- E2E uses an in-page WebSocket mock (`e2e/helpers/mockRpc.js`) so tests do not depend on a real app-server process.
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
```

Optional:

```bash
npm run perf:bundle:report -- --top=20
npm run perf:bundle:report -- --compare-baseline --baseline=../../docs/perf/web-reference-react-bundle-baseline.json
```

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

Put this block in `apps/web-reference-react/index.html` before:

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

- `apps/web-reference-react/scripts/rpc-queue-burst.browser.js`

It prints summary + samples to the browser console.

## Scope

- JSON-RPC initialize/initialized handshake
- thread/list + thread/start
- turn/start + turn/interrupt
- streaming transcript notifications
- pending input (`approval` / `ask_user_question`) and `turn/input/submit`
- browser-safe parity adapters for tool presentation logic (`src/parity/tools/*`)

This client is for protocol verification, not production UI.

## Markdown Highlight Runtime

- Markdown code highlighting uses `shiki/core` with the JavaScript regex engine.
- Language packs are lazy-loaded from a curated set:
  - `bash`, `css`, `diff`, `go`, `html`, `java`, `javascript`, `json`, `jsx`, `markdown`, `python`, `rust`, `sql`, `toml`, `tsx`, `typescript`, `xml`, `yaml`
- Unsupported code fences fall back to plain text rendering (`text`) while preserving copy behavior.
