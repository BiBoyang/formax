# Context Strategy Stack 合同（唯一事实源）

最后更新：2026-05-11  
状态：规范性（Normative）

本文档定义 Formax query-time context middle layer 的唯一事实源。

范围：
- query-time middle-layer stages 的列表、角色与执行顺序
- stage 对 request projection / persisted history / assembled envelope 的作用域边界
- stage facts 的最小稳定语义
- `prune` 作为 terminal fallback 的角色约束

不在范围内：
- full compact / partial compact / reactive compact 的完整协议
- session memory schema 与 restore sidecar 语义
- Web / TUI 的具体显示样式
- 单个 strategy 的内部启发式参数细节

相关文档（信息性镜像）：
- `docs/contracts/slash-command-contract.md`
- `docs/contracts/app-server-interaction-contract.md`
- `docs/contracts/session-persistence-contract.md`
- `packages/core/src/chat/context/README.md`

相关实现（规范锚点）：
- `packages/core/src/chat/context/middleLayerStrategyStack.ts`
- `packages/core/src/chat/context/microCompact.ts`
- `packages/core/src/chat/context/toolResultBudget.ts`
- `packages/core/src/chat/context/snip.ts`
- `packages/core/src/chat/context/contextCollapse.ts`
- `packages/core/src/chat/context/prune.ts`
- `packages/core/src/features/repl/controller/send/contextCompressionService.ts`
- `packages/core/src/chat/context/contextDiagnostics.ts`

规范关键字约定：
- `MUST`、`SHOULD`、`MAY` 采用 RFC 2119 语义。

## 1. 权威模型

`CSS-001`  
query-time middle-layer strategy stack 的权威实现 MUST 位于 `packages/core/src/chat/context/middleLayerStrategyStack.ts`。

`CSS-002`  
runtime send-path 与 `/context` next-turn diagnostics MUST 复用同一 middle-layer stack owner；不得长期维持两套独立的 stage 串联逻辑。

`CSS-003`  
新增 middle-layer strategy 时，MUST 先在本合同中定义 stage 角色、顺序与作用域，再接入 runtime。

## 2. Stage 列表与角色

`CSS-101`  
当前 query-time middle-layer stages MUST 只包含以下五类：
1. `microcompact`
2. `tool_result_budget`
3. `snip`
4. `collapse`
5. `prune`

`CSS-102`  
每个 stage MUST 属于以下角色之一：
1. `budget_reducer`
2. `semantic_projection`
3. `terminal_fallback`

`CSS-103`  
当前 stage 角色 MUST 为：
1. `microcompact -> budget_reducer`
2. `tool_result_budget -> budget_reducer`
3. `snip -> budget_reducer`
4. `collapse -> semantic_projection`
5. `prune -> terminal_fallback`

`CSS-104`  
`prune` MUST NOT 被视为普通中途压缩步骤；它的规范角色是最终 hard cutoff / terminal fallback。

## 3. Stage 顺序

`CSS-201`  
当前 middle-layer stage 的规范执行顺序 MUST 为：
1. `microcompact`
2. `tool_result_budget`
3. `snip`
4. `collapse`
5. `prune`

`CSS-202`  
`budget_reducer` stages MUST 在 `semantic_projection` stage 之前执行。

`CSS-203`  
`terminal_fallback` stage MUST 在所有非 terminal stages 之后执行。

`CSS-204`  
未来新增 stage 时，若其目标是局部 request-time 降预算且尽量少改语义，SHOULD 归入 `budget_reducer` 并置于 `collapse` 之前；若其目标是请求视图重投影，SHOULD 归入 `semantic_projection`；若其目标是最后兜底硬裁剪，MUST 归入 `terminal_fallback`。

## 4. 作用域边界

`CSS-301`  
middle-layer stack MUST 区分以下三个 envelope：
1. `persisted_history_candidate`
2. `request_history_projection`
3. `assembled_request_envelope`

`CSS-302`  
`snip` 与 `collapse` MUST 只作用于 `request_history_projection`；MUST NOT 改写 persisted `history` 语义。

`CSS-303`  
`microcompact` 与 `tool_result_budget` 当前 SHOULD 被视为 request-time reducers；不得在没有显式合同变更的情况下引入 persisted-history mutation 语义。`microcompact` 当前只允许 Claude Code-aligned 子路径：cold-cache time-based content clearing 与 Anthropic cache-editing delete planning；这些子路径同样 MUST 保持 request-time reducer 语义，不得把“较旧结果更早 stub”扩展成 persisted baseline 改写。

`CSS-304`  
`prune` 的规范语义 MUST 是 terminal fallback：它的职责是保证最终 request-time payload 进入预算，而不是抢在前置 reducers/projection 之前充当普通变换步骤。

`CSS-305`  
若 stage 只影响 request-time projection，runtime 返回结构 MUST 能将其 effects 与 persisted `history` 基线分离表达；不得要求调用方从最终 history 倒推 request-only effects。

`CSS-305a`
request-time reducers MAY 产生 provider-specific request-envelope side-effect plan，例如 Anthropic cache editing 的 `cache_reference` / `cache_edits` delete plan。此类 plan MUST 只用于 assembled request/API payload projection；MUST NOT 被写回 persisted history，也 MUST NOT 改变 replay/session restore 的 authoritative transcript。若 request side-effect plan 无法被当前 provider/capability 消费，runtime MUST 能继续使用不依赖该 plan 的 request projection 或 fallback path。

`CSS-305b`
Claude Code-style time-based microcompact MAY run before cache-editing projection when main-thread Anthropic cache editing is enabled and the wall-clock gap since the last assistant message exceeds the configured prompt-cache TTL threshold. This path MUST treat the cache as cold: it MAY content-clear older compactable `tool_result` blocks in the request projection, MUST keep at least the most recent compactable tool result, and MUST NOT emit `cache_edits` for that same turn. Persisted history MAY carry assistant timestamp metadata needed to evaluate the wall-clock gap, but time-based tool-result clearing itself remains request-only.

`CSS-305c`
When Anthropic cache editing is unavailable and the cold-cache time-based trigger has not fired, `microcompact` MUST be a no-op. It MUST NOT fall back to Formax's legacy content-stub microcompact or user-turn-based stale-result compaction because changing a warm prompt prefix can reduce prompt-cache reuse. Context pressure in this case MUST be handled by later stack stages such as `tool_result_budget`, `snip`, `collapse`, `prune`, or full auto-compact.

`CSS-306`  
post-turn finalization、manual compact 后的 persisted baseline materialization、以及 reactive/auto compact 后的 persisted-history normalization SHOULD 复用 canonical middle-layer stack owner，而不是在调用侧继续手工串联 `microcompact` / `prune` helper。

`CSS-307`  
当 surrounding flow materialize future-turn persisted `history` 时，`prune` MUST NOT 被写回 persisted baseline。`prune` 只负责 `assembled_request_envelope` 的 terminal fallback；若调用方需要 future-turn baseline，MUST 取 canonical stack 暴露的 persisted-history candidate，而不是取 terminal-pruned request payload。

## 5. Stage Facts 合同

`CSS-401`  
middle-layer stack SHOULD 为每个 stage 暴露结构化 facts；这些 facts MUST 至少能表达：
1. `stage`
2. `role`
3. `scope`
4. `disposition`（`applied` / `skipped`）
5. `terminal`
6. `advisory`
7. `reason`
8. `estimatedTokensSaved`
9. `inputTokens`
10. `outputTokens`

`CSS-402`  
若 stage 被跳过，facts SHOULD 能表达 skip reason；若 stage 生效，facts SHOULD 能表达 apply reason 或触发依据。各派生 payload MAY 继续保留 strategy-specific impact 子对象，但 stage-level canonical facts MUST 以本合同字段为准。

`CSS-403`  
diagnostics / app-server / Web surface 对 middle-layer 的展示 SHOULD 优先消费 runtime 产生的 canonical stage facts，而不是各自重新推导另一套 stage 语义。

`CSS-404`  
若 diagnostics / app-server / Web surface 需要展示 stack-level control-plane summary，则该 summary MUST 建立在 canonical stage facts 之上；不得引入一套与 `stageOrder` / `role` / `scope` / `disposition` 不一致的独立推导逻辑。

## 6. 变更流程

`CSS-501`  
当以下任一内容变化时，必须先更新本合同，再更新实现：
1. stage 列表
2. stage 角色
3. stage 执行顺序
4. request-time 与 persisted-history 的作用域边界
5. stage facts 的稳定字段

`CSS-502`  
当 `/context`、app-server diagnostics、或 Web parity 需要消费新的 middle-layer facts 时，本合同 MUST 先记录 canonical stage 语义；派生文档只做链接和摘要，不得重定义核心角色与顺序。

## 7. 测试映射

主测试集：
1. `packages/core/src/chat/context/middleLayerStrategyStack.test.ts`
2. `packages/core/src/chat/context/contextDiagnostics.test.ts`
3. `packages/core/src/features/repl/controller/send/contextCompressionService.test.ts`

新增 stage 或修改 stage 顺序时，相关测试 SHOULD 至少覆盖：
1. stage order regression
2. request-only vs persisted-history 边界
3. terminal fallback (`prune`) 位置与角色
