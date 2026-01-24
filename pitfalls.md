# Pitfalls / 踩坑记录

This is a living knowledge base. Whenever you hit a non-obvious pitfall and you can reproduce + explain it, add a short entry.

## Format (keep it concise)
- **Problem**: what went wrong
- **Repro**: minimal steps to reproduce
- **Root cause**: why it happens
- **Fix**: what we changed / what to do next time
- **Links**: related docs/issues/PRs (optional)
- **Keywords**: terms to `rg` later

---

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
- **Links**: `src/chat/context/prune.ts`, `src/chat/engine.ts`, `src/features/repl/useReplController.ts`
- **Keywords**: context window, prompt budget, prune, tool_result, tool_use, tool loop

## Ink InputScope flicker (controlled input + effect deps)
- **Problem**: typing in an overlay TextInput causes flicker / missed keys / cursor weirdness (sometimes looks like “can’t delete”).
- **Repro**:
  1) open an overlay with a controlled input (e.g. `/hooks` → Add new hook)
  2) type quickly; observe flicker or dropped characters
- **Root cause**: an effect that manages input scope (`pushScope/popScope`) depends on the whole `view` object. Controlled inputs update `view` on every keystroke → effect cleanup runs per keystroke → scope is popped/pushed repeatedly → transient “no active handler” windows.
- **Fix**: scope activation effects must depend only on stable state (usually `view.kind`), not the full `view` object.
- **Links**: `src/features/repl/inputScopeContext.tsx`, `src/ui/hooks/HooksDialog.tsx`
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
- **Links**: `src/ui/hooks/ui.tsx`
- **Keywords**: ink, overlay, flicker, flash, layout, terminal height, marginY, marginBottom, width=100%, TextInput
