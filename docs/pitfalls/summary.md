# Pitfalls

This is a living knowledge base. Whenever you hit a non-obvious pitfall and you can reproduce + explain it, add a short entry.

## Format (keep it concise)
- **Problem**: what went wrong
- **Repro**: minimal steps to reproduce
- **Root cause**: why it happens
- **Fix**: what we changed / what to do next time
- **Links**: related docs/issues/PRs (optional)
- **Keywords**: terms to `rg` later

---

## UI refactor drift (mixed ownership + mixed goals)
- **Problem**: a small UI change took too many iterations and repeatedly regressed.
- **Repro**:
  1) keep more than one implementation path active for the same interaction
  2) change behavior and visuals in the same loop
  3) rely on implementation-level checks instead of user-behavior checks
  4) observe “fix one break one” cycles
- **Root cause**:
  - ownership of state/interaction was not single-source
  - scope was not isolated (architecture and styling changed together)
  - tests did not guard the exact user action that kept regressing
- **Fix**:
  - first converge to one interaction path and one owner for state
  - lock key user behavior with a minimal end-to-end check before refactor
  - split work into phases: behavior correctness first, visual polish second
  - reject compatibility/branching work unless runtime evidence proves it is necessary
- **Keywords**: ui refactor, single ownership, behavior first, phase separation, e2e guard

## Repomix respects `.gitignore` (proxy JSON missing)
- **Problem**: repomix export sometimes “misses” `proxy/*.json` and other artifacts.
- **Repro**: run repomix without flags in a repo where `.gitignore` ignores `proxy/`.
- **Root cause**: repomix respects `.gitignore` by default.
- **Fix**: export with `--no-gitignore` (and use `--include`/`--ignore` as needed).
- **Links**: `.cursor/commands/repomix.md`
- **Keywords**: repomix, gitignore, proxy, tools.json, tools-copy.json

## Approval prompts: option-3 custom input must not special-case “cancel”
- **Problem**: user types `cancel` as feedback; it must be treated as arbitrary feedback, not a magic word.
- **Repro**: choose option 3 in an approval prompt and type `cancel`.
- **Root cause**: it’s tempting to interpret text content, but that breaks legitimate user feedback.
- **Fix**: keep “cancel” handling purely as a selection/action (Esc / Cancel option), never `text === 'cancel'`.
- **Keywords**: approval prompt, EditApprovalPrompt, feedback, cancel

## Prompt blows context window (tool output + tool loop)
- **Problem**: long tool output (Grep/Bash/TaskOutput/Task) can bloat the prompt; in the worst case it fails mid tool loop (stopReason=tool_use) before the turn completes.
- **Repro**:
  1) trigger a long-output tool (e.g. Grep with a broad glob) that returns thousands of lines
  2) observe that the prompt grows quickly and may exceed the provider context window
- **Root cause**:
  - UI history and prompt history were treated similarly, or pruning happened only after the turn finished.
  - Tool loops call the model multiple times inside one turn; pruning only “post-turn” is too late.
- **Fix**:
  - Keep UI transcript and prompt history separate (`historyRef` vs `messages`).
  - Apply `pruneForPromptBudget()` before sending each model call (pre-turn) and also inside the tool loop (pre-`streamOnce`).
- **Links**: `packages/core/src/chat/context/prune.ts`, `packages/core/src/chat/engine.ts`, `packages/core/src/features/repl/useReplController.ts`
- **Keywords**: context window, prompt budget, prune, tool_result, tool_use, tool loop

## Ink InputScope flicker (controlled input + effect deps)
- **Problem**: typing in an overlay TextInput causes flicker / missed keys / cursor weirdness (sometimes looks like “can’t delete”).
- **Repro**:
  1) open an overlay with a controlled input (e.g. `/hooks` → Add new hook)
  2) type quickly; observe flicker or dropped characters
- **Root cause**: an effect that manages input scope (`pushScope/popScope`) depends on the whole `view` object. Controlled inputs update `view` on every keystroke → effect cleanup runs per keystroke → scope is popped/pushed repeatedly → transient “no active handler” windows.
- **Fix**: scope activation effects must depend only on stable state (usually `view.kind`), not the full `view` object.
- **Links**: `packages/core/src/features/repl/inputScopeContext.tsx`, `packages/core/src/tui/hooks/HooksDialog.tsx`
- **Keywords**: ink, input scope, useLayoutEffect, controlled input, flicker, pushScope, popScope

## Ink overlay “full page flash” on every keystroke (layout height / margins)
- **Problem**: in some overlays, typing into a TextInput makes the whole page visually “flash” (looks like a full clear+repaint per keystroke).
- **Repro**:
  1) open `/hooks` → Add new hook
  2) type in the command input; the screen flashes on each keypress
  3) if you temporarily add `Math.random()` somewhere in the view, you’ll see it changes every keypress (confirming re-render)
- **Root cause**:
  - controlled inputs re-render on each keypress (expected), and Ink typically repaints via a full-frame update;
  - if the overlay content is near/over the terminal height, or the layout changes (extra blank lines from `marginY`/`marginBottom`, or a bordered Box that resizes), the repaint becomes very noticeable as “flashing”.
- **Fix**:
  - keep “typing views” compact: avoid tall blocks above the input; prefer `marginTop` over `marginY`; reduce blank lines;
  - make bordered input containers stable: `width="100%"` so they don’t shrink/expand with text;
  - if the view must be long, introduce an explicit scroll region or collapse long help/examples (UI behavior change — requires user approval).
- **Links**: `packages/core/src/tui/hooks/ui.tsx`
- **Keywords**: ink, overlay, flicker, flash, layout, terminal height, marginY, marginBottom, width=100%, TextInput

## Ink `useInput` “bubbling” (multiple handlers receive the same key)
- **Problem**: When the cursor is at a boundary in `TextInput`, pressing `←/→/Backspace/Delete/Enter` can “leak” to an outer list/hotkeys (symptoms: selection jumps, Tab/arrow navigation misfires, or even REPL hotkeys trigger).
- **Repro**:
  1) Open an overlay (e.g. `/hooks` → Add new hook) and put the cursor at the far left/right of the input
  2) Press `←/→` or `Backspace/Delete` repeatedly
  3) Observe that the outer list or REPL hotkeys also fire (most noticeable at boundaries)
- **Root cause**: Ink delivers the same keypress to multiple `useInput` handlers by default; there is no browser-style stop-propagation. Simply “returning” inside one handler does not prevent other handlers from receiving the key.
- **Fix**:
  - Centralize routing via the InputScope router and introduce a “consumed” semantic: `handler(...) === true` means the key is consumed and prevents lower-priority handlers (within the same scope) from handling it.
  - In scope mode, `TextInput` must consume `←/→/Backspace/Delete/Enter` **even at boundaries** (so it never leaks to outer handlers).
  - Split REPL hotkeys vs slash selector into groups with priorities so selector navigation keys are consumed first.
- **Links**: `packages/core/src/features/repl/inputScopeContext.tsx`, `packages/core/src/components/ui/TextInput.tsx`, `packages/core/src/screens/repl/hotkeys.ts`, `packages/core/src/features/repl/inputScopeContext.test.tsx`, `packages/core/src/components/ui/TextInput.test.tsx`, `packages/core/src/screens/repl/hotkeys.test.tsx`
- **Keywords**: ink, useInput, bubbling, consumed, priority, input scope, TextInput, hotkeys

## `/clear` needs two runs / flashes once (Ink log-update cache vs manual ANSI clear)
- **Problem**: running `/clear` appears to “flash” and only fully clears the transcript on the 2nd run (or looks like it didn’t clear at all).
- **Repro**:
  1) run `bun run dev`
  2) have some chat history on screen
  3) run `/clear` once → the screen flashes / old content comes back
  4) run `/clear` again → finally clean
- **Root cause**:
  - Ink uses an internal “previous frame” buffer (via `log-update`) to compute what to draw next.
  - If we manually write ANSI clear sequences (e.g. `\x1b[2J\x1b[3J\x1b[H`) *before* the React state is cleared, Ink may render one more frame using the old buffer/state and “paint back” the old transcript (buffer/terminal becomes out of sync).
- **Fix**:
  - Clear transcript state first (`setMessages([])` + `setTranscriptSeq(+1)`), then clear the terminal.
  - Keep a single clear path for legacy REPL (`resetInkStaticOutputForStdout` + `clearTerminal()`), avoid extra `replInstance.clear()` calls that can race with the next paint.
- **Links**: `packages/core/src/features/repl/useReplController.ts`, `packages/core/src/runtime/bootstrap/runLegacyCli.tsx`, `packages/core/src/shared/utils/terminal.ts`
- **Keywords**: /clear, ink, log-update, instance.clear, ansi, clearTerminal, Static, transcriptSeq, flicker

## `/resume` select-session black screen (bypassed reset transaction)
- **Problem**: `/resume` shows session list, pressing Enter on a session can leave a blank screen while process is still alive.
- **Repro**:
  1) run `bun run dev`
  2) input `/resume`, pick a session, press Enter
  3) terminal is cleared but transcript does not repaint
- **Root cause**:
  - Resume path used its own clear/remount ordering, bypassing the shared serialized surface reset queue.
  - Terminal clear path also had duplicate clear sources (`replInstance.clear()` + ANSI clear), which amplified race windows.
- **Fix**:
  - Route resume surface updates through shared `resetTranscriptSurface()` transaction (same owner/queue as Ctrl+O paths).
  - Keep only one terminal clear path in legacy runner.
  - Add regression test asserting resume uses shared surface reset transaction ordering.
- **Links**: `packages/core/src/features/repl/controller/session/sessionTransitions.ts`, `packages/core/src/features/repl/useReplController.ts`, `packages/core/src/features/repl/controller/ui/surfaceReset.ts`, `packages/core/src/runtime/bootstrap/runLegacyCli.tsx`
- **Keywords**: resume, black screen, Static, reset transaction, surface queue, clear race

## Bash-mode Backspace fails after toggling mode (stale callback closure)
- **Problem**: after pressing `!` to enter bash mode, Backspace sometimes cannot exit bash mode.
- **Repro**:
  1) start in normal input mode (`onBackspaceAtStart` is undefined)
  2) press `!` to switch to bash mode
  3) press Backspace on empty/near-empty input
  4) observe no mode exit
- **Root cause**:
  - `TextInput` handler is `useCallback`-memoized.
  - callback dependencies only included `[focus, multiline]`, so `onBackspaceAtStart` stayed stale from normal mode.
  - after toggling into bash mode, handler still captured `onBackspaceAtStart = undefined`.
- **Fix**:
  - include dynamic callback/guard props in the dependency list:
    `useCallback(..., [focus, multiline, onBackspaceAtStart, reservedChars])`.
  - add regression tests that switch `InputBar` mode normal→bash and assert Backspace invokes `onBackspaceAtStart`.
- **Links**: `packages/core/src/components/ui/TextInput.tsx`, `packages/core/src/components/chat/InputBar.test.tsx`, `packages/core/src/components/ui/TextInput.test.tsx`
- **Keywords**: bash mode, backspace, useCallback, stale closure, dependency array, onBackspaceAtStart

## Compact + Ctrl+O duplicates header/banner in real terminal (symptom + handling)
- **Problem**: after `/compact` and repeated `ctrl+o` toggles, real terminal may show duplicated `HeaderBanner` / compact banner / compact subline even when tests pass.
- **Repro**:
  1) run `bun run dev`
  2) send a couple of turns, run `/compact`, then toggle `ctrl+o` back and forth (especially rapidly)
  3) observe duplicated header/banner/subline in primary or expanded view
- **Fix**:
  - keep header/messages inside `Static` (do not move them out as a workaround)
  - route view-transition resets through `useSurfaceTransitionManager` (single owner)
  - keep compact projection deterministic (`compact_boundary` slicing + compact command fallback)
  - always validate with forced-Static tests (`surfaceSmoke`) plus terminal-model smoke (`test:surface-screen-model`)
- **Links**: `packages/core/src/screens/repl/useSurfaceTransitionManager.ts`, `packages/core/src/screens/repl/transcript.tsx`, `packages/core/src/screens/repl/compactProjection.ts`, `packages/core/src/screens/repl/surfaceSmoke.test.tsx`, `scripts/surface-screen-model-smoke.tsx`
- **Keywords**: compact, ctrl+o, header duplicate, run dev, smoke tests

## Compact surface drift root cause (Static append-only + reset race + test gap)
- **Problem**: transcript slicing/state can be logically correct while the physical terminal still shows stale rows.
- **Repro**:
  1) run in real TTY (`bun run dev`) and trigger rapid view transitions (`ctrl+o`, `ctrl+e`, `/compact`)
  2) compare with default Vitest run that does not force Static path
  3) observe mismatch: tests green, terminal still duplicates rows
- **Root cause**:
  - Ink `<Static>` is append-only; remount/clear is required to remove old rows from the terminal surface
  - reset operations are async and can race under rapid keypresses without a single transition owner
  - clear-only paths (without remount) and fire-and-forget terminal clear can break expected `clear -> remount` ordering
  - test/runtime mismatch: non-Static test paths can hide real Static regressions
- **Fix**:
  - keep one owner for surface transitions (`useSurfaceTransitionManager` + serialized reset queue)
  - prefer reset transaction for view return paths that touch Static surface (not clear-only)
  - treat clear/remount as a transaction, not independent effects
  - maintain both fast logic tests (`compactProjection.test.ts`) and real-surface smoke (`surfaceSmoke`, `test:surface-screen-model`)
- **Links**: `packages/core/src/screens/repl/transcript.tsx`, `packages/core/src/screens/repl/useSurfaceTransitionManager.ts`, `packages/core/src/features/repl/useReplController.ts`, `packages/core/src/screens/repl/compactProjection.test.ts`, `packages/core/src/screens/repl/surfaceSmoke.test.tsx`
- **Keywords**: Ink Static, append-only, reset race, remount transaction, test parity

## REPL semantic handoff drift (duplicate tool rows / flicker / order flip)
- **Problem**: during semanticization, tool rows could duplicate, flicker (disappear/reappear), or show unstable ordering with assistant text.
- **Repro**:
  1) run a turn with one or more tool calls
  2) hit finalize/footer/abort around running->terminal handoff
  3) observe duplicate/misaligned rows, especially in Static rendering path
- **Root cause**:
  - one semantic tool identity crossed transient/static ownership windows
  - handoff was not always atomic at footer/finalize boundary
  - Ink `<Static>` append-only behavior amplifies non-append row rewrites
  - footer correction path can accidentally conflict with explicit `tool_end` authority if not guarded
- **Fix**:
  - enforce stable `(turnId, toolUseId)` identity + explicit `surfaceOwner`
  - close turns through canonical footer semantics
  - reset/remount transcript surface when static correction is non-append
  - keep `tool_end` terminal authority when footer is corrected later
- **Links**: `docs/pitfalls/repl-transcript-surface-handoff-pitfall.md`, `docs/pitfalls/repl-transcript-static-rootcause.md`
- **Keywords**: semantic handoff, tool duplicate, flicker, order inversion, surfaceOwner, turn_footer, tool_end

## `/v1/messages` “负载上限”/thinking 协议错误：先分离 signature、prune 与 header 路由问题
- **Problem**: 出现 `500 new_api_error`（“负载上限”）或 `content[].thinking ... must be passed back`，且在第 N 轮随机失败，容易误判为额度/容量问题。
- **Repro**: 混合主请求与 auto-title 请求做 A/B；在历史回传中丢失 `thinking.signature`；或 prompt 压力触发 terminal prune 后，把 assistant tool-use turn 裁成裸 `tool_use`。
- **Root cause**:
  - 协议层：`thinking.signature` 未透传会导致后续轮次失败；
  - 裁剪层：Anthropic thinking 工具回合的 `thinking` / `redacted_thinking` 协议伴随块不能被 prune 丢弃；
  - 路由层：主请求 header profile 会影响上游处理路径；
  - 统计层：auto-title（`tools=0/thinking=false`）失败会污染主请求结论。
- **Fix**:
  - 先修复 signature 透传；
  - terminal prune 保留 assistant tool-use turn 的 thinking 协议伴随块；
  - 主请求单独做 header 二分，auto-title 单独统计；
  - 使用稳定主请求 header profile（见下方链接）。
- **Links**: `docs/pitfalls/anthropic-fake-overload-and-header-routing.md`
- **Keywords**: anthropic, signature_delta, thinking.signature, redacted_thinking, prune, header routing, auto-title, new_api_error, fake overload

## Vitest session writes pollute `~/.formax` when not isolated
- **Problem**: running tests can create thousands of real session files under `~/.formax/sessions` and `~/.formax/archived_sessions`, and archived threads may reappear on refresh.
- **Repro**:
  1) run REPL/app-server tests that exercise session save + title generation
  2) inspect `~/.formax/sessions` and archived list in web reference UI
  3) observe marker conversations such as `HISTLEN:*` and `ACK:Please write a 5-10 word title for the followi`
- **Root cause**:
  - session save path defaulted to global config root (`~/.formax`) during Vitest runs
  - tests intentionally keep real write semantics, so artifacts accumulate unless storage root is redirected
- **Fix**:
  - Vitest now sets `FORMAX_VITEST_SESSION_CONFIG_DIR` per worker to a dedicated system tmp root (`<os.tmpdir()>/formax-vitest-session-config-roots/...`)
  - session path resolver now uses `FORMAX_VITEST_SESSION_CONFIG_DIR` only when `FORMAX_CONFIG_DIR` is not explicitly set
  - use cleanup scripts for maintenance:
    - `bun run test:sessions:cleanup:dry` / `bun run test:sessions:cleanup`
    - `bun run test:sessions:cleanup:legacy:dry` / `bun run test:sessions:cleanup:legacy`
- **Keywords**: vitest, session isolation, FORMAX_VITEST_SESSION_CONFIG_DIR, tmp ledger, cleanup
