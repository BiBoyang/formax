# 项目语义合同（唯一事实源）

最后更新：2026-06-01  
状态：规范性（Normative）

本文档定义 Formax 项目级语义化（semantics）的唯一事实来源与跨端约束。

范围：
- canonical event envelope 与事件语义
- projection（语义状态）与 renderer（展示）分层边界
- thread runtime side state（mode、pending input、sticky tool names、runtime preferences）
- TUI / app-server / Web 的跨端一致性约束
- realtime 与 replay 一致性约束

不在范围内：
- 具体 UI 视觉样式（颜色、间距、字号）
- 单端交互细节（键位提示文案、按钮文案）
- 非语义层的实现细节优化

相关文档（信息性镜像）：
- `docs/contracts/app-server-interaction-contract.md`
- `docs/frontend/app-server-ui-spec.md`
- `docs/references/app-server-api-reference.md`
- `docs/design/semantics-architecture-blueprint.md`

规范关键字约定：
- `MUST`、`SHOULD`、`MAY` 采用 RFC 2119 语义。

## 1. 语义权威源

`SEM-001`  
项目语义权威定义 MUST 位于 `packages/core/src/features/semantics/*`，尤其是：
1. `packages/core/src/features/semantics/core/canonicalEvents.ts`
2. `packages/core/src/features/semantics/projection/transcriptProjection.ts`
3. `packages/core/src/features/semantics/runtime/inputStateMachine.ts`
4. `packages/core/src/features/semantics/runtime/threadRuntimeState.ts`

`SEM-002`  
TUI / app-server / Web MUST 共享同一语义模型；端内仅允许做 renderer 或交互适配，不得发明新的语义状态机分支。

## 2. 分层合同

`SEM-101` Event Layer  
输入（stream event / turn notification / replay record）MUST 先映射为 canonical event，再进入 projection。

`SEM-102` Projection Layer  
Projection MUST 作为语义真值的纯投影层；不得引入 UI 偏置逻辑。

`SEM-103` Selector Layer  
Selector MAY 产出端内 view model，但 MUST NOT 回写或修改 projection state。

`SEM-104` Renderer Layer  
Renderer MUST 只负责展示，不承担语义纠偏与状态修复职责。

`SEM-105` Runtime Side State  
`ThreadRuntimeState` MUST own per-thread runtime side state that is semantically shared across app-server and Web but is not transcript content. Current facets include mode, active/last turn status, pending inputs, sticky tool names, and `preferences`.

`SEM-106` Thread Runtime Preferences  
Thread runtime preferences MUST be represented as the `preferences` facet of `ThreadRuntimeState`. The v1 reduced shape is sparse:
1. `modelTier?: "haiku" | "sonnet" | "opus"`
2. `thinkingMode?: boolean`
3. `thinkingEffort?: "low" | "medium" | "high" | "xhigh" | "max"`

Omitted fields mean “inherit effective global/project/env config”. Reduced state MUST NOT store `null`; `null` is reserved for raw patch input to clear an override. `thinkingMode` controls whether thinking is enabled; `thinkingEffort` is a durable latent preference and MUST NOT be cleared when `thinkingMode` is set to `false`.

`SEM-107` Runtime Preferences Are Not Projection  
Preference changes MUST NOT create canonical transcript events, projection segments, history rows, or renderer log rows. They MAY update runtime-state caches and diagnostics only.

`SEM-108` Closed v1 Runtime-State Patch Facet  
The generic runtime-state patch lane is closed in v1: only the `preferences` facet is patchable. Mode, active turn state, pending inputs, sticky tool names, replay cursor state, transcript projection, and future facets MUST NOT become patchable until each has its own contract, reducer, persistence schema, replay/read/resume surface, and tests.

## 3. 一致性与不变量

`SEM-201`  
同一语义事件序列下，realtime 与 replay 的结果 MUST 一致（允许诊断字段差异，不允许语义结构差异）。

`SEM-202`  
`replaySeq` MUST 作为跨端主排序键，客户端不得退化为本地时间排序主导。

`SEM-203`  
Single-writer 约束 MUST 保持：业务流程不得绕开 canonical/projection 直接写 transcript 真值。

`SEM-203A`
GUI MAY render a local pending user row immediately after submit, but that row is renderer-side pending state, not projection truth. For app-server turns, clients SHOULD send `turn/start.input.clientMessageId`; app-server MUST echo it on `turn/started.input.clientMessageId`; canonical `user_message` MUST preserve it so renderers can replace the pending row with the canonical row instead of showing duplicates.

`SEM-204`  
语义终态（如 turn/tool 终态）MUST NOT 被后续非权威事件降级覆盖。

`SEM-205`  
Runtime side-state notifications MUST honor `replaySeq` monotonicity. Older or duplicate runtime-state notifications MUST NOT overwrite newer per-thread preferences.

## 4. 变更流程（强约束）

当变更语义行为（event mapping / projection / runtime state）时：
1. 先更新本文件。
2. 再更新 `packages/core/src/features/semantics/*` 与对应 adapter。
3. 同步更新 `docs/contracts/app-server-interaction-contract.md`、`docs/frontend/app-server-ui-spec.md`、`docs/references/app-server-api-reference.md` 的摘要描述（只做链接与摘要，不复制完整语义）。
4. 在 `docs/learnings/` 记录学习条目或变更决策。

## 5. 一致性测试映射

主测试集：
1. `packages/core/src/features/semantics/__tests__/*`
2. `packages/core/src/features/semantics/*.test.ts`
3. `packages/core/src/app-server/*.test.ts`（涉及 notification/replay/input lifecycle）
4. `packages/web-reference-react/src/App.test.tsx`
5. `packages/web-reference-react/src/store.test.ts`

辅助门禁：
1. `bun run test:repl-semantic-gate`
2. `bun run check:repl-single-writer`

若实现与本合同冲突，应视为实现漂移并立即收敛修正。
