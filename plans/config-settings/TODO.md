# `/config` — Formax Implementation TODO

Scope: implement `/config` in Formax with stable read/write semantics first, then wire each setting to behavior incrementally. Evidence and Claude Code findings live in `plans/config-settings/FINDINGS.md`.

## Phase 0 — Decide the contract (small + explicit)

- [x] Define the Formax `/config` v0 “supported settings” list (start with 3):
  - [x] `Output style` (prompt injection type)
  - [x] `Thinking mode` (API parameter type)
  - [x] `Verbose output` (UI-only type)
- [x] Decide write targets (“save scope”):
  - [x] User scope: `~/.formax/config.json` (or `FORMAX_CONFIG_DIR/config.json`)
  - [x] Project scope: `<repo>/.formax/config.json`
  - [x] Confirm “sparse write” policy: **only write non-default overrides**, but UI shows effective value + source.
  - [x] Note: we are explicitly **not** introducing any `cache.json` / `runtime.json` layer for v0.

## Phase 1 — Read/write real data (no behavioral wiring yet)

Goal: changing a value in `/config` updates the right file immediately and persists across reopening `/config`.

- [x] Add an adapter layer between UI state and `FormaxConfig`:
  - [x] Read effective config via existing config resolution (`global → project → env → flags`).
  - [x] Provide “source” metadata per setting (Default/User/Project/Env).
  - [x] Produce a minimal patch for the chosen save scope (only the toggled keys).
- [x] Implement persistence for the 3 initial settings (cc doesn’t ask for save-scope selection, so we default per-setting):
  - [x] `Output style` → Project (`<repo>/.formax/config.json`)
  - [x] `Thinking mode` → User (`~/.formax/config.json`)
  - [x] `Verbose output` → User (`~/.formax/config.json`)
- [x] Ensure saving triggers “in-process immediate effect” at least for:
  - [x] Output style injection into *next* request
  - [x] Thinking mode request parameter on *next* request
  - [x] Verbose affects UI immediately (no restart)

### Tests (lock behavior before refactor)

- [x] Add/extend `packages/core/src/tui/config/ConfigDialog.test.tsx`:
  - [x] Default values render (effective value + source shown).
  - [x] Saving to Project updates `<repo>/.formax/config.json`.
  - [x] Saving to User updates `~/.formax/config.json` (use temp FS path via env override in tests).
  - [x] Reopen `/config` reads back persisted values.
  - [x] “Sparse write”: default values are not written; only overrides appear.

## Phase 2 — Wire each setting to runtime behavior (one-by-one)

### Output style (prompt injection)

- [x] Implement Output style injection in Formax’s next-turn injected blocks:
  - [x] Inject a short style reminder block before the user’s message.
  - [x] Keep it out of UI transcript, consistent with “command UI output” vs “model injected context”.
  - [x] Injection rule: only `/config` changes that affect prompt semantics set `recordForNextTurn` (currently Output style). UI-only `/config` changes (e.g. Verbose output) do NOT inject `<command-name>`/`<local-command-stdout>`.

- [x] Add an integration-ish test to assert the injected block exists when Output style ≠ Default.

### Thinking mode (API request parameter)

- [x] Plumb the config value into the Anthropic request builder:
  - [x] When enabled: set `thinking: { type: 'enabled', ... }` (budget policy TBD).
  - [x] When disabled: omit `thinking`.
- [x] Add a test around request payload construction (no network needed) asserting `thinking` is present/absent.

### Verbose output (UI-only)

- [x] Define what “Verbose” means in Formax (initially):
  - [x] Show/hide thinking blocks in the primary transcript (Expanded Transcript always shows them).
  - [x] Do not change prompt contents.
- [x] Add a UI test locking the expected show/hide behavior.

## Phase 3 — Expand beyond the first 3 settings

Only after Phase 1–2 are stable, start adding the rest of cc’s `/config` entries. For each new item:

- [ ] Decide its “type”: prompt injection vs request parameter vs UI-only vs filesystem/tool policy.
- [ ] Decide its scope defaults (User vs Project vs Local).
- [ ] Add tests for read/write + effect.

Known unverified cc items we can defer (we didn’t test their storage in cc):

- [ ] Rewind code (checkpoints)
- [ ] Editor mode (explicitly out of scope for now — we are not implementing Vim/editor-mode parity)

## Notes — `/config` exit subline parity

Keep `/config` exit output aligned with Claude Code:

- No persisted changes → `Status dialog dismissed`
- With persisted changes → `Set <field> to <value>` (prefer showing only the last change for v0)

## Notes — Injection parity

- `/todos` output is injected into the next request (via `<command-name>` + `<local-command-stdout>`).
- `/config` output is injected only when the change affects prompt semantics (currently: Output style).
