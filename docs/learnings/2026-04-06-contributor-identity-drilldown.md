# Contributor Identity Drill-Down

日期：2026-04-06

## 背景

`/context` 之前已经有 `topSnapshotContributors`、`systemSectionBreakdown`、`topAssembledContributors`，但 contributor 只有：

- `label`
- `tokens`

这足够给人看，却不够给客户端或调试工具做稳定 drill-down。  
一旦 `label` preview 文案变化，客户端就只能重新猜“这是哪条 message / 哪个 tool result / 哪个 system section”。

## 这次收敛出的规则

本轮把 contributor payload 升级成“可读 label + 稳定 identity”双轨结构：

- `kind`
- `key`
- `label`
- `tokens`

并按类型额外补这些字段：

- message contributor
  - `role`
  - `ordinal`
- tool-result contributor
  - `role`
  - `ordinal`
  - `toolUseId`
  - `toolName`
- system-section contributor
  - `systemSectionKey`

## 为什么这样做

目标不是把 text diagnostics 改成机器格式，而是：

1. 保持 text diagnostics 继续面向人类可读
2. 让 JSON diagnostics / app-server payload / Web parser 拥有稳定 identity
3. 避免客户端反解析 `label`

## 当前 key 语义

- system section
  - `system_section:<sectionKey>`
- message
  - `message:<role>:<ordinal>`
- tool result
  - `tool_result:<toolUseId>:<blockIndex>`
  - 若缺少 `toolUseId`，退化为 `tool_result:unknown:<ordinal>:<blockIndex>`
- fixed group
  - `fixed_group:<index>:<sanitized-label>`

这些 key 当前只承诺“在 diagnostics payload 内稳定、可用于 drill-down”，
还不承诺跨历史重写、跨 replay 重建后的永久全局 identity。

## 额外的小收敛

contributor 排序的 tie-break 现在优先使用 `key`，再回退到 `label`。  
这样在 token 相同的情况下，payload 和 text diagnostics 的顺序会更稳定。
