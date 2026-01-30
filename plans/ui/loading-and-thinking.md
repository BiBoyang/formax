## 1) Claude Code timeline extraction from the casts

I focused on the turns that expose the *thinking vs tool vs total request duration* behavior (the part that’s causing your “thinking 100+ seconds” bug).

### demo.cast (long “Explore … codebase structure” turn)

**Turn start → prompt returns**: **00:50.938 → 03:14.505** (total ≈ 2m23s)

#### Status lines: appearance / disappearance

* **00:50.938** — **Loading line appears**

  * `· Ruminating… (esc to interrupt)`
  * (very shortly after it renders as `✻ Ruminating…`)

* **00:52.131** — **Thinking line appears**

  * `∴ Thinking…`

* **00:52.670** — **Thinking switches to “Thought for …”**

  * `∴ Thought for 1s (ctrl+o to show thinking)`
  * **Important:** it stays **exactly “1s”** for the remainder of this long turn.

* **03:14.505** — **Loading + thinking lines disappear; prompt returns**

  * Last status lines shown just before returning:

    * Loading: `✻ Thinking… (esc to interrupt · 2m 22s · ↓ 282 tokens)`
    * Thinking: `∴ Thought for 1s (ctrl+o to show thinking)`
  * Immediately after: only the prompt/input UI remains.

#### Loading line hint changes (parenthesis content)

* **00:50.938 → 01:21.483** — hint is **only** `(esc to interrupt)`
* **01:21.483** — hint expands to include elapsed + tokens:

  * `(... esc to interrupt · 30s · ↓ 260 tokens)`
* From there it keeps updating the elapsed time and token count, reaching:

  * `(... · 2m 22s · ↓ 282 tokens)` by the end.

#### Tool execution lines / tool output

* **00:54.725** — assistant begins output **and** the Explore tool call shows up:

  * Assistant text line appears (`⏺ …`)
  * Tool call appears:

    * `Explore(Analyze formax codebase structure)`
* **00:54.751** — tool subline shows:

  * `⎿ Initializing…`
* For the next ~2 minutes you see nested tool activity like `⎿ Read(…)` etc.

#### Key observed behavior (ground truth)

* **Total request duration ≈ 2m22s**, but **thinking shows “Thought for 1s” the whole time**.
* That implies Claude Code’s “Thought for Ns” is **not** “time since request started”.

---

### demo2.cast (multi Bash tool cluster + tool confirmation)

This cast shows **tool clusters** and a **tool-approval prompt** that temporarily replaces the loading/thinking block.

#### Segment: tool cluster while loading is active

* **01:47.401** — **Loading line appears**

  * `✻ Spinning… (esc to interrupt)`
* **01:47.401** — **Thinking line already present**

  * `∴ Thought for 1s (ctrl+o to show thinking)`
* **01:47.404**

  * `∴ Thought for 2s (ctrl+o to show thinking)`
* **01:48.008** — **Tool lines appear** (multiple Bash calls)

  * `⏺ Bash(ls -la src/chat/context)`
  * `⏺ Bash(ls -la src/chat/context/budget)`
  * `⏺ Bash(tree src/chat/context)`
  * `⏺ Bash(cat package.json | head -n 50)`
  * During this tool cluster, the thinking line stays **at 2s** (no continued counting).

#### Transition to tool-approval UI (loading/thinking disappears)

* **01:50.312** — UI switches to a confirmation prompt:

  * `Allow execution of bash command?`
  * Options like `❯ Yes / No`
* At this point, the **loading + thinking lines are gone** (the UI is now awaiting user input for tool approval).

#### Example: loading without any thinking line (answers “no thinking content” question)

* **02:38.793** — loading line appears with no thinking line:

  * `✻ Refining… (esc to interrupt · 11s · ↓ 0 tokens)`
  * (no `∴ …` line at all)

---

## 2) State machine spec aligned to the casts

### Minimal state model

You can keep this **tiny** and still match Claude Code well.

#### TurnPhase

This is your “what is the turn doing” phase.

* `idle` — prompt available; no request in flight.
* `in_flight` — model/tool work is happening and you show the loading block.
* `awaiting_user` — you’re waiting for user interaction mid-turn (e.g., tool approval UI). In Claude Code this *replaces* the loading/thinking block.

You may already implicitly have `idle` vs `in_flight` via `state.isLoading`; if you don’t want a new enum, you can still *derive* `TurnPhase` from existing flags, but explicitly naming it reduces bugs.

#### ThinkingPhase (timer-based, not a separate enum)

Represent thinking as a **timer that can run/pause**:

```ts
type ThinkingTimer = {
  totalMs: number          // accumulated “thinking time so far” in this turn
  startedAtMs: number|null // when the current thinking segment started; null when paused/off
}
```

Derive phases:

* **off**: `totalMs === 0 && startedAtMs === null`
* **running**: `startedAtMs !== null`
* **paused**: `startedAtMs === null && totalMs > 0`

### Transition rules with evidence

I’ll reference what we see in the casts.

#### TurnPhase transitions

| From            | Event                      | To                    | Evidence                                                               |
| --------------- | -------------------------- | --------------------- | ---------------------------------------------------------------------- |
| `idle`          | user sends message         | `in_flight`           | loading line appears immediately (`… (esc to interrupt)`)              |
| `in_flight`     | tool approval prompt shown | `awaiting_user`       | demo2: at 01:50.312 loading/thinking disappear and approval UI appears |
| `awaiting_user` | user approves/denies tool  | `in_flight` or `idle` | (not fully shown in the snippet, but consistent with Claude tool flow) |
| `in_flight`     | turn completes             | `idle`                | demo.cast at 03:14.505 status lines disappear and prompt returns       |

#### ThinkingTimer transitions

| Current    | Event                          | Action                                                        |
| ---------- | ------------------------------ | ------------------------------------------------------------- |
| off/paused | `thinking_delta` arrives       | if `startedAtMs == null`, set `startedAtMs = now`             |
| running    | `assistant_delta` arrives      | **pause**: `totalMs += now - startedAtMs; startedAtMs = null` |
| running    | `tool_start` arrives           | **pause** same as above                                       |
| paused     | later `thinking_delta` arrives | **resume**: set `startedAtMs = now`                           |
| running    | `complete` / `error` / `abort` | **pause** (finalize total)                                    |

**Why pause on `assistant_delta`?**
Because in demo.cast the thinking timer freezes while the system spends minutes running tools / printing output. Thinking clearly ends before/during tool use; `assistant_delta` is the clean “thinking ended and output started” signal in your system.

### Explicit answers (A/B/C)

**A) If no thinking content exists, does Claude Code still show “Thought for Ns”?**
**No.** There are segments with a loading line but no thinking line at all (demo2 around **02:38.793** shows loading with no `∴ …` line). In your app, that means: **don’t render ThinkingStatusLine unless you received at least one `thinking_delta`.**

**B) When tool execution starts, does thinking disappear or freeze?**
**It freezes (stops counting) and stays visible** while tools run (demo.cast: “Thought for 1s” persists across a ~2m22s run; demo2 tool cluster shows “Thought for 2s” staying fixed).
Exception: if the UI switches to a **tool approval prompt**, then the whole loading/thinking block disappears (demo2 at 01:50.312).

**C) Across multiple tool cycles, does thinking timer reset or accumulate?**
It **accumulates within a turn** and **does not reset per tool**; it only **pauses** during tool work and resumes if the model emits more thinking later. It **resets on the next user turn**.

---

## 3) Code-level mapping to your repo

### Where your current behavior is wrong

#### Bug 1: thinking timer is derived from overall request duration

In `src/screens/REPL.tsx`, you pass `loadingStartedAtMs` into `ThinkingStatusLine`:

* `ThinkingStatusLine startedAtMs={loadingStartedAtMs}` 

And `loadingStartedAtMs` is set from `state.isLoading`:

* `if (state.isLoading) setLoadingStartedAtMs((prev) => prev ?? Date.now())` 

So your thinking line is **implicitly “time since request started”**, which explains “thinking 100+ seconds”.

#### Bug 2: thinking line shows even when there is no thinking content

`ThinkingStatusLine` returns `null` only when `startedAtMs === null` .
But since `loadingStartedAtMs` is always non-null during `isLoading`, it always renders, even if `thinking_delta` never happened.

That mismatches Claude Code (see Answer A).

---

### Exact state fields to add

Add a minimal timer object to controller state:

```ts
type ThinkingTimer = {
  totalMs: number
  startedAtMs: number | null
}
```

Add to `ReplControllerState`:

* `thinkingTimer: ThinkingTimer`

(Your existing `thinkingText` stays as-is; timer is separate from content.)

`ReplControllerState` is currently defined without this field , so this is the exact place to extend.

---

### Concrete files / functions to change (bulleted diffs, minimal refactor)

#### 1) `src/features/repl/useReplController.ts`

* **Add state:**

  * `const [thinkingTimer, setThinkingTimer] = useState<ThinkingTimer>({ totalMs: 0, startedAtMs: null })`
* **Return it in controller state** alongside `thinkingText`, `loadingText`, etc. 
* **Reset it** in your “reset streaming buffers” path (used by abort/new session):

  * `resetStreamingBuffers` currently clears buffers + `setThinkingText('')` 
  * Add `setThinkingTimer({ totalMs: 0, startedAtMs: null })` there.
* **Wire it into streaming:**

  * When you call `useReplStreaming(...)`, pass `setThinkingTimer` into its args. 
* **Wire it into send paths:**

  * Update calls to `maybeHandleCompactCommand`, `maybeHandleConsumedSlashCommand`, `runMainSendTurn` to pass `setThinkingTimer` as well. 

#### 2) `src/features/repl/controller/streaming.ts`

In `useReplStreaming`:

* **Extend args type** with `setThinkingTimer: Dispatch<SetStateAction<ThinkingTimer>>`.
* **On `thinking_delta`: start the timer if not already running**

  * You already append to `thinkingBufferRef` and set `thinkingText` 
  * Add:

    * `setThinkingTimer(prev => prev.startedAtMs ? prev : { ...prev, startedAtMs: Date.now() })`
* **On `assistant_delta`: pause the timer** (before early-return buffering)

  * You already handle buffered mode early-return 
  * Add “pause” logic before buffering:

    * If `prev.startedAtMs != null`, accumulate and set `startedAtMs=null`.
* **On `tool_start`: pause the timer**

  * You already handle tool_start and set loadingText etc 
  * Add the same pause logic here.
* **On `complete` / `error`: pause if still running**

  * (Even if rare, this prevents edge cases like “thinking runs until complete with no assistant_delta”.)

This is the core behavior change that makes “Thought for Ns” stop tracking total request duration.

#### 3) `src/features/repl/controller/send.ts`

Reset timer at the beginning of any “turn-like” operation.

* **`runMainSendTurn`**

  * It currently sets `isLoading`, sets `loadingText`, clears thinking buffers, sets `thinkingText=''` 
  * Add `setThinkingTimer({ totalMs: 0, startedAtMs: null })` right next to `setThinkingText('')`.

* **`maybeHandleCompactCommand`**

  * Same pattern exists: it sets loading, clears thinking buffers, sets `thinkingText=''` 
  * Add the same timer reset.

* **`maybeHandleConsumedSlashCommand` for `local_async`**

  * Same pattern exists for local async path 
  * Add the timer reset.

This ensures every “request start” consistently resets the thinking timer (matching “new turn resets”).

#### 4) `src/screens/REPL.tsx`

* Keep `loadingStartedAtMs` for `LoadingStatusLine` timing (that’s request duration).
* **Stop using it for thinking.**

Change the `ThinkingStatusLine` call inside `showLoadingBlock` from:

* `startedAtMs={loadingStartedAtMs}` 

to:

* `startedAtMs={state.thinkingTimer.startedAtMs}`
* `accumulatedMs={state.thinkingTimer.totalMs}`

Also adjust hint behavior to match Claude Code:

* `showThinkingHint={Boolean(state.thinkingText.trim()) && !showThinking}`

(Your hotkey already only toggles thinking display when `state.isLoading && state.thinkingText.trim()` , so this aligns nicely.)

#### 5) `src/components/ui/ThinkingStatusLine.tsx`

Right now it:

* renders nothing if `startedAtMs === null` 
* computes seconds from `nowMs - startedAtMs` only

Update it minimally:

* Add prop `accumulatedMs?: number` default `0`.
* Render `null` only when:

  * `startedAtMs === null && accumulatedMs === 0`
* Compute:

  * `elapsedMs = accumulatedMs + (startedAtMs ? nowMs - startedAtMs : 0)`
* Show `∴ Thinking…` only when:

  * `startedAtMs !== null && elapsedMs < hintAfterMs`
* Show `∴ Thought for Ns` otherwise.
* Clamp `Ns` to **at least 1** so you never display “Thought for 0s” (the casts never show 0s).

This preserves your copy/colors, only changes the logic.

---

## 4) Regression tests (3–5) to lock behavior

### Best existing test file to extend

`src/features/repl/useReplController.test.tsx` already tests streaming behaviors (`thinking_delta`, tool lifecycle, etc.). 
That’s the right place to add “thinking timer” regression tests without building a new harness.

### Proposed tests (specific assertions)

1. **No thinking blocks → no thinking timer**

* Engine emits only `assistant_delta` then `complete`.
* Assert after send:

  * `controller.state.thinkingTimer.totalMs === 0`
  * `controller.state.thinkingTimer.startedAtMs === null`
* (Optional UI test later: ThinkingStatusLine not rendered.)

2. **Start timer on first thinking_delta (not on send start)**

* `vi.useFakeTimers(); vi.setSystemTime(0)`
* Engine emits:

  * at t=0: `thinking_delta`
  * at t=5000: `assistant_delta`
  * `complete`
* Assert after send:

  * `totalMs === 5000`
  * `startedAtMs === null`

3. **Pause on tool_start; don’t count tool runtime**

* Fake timers; system time jumps:

  * t=0 `thinking_delta`
  * t=3000 `tool_start`
  * t=100000 `tool_end`
  * `complete`
* Assert:

  * `totalMs === 3000` (NOT 100000)
  * `startedAtMs === null`

4. **Accumulate across multiple thinking segments**

* Fake timers; events:

  * t=0 `thinking_delta`
  * t=2000 `tool_start` (pause -> total 2000)
  * t=10000 `tool_end`
  * t=10000 `thinking_delta` (resume)
  * t=15000 `assistant_delta` (pause -> +5000)
  * `complete`
* Assert:

  * `totalMs === 7000`

5. **Reset between turns**

* Run a turn that leaves `totalMs > 0`.
* Start a second send; assert early in second send (or after) the timer was reset to `{0,null}` (depends on whether you expose intermediate state; easiest is to check that the second turn’s timer result ignores the first).

### Optional unit test for `ThinkingStatusLine`

Add `src/components/ui/ThinkingStatusLine.test.tsx`:

* Render with `startedAtMs={null}`, `accumulatedMs={3000}` → expects “Thought for 3s”.
* Render with `startedAtMs={Date.now()}`, `accumulatedMs={0}` → initially “Thinking…”, later “Thought for …”.

This locks the rendering behavior separately from controller logic.

---

## 5) Precise implementation plan

### Step-by-step (minimal refactor)

1. **Introduce `ThinkingTimer`**

* File: `src/features/repl/useReplController.ts`
* Add `thinkingTimer` state and return it in `ReplControllerState`. 

**Acceptance:** Type-check passes; state exposes `thinkingTimer`.

2. **Reset timer at turn start + reset paths**

* File: `src/features/repl/controller/send.ts`

  * Reset timer in `runMainSendTurn`, `maybeHandleCompactCommand`, `maybeHandleConsumedSlashCommand(local_async)`.
* File: `src/features/repl/useReplController.ts`

  * Reset timer in `resetStreamingBuffers` (abort/new session). 

**Acceptance:** Timer is always `{0,null}` at the beginning of any new request-like operation.

3. **Implement start/pause logic from streaming events**

* File: `src/features/repl/controller/streaming.ts`

  * Start on `thinking_delta` 
  * Pause on `assistant_delta` and `tool_start`
  * Pause on `complete/error` as safety

**Acceptance:** During a long tool run, `thinkingTimer.totalMs` stops increasing once tool starts.

4. **Wire UI to use the thinking timer, not loading timer**

* File: `src/screens/REPL.tsx`

  * Pass `state.thinkingTimer.*` into ThinkingStatusLine instead of `loadingStartedAtMs`.

**Acceptance:** A long tool call no longer causes “Thought for 100+ seconds”.

5. **Update ThinkingStatusLine to support paused display**

* File: `src/components/ui/ThinkingStatusLine.tsx`

  * Add `accumulatedMs` prop and render frozen “Thought for …” when paused. 

**Acceptance:** When tool starts, thinking line remains visible but frozen (matching Claude Code), and is absent if no thinking deltas occurred.

6. **Add regression tests**

* File: `src/features/repl/useReplController.test.tsx` 
* Add 3–5 tests above.

**Acceptance:** Tests fail on the old behavior (“thinking counts tool time”), pass on the new behavior.

---

### Net effect (what you’ll see)

* If the model never emits `thinking_delta`: **no thinking line** (Claude Code behavior).
* If it emits thinking then runs tools: thinking line shows **frozen** “Thought for Ns” while tools run (Claude Code behavior).
* Timer reflects **sum of thinking segments only**, not the whole request wall time, eliminating “thinking 100+ seconds”.

If you want, I can also extract an **exhaustive per-turn** timeline (every loading segment in both casts), but the above is enough to define the correct state transitions and fix the bug without inventing API fields.
