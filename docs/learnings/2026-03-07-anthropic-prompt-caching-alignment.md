# 2026-03-07 - Anthropic Prompt Caching 对齐（CC 风格）

## Context

在对齐 Claude Code（CC）抓包时，发现我们对 `cache_control: { type: 'ephemeral' }` 的放置不稳定：

- 一些注入块在构造阶段就带了 `cache_control`
- 不同入口（REPL / 预览脚本 / app-server / SDK）容易出现位置不一致
- `prompt-caching-scope-2026-01-05` 之前还和 thinking 逻辑绑定，不利于独立排查

目标是收敛为一套稳定、可验证、可迁移的布局规则。

## Final Rules（当前实现）

Anthropic 请求发送前统一归一化为：

1. `system` 中所有 `type='text'` block 都带 `cache_control: { type: 'ephemeral' }`
2. `messages` 先清空已有 `cache_control`
3. 只给“最新 2 条非空 message”的“最后一个 content block”打 `cache_control: { type: 'ephemeral' }`
4. 其它 message block 一律不带 `cache_control`

这套规则由传输层兜底，避免上游注入逻辑分散打点导致漂移。

## Code Landing

- 归一化核心：
  - `packages/core/src/streaming/anthropic/promptCachingLayout.ts`
- 请求发送前统一应用：
  - `packages/core/src/streaming/anthropic/StreamClient.ts`
- 预览脚本同样应用（便于“只构造请求不真实发送”时看到最终形态）：
  - `scripts/repl-request-preview.ts`
  - `scripts/request-toolsearch-alignment.ts`
- 对齐检查器：
  - `scripts/check-cache-control-alignment.ts`
  - `bun run request:check:cache-control -- --dir <traffic-log-dir>`

## Header Strategy（与 thinking 解耦）

`anthropic-beta` 改为两层：

- Base（默认发送）：
  - `claude-code-20250219`
  - `prompt-caching-scope-2026-01-05`
  - `effort-2025-11-24`
- Thinking（仅启用 thinking 时附加）：
  - `adaptive-thinking-2026-01-28`

失败回退策略：

1. thinking 字段被拒绝：去掉 thinking 重试（保留 base beta）
2. beta header 被拒绝：再去掉 `anthropic-beta` 重试

这样把“prompt caching scope 能力”从“thinking 是否开启”中拆开，便于兼容中转层。

## Why This Shape

1. CC 抓包观察到的模式更接近“系统块 + 近期消息尾块”断点，而不是历史全量断点
2. 传输层统一归一化可以容忍上游模块继续按旧习惯写 `cache_control`
3. 预览脚本和真实发送共用同一规则，降低“预览看起来对、线上发出去不对”的风险

## Validation Workflow

1. 生成请求快照（不真实请求）：
   - `bun run request:preview -- --text "执行下 pwd"`
2. 校验缓存断点布局：
   - `bun run request:check:cache-control -- --dir proxy/request-preview/<traffic-log-dir>`
3. ToolSearch 两回合对齐（可选）：
   - `bun run request:align:toolsearch -- --tool Bash`

## Notes / Follow-up

1. 这是“布局收敛”，不是“缓存收益最大化调参”；后续可再调断点数量或策略。
2. 现阶段先以 Anthropic 路径为准；若后续需要跨 provider 统一缓存语义，再抽象一层 provider policy。
3. 抓包证据在本地 `proxy/traffic-log-*`，不入库；此文只记录可复现规则和代码落点。
