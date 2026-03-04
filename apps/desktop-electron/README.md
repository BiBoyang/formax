# Formax Desktop Electron (MVP)

This package provides an Electron desktop shell for the existing web runtime.
It reuses `apps/web-reference-react` and does not introduce a second renderer.

## Scope

- Dev mode: start `app-server:web-reference` + Electron
- Debug mode: same as dev, with main-process inspector + renderer DevTools
- Preview mode: start `formax web` from `dist/cli.js` + Electron
- Build mode: generate `electron-builder --dir` unpacked output

Out of scope in this MVP:

- Signed installers (`dmg` / `exe`)
- Auto update
- Standalone distribution outside this repository

## Install dependencies

From repository root:

```bash
npm --prefix apps/desktop-electron install
```

## Scripts

From repository root (recommended wrappers):

```bash
bun run desktop:electron:dev
bun run desktop:electron:debug
bun run desktop:electron:preview
bun run desktop:electron:build
```

Or directly:

```bash
npm --prefix apps/desktop-electron run dev
npm --prefix apps/desktop-electron run debug
npm --prefix apps/desktop-electron run preview
npm --prefix apps/desktop-electron run build
```

## Runtime defaults

- Host: `127.0.0.1`
- UI port: `3781`
- Bridge port: `3777`
- Start URL: `http://127.0.0.1:3781`

## Environment variables

- `FORMAX_ELECTRON_START_URL`
  - Start URL for Electron window. Default: `http://127.0.0.1:3781`
  - `scripts/run.mjs` also uses this host/port for readiness checks and runtime startup args
- `FORMAX_ELECTRON_OPEN_DEVTOOLS`
  - `1` opens renderer DevTools automatically
- `FORMAX_ELECTRON_MODE`
  - `dev | debug | preview`

## Notes

- `scripts/run.mjs` waits for web readiness (up to 30 seconds) before launching Electron.
- In `debug` mode, main process inspector runs on `9229` via `electron:start:debug`.
- Navigation is restricted to local URLs (`127.0.0.1`, `localhost`, `::1`); external links open in system browser.
