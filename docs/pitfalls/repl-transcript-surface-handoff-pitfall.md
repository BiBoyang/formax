# REPL Transcript Surface Handoff Pitfall

## Summary
This pitfall appeared during semanticization of REPL transcript rendering.  
Symptoms looked random (`duplicate tool rows`, `tool row flicker`, `assistant/tool order inversion`), but the root issue was not random: ownership and lifecycle of the same semantic row were split across surfaces and timing windows.

## User-Visible Symptoms
- Same tool row appears twice (same `toolUseId`, sometimes same id suffix).
- Tool row disappears then reappears after finalize/next model request.
- Assistant text and tool row order can flip in edge timing.
- Fixing one symptom often reintroduced another one.

## Minimal Repro Pattern
1. Start a turn with tool calls.
2. Allow tool to enter running state.
3. Trigger footer/finalize (or abort) while UI is still in transient/static handoff.
4. Observe duplicate/static mismatch in forced `Static` rendering path.

## Root Cause (Canonical View)
1. **Dual ownership for one semantic row**  
The same tool identity could be represented by both transient and static pipelines around handoff.

2. **Non-atomic handoff**  
`tool running -> tool terminal -> finalize/turn footer` was not always applied as a single semantic transaction.

3. **Ink `<Static>` append-only contract**  
Rewriting previously rendered static rows without controlled remount/reset can create visual duplicate artifacts even when logical state looks valid.

4. **Terminal event authority confusion**  
`turn_footer` correction path briefly risked overriding explicit `tool_end` terminal outcomes.

## Stabilization Principles
1. **Stable tool identity**: use `(turnId, toolUseId)` scoped ids for canonical tool rows.
2. **Explicit surface ownership**: rely on `surfaceOwner`, not inferred `isStreaming`.
3. **Footer-driven closure**: aborted/failed/completed turns converge through canonical footer semantics.
4. **Static non-append update handling**: when static correction is non-append, trigger transcript surface reset/remount.
5. **Terminal authority**: explicit `tool_end` terminal status must not be downgraded by later footer corrections.

## Guardrails (Keep Forever)
- Same `(turnId, toolUseId)` must render at most one visible row at any time.
- Finalized tool rows must not regress from `completed` to `error` due to footer correction alone.
- Buffered mode order must remain stable across multi-tool turns.
- Abort flow must not duplicate tool rows or leave zombie running rows.

## Regression Test Focus
- `multi-tool` order stability in one turn.
- `tool_end` then `abort` should keep terminal tool status.
- footer correction updates allowed metadata but not explicit tool terminal authority.
- forced Static smoke path for duplicate-row artifacts.

## Related Files
- `packages/core/src/features/repl/useReplController.ts`
- `packages/core/src/features/repl/controller/canonical/canonicalTurnMessageMapping.ts`
- `packages/core/src/features/semantics/projection/transcriptProjectionTurnReducer.ts`
- `packages/core/src/screens/repl/transcript.tsx`
- `packages/core/src/features/repl/useReplController.test.tsx`
- `packages/core/src/features/semantics/projection/transcriptProjection.test.ts`
- `packages/core/src/screens/repl/surfaceSmoke.test.tsx`

## Related Notes
- `docs/pitfalls/repl-transcript-static-rootcause.md`
