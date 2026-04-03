# 2026-04-03 Context Diagnostics Command

## What changed

- Formax 新增了精确 `/context` 命令入口。
- 该命令当前走本地诊断路径，不进入主模型发送。
- TUI 仍由 dedicated local path 直接处理；app-server / Web 现在也能通过 `command/dispatch` 获取同一类 diagnostics 输出。
- `/context --json` 现在会返回同一 diagnostics 数据的 JSON 文本表示。
- app-server `/context` / `/context --json` 现在还会额外返回 `local.diagnostics` 结构化 payload，客户端可以直接消费，不必反解析 stdout。
- 输出聚焦当前持久化 prompt snapshot：
  - system prompt 估算
  - history total 估算
  - tool result slice 估算
  - budget / auto-compact 压力
  - microcompacted tool result 数量
- 现在还会额外输出 “next-turn fixed context” 视图：
  - projected history after microcompact/prune
  - deferred tool exposure / reminders / mode semantics / pending injected blocks 等固定开销
  - future user text 出现前的 assembled total / remaining budget
- 现在还会额外输出两个 top contributors 排行：
  - 当前 snapshot 里最重的 system / message / tool_result
  - future user text 出现前 assembled fixed context 里最重的 system / projected history / fixed groups

## Why this shape

- 先把 `/context` 做成本地即时命令，比让模型“解释上下文状态”更稳定，也更便于后续调 `microcompact` / auto-compact。
- 把统计逻辑放在 `chat/context/contextDiagnostics.ts`，让 send 层只负责命令入口和 UI subline 输出。
- 第一版故意只看“当前持久化 prompt history”，不把下一轮 injected blocks 混进来，避免诊断结果被临时提示污染。
- 升级版改为同时给出一个“未来用户正文之前的固定上下文投影”，这样能更接近真实 assembled prompt，又不需要真的执行 full auto-compact 或猜测用户下一句。
- 加 top contributors 是因为单看总量还不够，调压缩时我们还需要知道“到底是哪几段最胖”。
- 先把 `--json` 做成“结构化数据的文本输出”而不是直接扩展 `command/dispatch` 协议，可以在不改现有 local-dispatch shape 的前提下，让 TUI / app-server / Web 同步获得机器可读版本。

## Current limits

- `tool_result` / `other history` 的拆分是近似估算，不保证与总量完全可加。
- app-server 已经暴露 `local.diagnostics`，但 Web 目前仍主要把它当作“为后续 richer UI 预留的数据”，还没有真正渲染成专用诊断面板。
- 还没有 message id / tool_use_id 级别的精确定位、或更细的 per-system-section 视图。
- next-turn 视图当前仍不包含“未来真实用户正文”的 token，也不会真的执行 full auto-compact；它是保守的固定开销投影，不是一次完整 dry-run。
