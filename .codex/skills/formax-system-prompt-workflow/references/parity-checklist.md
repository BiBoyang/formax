# Parity Checklist: System Prompt and Deferred Exposure

Use this checklist when aligning Formax request payloads with the target CC behavior.

## Local artifact policy

1. `proxy/*` is git-ignored in this repository.
2. Treat all proxy captures as local-only debugging evidence.
3. Commit only a concise evidence summary (paths + conclusions), not raw capture files.
4. Use `references/parity-evidence-template.md` for the summary format.

## 1) Define the comparison scope

1. Confirm whether the task is:
- full mode alignment (`FORMAX_DEFERRED_TOOL_EXPOSURE=0`), or
- deferred mode alignment (`FORMAX_DEFERRED_TOOL_EXPOSURE=1`).
2. Freeze one model, one cwd, and one user prompt for the comparison run.
3. Record absolute capture paths before editing anything.

## 2) Generate Formax request preview (fast loop)

1. Run:
```bash
bun run request:preview -- --text "执行下 pwd" --deferred
```
2. Locate generated files under `proxy/request-preview/...`.
If you need a tracked artifact for review, rerun with:
```bash
bun run request:preview -- --text "执行下 pwd" --deferred --output-dir plans/system-reminder/request-preview/latest
```
3. Verify basic markers in generated payload:
- `system[]` exists and expected variant text appears.
- deferred mode contains helper blocks like `<available-deferred-tools>`.
- skills reminder behavior matches current design intent.

## 3) Capture real proxy traffic (ground truth)

1. Start proxy logger (`proxy/index.js`) if not running.
2. Trigger one real request from the target entrypoint (TUI/app-server/SDK).
3. Save the exact traffic log folder name and first request file path.
Record these local absolute paths in the evidence summary template (do not commit the raw files).

## 4) Compare payload structure in this order

1. `system[]` block order and major section headings.
2. `messages[]` first user turn composition:
- injected reminders
- semantic blocks
- user text block
3. `tools[]` exposure mode:
- deferred mode: ToolSearch-first and deferred semantics
- non-deferred mode: full exposed tool set
4. fields that must not regress:
- `allowTools` semantics (`[]` means deny-all in engine path)
- no prompt profile branches (`lite/full`) in runtime behavior

## 5) Deferred-mode specific checks

1. `resolveSystemPromptVariant` resolves to `deferred_aligned`.
2. Request includes deferred helper content.
3. Skills availability is communicated through reminder/helper flow as designed.
4. Tool chain scenario remains valid:
- user asks `pwd`
- model can load via `ToolSearch(select:Bash)` path
- Bash executes after exposure

## 6) Acceptance criteria

All checks below must pass before concluding parity work:

1. Targeted tests pass:
```bash
bun run test -- \
  src/prompts/system.test.ts \
  src/tools/runtime/deferredToolExposureResolver.test.ts \
  src/features/repl/controller/send/sendMainTurn.test.ts
```
2. Core semantic safety tests pass when touched:
```bash
bun run test -- src/chat/engine.test.ts src/config/settings/resolve.test.ts
```
3. `bun run type-check` passes.
4. Request preview and real proxy capture both match expected mode semantics.

## 7) Common failure patterns

1. Changed prompt text but forgot resolver injection updates.
2. Updated TUI request path but missed app-server or SDK path.
3. Fixed payload shape but accidentally changed permission semantics.
4. Added optional CC-like prompt sections without implementing runtime capability.

## 8) Commit note template

Use a short note in commit/PR summary:

1. Mode: `legacy` or `deferred_aligned`
2. Paths compared: `<preview file>`, `<proxy capture file>`
3. Behavior deltas accepted intentionally
4. Tests run

Also add/update one git-tracked evidence note (template-based) with:
1. Local capture absolute paths
2. Compared files
3. Decision summary
