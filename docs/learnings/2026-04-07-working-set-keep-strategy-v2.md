# 2026-04-07 - working-set-aware keep strategy v2

## Context

之前 auto compact 的 `keep_combo` 只是在固定 `keepLastTurns` 之上增加统一的 `keepMinTokens=1200` 和 `keepMinUserTurns=1`。这已经比纯 `keep_last_turns` 好，但它对当前 working set 的感知还太弱，尤其是：

- recent files 已经明显进入 rehydration / session memory
- plan / todo state 已经是 compact 后恢复的重要工作态
- `plan` / `acceptEdits` 模式本身也意味着更强的 continuity 需求

## Decision

- 保留 `keep_combo` 作为 canonical auto keep strategy shape，不引入新的 boundary kind
- 新增 working-set-aware builder：
  - recent files 增加 token floor
  - plan state 增加 token floor
  - todo state 增加 token floor
  - non-normal mode 增加 token floor
  - 当这些 signal 足够强时，额外增加 `keepMinUserTurns`
- `/context` 同步暴露 `workingSetSignals`，让 diagnostics 能解释为什么 auto keep strategy 比固定 `keepLastTurns` 更积极

## Why

- 让 auto compact 更像“保住当前工作集”，而不是只保住最后 N 轮
- 继续缩小和 Claude Code 在 working-set continuity 上的差距
- 仍然保持实现保守：
  - 不新增新的 persisted boundary schema
  - 不改变 manual compact 的 `keep_last_turns` 语义
  - 不引入更重的 working-set store

## Guardrails

- 只有 auto / memory-first compact 路径使用 working-set-aware keep strategy
- manual compact 继续保留显式 `keep_last_turns`
- diagnostics 必须和 runtime 使用同一套 signal 派生逻辑，避免再出现“运行时一套、报告一套”
