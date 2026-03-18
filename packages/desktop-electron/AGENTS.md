# Desktop Electron Guidelines

## Scope
- Applies to `packages/desktop-electron/**`.
- This package is the Electron shell that hosts the web runtime; it does not maintain a second renderer stack.
- Inherit repo-wide policy from `../../AGENTS.md`; this file only adds desktop-local workflow details.

## Primary Commands
- Dev mode: `npm --prefix packages/desktop-electron run dev`
- Debug mode: `npm --prefix packages/desktop-electron run debug`
- Preview mode: `npm --prefix packages/desktop-electron run preview`
- Build runtime payload: `npm --prefix packages/desktop-electron run build:runtime`
- Build unpacked app: `npm --prefix packages/desktop-electron run build`
- Build mac artifacts: `npm --prefix packages/desktop-electron run build:mac`

## Runtime Notes
- Default host/ports: `127.0.0.1` with UI `3781` and bridge `3777`.
- Keep desktop shell behavior aligned with `packages/desktop-electron/README.md`.
- When changing startup/runtime wiring, validate both:
  - dev shell flow (`dev` / `debug`)
  - packaged runtime flow (`build` and launch output)

## Canonical References
- Package guide: `packages/desktop-electron/README.md`
- App-server interaction contract: `docs/contracts/app-server-interaction-contract.md`
- Web parity adapter contract: `docs/contracts/web-parity-adapter-contract.md`
