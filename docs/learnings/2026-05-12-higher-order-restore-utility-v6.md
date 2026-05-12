# 2026-05-12 - Higher-order restore utility v6

## Context

`pendingSessionMemoryRestore` 和 next-turn-only session-memory reminder 之前只覆盖：

- `mode`
- `recentFiles`
- `recentUserPrompts`
- `planPath`
- `planExcerpt`
- `todoSummary`

这足够做基础恢复，但对“当前任务依赖什么工作方式”仍然偏浅。

## Decision

在不引入新 persisted authority 的前提下，把 higher-order restore utility 的第一刀收敛为两个 bounded 字段：

- `recentSkills`
- `recentSubagentTypes`

它们都只来自 canonical session-memory draft / restore summary 路径：

1. `buildSessionMemoryDraft(...)`
2. `buildSessionMemoryRestoreSummary(...)`
3. `resolveSessionMemoryRestoreArtifacts(...)`

客户端和 app-server 只消费这条路径的结果，不重新组装第二套 utility。

## Why this slice

这两个字段满足三个条件：

1. 能代表更高阶的 task utility
   - skill usage
   - delegated/subagent execution mode

2. 可以直接从现有 transcript 协议稳定提取
   - 只接受成功的 `Skill` / `Task` tool use
   - 继续使用现有 `tool_use` / `tool_result` pairing 语义

3. 风险低
   - 不需要新增 sidecar schema authority
   - 不需要改 replay / restore protocol
   - 不涉及 deferred tool exposure 的额外语义判断

## Boundaries

- 继续保持 next-turn-only / best-effort 语义
- 只做 bounded recency summary，不做完整 task-state replay
- 不把 restore utility 升级成新的 persisted authority
- 不扩到 async-agent lifecycle / deferred instruction replay

## Follow-up

如果后续还需要继续加深 restore utility，优先考虑：

1. async-agent / delegated-task richer utility
2. compact protocol deeper inspection parity

不要直接把更多状态塞进 reminder block，先判断它是否真能提升 restore 后的 task completion utility。
