# Anthropic thinking tool-use turns must survive terminal prune

日期：2026-05-24

## 背景

Subagent 长工具链在 GUI 中完成大量读取和搜索后，末尾出现：

`The content[].thinking in the thinking mode must be passed back to the API.`

这不是 GUI 渲染问题，也不是 subagent approval 卡住。工具执行已完成，失败发生在后续模型请求构造阶段。

## 关键观察

- Anthropic extended thinking 与 tool use 组合时，工具回合里的 `thinking` block（含 `signature`）必须随对应 `tool_use` / `tool_result` 链路回传。
- API 还可能返回 `redacted_thinking`，它也是协议块，不能因为不是可读 `thinking` 就过滤掉。
- `pruneForPromptBudget()` 的 essential-tail 路径原本把 assistant 消息裁成仅保留 `tool_use`，这能保持 tool_use/tool_result 成对，但会破坏 Anthropic thinking 工具回合的更强协议不变量。
- no-thinking fallback payload 必须同时去掉历史 `thinking` 和 `redacted_thinking`，否则“关闭 thinking”与“历史仍含 thinking block”会形成不一致请求。

## 决策

- `prune` 在保留 assistant `tool_use` 时，也保留同一 assistant turn 的 `thinking` 与 `redacted_thinking`。
- Anthropic SSE parser round-trip `redacted_thinking`，避免安全红acted reasoning 被静默丢弃。
- Anthropic no-thinking payload strip 同时覆盖 `thinking` 与 `redacted_thinking`。
- no-thinking 请求在 terminal prune 预算估算前也剥离 request-only thinking blocks，避免为了后续不会发送的 opaque reasoning 丢弃有用上下文。

## 测试映射

- `packages/core/src/chat/context/prune.test.ts`：锁定 terminal prune 后仍保留 thinking 协议伴随块。
- `packages/core/src/streaming/anthropic/sseParser.test.ts`：锁定 `redacted_thinking` parser round-trip。
- `packages/core/src/streaming/anthropic/StreamClient.test.ts`：锁定 no-thinking 与 retry-no-thinking payload 不残留 thinking blocks。
