# Formax Microcompact TODO

更新时间：2026-04-03

## 这一版已经有了什么

- 已新增最小版 `microcompact`：`packages/core/src/chat/context/microCompact.ts`
- 已挂到统一协调层：`packages/core/src/features/repl/controller/send/contextCompressionService.ts`
- 当前会在这些阶段生效：
  - `prepareHistoryForTurn(...)`
  - `finalizeHistoryAfterTurn(...)`
- 当前只处理旧的、较大的、可重取的 tool result：
  - `Read`
  - `Grep`
  - `Glob`
- 当前默认策略：
  - 保留最近 3 个符合条件的原始 tool result
  - 更早的结果替换成短 stub
  - 小结果不压
  - `is_error: true` 的结果不压
  - `Bash` / `WebFetch` 默认不压，避免把不可稳定重放的证据过早丢掉
- 已新增 `/context` 诊断入口：
  - 会输出 system / history / tool_result 的近似占用
  - 会输出当前 snapshot 中的 microcompacted 条数
  - 会输出按 tool name 的结果分布概览

## 这一版故意还没做的

### 1. 自适应策略

- 还没有根据 token 压力动态决定“压多少”
- 还没有按 tool 类型配置不同保留数量
- 还没有按结果大小、时间远近、是否刚被引用来打分

### 2. 更丰富的 stub

- 现在的 stub 只保留最小摘要，例如：
  - `Read /repo/src/auth.ts`
  - `Grep "login" in /repo/src`
- 还没有保留：
  - Grep 命中数量
  - 行号范围

### 3. 更完整的覆盖范围

- 现在只压 `tool_result` block 本体
- 还没有处理：
  - 某些 tool result 后面的附加 text block
  - 更复杂的多 block 输出形态
  - 可能同样很大的非 tool text 历史
  - `Bash` / `WebFetch` 这类低重放性结果的安全压缩策略

### 4. 可观测性 / 诊断能力

- `/context` 已有第一版，但还不够细
- 还没有真正的 turn-level microcompact 命中统计
- 还没有 debug 开关去显示“本轮压了几条、压了哪些工具”
- 还没有 per-message / per-tool-result 的排行视图
- 还没有 web/app-server 路径下的 `/context`

### 5. Claude Code 级完整压缩体系

- 还没有 compact boundary metadata
- 还没有 post-compact rehydration
- 还没有 session memory compact
- 还没有 partial compact
- 还没有 provider-native context management 对接

## 推荐的下一步顺序

1. 给 `microcompact` 增加简单 metrics
   - 至少返回 `compactedBlocks`、`compactedToolNames`
2. 丰富 `Read` / `Grep` / `Glob` 的 stub 信息
   - 让压缩后的历史更可读
3. 给 `/context` 增加更细的排行和命中统计
   - 例如 top tool_result contributors、最近被 microcompact 的工具类型
4. 专门设计 `Bash` / `WebFetch` 的安全策略
   - 先定义哪些结果可视为“可重放”，哪些必须保留原文
5. 评估是否把 `/context` 带到 web/app-server
   - 避免只有 TUI 能看诊断
6. 评估是否要压附加 text block
   - 尤其是大型工具输出后的跟随文本
7. 再考虑更高阶能力
   - boundary
   - rehydrate
   - session memory compact
