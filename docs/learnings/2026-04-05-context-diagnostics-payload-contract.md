# 2026-04-05 context diagnostics payload contract

## 背景

`/context` 这条线已经先后补了：

1. text diagnostics
2. `--json`
3. app-server `local.diagnostics`

但在这一步之前，Web 客户端对 `local.diagnostics` 的消费仍然偏“宽松对象解析”：

- 只认 `kind`
- 只认 `schemaVersion`
- `snapshot` / `nextTurnFixed` 只是 `Record<string, unknown>`

这会带来一个问题：

> payload 虽然存在，但客户端很难真正把它当成稳定协议来依赖。

## 这次做了什么

这轮把 `local.diagnostics` 从“隐式 payload”提升成了正式消费契约：

1. app-server 合同明确写死了 `schemaVersion=1` 下的稳定字段
2. slash command 合同同步了 `/context` 的结构化 payload 约束
3. Web `rpcContracts.ts` 不再把它当 loose record，而是解析成稳定 typed shape
4. 若 `kind`、`schemaVersion` 或稳定字段不合法，客户端会把整个 diagnostics payload 视为不可用

## 为什么这一步重要

因为这一步之后，客户端终于可以理直气壮地依赖：

- `snapshot`
- `nextTurnFixed`
- `microCompactImpact`
- `latestCompactBoundary`

而不是继续写一堆“也许有、也许没有”的防御式临时逻辑。

## 一个重要取舍

这次没有把 schema 做成独立运行时 JSON Schema 文件，也没有引入跨 package 共享的 diagnostics-schema 库。

原因是当前最小收益比更高的做法是：

1. 先把 contract 文档写清楚
2. 先把 Web parser 收紧
3. 先让 `schemaVersion=1` 真正可依赖

等后面真的出现多客户端、多版本并存需求，再考虑抽成独立 schema artifact。

## 当前边界

这轮完成的是“正式消费契约”，不是 richer panel：

1. 还没有专门的 diagnostics UI panel
2. 还没有 per-system-section breakdown
3. 还没有 deeper contributor drill-down
4. 还没有 version-2 schema

## 结果

这一步之后，`CCA-072` 可以视为完成：

- server 产物有 canonical shape
- contract 有正式说明
- client parser 已按稳定字段消费
