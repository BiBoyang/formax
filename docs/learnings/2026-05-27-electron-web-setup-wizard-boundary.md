# 2026-05-27 - Electron/Web Setup Wizard Boundary

## Context

Electron first-run setup was added without creating a second renderer stack. The desktop app continues to host the existing Web runtime, while setup uses a top-level `/setup` route and a bridge side-channel.

## Decision

- Setup is config/auth/model initialization only. It is not transcript, turn, replay, or canonical semantics.
- The long-lived rules live in `docs/contracts/setup-wizard-contract.md`.
- Electron uses the runtime-owned setup status endpoint as authority instead of parsing config/auth directly in the main process.
- Setup mutation methods live behind `bridge/setup/*` and require `setupMode='allow'`; read-only status remains redacted.
- Desktop setup completion is a main-process handoff: restart managed runtime in `require-config`, re-probe status, then load the main route in the desktop host window.
- The desktop host does not need separate native setup/main BrowserWindows. Setup and main can share one default resizable BrowserWindow; the safety boundary is status-gated routing plus main-process handoff.
- Configured setup means API key, base URL, and an explicit model source for the active/default tier. Built-in default model fallback is not configured.
- Browser-only setup mode cannot restart its server. It must show restart guidance until the server was restarted from a complete config.

## What We Learned

Mandatory review is useful for lifecycle, secret-handling, and startup-mode bugs, but it can churn when product semantics are not fixed. For cross-layer setup work, define the contract before UI/orchestration changes and record conflicting review findings against that contract instead of repeatedly reversing implementation direction.

## Links

- `docs/contracts/setup-wizard-contract.md`
- `docs/setup-wizard-review-findings-log.md`
- `packages/core/src/core/setup/bridgeService.ts`
- `packages/desktop-electron/src/main.ts`
- `packages/web-reference-react/src/App.tsx`
