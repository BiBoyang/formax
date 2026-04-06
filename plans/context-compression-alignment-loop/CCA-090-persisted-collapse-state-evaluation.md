# CCA-090 - Persisted Collapse State / Store Evaluation

Date: 2026-04-07
Status: evaluated

## Question

在已经具备下面这些能力之后，Formax 是否值得继续上“最小 persisted collapse state/store”？

- request-time collapse MVP
- collapse impact diagnostics
- runtime collapse state plumbing
- `request_collapse_applied` session event
- shared latest/inspection helpers
- `thread/read` / `thread/messages` latest collapse summary surface

## Current state

当前已经有两层 persisted collapse facts：

1. **event layer**
   - session JSONL 中的 `request_collapse_applied`
   - 保留真实发生时间、phase、token 节省量、最小 recap metadata

2. **summary/helper layer**
   - `readLatestRequestCollapseEventFromSession(...)`
   - `inspectRequestCollapseEventsFromSession(...)`
   - `ThreadStore.inspectThreadRequestCollapse(...)`
   - `thread/read.latestRequestCollapse`
   - `thread/messages.latestRequestCollapse`
   - `/context.latestRequestCollapse`

## Evaluation

### 1. 现有 event + helper 是否已经够用？

**结论：当前阶段够用。**

原因：
- 最近一次 collapse 事实已经能被 runtime、diagnostics、app-server 和 thread surfaces 消费
- inspection 需求已经能回答：
  - 最近一次 collapse 是什么时候、属于哪个 phase
  - 一共发生了多少次
  - 累计节省了多少 token
- 这些能力都建立在 append-only session events 之上，风险低、语义清楚

### 2. 是否已经需要 archived spans / collapse commits？

**结论：现在还不需要。**

原因：
- request-time collapse 仍然是 projection，不是 persisted history rewrite
- 当前还没有强需求要求：
  - replay-time 重建 collapsed projection
  - persisted archived span identity
  - multi-collapse stack / commit chain
- 过早引入 store 会显著提高：
  - restore 复杂度
  - replay 协议复杂度
  - cross-surface state drift 风险

### 3. replay / restore / diagnostics 是否已经有明确消费需求？

**结论：有消费需求，但还没到必须上 store。**

当前更合理的路径是：
- 继续消费 persisted events / latest summary / inspection helper
- 先观察：
  - thread surfaces 是否还需要 richer collapse state
  - replay tooling 是否真的需要“重建 collapsed projection”而不是只看事实摘要

## Decision

### 当前决策

**NO-GO for full persisted collapse store**

当前不推进：
- archived collapse spans
- persisted collapse commits
- replay-time collapse projection rebuild

### 当前推荐

继续维持并扩展：
- append-only `request_collapse_applied` event
- latest summary helper
- inspection helper
- thread/read + thread/messages 最小摘要 surface

## Re-open triggers

只有在下面任一情况出现时，才重新打开 persisted collapse store 设计：

1. 需要在 replay / restore 中重建历史 collapse projection，而不仅是展示最近事实摘要
2. 需要在客户端展示多次 collapse timeline / commit chain
3. 需要 archived span identity 来支持 richer debugging 或 UI diff
4. 现有 latest/inspection helper 无法再满足跨 surface 消费

## Practical takeaway

这意味着下一阶段更应该投资在：
- 更好的 collapse inspection / UI 消费
- richer thread surface parity
- diagnostics 与 thread surfaces 的一致性

而不是急着把 request-time collapse 升级成完整 persisted store。
