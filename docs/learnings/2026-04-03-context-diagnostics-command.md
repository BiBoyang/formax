# 2026-04-03 Context Diagnostics Command

## What changed

- Formax 新增了精确 `/context` 命令入口。
- 该命令当前走本地诊断路径，不进入主模型发送。
- 输出聚焦当前持久化 prompt snapshot：
  - system prompt 估算
  - history total 估算
  - tool result slice 估算
  - budget / auto-compact 压力
  - microcompacted tool result 数量

## Why this shape

- 先把 `/context` 做成本地即时命令，比让模型“解释上下文状态”更稳定，也更便于后续调 `microcompact` / auto-compact。
- 把统计逻辑放在 `chat/context/contextDiagnostics.ts`，让 send 层只负责命令入口和 UI subline 输出。
- 第一版故意只看“当前持久化 prompt history”，不把下一轮 injected blocks 混进来，避免诊断结果被临时提示污染。

## Current limits

- 当前是 TUI 本地入口，web reference 还没有对应支持。
- `tool_result` / `other history` 的拆分是近似估算，不保证与总量完全可加。
- 还没有 `/context --json` 或更细粒度的 per-message / per-tool 排序视图。
