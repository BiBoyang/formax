# 2026-04-04 Session Memory Draft Schema

## 背景

Formax 现有的 memory 主要是按 cwd / workspace 维度定位的 `MEMORY.md`。
它适合保存跨 session 的稳定事实，但不适合承载当前会话自己的 working memory。

在对齐 Claude Code 上下文压缩体系时，我们需要把这两层分开：

- project memory：跨 session、按 cwd 共享、文件型
- session memory：当前会话自己的持续工作记忆

## 这次做了什么

新增 `packages/core/src/chat/context/sessionMemory.ts`，先只定义 **draft schema + builder + merge 规则**。

当前 schema 分三层：

1. `durableFacts`
   - `workspaceRoot`
   - `projectMemoryPath`
2. `activeTask`
   - `mode`
   - `recentFiles`
   - `recentUserPrompts`
   - `planPath`
   - `planExcerpt`
   - `todoSummary`
3. `currentStrategy`
   - `lastCompactTrigger`
   - `summaryKind`
   - `keepStrategy`
   - `rehydrationPlan`

builder 目前复用现有上下文治理信号：

- `buildPostCompactRehydration(...)`
- `findLatestCompactBoundary(...)`
- auto-memory 路径推导

## 为什么先停在 draft schema

这一步的目标不是马上把 session memory 接进 runtime。
先把 schema 和 merge 规则定下来，有几个好处：

1. 先把 session memory 和 project memory 的边界说清楚
2. 为后续 rolling memory 更新器提供稳定目标对象
3. 为 memory-first auto compact 铺路，而不是一开始就把 runtime 改复杂

## 当前刻意没做

- 没有后台 rolling memory 更新器
- 没有把 session memory 注入 prompt
- 没有接入 auto compact fallback chain
- 没有把它写进 session persistence / resume 协议

这些属于后续 `CCA-051` / `CCA-052` 的范围。
