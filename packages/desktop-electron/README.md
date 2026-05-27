# Formax Desktop Electron (MVP)

This package provides an Electron desktop shell for the existing web runtime.
It reuses `packages/web-reference-react` and does not introduce a second renderer.

## Scope

- Dev mode: start `app-server:web-reference` + Electron
- Debug mode: same as dev, with main-process inspector + renderer DevTools
- Preview mode: start `formax web` from `dist/cli.js` + Electron
- Build mode: generate `electron-builder --dir` unpacked output
- Mac package mode: generate unsigned mac artifacts (`dmg` + `zip`)
- Packaged app mode: auto-start embedded runtime on launch (no manual app-server startup)

Out of scope in this MVP:

- Signed installers (`dmg` / `exe`)
- Auto update
- Standalone distribution outside this repository

## Install dependencies

From repository root:

```bash
npm --prefix packages/desktop-electron install
```

## Scripts

From repository root (recommended wrappers):

```bash
bun run desktop:electron:dev
bun run desktop:electron:debug
bun run desktop:electron:preview
bun run desktop:electron:build:runtime
bun run desktop:electron:build
bun run desktop:electron:build:mac
```

Or directly:

```bash
npm --prefix packages/desktop-electron run dev
npm --prefix packages/desktop-electron run debug
npm --prefix packages/desktop-electron run preview
npm --prefix packages/desktop-electron run build:runtime
npm --prefix packages/desktop-electron run build
npm --prefix packages/desktop-electron run build:mac
```

## Runtime defaults

- Host: `127.0.0.1`
- UI port: `3781`
- Bridge port: `3777`
- Start URL: `http://127.0.0.1:3781`

## First-run setup

The desktop shell uses the existing Web renderer and opens a separate setup window when the managed runtime reports incomplete setup.

- Normal managed runtime startup uses `formax web --setup-mode require-config`.
- If startup fails because setup is required or config is repairable through setup, Electron retries the managed runtime with `--setup-mode allow` and loads `/setup`.
- Setup business logic stays in the core runtime through `bridge/setup/*`; Electron main only owns window orchestration and `formaxDesktop.setup.complete()/cancel()` IPC.
- After setup commit, Electron restarts the managed runtime in `require-config` mode, re-checks setup status, and opens the main window only after setup is complete.
- Browser-only `formax web --setup-mode allow` cannot restart its own server. After commit it shows restart guidance and waits for a restarted server before entering the main app.

## Environment variables

- `FORMAX_ELECTRON_START_URL`
  - Start URL for Electron window. Default: `http://127.0.0.1:3781`
  - `packages/desktop-electron/scripts/run.mjs` also uses this host/port for readiness checks and runtime startup args
- `FORMAX_ELECTRON_OPEN_DEVTOOLS`
  - `1` opens renderer DevTools automatically
- `FORMAX_ELECTRON_MODE`
  - `dev | debug | preview`
- `FORMAX_ELECTRON_MANAGED_RUNTIME`
  - `1` forces embedded runtime startup from Electron main process
  - `0` disables embedded runtime startup
  - default: enabled in packaged app, disabled in dev shell workflow
- `FORMAX_ELECTRON_BRIDGE_PORT`
  - override embedded runtime bridge port (default `3777`)

## Notes

- `packages/desktop-electron/scripts/run.mjs` waits for web readiness (up to 30 seconds) before launching Electron.
- In `debug` mode, main process inspector runs on `9229` via `electron:start:debug`.
- Navigation is restricted to local URLs (`127.0.0.1`, `localhost`, `::1`); external links open in system browser.
- `build:mac` disables identity auto discovery to keep local packaging deterministic (`CSC_IDENTITY_AUTO_DISCOVERY=false`).
- `build:*` scripts now copy root CLI bundle into embedded runtime (`runtime/cli.mjs`) and copy web assets (`runtime/web/*`).
- Packaged app launch attempts to auto-start embedded runtime; if setup is incomplete it opens setup recovery, and for non-setup startup failures the window renders a fallback guidance page instead of entering a broken main app.
