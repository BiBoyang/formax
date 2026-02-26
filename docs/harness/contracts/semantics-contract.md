# 项目语义合同（唯一事实源）

最后更新：2026-02-27  
状态：规范性（Normative）

本文档定义 Formax 项目级语义化（semantics）的唯一事实来源与跨端约束。

范围：
- canonical event envelope 与事件语义
- projection（语义状态）与 renderer（展示）分层边界
- TUI / app-server / Web 的跨端一致性约束
- realtime 与 replay 一致性约束

不在范围内：
- 具体 UI 视觉样式（颜色、间距、字号）
- 单端交互细节（键位提示文案、按钮文案）
- 非语义层的实现细节优化

相关文档（信息性镜像）：
- `docs/harness/contracts/app-server-interaction-contract.md`
- `docs/harness/frontend/app-server-ui-spec.md`
- `docs/harness/references/app-server-api-reference.md`
- `docs/harness/design/semantics-architecture-blueprint.md`

规范关键字约定：
- `MUST`、`SHOULD`、`MAY` 采用 RFC 2119 语义。

## 1. 语义权威源

`SEM-001`  
项目语义权威定义 MUST 位于 `src/features/semantics/*`，尤其是：
1. `src/features/semantics/core/canonicalEvents.ts`
2. `src/features/semantics/projection/transcriptProjection.ts`
3. `src/features/semantics/runtime/inputStateMachine.ts`
4. `src/features/semantics/runtime/threadRuntimeState.ts`

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

## 3. 一致性与不变量

`SEM-201`  
同一语义事件序列下，realtime 与 replay 的结果 MUST 一致（允许诊断字段差异，不允许语义结构差异）。

`SEM-202`  
`replaySeq` MUST 作为跨端主排序键，客户端不得退化为本地时间排序主导。

`SEM-203`  
Single-writer 约束 MUST 保持：业务流程不得绕开 canonical/projection 直接写 transcript 真值。

`SEM-204`  
语义终态（如 turn/tool 终态）MUST NOT 被后续非权威事件降级覆盖。

## 4. 变更流程（强约束）

当变更语义行为（event mapping / projection / runtime state）时：
1. 先更新本文件。
2. 再更新 `src/features/semantics/*` 与对应 adapter。
3. 同步更新 `docs/harness/contracts/app-server-interaction-contract.md`、`docs/harness/frontend/app-server-ui-spec.md`、`docs/harness/references/app-server-api-reference.md` 的摘要描述（只做链接与摘要，不复制完整语义）。
4. 在 `docs/harness/learnings/` 记录学习条目或变更决策（必要时再关联 `plans/app-server/` 执行文档）。

## 5. 一致性测试映射

主测试集：
1. `src/features/semantics/__tests__/*`
2. `src/features/semantics/*.test.ts`
3. `src/app-server/*.test.ts`（涉及 notification/replay/input lifecycle）
4. `apps/web-reference-react/src/App.test.tsx`
5. `apps/web-reference-react/src/store.test.ts`

辅助门禁：
1. `bun run test:repl-semantic-gate`
2. `bun run check:repl-single-writer`

若实现与本合同冲突，应视为实现漂移并立即收敛修正。
