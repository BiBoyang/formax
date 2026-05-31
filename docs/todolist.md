# Formax Rot Quick Wins Todo

## 0. Context and Boundary

### 0.1 Confirmed facts
- [x] The previous `docs/todolist.md` tracked a completed context-compression parity sequence and is no longer the active working todo.
- [x] ChatGPT/WebGPT responses are saved under `repomix-output/rsesponse/1.md` through `repomix-output/rsesponse/5.md`.
- [x] The quick-win/high-risk set is intentionally smaller than the full rot report: fix confirmed bugs and small contract-aligned cleanups first.
- [x] `repomix-output/rsesponse/1.md` confirms `scripts/repl-semantic-pre-review.mjs` points at a stale streaming test path.
- [x] `repomix-output/rsesponse/2.md` identifies confirmed Web replay bugs around global live cursor reuse, null active-thread gating, and malformed optional restore fields clearing caches.
- [x] `repomix-output/rsesponse/3.md` confirms new `tool_reference` writes still reinforce legacy `name`, while reads already prefer canonical `tool_name`.
- [x] `repomix-output/rsesponse/5.md` recommends model/config/setup ownership as the smallest high-impact layer-boundary cluster before broader `sessionSave` or package migration work.

### 0.2 Goals
- [x] Fix the stale REPL semantic pre-review gate path and make the gate fail fast when declared test paths disappear.
- [x] Fix Web replay high-risk bugs without changing the app-server JSON-RPC protocol.
- [x] Normalize optional restore/fact presence semantics: omitted means no cache change, explicit `null` means clear, valid object means set.
- [x] Stop emitting legacy `tool_reference.name` for new tool-reference blocks while preserving legacy read compatibility.
- [ ] Start the layer-boundary cleanup with the model/config/setup pure-helper ownership cluster, not a baseline refresh.
- [ ] Add focused regression tests before each behavior change.

### 0.3 Non-goals
- [x] Do not refresh layer-contract baselines as the primary fix.
- [x] Do not add broad `allowedImports` to hide ownership violations.
- [x] Do not rewrite `AppServer`, `TurnRunner`, `policyPreflight`, or tool rendering in this quick-win todo.
- [x] Do not implement the full renderer-neutral `ToolViewBlock` migration yet.
- [x] Do not split all of `sessionSave` yet; this belongs to the next larger layer-boundary phase after quick wins.
- [x] Do not introduce a new app-server/Web compression or restore UI surface.
- [x] Do not change user-visible TUI/Web copy, spacing, or interaction behavior unless a targeted bug fix requires it and tests lock the current behavior first.

### 0.4 Source responses
- [x] Test gates: `repomix-output/rsesponse/1.md`
- [x] Web replay: `repomix-output/rsesponse/2.md`
- [x] Tool runtime UI: `repomix-output/rsesponse/3.md`
- [x] Context compact: `repomix-output/rsesponse/4.md`
- [x] Layer boundaries: `repomix-output/rsesponse/5.md`

## 1. Definitions First

### 1.1 Canonical docs
- [x] Re-read `docs/contracts/web-parity-adapter-contract.md` before changing Web replay hydration, active-thread gating, or parser/cache semantics.
- [x] Re-read `docs/contracts/session-persistence-contract.md` before changing pending restore consumption/cache semantics.
- [x] Re-read `docs/contracts/tool-runtime-contract.md` before changing `tool_reference` writer/reader behavior.
- [ ] Re-read `docs/contracts/layer-contract.md` before moving model/config/setup ownership.
- [x] Update the relevant canonical contract first if implementation reveals current behavior and contract wording disagree.
- [x] Add/update a short learning note under `docs/learnings/` for any shipped behavior-alignment fix.

### 1.2 Data model
- [x] Define `pendingSessionMemoryRestore` parse presence as a three-state result:
  - [x] omitted or malformed required fields: field omitted, no cache update;
  - [x] explicit `null`: authoritative clear;
  - [x] valid object: set/update cache.
- [x] Define malformed optional restore subfields as filtered/defaulted, not parent-response fatal.
- [x] Define replay hydration source separately from live notification source.
- [x] Define strict visible projection gating: visible transcript/chrome only when a thread surface is visible and notification thread equals active thread.
- [x] Define new `tool_reference` write shape as canonical `tool_name` only; legacy `name` remains read fallback.
- [ ] Define model/context-window ownership split:
  - [ ] Config owns pure model identity, context-window extraction/inference, runtime profile/fingerprint, and static known metadata.
  - [ ] Repo/adapters own provider fetches, catalog fetching/caching, endpoint probing, and setup file/auth writes.
  - [ ] Service consumes resolved runtime model profiles but does not own provider discovery.

### 1.3 Types / Interfaces
- [x] Add or reuse a parser helper that can distinguish omitted optional fields from explicit `null`.
- [x] Add a replay/live notification source option without weakening live de-dupe semantics.
- [x] Add a strict active-thread projection helper with tests for draft/no-thread surfaces.
- [x] Keep `tool_reference` readers compatible with legacy `name`, including conflict precedence where `tool_name` wins.
- [ ] Introduce Config-owned model helper paths only after deciding concrete target filenames.

## 2. Runtime / Platform

### 2.1 REPL semantic gate quick fix
- [x] Fix the stale streaming test path in `scripts/repl-semantic-pre-review.mjs`.
- [x] Add a manifest or manifest-like path preflight so the gate fails before Vitest when any required test path is missing.
- [x] Keep `bun run test:repl-semantic-gate` as the public entrypoint.
- [x] Include current gate checks without changing review policy semantics.

### 2.2 Web replay high-risk fixes
- [x] Fix restore parser presence semantics for `thread/resume` and `thread/replay`.
- [x] Ensure malformed optional restore fields do not reject the parent response and do not become authoritative `null`.
- [x] Split live notification sequencing from replay hydration acceptance.
- [x] Ensure replay hydration for thread B is not rejected because thread A previously advanced the live cursor.
- [x] Add strict visible-surface projection gating for draft/no-thread surfaces.
- [x] Allow thread-scoped bookkeeping for non-active threads while blocking visible transcript/chrome updates.
- [ ] Add bounded unknown-event fallback only if the existing canonical contract requires visible degradation.
- [ ] Keep app-server replay sequence semantics and JSON-RPC response shapes stable.

### 2.3 Tool reference writer cleanup
- [x] Change new `tool_reference` blocks to emit `tool_name` only.
- [x] Preserve read fallback for legacy `name`.
- [x] Prefer `tool_name` when both `tool_name` and `name` are present and conflict.
- [x] Update ToolSearch/tool-result-content tests that currently expect new writes to include `name`.

### 2.4 Model/config/setup ownership quick cluster
- [ ] Move or split pure context-window extraction/inference helpers into a Config-owned model module.
- [ ] Move or split model identity/profile/fingerprint/persistence-policy helpers into Config-owned model modules.
- [ ] Move provider fetch/catalog behavior into adapter/Repo-owned modules.
- [ ] Update setup adapters to import Config pure helpers and adapter provider fetch/catalog helpers, not Service/core model modules.
- [ ] Update `config/runtimeModelProfile.ts` so it imports only Config-owned model helpers and no chat/context Service module.
- [ ] Update layer-contract mappings only after concrete file moves.

## 3. Frontend Boundary

### 3.1 Web parser/cache/runtime
- [x] Add parser tests before changing restore semantics.
- [x] Add cache tests for omitted/null/object restore update behavior.
- [x] Add replay hydration tests for cross-thread live cursor isolation.
- [x] Add draft/no-thread tests proving active chrome/projection is not rendered when there is no active thread.
- [ ] Keep visible Web UI behavior unchanged except for preventing incorrect projection/chrome updates.

### 3.2 TUI / tool transcript
- [x] Confirm `tool_reference` writer cleanup does not change displayed tool output.
- [x] Do not begin shared renderer-neutral tool block migration in this todo.
- [x] Do not change Task nested rendering in this todo.

## 4. Tests

### 4.1 Gate tests
- [x] Add a test or script-level assertion that every semantic gate path exists.
- [x] Run `bun run test:repl-semantic-gate`.

### 4.2 Web replay/parser tests
- [x] `packages/web-reference-react/src/app/core/rpcParsers.test.ts`: malformed optional restore subfields are omitted/defaulted, not `null`.
- [x] `packages/web-reference-react/src/app/core/rpcContracts.test.ts`: malformed optional restore does not reject `thread/resume` or `thread/replay`.
- [x] `packages/web-reference-react/src/app/runtime/threadDataOps.test.ts`: omitted restore does not clear existing cache; explicit `null` clears; valid object sets.
- [x] `packages/web-reference-react/src/app/runtime/replayThreadEvents.test.ts`: replay hydration bypasses global live cursor and uses per-thread replay cursor.
- [x] `packages/web-reference-react/src/app/runtime/processNotification.test.ts`: draft/no-thread surfaces update by-thread runtime state only, with no visible active-thread projection/chrome.
- [x] Add unknown-event fallback tests only if the contract requires that fallback.

### 4.3 Tool reference tests
- [x] Add/update tests asserting new `tool_reference` writes emit `tool_name` and omit `name`.
- [x] Add/update tests asserting legacy `name`-only blocks still read correctly.
- [x] Add/update tests asserting `tool_name` wins when both fields conflict.

### 4.4 Layer/config tests
- [ ] Add/update tests for context-window extraction from provider payloads.
- [ ] Add/update tests for fallback context-window inference.
- [ ] Add/update tests for runtime model profile fingerprint stability.
- [ ] Add/update setup tests for context-window source precedence: provider list, provider detail, catalog, heuristic.
- [ ] Add/update setup tests that heuristic context-window tokens are not persisted when policy says they should not be.
- [ ] Run `bun run check:layer-contracts` after each ownership slice.

## 5. Recommended Execution Order

### Loop 1: Semantic gate path and manifest preflight
Review gate for this loop:
- Blocking: required path checks are missing, `bun run test:repl-semantic-gate` still references stale files, or gate entrypoint changes unexpectedly.
- Non-blocking: adding the full cross-layer fixture matrix.

- [x] Fix the stale streaming test path.
- [x] Add a minimal manifest/path-existence preflight.
- [x] Add a regression test or script assertion for missing path failure.
- [x] Run `bun run test:repl-semantic-gate`.
- [x] Run `codex review` for this loop after targeted verification passes.

### Loop 2: Restore parser/cache presence semantics
Review gate for this loop:
- Blocking: malformed optional restore clears cache, rejects parent response, or becomes authoritative `null`.
- Non-blocking: broader projection fact cache refactor.

- [x] Add parser/contract/cache tests for omitted/null/object restore semantics.
- [x] Patch `rpcParsers` / contract parsing to preserve three-state presence.
- [x] Patch Web cache update call sites to treat omitted as no-op.
- [x] Run targeted Web parser/cache tests.
- [x] Run `codex review` for this loop after targeted verification passes.

### Loop 3: Web replay cursor and visible projection gate
Review gate for this loop:
- Blocking: replay hydration consults the global live cursor, draft/no-thread renders active thread projection/chrome, or live notification de-dupe becomes weaker.
- Non-blocking: `AppServer` helper extraction.

- [x] Add cross-thread replay hydration regression test.
- [x] Split live notification sequencing from replay hydration acceptance.
- [x] Add strict visible projection gate tests for active, non-active, draft, and no-thread surfaces.
- [x] Patch Web runtime/projection paths to use the strict gate for visible side effects.
- [x] Run targeted replay/process-notification tests.
- [x] Run `codex review` for this loop after targeted verification passes.

### Loop 4: Tool reference canonical writer cleanup
Review gate for this loop:
- Blocking: legacy `name` read compatibility breaks, `tool_name` conflict precedence changes incorrectly, or model-facing tool references lose required fields.
- Non-blocking: shared renderer-neutral tool view model migration.

- [x] Add/update canonical writer and legacy reader tests.
- [x] Change `toToolReferenceBlock()` to emit `tool_name` only.
- [x] Update ToolSearch/tool-result-content tests to stop expecting new `name` writes.
- [x] Run targeted tool-reference tests.
- [x] Run `codex review` for this loop after targeted verification passes.

### Loop 5: Model/config/setup ownership quick cluster
Review gate for this loop:
- Blocking: Config still imports chat/context Service modules, setup adapters still import Service-owned model helpers, or layer violations are hidden by broad allowlists.
- Non-blocking: full `sessionSave` split, full `@formax/semantics` / `@formax/shared` migration.

- [ ] Choose exact target Config/adapter model helper filenames.
- [ ] Move pure model/context-window helpers to Config-owned modules.
- [ ] Move provider fetch/catalog behavior to adapter/Repo-owned modules.
- [ ] Update setup/config imports.
- [ ] Add/update targeted config/setup/model tests.
- [ ] Run `bun run check:layer-contracts`.
- [ ] Run targeted config/setup/model tests.
- [ ] Run `codex review` for this loop after targeted verification passes.

## 6. Deferred Follow-Up Todo Candidates

- [ ] Broader layer-boundary work: split `sessionSave` DTO readers from Service restore semantics.
- [ ] Broader context work: introduce `prepareTurnContextRequest` and migrate REPL/app-server/SDK preparation onto it.
- [ ] Broader tool UI work: introduce renderer-neutral `ToolCallViewModel` / `ToolViewBlock` schema and migrate tools incrementally.
- [ ] Broader package work: turn `@formax/semantics` and `@formax/shared` from core re-export bridges into package-owned source.
- [ ] Broader test-gate work: cross-layer context/compact fixture matrix across REPL, app-server, SDK, and Web.
