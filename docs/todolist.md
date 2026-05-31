# SessionSave Layer Boundary Todo

## 0. Context and Boundary

### 0.1 Confirmed facts
- [x] `bun run check:layer-contracts` currently fails on `packages/core/src/features/repl/sessionSave/**` importing Service-layer modules.
- [x] The failing gate reports `sessionSave` as Repo importing `chat/context`, `prompts`, `features/repl/mode`, and `features/repl/controller/send/reactiveCompact`.
- [x] WebGPT `repomix-output/rsesponse/4.md` says `sessionSave` is doing semantic replay, not just JSONL persistence.
- [x] WebGPT `repomix-output/rsesponse/5.md` recommends keeping `sessionSave` Repo-owned while moving semantic reconstruction to Service.
- [x] The previous quick-win todo is complete and committed; this todo is the next focused layer-boundary task.
- [x] User requested every loop to include a `commit` checkbox after `codex review`.
- [x] User requested review to use `gpt-5.4` with medium reasoning.

### 0.2 Goals
- [ ] Make `bun run check:layer-contracts` pass without refreshing the baseline or adding broad `allowedImports`.
- [ ] Keep `sessionSave` as Repo-owned raw JSONL/sidecar IO plus DTO parsing.
- [ ] Move context-collapse, durable-snip, durable tool-result replacement, session-memory refresh, and prompt-block reconstruction semantics to Service-owned modules.
- [ ] Preserve existing REPL, app-server, and SDK behavior while changing import direction.
- [ ] Add focused DTO parser and Service replay tests before/with each behavior-preserving move.
- [ ] Keep each loop reviewable and committed after passing targeted verification and `codex review`.

### 0.3 Non-goals
- [x] Do not remap all of `sessionSave` to Service just to silence the gate.
- [x] Do not write a layer-contract baseline as the primary fix.
- [x] Do not add directory-wide `allowedImports`.
- [x] Do not rewrite `contextProjection`, `middleLayerStrategyStack`, or `/context` diagnostics in this task.
- [x] Do not implement the broader `prepareTurnContextRequest` unification in this task.
- [x] Do not migrate `@formax/semantics` or `@formax/shared` package ownership in this task.
- [x] Do not change session JSONL event names or persisted file format unless a targeted DTO compatibility test proves the behavior.

### 0.4 Current failing files
- [x] `sessionSave/contextCollapseStoreEvents.ts` imports compact/context-collapse/prompt semantics.
- [x] `sessionSave/durableSnipStoreEvents.ts` imports compact/context-projection/prompt semantics.
- [x] `sessionSave/durableToolResultContentReplacementEvents.ts` imports compact/context-projection/prompt semantics.
- [x] `sessionSave/reactiveCompactEvents.ts` imports `ReactiveCompactErrorKind` from Service controller code.
- [x] `sessionSave/sessionMemoryRefresh.ts` imports chat engine, session-memory, prompt, and REPL mode semantics.
- [x] `sessionSave/sessionMemorySidecar.ts` imports `SessionMemoryDraft` from chat/session-memory semantics.

## 1. Definitions First

### 1.1 Canonical docs
- [x] Re-read `docs/contracts/layer-contract.md` before moving files.
- [x] Re-read `docs/contracts/session-persistence-contract.md` before changing JSONL/sidecar DTO parsing.
- [x] Re-read `docs/contracts/context-strategy-stack-contract.md` before moving compact/durable projection replay semantics.
- [ ] Re-read `docs/contracts/model-settings-contract.md` only if setup/model files are touched unexpectedly.
- [ ] Update `docs/contracts/layer-contract.md` if this task introduces a new Service-owned restore path or ownership decision tree.
- [ ] Update `CODEMAP.md` when final owner paths are created or existing session restore entrypoints move.
- [ ] Add/update a short learning note under `docs/learnings/` after the boundary lands.

### 1.2 Ownership model
- [x] Define Repo `sessionSave` responsibility as file IO, JSONL scanning, sidecar read/write, tolerant record parsing, and persisted DTO emission.
- [x] Define Service restore responsibility as compact-boundary interpretation, active generation scoping, durable state reconstruction, session-memory draft creation, and prompt-block reconstruction.
- [x] Decide exact Service-owned path, recommended `packages/core/src/features/repl/sessionRestore/`.
- [ ] Decide whether compatibility wrappers remain in old `sessionSave` paths during migration; if kept, they must not keep Repo files importing Service.
- [ ] Define persisted DTO names separately from domain state names so Repo DTOs do not import Service types.

### 1.3 DTO / Interface plan
- [x] Introduce Repo-local DTOs for context-collapse committed events.
- [x] Introduce Repo-local DTOs for durable snip committed events.
- [x] Introduce Repo-local DTOs for durable tool-result content replacement events.
- [ ] Introduce Repo-local DTOs for reactive compact events, including a persisted error-kind union that does not import controller code.
- [ ] Introduce a Repo-local `SessionMemorySidecarDto` or `unknown` boundary for sidecar read/write.
- [ ] Introduce Service restore APIs that consume DTOs and return existing semantic state shapes.
- [x] Keep exported event-name constants stable for existing tests and writers.

## 2. Runtime / Platform

### 2.1 Repo DTO readers
- [x] Split `contextCollapseStoreEvents.ts` so Repo parsing does not import `chat/context` or `prompts`.
- [x] Split `durableSnipStoreEvents.ts` so Repo parsing does not import `chat/context` or `prompts`.
- [x] Split `durableToolResultContentReplacementEvents.ts` so Repo parsing does not import `chat/context` or `prompts`.
- [ ] Split `reactiveCompactEvents.ts` so Repo parsing does not import REPL controller send code.
- [ ] Split `sessionMemorySidecar.ts` so sidecar IO does not import `SessionMemoryDraft`.
- [ ] Keep malformed record tolerance and latest-event selection behavior unchanged.

### 2.2 Service restore modules
- [x] Add Service-owned context-collapse restore that builds `ContextCollapseStoreSnapshot` from Repo DTOs.
- [x] Add Service-owned durable-snip restore that builds `DurableSnipState` from Repo DTOs and applies active compact-boundary reset rules.
- [x] Add Service-owned durable tool-result replacement restore that builds semantic replacement state and applies source-scope / active-boundary filtering.
- [ ] Move `sessionMemoryRefresh.ts` semantics to Service-owned restore path, keeping Repo sidecar IO separate.
- [ ] Ensure Service restore modules import Repo DTO readers, not the reverse.
- [ ] Preserve existing sync and async restore call variants where current call sites require them.

### 2.3 Call sites
- [ ] Update REPL controller call sites to import Service restore functions when they need semantic state.
- [ ] Update app-server call sites to import Service restore functions when they need semantic state.
- [ ] Update SDK query/resume call sites to import Service restore functions when they need semantic state.
- [ ] Keep writer/test imports for event constants pointed at Repo DTO modules when they only need persisted names.
- [ ] Avoid changing runtime behavior, prompt history shape, replay facts, or persisted session rows.

### 2.4 Boundary gates
- [x] Run `bun run check:layer-contracts` after each loop that changes import direction.
- [x] Run `bun run check:layer-coverage` if new Service/Repo paths are added.
- [x] Run `bun run type-check` before final commit if the loop moves exported types or public imports.
- [ ] Do not mark the task done until `bun run check:layer-contracts` is green.

## 3. Frontend Boundary

### 3.1 User-visible behavior
- [ ] Preserve Web/app-server replay fact shapes.
- [ ] Preserve REPL resume, compact, durable snip, and session-memory restore behavior.
- [ ] Preserve SDK resume/query behavior.
- [ ] Do not change TUI/Web copy, spacing, or transcript rendering as part of this task.

### 3.2 Persistence surface
- [ ] Preserve session JSONL event names.
- [ ] Preserve sidecar file paths and write timing.
- [ ] Preserve recovery behavior for malformed or partial session files.
- [ ] Preserve old session compatibility for sessions written before this refactor.

## 4. Tests

### 4.1 Repo DTO tests
- [x] Add/update `sessionSave/contextCollapseStoreEvents.test.ts` for DTO parsing and malformed event tolerance.
- [x] Add/update `sessionSave/durableSnipStoreEvents.test.ts` for DTO parsing and malformed event tolerance.
- [x] Add/update `sessionSave/durableToolResultContentReplacementEvents.test.ts` for DTO parsing and malformed event tolerance.
- [ ] Add/update `sessionSave/reactiveCompactEvents.test.ts` for persisted DTO parsing without controller imports.
- [ ] Add/update `sessionSave/sessionMemorySidecar.test.ts` for sidecar DTO/unknown read-write boundaries.

### 4.2 Service restore tests
- [x] Add Service restore tests for context-collapse active compact-boundary transitions.
- [x] Add Service restore tests for durable snip generation scoping and stale-state clearing.
- [x] Add Service restore tests for durable tool-result replacement source-scope and compact-boundary filtering.
- [ ] Add Service restore tests for session-memory refresh / restore block construction.

### 4.3 Runtime parity tests
- [x] Run existing `contextCompressionService.test.ts` cases that cover durable snip, durable tool replacement, session memory, and compact generation behavior.
- [x] Run existing app-server tests that cover durable snip/collapse/tool replacement replay facts.
- [x] Run existing SDK query/resume tests that cover session restore semantics.
- [ ] Run targeted REPL controller/session tests for session memory flush/restore paths.

## 5. Recommended Execution Order

### Loop 1: Establish DTO/service boundary for context collapse
Review gate for this loop:
- Blocking: Repo still imports `chat/context` or `prompts` for context-collapse reconstruction, malformed-event tolerance changes, or compact-boundary generation semantics drift.
- Non-blocking: durable snip/tool replacement/session-memory modules still pending.

- [x] Re-read relevant canonical docs for context-collapse session replay.
- [x] Add or strengthen Repo DTO tests for context-collapse event parsing.
- [x] Add Service restore tests for context-collapse store reconstruction and active compact-boundary transitions.
- [x] Split context-collapse DTO parsing from semantic store reconstruction.
- [x] Update REPL/app-server/SDK context-collapse call sites to use Service restore API.
- [x] Run targeted context-collapse/session restore tests.
- [x] Run `bun run check:layer-contracts` and confirm the context-collapse violations are gone or strictly reduced.
- [x] Run `codex review --uncommitted -c model="gpt-5.4" -c model_reasoning_effort="medium"` for this loop.
- [x] Commit this loop after review passes.

### Loop 2: Split durable snip and durable tool-result replacement replay
Review gate for this loop:
- Blocking: Repo still imports `contextProjection`, `compact`, or `prompts` for durable state semantics; stale compact-boundary clearing changes; source-scope filtering changes.
- Non-blocking: session-memory refresh remains pending.

- [x] Add or strengthen Repo DTO tests for durable snip and durable tool-result replacement events.
- [x] Add Service restore tests for durable snip generation scoping and durable tool replacement filtering.
- [x] Split durable snip DTO parsing from semantic state reconstruction.
- [x] Split durable tool-result replacement DTO parsing from semantic state reconstruction.
- [x] Update REPL/app-server/SDK durable state call sites to use Service restore APIs.
- [x] Run targeted durable state tests.
- [x] Run `bun run check:layer-contracts` and confirm durable-state violations are gone or strictly reduced.
- [x] Run `codex review --uncommitted -c model="gpt-5.4" -c model_reasoning_effort="medium"` for this loop.
- [x] Commit this loop after review passes.

### Loop 3: Split reactive compact and session memory boundaries
Review gate for this loop:
- Blocking: Repo still imports REPL controller code, chat engine, session-memory semantics, prompts, or REPL mode; session-memory restore prompt blocks drift.
- Non-blocking: broader prepare-turn-context unification.

- [ ] Add or strengthen Repo DTO tests for reactive compact events.
- [ ] Add or strengthen sidecar DTO/unknown boundary tests.
- [ ] Move session-memory refresh semantics to Service-owned restore path.
- [ ] Make `reactiveCompactEvents.ts` use Repo-local persisted DTO types.
- [ ] Make `sessionMemorySidecar.ts` avoid importing Service semantic types.
- [ ] Update REPL/app-server/SDK/runtime call sites to use Service restore APIs for session-memory semantics.
- [ ] Run targeted session-memory/reactive compact tests.
- [ ] Run `bun run check:layer-contracts` and confirm remaining sessionSave violations are gone or strictly reduced.
- [ ] Run `codex review --uncommitted -c model="gpt-5.4" -c model_reasoning_effort="medium"` for this loop.
- [ ] Commit this loop after review passes.

### Loop 4: Final boundary convergence and documentation
Review gate for this loop:
- Blocking: `bun run check:layer-contracts` still fails, stale compatibility wrappers keep reverse imports, docs point to old ownership, or tests rely on obsolete paths.
- Non-blocking: package ownership migration and full context preparation unification.

- [ ] Remove stale compatibility exports or keep only safe re-export shims that do not violate Repo -> Service direction.
- [ ] Update `sessionSave/index.ts` exports to expose only Repo-safe DTO/IO APIs.
- [ ] Update `CODEMAP.md` with Repo DTO and Service restore owners.
- [ ] Update `docs/contracts/layer-contract.md` if a new Service restore path is added.
- [ ] Add/update `docs/learnings/` note for the sessionSave boundary cleanup.
- [ ] Run final targeted sessionSave/service restore/runtime tests.
- [ ] Run `bun run check:layer-contracts`.
- [ ] Run `bun run type-check`.
- [ ] Run `codex review --uncommitted -c model="gpt-5.4" -c model_reasoning_effort="medium"` for this loop.
- [ ] Commit this loop after review passes.

## 6. Deferred Follow-Up Candidates

- Broader `prepareTurnContextRequest` unification across REPL, app-server, and SDK.
- Cross-layer context/compact golden fixture matrix across REPL, app-server, SDK, diagnostics, and Web.
- Public package ownership migration for `@formax/semantics` and `@formax/shared`.
- Renderer-neutral `ToolViewBlock` / `ToolCallViewModel` migration.
