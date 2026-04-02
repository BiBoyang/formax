# 2026-04-03 Context Microcompact MVP

## What changed

- Formax 在 `contextCompressionService` 前后置链路里新增了 `microCompactHistory()`。
- 第一版只处理旧的、较大的、且可重取的 tool result：`Read`、`Grep`、`Glob`。
- microcompact 会保留最近 3 个符合条件的 tool result 原文，更早的结果替换成短 stub，例如：
  - `[Older tool result cleared by microcompact: Read /repo/src/auth.ts]`

## Why this shape

- 先做“轻量减压”，可以在不触发 full compact 的情况下回收大量 prompt token。
- 把算法放在 `chat/context`，把编排留在 `contextCompressionService`，避免把 send 层再次做成巨型 orchestrator。
- stub 保留最少但可读的信息，方便模型和开发者知道“之前读过什么”，而不是只看到一个无意义的 cleared 标记。
- `Bash` / `WebFetch` 暂时故意不进默认策略，因为它们经常承载不可稳定重放的证据，MVP 阶段先不做有损压缩。

## Current limits

- 这是 MVP，不是 Claude Code 级完整方案。
- 还没有按 token 压力做自适应策略，只是固定规则。
- 还没有 boundary metadata、post-compact rehydration、session memory compact。
- 还没有 `/context` 风格的细分诊断视图。
