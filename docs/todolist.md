# Electron Setup Window and Config Gate Todo

## 0. Context and Boundary

### 0.1 Confirmed facts
- [x] Current Electron startup can create a setup-specific BrowserWindow by checking whether the URL ends with `/setup`.
- [x] Current setup-specific BrowserWindow is smaller and has setup-only native capabilities such as non-resizable behavior.
- [x] Current Web `/setup` route can render `RuntimeApp` when setup status reports complete or setup mode is unavailable.
- [x] The setup status service already exposes redacted reasons: `configured`, `missing_api_key`, `missing_base_url`, `missing_model`, and `invalid_config`.
- [x] Current `formax web --setup-mode require-config` checks API key only, so CLI startup and Web/setup status gates are not using one configured definition.
- [x] User-aligned: Electron should converge to one default desktop BrowserWindow for setup and main routes.
- [x] User-aligned: configured setup requires API key, base URL, and explicit model configuration.
- [x] User-aligned: built-in default model resolution does not count as configured.
- [x] User-aligned: `GET /__formax/setup/status` remains useful as an Electron main-process redacted pre-render gate.

### 0.2 Goals
- [x] Replace setup-specific native window behavior with a unified desktop BrowserWindow that uses the main default size and remains resizable.
- [x] Keep Electron main process as the owner of managed runtime restart, setup status re-probe, and route handoff.
- [x] Define one shared configured-status helper and use it from setup status and `formax web --setup-mode require-config`.
- [x] Treat default model fallback as `missing_model` for setup/configured status.
- [x] Prevent managed desktop `/setup` paths from bypassing Electron main-process handoff into `RuntimeApp`.
- [x] Preserve setup secret redaction and existing core setup session/write paths.

### 0.3 Non-goals
- [x] Do not add a second Electron renderer stack.
- [x] Do not add standalone setup HTML.
- [x] Do not rewrite setup wizard UI or model selection UX beyond behavior required by configured status.
- [x] Do not let Electron main process read raw API keys or parse auth store secrets.
- [x] Do not change thread, turn, replay, transcript, or app-server semantics.
- [x] Do not make browser-only setup auto-restart its server; browser-only setup keeps restart guidance.
- [x] Do not remove `/__formax/setup/status`; this task keeps it as the redacted HTTP setup gate.

### 0.4 Spec lock and review-scope
- [x] Spec lock required: this crosses Electron/Web bridge, runtime startup, config/auth status, child process lifecycle, and setup secret boundaries.
- [x] Review findings log: use `docs/setup-wizard-review-findings-log.md` for this setup-window/config-gate task.
- [x] Review findings must be classified before code changes.
- [x] Current-loop review is scoped by each loop's `Loop Contract`.
- [x] Later-loop findings are logged, not chased in the current loop.
- [x] Spec ambiguity stops implementation until this todo, canonical docs, or user alignment is updated.
- [x] Use the repository review profile from `AGENTS.md`; do not redefine model, reasoning, timeout, or service tier here.

### 0.5 Decision Draft Summary
- [x] Storage/config source: config and auth remain owned by core config resolution plus setup write paths; Electron main consumes only redacted setup status.
- [x] Schema/defaults/rejected fields: configured status accepts API key, base URL, and explicit model source; built-in default model source is rejected as configured.
- [x] Startup/activation timing: local managed Electron probes redacted setup status before renderer route load; `/setup` must still initialize before `RuntimeApp`.
- [x] Dev/Vite startup timing: when the Vite UI path lacks HTTP `/__formax/setup/status`, Web `SetupStatusGate` under injected setup mode remains the pre-`RuntimeApp` gate; preview/packaged paths keep the HTTP pre-render probe.
- [x] Permission model: no new permission, approval, policy, or hook action is introduced.
- [x] Capability level: this is startup/configured-status behavior plus Electron host routing, not a tool, slash command, or SDK feature.
- [x] Result/IO/cleanup bounds: HTTP setup status remains redacted; setup sessions continue existing TTL/cleanup/secret rules.
- [x] Explicit non-goals: no new renderer, no raw secret reads in Electron, no browser-only auto-restart, no transcript/runtime behavior changes.

## 1. Definitions First

### 1.1 Canonical docs
- [x] Update `docs/contracts/setup-wizard-contract.md` before implementation to allow desktop host handoff through one BrowserWindow.
- [x] Update `docs/contracts/setup-wizard-contract.md` to define configured setup as API key + base URL + explicit model configuration.
- [x] Update `docs/learnings/2026-05-27-electron-web-setup-wizard-boundary.md` after behavior lands.
- [x] Update `packages/desktop-electron/README.md` to describe unified desktop window startup and handoff.
- [x] Update `CODEMAP.md` only if a new shared setup status helper becomes a long-lived ownership point.

### 1.2 Data model
- [x] Define shared setup configured status inputs: resolved runtime config, config load success/failure, and model source.
- [x] Define configured model against the active/default tier: `tier_env`, `tier_model`, or `legacy_sonnet_model` only when the active tier is `sonnet`.
- [x] Document accepted behavior for non-sonnet default tier with only legacy `llm.model`: it remains `missing_model`.
- [x] Define rejected model source: `default_model` maps to `missing_model`.
- [x] Preserve status reason order: invalid config, missing API key, missing base URL, missing explicit model, configured.
- [x] Keep HTTP setup status redacted to `{ schemaVersion: 1, complete: boolean }`.

### 1.3 Types / Interfaces
- [x] Add one canonical configured-status helper under `packages/core/src/core/setup/configuredStatus.ts`.
- [x] Make `bridge/setup/status` use the shared helper.
- [x] Make `formax web --setup-mode require-config` use the shared helper.
- [x] Remove hand-rolled configured checks from `bridge/setup/status` and CLI `web require-config`.
- [x] Keep `SetupStatusResult.effective` redacted and free of raw API key material.
- [x] Rename Electron route-gate helpers touched by this task away from `Window` naming, for example `shouldLoadSetupRoute`.

### 1.4 Semantic decision table
| Decision | Accepted rule | Source | Alternatives rejected / deferred | Contract target | Test implication |
|---|---|---|---|---|---|
| Desktop window model | Setup and main use one default resizable BrowserWindow. | `User-aligned` | Two native windows with setup-only fixed size. | `docs/contracts/setup-wizard-contract.md` | Electron main build plus desktop startup smoke expectations. |
| Desktop handoff owner | Electron main owns runtime restart, status re-probe, and route load. | `Formax-existing` + `User-aligned` | Renderer-only redirect after managed setup commit. | `docs/contracts/setup-wizard-contract.md` | Web tests assert desktop commit calls `formaxDesktop.setup.complete()`. |
| HTTP status endpoint | Keep `/__formax/setup/status` as redacted pre-render gate. | `Formax-existing` + `User-aligned` | Removing endpoint and relying only on Web root gate. | `docs/contracts/setup-wizard-contract.md` | localUi tests keep endpoint out of SPA fallback and redacted. |
| Configured status | Configured requires API key, base URL, and explicit model config. | `User-aligned` | API-key-only gate; API key + base URL only. | `docs/contracts/setup-wizard-contract.md` | Core and CLI tests cover all missing reasons. |
| Active/default tier model | Configured model is evaluated for the active/default tier; legacy `llm.model` counts only through `legacy_sonnet_model`. | `User-aligned` | Treat legacy `llm.model` as configuring haiku/opus default tiers. | `docs/contracts/setup-wizard-contract.md` | Core tests cover non-sonnet default tier with only legacy model. |
| Default model fallback | `default_model` does not count as configured. | `User-aligned` | Treat built-in default model as configured. | `docs/contracts/setup-wizard-contract.md` | Core tests assert `missing_model` for default-only model. |
| Browser-only setup | Browser-only setup still shows restart guidance after commit. | `Formax-existing` | Browser-only server self-restart. | `docs/contracts/setup-wizard-contract.md` | Web tests preserve restart-required behavior. |
| Secret boundary | Electron main never reads raw API key or auth store secrets. | `Formax-existing` | Main-process config/auth parsing. | `docs/contracts/setup-wizard-contract.md` | Tests and review check no raw secret in status/IPC/log output. |

### 1.5 EntryPoint Matrix
| EntryPoint | Reads config? | Activates runtime? | Exposes capability? | UI/transcript behavior | Tests |
|---|---|---|---|---|---|
| REPL | Existing runtime config behavior only. | Existing REPL startup unchanged. | No new capability. | No setup window behavior. | No REPL tests unless shared helper changes CLI setup behavior used by REPL. |
| SDK | No change. | No change. | No new capability. | No UI. | No SDK tests. |
| app-server bridge | Uses setup bridge service for `bridge/setup/status` and setup mutation. | Existing bridge startup unchanged. | Existing setup side-channel only. | No transcript changes. | `devBridge` setup route tests where touched. |
| Web | Calls `bridge/setup/status`, renders setup/root gate, and calls desktop setup complete. | Must not initialize `RuntimeApp` before setup gate. | Existing setup UI only. | `/setup` remains isolated from thread/turn/replay. | `packages/web-reference-react/src/App.test.tsx`. |
| Electron | Probes redacted HTTP status, starts managed runtime modes, loads setup/main routes in one BrowserWindow. | Owns managed runtime restart and re-probe. | Desktop host setup bridge only. | Unified native window; no transcript changes. | `npm --prefix packages/desktop-electron run build:main` plus targeted smoke/manual checks. |
| CLI `web` | Uses shared configured status for `require-config`. | Starts Web UI only when configured or setup mode is allow. | No new command. | No UI when require-config rejects. | `packages/core/src/runtime/cli/main.test.ts`. |

### 1.6 Review finding triage policy
- [x] Classify every review finding as `true blocker`, `valid but later-loop`, `spec ambiguity`, `reviewer preference`, or `conflicts with accepted contract` when review is run.
- [x] Fix code only for true blockers inside the current loop contract, accepted contract violations, or localized low-risk implementation bugs.
- [x] For later-loop findings, update `docs/setup-wizard-review-findings-log.md` and make sure a future loop owns the acceptance item.
- [x] For spec ambiguity, stop implementation and update contracts/todo or ask the user before editing code.
- [x] For reviewer preference, do not adopt unless it is low-risk, local to the current loop, and does not change behavior or scope.
- [x] For contract conflicts, do not implement the finding; cite the accepted contract and add a focused regression test.
- [x] Re-run review only after triage is documented and targeted tests pass; skipped in this run by active user request.

## 2. Runtime / Platform
- [x] Move setup status reason logic from `bridgeService.ts` into the canonical configured-status helper.
- [x] Make the canonical configured-status helper the only authority for setup configured reasons.
- [x] Update setup status tests for `missing_base_url` and default-model-only `missing_model`.
- [x] Update setup status tests for non-sonnet default tier with only legacy `llm.model`.
- [x] Update CLI `web require-config` to reject the same missing reasons as setup status.
- [x] Make direct API-key-only checks in `formax web --setup-mode require-config` a blocker.
- [x] Update CLI tests for missing API key, missing base URL, default-model-only missing model, and configured explicit model.
- [x] Keep `/__formax/setup/status` payload unchanged, but ensure its `complete` bit comes from the same setup status service and shared configured helper.
- [x] Keep allow setup mode able to start for repair even when config is incomplete or invalid.
- [x] Keep local UI HTTP status redacted and outside SPA fallback.
- [x] Keep Electron setup-required runtime error classification compatible with the unified reasons.

## 3. Electron / Web Boundary
- [x] Update Electron contract language from setup/main windows to desktop host setup/main routes.
- [x] Remove setup-specific fixed-size and non-resizable BrowserWindow options.
- [x] Make setup and main URLs load in the owner BrowserWindow; create a replacement window only when the owner is missing or destroyed.
- [x] Update setup completion IPC so successful re-probe loads the main route in the owner window instead of creating a second window.
- [x] Assert app activation/focus reuses an existing BrowserWindow regardless of current setup/main route.
- [x] Assert setup completion, app activation, and recovery do not create a second BrowserWindow while the owner window is alive.
- [x] Keep recovery behavior in the same window when re-probe remains incomplete or runtime restart fails.
- [x] Prevent managed desktop `/setup` complete/unavailable paths from bypassing main-process handoff into `RuntimeApp`.
- [x] Preserve browser-only `/setup` restart guidance and unavailable behavior.

## 4. Tests
- [x] Add core setup status tests for each configured reason.
- [x] Add CLI tests proving require-config uses the shared configured definition.
- [x] Update Web App tests for `/setup` incomplete, complete, restart-required, unavailable, and desktop managed behavior.
- [x] Keep localUi tests for `/__formax/setup/status` redaction and no SPA fallback.
- [x] Targeted core setup verification passes.
- [x] Targeted CLI web command verification passes.
- [x] Targeted Web App verification passes.
- [x] Desktop Electron main build verification passes.
- [x] TypeScript boundary verification passes after shared TypeScript changes.

## 5. Recommended Execution Order

### Loop 1: Contract and Configured Status Definition
#### Loop Contract
- Purpose: lock the accepted architecture and configured semantics before code changes.
- In scope: setup wizard contract, README wording, todo alignment, review log setup.
- Out of scope: code changes, UI polish, Electron window implementation.
- Blocking findings: docs still require two native windows, docs allow default model to count as configured, docs allow renderer-only managed desktop handoff.
- Non-blocking / later-loop findings: wording polish that does not affect semantics.
- Known unresolved semantics: none after user alignment in this todo.
- Required targeted tests: none for docs-only loop.
- Review prompt scope: contract consistency only.
- Exit criteria: canonical docs permit unified BrowserWindow and define explicit-model configured status.

- [x] Update `docs/contracts/setup-wizard-contract.md`.
- [x] Update `packages/desktop-electron/README.md`.
- [x] Add review finding triage section or entry to `docs/setup-wizard-review-findings-log.md`.
- [x] Check docs do not describe two native windows as mandatory.
- [x] Defer loop-local review to the final convergence review to avoid chasing intermediate states.
- [x] Triage review findings through `docs/setup-wizard-review-findings-log.md`; final convergence review owns the resolved state.

### Loop 2: Shared Configured Status Gate
#### Loop Contract
- Purpose: make CLI and setup status use one configured definition.
- In scope: core setup status helper, `bridge/setup/status`, CLI require-config, tests for reasons.
- Out of scope: Electron BrowserWindow changes, Web route behavior, setup UI design.
- Blocking findings: API-key-only path remains, default model counts as configured, raw API key leaks, allow mode can no longer repair incomplete setup.
- Non-blocking / later-loop findings: richer CLI copy beyond reason clarity.
- Known unresolved semantics: none.
- Required targeted tests: core setup bridge/status tests and CLI web tests.
- Review prompt scope: configured-status semantics and secret redaction only.
- Exit criteria: missing API key, missing base URL, and default-only model produce matching setup/CLI incomplete behavior.

- [x] Add the canonical configured-status helper in `packages/core/src/core/setup/configuredStatus.ts`.
- [x] Update `bridgeService.status()` to use the shared helper.
- [x] Update `formax web --setup-mode require-config` to use the shared helper.
- [x] Remove direct API-key-only configured checks from CLI `web require-config`.
- [x] Add/update tests for `missing_api_key`.
- [x] Add/update tests for `missing_base_url`.
- [x] Add/update tests for `missing_model` when model source is `default_model`.
- [x] Add/update tests for non-sonnet default tier with only legacy `llm.model` remaining `missing_model`.
- [x] Add/update tests for configured explicit model sources.
- [x] Keep `/__formax/setup/status` payload unchanged while its `complete` bit comes from the shared helper.
- [x] Targeted core setup and CLI verification passes.
- [x] Defer loop-local review to the final convergence review to avoid chasing intermediate states.
- [x] Triage review findings through `docs/setup-wizard-review-findings-log.md`; final convergence review owns the resolved state.

### Loop 3: Unified Electron BrowserWindow
#### Loop Contract
- Purpose: remove setup-specific native window capability and use one desktop host window for setup/main routes.
- In scope: Electron main window creation, setup completion IPC handoff, helper naming, desktop README follow-up.
- Out of scope: configured-status semantics, Web setup UI redesign, browser-only setup behavior.
- Blocking findings: setup route still creates fixed non-resizable window, successful setup still creates second main window while owner exists, Electron reads raw secrets, recovery can enter RuntimeApp without re-probe.
- Non-blocking / later-loop findings: final macOS visual polish for setup route.
- Known unresolved semantics: none.
- Required targeted tests: desktop Electron main build; targeted smoke checklist in final notes.
- Review prompt scope: Electron lifecycle and native window state only.
- Exit criteria: setup and main routes use the same default resizable BrowserWindow, and setup completion handoff stays main-process owned.

- [x] Rename route-gate helpers touched by this task away from setup-window terminology.
- [x] Remove `SETUP_WINDOW_WIDTH` / `SETUP_WINDOW_HEIGHT` usage or alias setup to main dimensions.
- [x] Remove setup-specific non-resizable/maximize/fullscreen constraints.
- [x] Update setup completion IPC to load `nextUrl` in `ownerWindow` after successful re-probe.
- [x] Create a new window only when no owner window exists or it was destroyed.
- [x] Add/update lifecycle assertions that app activation/focus reuses an existing BrowserWindow regardless of current setup/main route.
- [x] Add/update lifecycle assertions that setup completion, app activation, and recovery do not create a second BrowserWindow while the owner window is alive.
- [x] Keep incomplete/recovery paths loading `/setup` in the same window.
- [x] Desktop Electron main build verification passes.
- [x] Defer loop-local review to the final convergence review to avoid chasing intermediate states.
- [x] Triage review findings through `docs/setup-wizard-review-findings-log.md`; final convergence review owns the resolved state.

### Loop 4: Web Setup Route and Managed Desktop Handoff
#### Loop Contract
- Purpose: ensure Web route behavior does not bypass managed desktop host handoff.
- In scope: `App.tsx` setup route/root gate behavior, desktop managed complete/unavailable handling, App tests.
- Out of scope: Electron native window sizing, core configured-status helper, setup wizard visual redesign.
- Blocking findings: `/setup` initializes `RuntimeApp` before status gate, managed desktop setup success bypasses `formaxDesktop.setup.complete()`, browser-only restart guidance regresses.
- Non-blocking / later-loop findings: improved copy for already-configured setup page.
- Known unresolved semantics: none; the route-context matrix below is the accepted behavior for this loop.
- Required targeted tests: `packages/web-reference-react/src/App.test.tsx`.
- Review prompt scope: Web route gating and desktop/browser setup separation only.
- Exit criteria: Web setup route stays isolated, desktop managed setup handoff uses the bridge, and browser-only restart guidance remains.

#### Route-context matrix
| Route context | Status | Expected behavior |
|---|---|---|
| Managed desktop `/setup` | incomplete | render setup entrypoint/session before `RuntimeApp` |
| Managed desktop `/setup` | complete | render host-handoff/already-configured state; no setup session mutation; no `RuntimeApp` render from `SetupEntrypoint` |
| Managed desktop `/setup` | mutation unavailable | render setup-unavailable/host-handoff state; no setup session mutation; no `RuntimeApp` render from `SetupEntrypoint` |
| Browser-only `/setup` | incomplete + allow | render setup entrypoint/session |
| Browser-only `/setup` | complete after setup on same allow server | render restart guidance when `restartRequired` is true |
| Browser-only root gate | complete at startup | enter `RuntimeApp` through root gate |

- [x] Update `/setup` complete/unavailable behavior for managed desktop.
- [x] Implement the route-context matrix.
- [x] Preserve root `SetupStatusGate` behavior for setup mode allow.
- [x] Preserve browser-only restart required behavior.
- [x] Add/update tests that `/setup` does not create setup sessions when already complete.
- [x] Add/update tests that managed desktop setup commit calls desktop complete and handles retry.
- [x] Add/update tests that setup route does not trigger main app initialization while incomplete.
- [x] Add/update Web tests for injected `__FORMAX_SETUP_MODE__='allow'` root gate behavior independent of HTTP setup status endpoint.
- [x] Targeted Web App verification passes.
- [x] Defer loop-local review to the final convergence review to avoid chasing intermediate states.
- [x] Triage review findings through `docs/setup-wizard-review-findings-log.md`; final convergence review owns the resolved state.

### Loop 5: Verification and Convergence
#### Loop Contract
- Purpose: close docs/tests/review feedback and prepare the patch for commit.
- In scope: targeted test reruns, type-check, CODEMAP update if helper ownership moved, learning note update, final cleanup.
- Out of scope: new setup UI polish, new provider/model selection UX, browser-only auto-restart.
- Blocking findings: contract contradicts implementation, targeted tests fail, type-check fails, secrets leak in status/log outputs, review reports a current-loop regression.
- Non-blocking / later-loop findings: aesthetic setup-route polish and future telemetry/diagnostics backlog.
- Known unresolved semantics: none.
- Required targeted tests: touched core, CLI, Web tests, desktop build, and TypeScript boundary verification.
- Review prompt scope: final architecture consistency across docs, core, Web, and Electron.
- Exit criteria: docs align, targeted verification passes, review findings are classified, and no temporary scaffolding remains.

- [x] Touched core setup verification passes.
- [x] Touched CLI verification passes.
- [x] Touched Web App verification passes.
- [x] Desktop Electron main build verification passes.
- [x] TypeScript verification passes.
- [x] Update `CODEMAP.md` if a new setup status helper ownership point was introduced.
- [x] Update `docs/learnings/2026-05-27-electron-web-setup-wizard-boundary.md`.
- [x] Remove temporary diagnostics or scaffolding.
- [x] Run `codex review` for final convergence after targeted verification passes without `service_tier=fast`.
- [x] Triage final review findings into `docs/setup-wizard-review-findings-log.md`. Final review reported no actionable regressions.
