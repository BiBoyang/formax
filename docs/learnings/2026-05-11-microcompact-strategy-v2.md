# 2026-05-11 - Microcompact strategy v2

## Context

`microCompactHistory()` originally protected the newest eligible tool results with a single global `keepRecentToolResults` budget. That was simple, but it let newer low-value search/list outputs crowd out more important recent `Read` / `Skill` context. It also applied one global size threshold across tool families.

## Decision

Upgrade microcompact to use:

1. family-aware recent keep quotas (`keepRecentToolResultsByName`)
2. per-tool size thresholds (`minResultCharsByName`)
3. the same adaptive policy inputs in runtime and `/context` next-turn diagnostics

The resulting policy is still deliberately small and deterministic. We did **not** add a generic scoring system or a persisted strategy model.

## Why

This improves yield under pressure without turning microcompact into another opaque optimizer:

- recent `Read` / `Skill` context gets explicit protection
- medium-size `Grep` / `Glob` results can become compactable under tighter pressure tiers
- `/context` no longer risks showing a different microcompact projection than the real send path

## Guardrails

- keep the strategy table explicit and test-backed
- do not compact more Bash/WebFetch output unless the existing safety gates still pass
- prefer deterministic family/threshold rules over heuristic ranking systems unless a later stage proves the extra complexity is worth it
