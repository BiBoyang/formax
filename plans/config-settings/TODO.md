# `/config` — Formax Implementation TODO

Scope: implement `/config` in Formax with stable read/write semantics first, then wire each setting to behavior incrementally. Evidence and Claude Code findings live in `plans/config-settings/FINDINGS.md`.

## Phase 0 — Decide the contract (small + explicit)

- [ ] Define the Formax `/config` v0 “supported settings” list (start with 3):
  - [ ] `Output style` (prompt injection type)
  - [ ] `Thinking mode` (API parameter type)
  - [ ] `Verbose output` (UI-only type)
- [ ] Decide write targets (“save scope”):
  - [ ] User scope: `~/.formax/config.json` (or `FORMAX_CONFIG_DIR/config.json`)
  - [ ] Project scope: `<repo>/.formax/config.json`
  - [ ] Confirm “sparse write” policy: **only write non-default overrides**, but UI shows effective value + source.
  - Note: we are explicitly **not** introducing any `cache.json` / `runtime.json` layer for v0.

## Phase 1 — Read/write real data (no behavioral wiring yet)

Goal: changing a value in `/config` updates the right file immediately and persists across reopening `/config`.

- [ ] Add an adapter layer between UI state and `FormaxConfig`:
  - [ ] Read effective config via existing config resolution (`global → project → env → flags`).
  - [ ] Provide “source” metadata per setting (Default/User/Project/Env).
  - [ ] Produce a minimal patch for the chosen save scope (only the toggled keys).
- [ ] Implement persistence for the 3 initial settings:
  - [ ] `Output style` write path (default to Project, allow User).
  - [ ] `Thinking mode` write path (default to User, allow Project).
  - [ ] `Verbose output` write path (default to User, allow Project).
- [ ] Ensure saving triggers “in-process immediate effect” at least for:
  - [ ] Output style injection into *next* request
  - [ ] Thinking mode request parameter on *next* request
  - [ ] Verbose affects UI immediately (no restart)

### Tests (lock behavior before refactor)

- [ ] Add/extend `src/ui/config/ConfigDialog.test.tsx`:
  - [ ] Default values render (effective value + source shown).
  - [ ] Saving to Project updates `<repo>/.formax/config.json`.
  - [ ] Saving to User updates `~/.formax/config.json` (use temp FS path via env override in tests).
  - [ ] Reopen `/config` reads back persisted values.
  - [ ] “Sparse write”: default values are not written; only overrides appear.

## Phase 2 — Wire each setting to runtime behavior (one-by-one)

### Output style (prompt injection)

- [ ] Implement Output style injection in Formax’s next-turn injected blocks:
  - [ ] Inject a short style reminder block (similar role/type as other injected blocks) before the user’s message.
  - [ ] Keep it out of UI transcript (or mark it as injected-only), consistent with existing command output vs model context separation.
- [ ] Add an integration-ish test to assert the injected block exists when Output style ≠ Default.

### Thinking mode (API request parameter)

- [ ] Plumb the config value into the Anthropic request builder:
  - [ ] When enabled: set `thinking: { type: 'enabled', budget_tokens: ... }` (budget policy TBD).
  - [ ] When disabled: omit `thinking`.
- [ ] Add a test around request payload construction (no network needed) asserting `thinking` is present/absent.

### Verbose output (UI-only)

- [ ] Define what “Verbose” means in Formax (initially):
  - [ ] Show/hide thinking blocks in Expanded Transcript (and/or other debug panels).
  - [ ] Do not change prompt contents.
- [ ] Add a UI test locking the expected show/hide behavior.

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
