# 2026-05-11 Assembled Payload Ledger

## Context

`/context` 已经能展示 snapshot、next-turn fixed totals、contributors、collapse impact、working-set signals，但仍然需要用户自己把多个分散字段拼成“最终发给模型的 assembled request payload 是由哪些固定部分组成”的账本。

## Decision

在 `nextTurnFixed` diagnostics 下新增稳定的 `assembledLedger`，而不是再造一套更重的 payload 模型。

当前 row 级稳定字段：
- `kind`
- `key`
- `label`
- `tokens`
- `messageCount?`
- `blockCount?`

当前 `kind`：
- `system_total`
- `request_history`
- `fixed_group`
- `fixed_total`
- `assembled_total`

## Why

这样可以直接回答：
1. 最终 request payload 里 system prompt 占多少
2. request history 在 microcompact/prune/collapse 后还剩多少
3. 各个 fixed group 各占多少
4. assembled total 到底是多少

同时保留现有：
- `topAssembledContributors`
- `collapseImpact`
- `workingSetSignals`

也就是：
- `assembledLedger` 负责回答“账本是什么”
- contributors / impacts 负责回答“为什么会这样”

## Consequences

优点：
- text / JSON / app-server / Web parser 可以共享同一稳定结构
- 不需要把 runtime payload 模型整体重写成更重的结构
- 后续如果要做 richer diagnostics UI，可以直接消费 `assembledLedger`

限制：
- 这仍然是 diagnostics ledger，不是 provider request 的完整逐字段镜像
- 不包含未来用户正文
