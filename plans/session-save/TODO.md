# TODO — Session Save (Local Persistence)

Scope: implement local session persistence so users can close/reopen Formax without losing context.  
Design reference: `plans/session-save/DESIGN.md` and `plans/session-save/codex.md`.

## Phase 1 — Persist + Resume (MVP)

- [x] Define session file format (JSONL): `session_meta` first line, then `ui_msg`/`history_msg`/`event`
- [x] Decide & document caps: `maxLineBytes = 1 MiB` (Phase 1 default); truncation markers (`truncated: true`)
- [x] Define history correctness rule: write `history_state` snapshots (turn-level) so resume restores the exact `historyRef.current` (not just appended deltas)
- [x] Define UI correctness rule: persist only stable `Msg` states (no `isStreaming`, no tool `running`), or use id-based upsert if we later need intermediate states
- [x] Implement `SessionWriter` (append-only, bounded queue, flush after write)
- [x] Wire `SessionWriter` into REPL loop: record user/assistant/tool messages + key events (`/compact`, `/clear`, `/config` exit)
- [x] Persist tool results for audit/replay: write `tool_result` content by default, but enforce caps (no unbounded growth)
- [x] Implement `SessionReader`: parse JSONL, skip bad lines, reconstruct `Msg[]` + `ChatHistory`
- [x] Add minimal resume entrypoint (`/resume` list or CLI `--resume-last`); default filter by current `cwd`
- [x] Define cwd matching: store `cwd` + `cwdReal` (best-effort realpath) and match by `cwdReal` by default; document fallback behavior
- [x] Change `/clear` semantics to match CC: switch to a **new session id** (old session remains resumable)
- [x] Add retention guardrails: per-line size cap (truncate with markers); no default per-session cap (Codex-aligned)
- [x] Add security basics: file permissions `0600` best-effort, opt-out env/config flag
- [x] Ensure writer lifecycle: flush/drain on `/clear` and best-effort shutdown on process exit (SIGINT/uncaught)
- [x] Injected blocks: record events/metadata only (do NOT persist final injected text)
  - [x] A: local command stdout / command_subline (optional event: lengths + truncated)
  - [x] B: short behavior-driving injections (outputStyle/STATUS): event with value/version + lengths
  - [x] C: CLAUDE.md injections: event with `{path, mtime?, size, hash, truncated?}` and apply cap on recompute (hash recommended as required for audit)

## Phase 1 Tests (must-have)

- [x] Writer appends valid JSONL lines and survives partial/corrupted tail line
- [x] Reader reconstructs `Msg[]` and `ChatHistory` from a sample rollout
- [x] Resume-last selects newest session matching current `cwd`
- [x] `/clear` starts a new session id and old session remains resumable
- [x] History snapshot correctness: resume uses last `history_state` and matches the pre-clear `historyRef.current`
- [x] UI stable-state correctness: streaming messages and tool `running` states are not persisted (or are normalized on resume)
- [x] Tool result cap: oversized `tool_result` is truncated and marked, without breaking tool_use/tool_result pairing
- [x] Injected block events: CLAUDE.md metadata event emitted; outputStyle change emits event (no injected text persisted)

## Phase 2 — Make settings affect behavior (later)

Moved to `plans/session-save/TODO-LATER.md`.
