# 2026-04-03 Context Microcompact MVP

## What changed

- Formax 在 `contextCompressionService` 前后置链路里新增了 `microCompactHistory()`。
- 第一版只处理旧的、较大的、且可重取的 tool result：`Read`、`Grep`、`Glob`。
- microcompact 会保留最近 3 个符合条件的 tool result 原文，更早的结果替换成短 stub，例如：
  - `[Older tool result cleared by microcompact: Read /repo/src/auth.ts]`
- richer stub 现在会补充更高价值的最小上下文：
  - `Read`：文件路径 + 近似体量信息
  - `Grep`：pattern/path + 近似命中数
  - `Glob`：pattern/path + 近似路径数

## Why this shape

- 先做“轻量减压”，可以在不触发 full compact 的情况下回收大量 prompt token。
- 把算法放在 `chat/context`，把编排留在 `contextCompressionService`，避免把 send 层再次做成巨型 orchestrator。
- stub 保留最少但可读的信息，方便模型和开发者知道“之前读过什么”，而不是只看到一个无意义的 cleared 标记。
- richer stub 的目标不是“摘要原文”，而是让后续继续工作时，至少还能知道“读过哪个文件、grep 了什么、结果大概有多大”。
- adaptive 策略现在会按上下文压力分档，动态调节：
  - 压哪些工具
  - 保留最近多少条原始结果
  - 最小结果大小阈值
- `Bash` / `WebFetch` 暂时故意不进默认策略，因为它们经常承载不可稳定重放的证据，MVP 阶段先不做有损压缩。

## Current limits

- 这是 MVP，不是 Claude Code 级完整方案。
- 还没有按 token 压力做自适应策略，只是固定规则。
- 还没有 boundary metadata、post-compact rehydration、session memory compact。
- 还没有 `/context` 风格的细分诊断视图。
