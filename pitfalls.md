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
