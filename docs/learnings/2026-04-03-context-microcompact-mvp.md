# 2026-04-03 Context Microcompact MVP

## What changed

- Formax 在 `contextCompressionService` 前后置链路里新增了 `microCompactHistory()`。
- 第一版先处理旧的、较大的、且可重取的 tool result：`Read`、`Grep`、`Glob`。
- 后续增量又补上了一个更窄但高价值的安全路径：
  - `Skill` 的 machine-generated companion text block（来自 `ToolResult.extraTextBlocks`）
  - 当前只命中已知的 skill body 形态：以 `Base directory for this skill:` 开头的附加块
  - 这条路径不会误伤普通 trailing text，也不会改掉 `Launching skill: ...` 这类短 launch stub
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
- 对 `Skill` companion block 来说，最值钱的信息不是完整 skill body 一直留在 prompt 里，而是：
  - 这是哪个 skill 的 body
  - 它曾经被注入过
  - 大概有多大
- adaptive 策略现在会按上下文压力分档，动态调节：
  - 压哪些工具
  - 保留最近多少条原始结果
  - 最小结果大小阈值
- `Bash` / `WebFetch` 不再是纯粹的“永不压缩”。
  - `Bash` 只允许明确只读、无 shell 组合符的命令进入 microcompact。
  - `WebFetch` 只允许稳定的 HTTPS 文档类 URL 且无 query/hash 的场景进入 microcompact。
- `Bash` / `WebFetch` 仍然不进入“默认宽松策略”；只有在更高压力档位下，且命中保守 allow/deny 规则时，才允许进入 microcompact。

## Current limits

- 这是 MVP，不是 Claude Code 级完整方案。
- 已有按 token 压力分档的自适应策略，但还没有缓存感知 / 时间感知路径。
- 目前只对已知安全的 machine-generated companion block 做了非常窄的命中：
  - 只覆盖 `Skill`
  - 只覆盖紧跟 `tool_result` 的第一个 text block
  - 只覆盖以 `Base directory for this skill:` 开头的附加块
- 还没有处理更一般化的 post-tool text 或其他工具的 companion block。
- 还没有 boundary metadata、post-compact rehydration、session memory compact。
- boundary metadata、post-compact rehydration、`/context` diagnostics 已经补到第一版，但仍然离 Claude Code 的成熟分层体系有差距。
