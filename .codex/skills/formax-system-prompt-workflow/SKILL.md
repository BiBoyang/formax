---
name: formax-system-prompt-workflow
description: Use when designing, refactoring, or debugging Formax system prompt assembly, system-reminder injection, or skills/deferred-tool prompt exposure semantics; mandatory for any change involving FORMAX_DEFERRED_TOOL_EXPOSURE and request-payload parity checks.
---

# formax-system-prompt-workflow

## Goal

Keep Formax prompt behavior consistent and extensible across legacy and deferred tool-exposure modes without reintroducing removed prompt-profile branches.

## File Map

- `src/prompts/system.ts`
  System prompt source of truth, variant selection (`legacy`/`deferred_aligned`), and code-level capability switches.
- `src/features/repl/controller/send/sendMainTurn.ts`
  Per-turn injected block composition order, system prompt assembly call site, and engine turn arguments.
- `src/tools/runtime/deferredToolExposureResolver.ts`
  Deferred tools exposure, ToolSearch-first tool list, and injected `<available-deferred-tools>` + skills reminder blocks.
- `src/tools/modules/skill/index.ts`
  Skill tool description shaping and `buildAvailableSkillsSystemReminderText`.
- `src/chat/engine.ts`
  Request assembly and injected-block persistence boundaries.
- `scripts/repl-request-preview.ts`
  Fast local request preview generator (proxy-style output) for parity checks without live network calls.
- `proxy/traffic-log-*`
  Local-only capture artifacts used for CC vs Formax request-diff validation (`proxy/*` is git-ignored).

## References

- `references/parity-checklist.md`
  Step-by-step parity procedure for request preview, proxy capture comparison, and acceptance criteria.
- `references/parity-evidence-template.md`
  Git-safe summary template for recording local capture paths, compared files, and accepted deltas.

## Invariants

1. Keep a single prompt-profile path.
Do not reintroduce `promptProfile`, `lite`, or equivalent profile branches.
2. Treat `FORMAX_DEFERRED_TOOL_EXPOSURE` as a linked behavior bundle.
When the flag toggles, system prompt variant, tools exposure style, and skills presentation must stay aligned.
3. Keep injected prompt blocks request-scoped.
Injected `<system-reminder>` and deferred helper blocks must not pollute persisted long-term history.
4. Keep deferred helper blocks ephemeral.
`<available-deferred-tools>` and skills reminder helper blocks must stay ephemeral prompt blocks.
5. Enable optional CC-like prompt sections only when Formax runtime capability exists.
Do not claim memory/fast-mode/IDE capabilities before implementation.

## Workflow

1. Classify scope first.
Decide whether the change is all-mode (`legacy` + `deferred_aligned`) or deferred-only (`FORMAX_DEFERRED_TOOL_EXPOSURE=1`).
2. Edit canonical prompt text first.
Update `src/prompts/system.ts` before adjusting call-site wiring.
3. Update resolver/wiring second.
Apply matching changes in `sendMainTurn.ts` and `deferredToolExposureResolver.ts` so request structure matches prompt intent.
4. Preserve injected block order.
Keep the existing ordering contract in `sendMainTurn.ts`:
- deferred injected blocks
- reminder service blocks
- output-style reminder blocks
- semantic/slash blocks
- user text blocks
5. Keep cross-entrypoint semantics in sync.
If system/reminder semantics change, check TUI (`sendMainTurn`), app-server (`src/app-server/turnRunner.ts`), and SDK (`src/sdk/query/runner.ts`) together.
6. Update targeted tests with the change.
Do not rely on capture comparison alone.
7. Persist evidence in git-safe form.
Do not commit `proxy/*` raw logs; commit a short summary using the evidence template.

## Deferred Exposure Checklist (`FORMAX_DEFERRED_TOOL_EXPOSURE=1`)

- System prompt variant resolves to `deferred_aligned`.
- Request contains `<available-deferred-tools>` helper content.
- Skills availability is delivered as a skills system-reminder helper block.
- Tool list starts from deferred exposure resolver output (ToolSearch-first strategy).
- Tool-call chain remains valid: `ToolSearch(select:<tool>) -> <tool>`.

## Validation Commands

- `bun run test -- src/prompts/system.test.ts src/tools/runtime/deferredToolExposureResolver.test.ts src/features/repl/controller/send/sendMainTurn.test.ts`
- `bun run test -- src/chat/engine.test.ts src/config/settings/resolve.test.ts` when request assembly or tool-exposure semantics are touched
- `bun run type-check`
- `bun run request:preview -- --text "执行下 pwd" --deferred` for quick payload inspection

## Guardrails

- Do not loosen permissions or allow-list behavior just to make parity demos pass.
- Do not add new environment toggles for prompt capability sections; use code-level capability switches in `system.ts`.
- Do not reintroduce profile-style branching (`lite/full`) in prompt construction or request preview tooling.
