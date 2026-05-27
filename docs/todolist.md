# Electron Setup Wizard Todo

## 0. Context and Boundary

### 0.1 Confirmed facts
- [x] Electron desktop currently hosts the existing Web runtime and should not maintain a second renderer stack.
- [x] Packaged Electron starts the managed runtime through `cli.mjs web --host ... --ui-port ... --bridge-port ...`.
- [x] `formax web` currently exits before starting the Web UI when runtime config has no API key.
- [x] The existing TUI setup flow already has a reusable core state machine in `packages/core/src/core/setup/session.ts`.
- [x] Setup connection probing already lives in `packages/core/src/adapters/setup/connectionTest.ts`.
- [x] Setup config/auth persistence already lives in `packages/core/src/adapters/setup/writeSetupFiles.ts`.
- [x] Setup must preserve model context-window provenance and must not persist heuristic fallback as authoritative config.
- [x] Setup is config/auth/model initialization; it is not transcript, REPL, turn, replay, or canonical semantics.
- [x] The aligned architecture is: Vite `/setup` top-level route, Electron separate Setup BrowserWindow, `bridge/setup/*` side-channel RPC for setup business operations, Electron IPC only for setup complete/cancel window orchestration, `formax web --allow-setup` for desktop first-run, and managed runtime restart after successful setup.

### 0.2 Goals
- [x] Allow Electron first-run users to complete setup without running terminal `formax setup`.
- [x] Open a separate setup window when setup is incomplete; open the main desktop window directly when setup is complete.
- [x] Reuse the canonical setup session, connection test, and write paths instead of creating a second setup backend.
- [x] Keep `/setup` isolated from main Web app runtime initialization so it does not trigger `initialize`, `thread/list`, diff refresh, or replay.
- [x] Keep ordinary `formax web` behavior stable by requiring an explicit setup-allowed mode for first-run Web setup.
- [x] Restart Electron managed runtime after setup commit so new app-server/Web state is based on fresh runtime config.

### 0.3 Non-goals
- [x] Do not redesign `/config` or broaden this into a general settings UI.
- [x] Do not rewrite the TUI SetupWizard.
- [x] Do not add transcript/replay/canonical semantics for setup.
- [x] Do not move setup write or connection-test ownership into Electron main.
- [x] Do not add a hand-written standalone HTML setup page or second renderer stack.
- [x] Do not implement app-server `setup/*` as stable thread/turn protocol unless bridge side-channel proves insufficient.
- [x] Do not make browser-only Web first-run setup a full product target in the first implementation loop.

## 1. Definitions First

### 1.1 Canonical docs
- [x] Add a documented bridge setup API section for `bridge/setup/*` in the appropriate API reference or a focused bridge setup contract.
- [x] Keep `docs/contracts/semantics-contract.md` unchanged unless implementation accidentally introduces setup into transcript/replay semantics.
- [x] Update `docs/contracts/app-server-interaction-contract.md` only if setup methods become formal app-server protocol methods instead of bridge side-channel methods.
- [x] Update `docs/contracts/config-settings-contract.md` only to state that GUI setup reuses the same config/auth write path as TUI setup, unless persistence semantics change.
- [x] Update `docs/contracts/model-settings-contract.md` only if setup model/context-window write behavior changes.
- [x] Update `CODEMAP.md` and package-local CODEMAP/README entries if new setup route, bridge service, or Electron setup window ownership points are added.
- [ ] Add a short learning note under `docs/learnings/` after the architecture lands.

### 1.2 Data model
- [x] Define `SetupStatusResult` with `schemaVersion`, `complete`, redacted `reason`, redacted effective provider/baseUrl/model summary, API key source, and warnings.
- [x] Define a runtime-owned read-only HTTP setup status endpoint, preferably `GET /__formax/setup/status`, for Electron main probing.
- [x] Ensure HTTP setup status and `bridge/setup/status` share the same setup status service and redacted schema.
- [x] Define HTTP status endpoint security: read-only, no raw auth material, no write/test/commit operations, loopback-only for desktop managed runtime; if non-loopback dev hosting is allowed, require token protection or disable the endpoint.
- [x] Define `SetupSessionView` as a redacted view over `SetupSessionState`; raw API key must not be returned to renderer after it is submitted.
- [x] Define raw API key server-side lifetime: the raw key may exist only in an ephemeral active setup session secret slot and must not be included in `SetupSessionView`, action history, diagnostics, audit details, logs, JSON-RPC errors, or test fixtures.
- [x] Define secret cleanup triggers: commit, cancel, dispose, stale-session timeout, socket close, and service shutdown must delete raw API key references.
- [x] Define setup session TTL, max lifetime, max active sessions, and stale-session behavior, especially for sessions holding a secret.
- [x] Define setup session ownership and lifetime: `sessionId`, stale-session behavior, dispose/cancel behavior, and cleanup after commit.
- [x] Define setup action input shape before UI work: provider, anthropic vendor, base URL, API key, model mode, model selection, next, back.
- [x] Treat API key submission as a secret-bearing setup operation, not a normal loggable action; decide whether it is a dedicated method or a flagged action before bridge wiring.
- [x] Define commit result shape, including config path/auth path/logs dir/warnings and whether runtime restart is required.
- [x] Define how env-provided API key affects setup status: env key can make setup complete but must not be written back to auth store unless the user explicitly submits a new key.
- [x] Define invalid config/auth behavior: status should surface warnings and allow repair through setup without leaking secret material.
- [x] Define setup RPC response boundary: `bridge/setup/*` responses must not carry turn/replay envelope fields such as `replaySeq`, `traceId`, `seq`, `eventId`, or notification `source`.
- [x] Define browser-only explicit setup mode behavior: `formax web` remains not setup-capable by default; explicit setup mode may commit through bridge but only gets refresh/restart guidance instead of Electron window orchestration.

### 1.3 Types / Interfaces
- [x] Add core-owned setup bridge service types near setup/runtime ownership rather than in React components.
- [x] Add redaction helpers for setup state and status so bridge responses never expose raw API keys.
- [x] Extend Web RPC typing or local setup RPC helpers for `bridge/setup/*`.
- [x] Extend `FormaxDesktopBridge` typing with `setup.complete()` and `setup.cancel()` only.
- [x] Extend web command options with `setupMode: 'require-config' | 'allow'`.
- [x] Add `--setup-mode require-config|allow` as the canonical parser model, with `--allow-setup` allowed as shorthand for `--setup-mode allow`.

## 2. Runtime / Platform

### 2.1 Setup service
- [x] Create a core setup bridge service that owns setup status, session creation, session actions, commit, cancel, and dispose.
- [x] Reuse `createSetupSession` for setup flow state.
- [x] Reuse `testSetupConnection` for connection testing.
- [x] Reuse `writeSetupFiles` for config/auth persistence.
- [x] Preserve setup model context-window source/confidence/binding metadata through the Web setup flow.
- [x] Ensure commit rejects missing provider/baseUrl/apiKey/model states rather than relying on UI-only validation.
- [x] Ensure all setup errors map to stable JSON-RPC errors or structured result errors without leaking API keys.

### 2.2 Bridge side-channel
- [x] Gate setup side-channel methods by setup mode: setup session/create/action/commit must require `setupMode='allow'`.
- [x] Allow only redacted read-only status probing outside setup mode if needed; do not allow write/test/commit operations when setup mode is not allowed.
- [x] Register `bridge/setup/status`.
- [x] Register `bridge/setup/session/create`.
- [x] Register `bridge/setup/session/action`.
- [x] Register `bridge/setup/session/commit`.
- [x] Register `bridge/setup/session/cancel` or `bridge/setup/session/dispose`.
- [x] Ensure `bridge/setup/*` messages are handled by the bridge and are not forwarded to app-server stdio.
- [x] Ensure `bridge/setup/*` uses JSON-RPC request/response only and never emits app-server notifications.
- [x] Ensure setup RPC responses are not passed into replay cursor, Web parity adapters, transcript projection, or visible transcript logs.
- [x] Ensure existing bridge token/origin/rate-limit protections cover setup methods.
- [x] Ensure setup side-channel methods share payload-size, rate-limit, and security enforcement with existing bridge RPC paths.
- [x] Ensure setup side-channel methods are available in the runtime path used by `formax web`, desktop dev/preview, and packaged managed runtime.

### 2.3 Web command startup
- [x] Extend `parseWebCommandArgs` with `setupMode`, including canonical `--setup-mode require-config|allow` and optional `--allow-setup` shorthand.
- [x] Update CLI dispatch so default `formax web` keeps the existing setup-required error.
- [x] Update CLI dispatch so `formax web --allow-setup` starts Web UI and bridge even when API key is missing.
- [x] Update desktop managed runtime args to pass `--allow-setup`.
- [x] Update CLI/web command tests to cover default missing-config rejection and setup-allowed startup.

### 2.4 Electron orchestration
- [x] Add a setup status probe after managed runtime readiness and before main window creation using the runtime-owned read-only HTTP status endpoint.
- [x] Prefer runtime-owned status for authority; Electron main should not directly parse config/auth as the source of truth.
- [x] Add `createSetupWindow(setupUrl)` with a singleton setup-window guard.
- [x] Keep setup BrowserWindow separate from the main BrowserWindow and load `/setup`.
- [x] Add preload IPC for `formaxDesktop.setup.complete()` and `formaxDesktop.setup.cancel()`.
- [x] On setup completion, close setup window, restart managed runtime, re-probe setup status, then open main window.
- [x] Ensure main window opens only after restarted runtime reports complete setup status.
- [x] If post-restart setup status remains incomplete, reopen/focus setup instead of opening main.
- [x] Abandon or close old WebSocket clients before loading the post-setup main window.
- [x] On setup cancel/close while incomplete, avoid opening main window; quit or keep a clear desktop fallback behavior.
- [x] Define cancel behavior explicitly before implementation: recommended v1 is quit on Windows/Linux; on macOS keep app alive without main window and reopen/focus setup on activate.
- [x] Ensure macOS activate behavior focuses an existing setup window instead of opening a main window while setup remains incomplete.

## 3. Frontend Boundary

### 3.1 Route ownership
- [x] Add a top-level `/setup` route switch before calling `useAppRuntime`.
- [x] Ensure `/setup` does not call `useAppRuntime`, `useRpcConnectionEffect`, `initializeRuntime`, `thread/list`, diff refresh, or replay.
- [x] Ensure importing/rendering `SetupRoot` does not import or execute `AppShell`/`useAppRuntime` side effects.
- [x] Keep the existing main app route behavior unchanged when path is not `/setup`.
- [x] Avoid adding a global React router unless the setup route actually needs it; a minimal pathname switch is preferred for the first implementation.

### 3.2 Web setup UI
- [x] Build `SetupRoot` and setup components under a focused Web setup folder.
- [x] Mirror the current TUI setup flow: provider, Anthropic-compatible vendor, base URL, API key, connection test, model mode, model selection, confirm/write, done.
- [x] Use existing Web design tokens and components; do not create a visually unrelated setup experience.
- [x] Keep API key input local and masked; do not display raw key in logs, notices, serialized state, or diagnostics.
- [x] Render connection-test loading and errors with enough detail to recover, using existing setup hint/error mapping where practical.
- [x] Render commit warnings after successful write where useful.
- [x] After commit, call `window.formaxDesktop.setup.complete()` when available.
- [x] In browser-only `--allow-setup` mode, show a graceful post-commit fallback that asks the user to refresh or restart rather than calling desktop IPC.

### 3.3 Main app fallback
- [x] If a user manually opens `/` while setup is incomplete in desktop mode, avoid starting a broken main workflow.
- [x] Decide whether the main route redirects to `/setup`, shows a setup-required fallback, or relies entirely on Electron window orchestration.
- [x] Keep this fallback renderer-local and out of canonical transcript/thread semantics.

## 4. Tests

### 4.1 Core setup service tests
- [x] Cover status when config/auth are missing.
- [x] Cover status when env API key is present.
- [x] Cover status with invalid config/auth warnings.
- [x] Cover redacted setup session view after API key is submitted.
- [x] Cover raw API key cleanup on commit, cancel, dispose, stale-session timeout, socket close, and service shutdown.
- [x] Cover setup session TTL/max lifetime and max active session behavior.
- [x] Cover session action progression through quick setup.
- [x] Cover session action progression through advanced haiku/sonnet/opus setup.
- [x] Cover connection-test failure and recovery.
- [x] Cover commit calling `writeSetupFiles` with tier model/context-window metadata.
- [x] Cover stale session and cancel/dispose behavior.

### 4.2 Bridge tests
- [x] Extend `devBridge.test.ts` or adjacent bridge tests for `bridge/setup/*`.
- [x] Add tests that setup session/create/action/commit methods return an error when `setupMode` is not `allow`.
- [x] Assert setup methods are not forwarded to app-server stdio.
- [x] Assert `bridge/setup/*` responses do not include `replaySeq`, `traceId`, `seq`, `eventId`, or app-server notification envelope fields.
- [x] Assert malformed setup params return JSON-RPC errors.
- [x] Assert setup methods are protected by existing token/origin checks.
- [x] Assert setup methods share bridge payload-size/rate-limit/security behavior with existing bridge RPC.
- [x] Assert raw API key is not emitted in bridge responses or audit details.
- [x] Assert secret-bearing setup calls are excluded from action/audit detail payloads.
- [x] Add tests for local HTTP setup status: redacted response, loopback/token behavior, same schema as `bridge/setup/status`, and no write/test/commit operations.

### 4.3 CLI / runtime web tests
- [x] Update `runtime/cli/main.test.ts` for default missing-config rejection.
- [x] Add test for `web --setup-mode allow` and `web --allow-setup` starting despite missing API key.
- [x] Update `webCommand.test.ts` for setup mode parsing, shorthand parsing, invalid mode, and help text.
- [x] Add/adjust runtime web tests for `/setup` SPA fallback if needed.
- [x] Add runtime web tests for read-only HTTP setup status when setup mode is allowed.

### 4.4 Web UI tests
- [x] Add React tests proving `/setup` renders setup UI without invoking `useAppRuntime`.
- [x] Assert `/setup` sends no `initialize`, `thread/list`, `thread/messages`, `thread/replay`, `turn/start`, or diff bridge requests under initial load, retry, and reconnect.
- [x] Assert setup RPC responses are not dispatched into transcript logs, projection store, replay cursor, or Web parity adapters.
- [x] Add Web setup flow tests with mocked `bridge/setup/*` RPC.
- [x] Cover connection-test error rendering.
- [x] Cover commit success and desktop complete IPC call.
- [x] Cover browser-only explicit setup mode commit and post-commit refresh/restart fallback when desktop IPC is unavailable.

### 4.5 Electron validation
- [ ] Add targeted unit tests where practical for setup URL resolution and IPC handler behavior.
- [ ] Manually smoke `bun run desktop:electron:dev` with setup incomplete.
- [ ] Manually smoke `bun run desktop:electron:dev` with setup complete.
- [ ] Manually smoke `bun run desktop:electron:preview` with setup incomplete.
- [ ] Manually smoke direct `/setup` URL load in preview/packaged runtime.
- [ ] Manually smoke setup commit -> managed runtime restart -> fresh main initialize path.
- [ ] Manually smoke cancel/close incomplete setup and relaunch behavior.
- [ ] Manually smoke packaged/unpacked launch path if this loop changes packaged managed runtime behavior.
- [ ] Capture screenshots or terminal evidence for setup window and main window transition if UI changes are included in the PR.

## 5. Recommended Execution Order

### Loop 1: Define setup API and startup mode
Review gate for this loop:
- Blocking: setup status/session contracts are wrong or leak secrets; setup mode parsing/gating is wrong; CLI default `formax web` behavior regresses; explicit setup mode cannot start without existing auth; raw API key lifetime/cleanup is undefined or unsafe; bridge response boundary would allow setup data into turn/replay/projection/log semantics.
- Non-blocking: final Web setup UI polish, Electron BrowserWindow orchestration, preview/packaged smoke, final docs/CODEMAP promotion, and full TUI copy parity unless they expose a contract bug in this loop.

- [x] Add setup status/session/action/commit type definitions and redaction helpers.
- [x] Define `setupMode: 'require-config' | 'allow'`, parser behavior, and `--allow-setup` shorthand.
- [x] Define setup mode gating for status vs session/create/action/commit.
- [x] Define runtime-owned read-only HTTP setup status probe and how it shares the bridge setup status service/schema.
- [x] Define secret-bearing API key handling, cleanup triggers, setup session TTL, and max session behavior.
- [x] Define bridge setup response boundary: no turn/replay envelope and no projection/log dispatch.
- [x] Add focused setup bridge service tests for status and redacted session view.
- [x] Implement the core setup bridge service without wiring it to Web or Electron yet.
- [x] Add setup mode parsing and CLI dispatch behavior.
- [x] Run targeted tests for setup service and web command parsing/dispatch.
- [x] Run `codex review` for this loop.

### Loop 2: Wire bridge side-channel
Review gate for this loop:
- Blocking: `bridge/setup/*` bypasses setup mode gating; setup methods are forwarded to app-server stdio; setup responses leak raw secrets or notification/replay envelope fields; HTTP status is not redacted/read-only; bridge token/origin/payload protections are skipped; setup sessions are not disposed on socket close or service shutdown.
- Non-blocking: final SetupRoot component structure, Electron window lifecycle polish, packaged runtime validation, and final user-facing setup copy unless they reveal a bridge/protocol contract bug.

- [x] Register `bridge/setup/*` in the WebSocket bridge.
- [x] Ensure setup side-channel methods do not forward to app-server stdio.
- [x] Add local read-only HTTP setup status endpoint for Electron main probing.
- [x] Add bridge tests for success, malformed params, auth/origin protection, setup mode gating, no notification envelope fields, and no API-key leakage.
- [x] Add HTTP setup status tests for redaction, loopback/token behavior, shared schema, and no write methods.
- [x] Update API reference or focused bridge setup contract for `bridge/setup/*`.
- [x] Run targeted bridge/protocol tests.
- [x] Run `codex review` for this loop.

### Loop 3: Add Web `/setup` route and setup UI
Review gate for this loop:
- Blocking: `/setup` initializes main runtime/thread/diff/replay paths; configured users are routed into setup from `/`; incomplete users in setup-allowed mode cannot reach setup; explicit `/setup` cannot render in dev/preview; setup UI can commit unvalidated connection/model state; setup RPC results enter transcript/projection/replay state; raw API keys are displayed or retained in renderer state.
- Non-blocking: final visual polish, full TUI copy parity, component extraction beyond current maintainability, full browser-only setup productization, and Electron packaged smoke unless they break the route isolation or setup state contract.

- [x] Add top-level `/setup` switch before `useAppRuntime`.
- [x] Add setup RPC client helpers for `bridge/setup/*`.
- [x] Implement SetupRoot and Web setup flow against setup session actions.
- [x] Add Web UI tests for route isolation, full quick flow, failure flow, and commit completion.
- [x] Add Web UI tests proving setup route sends no main app runtime/thread/diff RPCs under retry/reconnect.
- [x] Add Web UI tests proving setup RPC responses do not enter transcript/projection/replay state.
- [x] Run targeted Web Vitest tests.
- [ ] Run Browser/Playwright spot check for `/setup` visual state if a dev server is practical.
- [x] Run `codex review` for this loop.

### Loop 4: Electron setup window orchestration
Review gate for this loop:
- Blocking: Electron cannot distinguish complete vs incomplete setup before opening windows; setup completion does not restart/re-probe managed runtime; main window can open while setup remains incomplete; restart failure leaves setup unrecoverable; cancel/close opens a broken main workflow; macOS activate opens main while setup is incomplete; old setup WebSocket clients remain authoritative after restart.
- Non-blocking: final setup UI styling, full packaged/unpacked smoke matrix, screenshot capture, and docs cleanup unless they reveal an Electron lifecycle or startup correctness bug in this loop.

- [x] Pass `--allow-setup` from Electron managed runtime startup.
- [x] Add runtime-owned HTTP setup status probe before window creation.
- [x] Add setup BrowserWindow singleton and `/setup` loading.
- [x] Add desktop setup complete/cancel IPC.
- [x] Implement setup completion transition: close setup window, restart managed runtime, re-probe, open main window.
- [x] Implement cancel/close behavior while setup is incomplete.
- [x] Ensure post-restart incomplete status reopens/focuses setup instead of opening main.
- [x] Ensure old WebSocket clients are abandoned/closed before main window loads.
- [x] Run targeted desktop build/type checks.
- [x] Run `codex review` for this loop.

### Loop 5: Packaged/runtime hardening and docs
Review gate for this loop:
- Blocking: preview/packaged runtime cannot serve `/setup`; setup commit/restart fails in preview/packaged paths; CODEMAP/canonical docs contradict shipped ownership; acceptance criteria remain unverifiable; prior loop checks regress.
- Non-blocking: optional screenshots or extra manual evidence when the same behavior is already covered by targeted checks, unless the PR explicitly requires that evidence.

- [x] Verify preview and packaged/unpacked runtime paths still copy and serve the setup route.
- [x] Verify preview/packaged direct `/setup` URL load.
- [ ] Verify preview/packaged setup commit -> runtime restart -> fresh main initialize.
- [ ] Verify preview/packaged cancel/close incomplete setup and relaunch behavior.
- [x] Update desktop README and CODEMAP/package CODEMAP entries.
- [x] Add learning note under `docs/learnings/`.
- [x] Run targeted CLI, bridge, Web, and desktop checks from prior loops.
- [x] Run manual preview/packaged smoke where feasible.
- [x] Run `codex review` for this loop.

## 6. Acceptance Criteria

- [ ] A fresh Electron launch with no persisted setup opens a separate setup window and not the main app.
- [ ] Completing setup writes config/auth through `writeSetupFiles` and preserves model context-window provenance rules.
- [ ] Setup completion closes the setup window, restarts managed runtime, and opens the main app successfully.
- [ ] After setup completion, the main app opens only after the restarted runtime reports complete setup status.
- [ ] If post-restart setup status is still incomplete, Electron opens/focuses setup instead of opening the main app.
- [ ] A configured Electron launch opens the main app directly.
- [ ] `/setup` does not initialize the main app runtime or touch thread/transcript state.
- [ ] `bridge/setup/*` responses never use app-server notification envelopes and never enter replay cursor, Web parity adapters, transcript projection, or visible transcript logs.
- [ ] Default `formax web` still rejects missing setup unless setup mode is explicitly allowed.
- [ ] Setup session/create/action/commit methods are unavailable unless setup mode is explicitly allowed.
- [ ] No setup protocol or UI path leaks raw API keys in responses, logs, or persisted UI state.
- [ ] Raw API key references are cleaned up on commit, cancel, dispose, stale timeout, socket close, and service shutdown.
- [ ] The implementation has targeted tests for setup service, bridge wiring, CLI startup mode, Web setup UI, and desktop orchestration.
