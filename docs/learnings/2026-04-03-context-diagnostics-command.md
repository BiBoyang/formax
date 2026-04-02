# 2026-04-03 Context Diagnostics Command

## What changed

- Formax 新增了精确 `/context` 命令入口。
- 该命令当前走本地诊断路径，不进入主模型发送。
- TUI 仍由 dedicated local path 直接处理；app-server / Web 现在也能通过 `command/dispatch` 获取同一类 diagnostics 输出。
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

- `tool_result` / `other history` 的拆分是近似估算，不保证与总量完全可加。
- 还没有 `/context --json` 或更细粒度的 per-message / per-tool 排序视图。
- app-server / Web 当前仍只返回纯文本 diagnostics；还没有结构化 JSON 版本给客户端做 richer rendering。
