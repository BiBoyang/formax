# 交互输入合同（唯一事实源）

最后更新：2026-06-12
状态：规范性（Normative）

本文档是 Formax 中交互输入行为的唯一事实来源（Single Source of Truth）。

范围：
- canonical 协议输入类型：`approval` / `ask_user_question`
- 语义交互入口与协议映射（含 `AskUserQuestion` / `EnterPlanMode` / `ExitPlanMode`）
- 交互 preflight 入口归类（含 policy approval 与 skill approval-like 现状）
- 覆盖 app-server、TUI、Web 共享的生命周期与提交语义
- Ink REPL active interactive prompt 的 bottom input surface 所有权

不在范围内：
- 非交互式 tool 输出渲染
- 通用 transcript 布局与样式
- 与交互输入无关的 slash command 行为

相关文档（信息性镜像）：
- `docs/contracts/app-server-interaction-contract.md`
- `docs/contracts/permissions-policy-contract.md`
- `docs/references/app-server-api-reference.md`
- `docs/frontend/app-server-ui-spec.md`
- `docs/inventories/interactive-input-inventory.md`

规范关键字约定：
- `MUST`、`SHOULD`、`MAY` 采用 RFC 2119 语义。

## 1. 规范模型（Canonical Model）

`interactive input` 是一个由 `inputId` 标识的 pending/resolve 生命周期对象。

类型（kind）：
1. `approval`
2. `ask_user_question`

生命周期状态：
1. pending
2. submitted
3. canceled
4. expired
5. failed

### 1.1 交互入口矩阵（语义层 -> 协议层）

`MATRIX-001`  
canonical 协议输入类型 MUST 仅包含以下两类：
1. `approval`
2. `ask_user_question`

`MATRIX-002`  
语义入口到协议层的映射 MUST 以如下矩阵为准：

| 语义入口 | 入口层级 | 主实现路径（规范锚点） | 触发事件 | 协议 `input.kind` | 提交载荷 |
|---|---|---|---|---|---|
| policy / workspace approval | preflight | `packages/core/src/tools/executor/policyPreflight.ts` + `packages/core/src/tools/executor/approvalService.ts` | `approval_request` | `approval` | `approve / approve_remember / feedback / cancel` |
| `Skill` preflight approval | preflight | `packages/core/src/tools/executor/skillPreflight.ts` | `approval_request` | `approval` | `approve / approve_remember / feedback / cancel` |
| `AskUserQuestion` tool | tool handler | `packages/core/src/tools/modules/askUserQuestion/handler.ts` | `ask_user_question` | `ask_user_question` | `Record<string,string>` |
| `EnterPlanMode` tool | tool handler | `packages/core/src/tools/modules/enterPlanMode/handler.ts` | `ask_user_question` | `ask_user_question` | `Record<string,string>`（典型字段：`choice`） |
| `ExitPlanMode` tool | tool handler | `packages/core/src/tools/modules/exitPlanMode/handler.ts` | `ask_user_question` | `ask_user_question` | `Record<string,string>`（典型字段：`choice`/`feedback`） |

`MATRIX-003`  
`EnterPlanMode` / `ExitPlanMode` MUST 视为“plan-mode 语义交互入口”，它们在协议层 MUST 归一到 `ask_user_question`，不得新增第三种协议 `kind`。

### 1.2 共享编排实现约束（防漂移）

`MATRIX-201`  
`AskUserQuestion` / `EnterPlanMode` / `ExitPlanMode` 这三条 `ask_user_question` 语义入口 MUST 复用同一事务编排主路径：
1. `packages/core/src/tools/runtime/interactivePromptTransaction.ts`
2. `packages/core/src/tools/runtime/askUserQuestionPrompt.ts`

`MATRIX-202`  
上述三条入口在 handler 层 SHOULD 优先使用 `requestAskUserQuestionAnswersResult` 的 `ok/result` 显式分支；若需要抛错语义，MAY 使用 `requestAskUserQuestionAnswers` 包装层，但不得自行重复实现 `Error:` 前缀解析。

`MATRIX-203`  
approval-like 入口（policy approval + skill approval）MUST 复用：
1. `packages/core/src/tools/executor/approvalLikePrompt.ts` 的 `promptForApprovalLikeAnswer`
2. `packages/core/src/tools/executor/approvalLikePrompt.ts` 的 `resolveApprovalLikeOutcome`

`MATRIX-204`  
交互入口层（tool handler / preflight）MUST NOT 各自重写以下规范化逻辑：
1. 决策字符串标准化（如 `decision` 大小写/空白处理）
2. rejection 文案构建（`Tool use rejected ...`）
3. 交互失败 `ToolResult.content` 到最终错误文本的前缀处理

### 1.3 Skill preflight 协议化规则

`MATRIX-101`  
`Skill` preflight（`packages/core/src/tools/executor/skillPreflight.ts`）在需要人工确认时 MUST 发出 `approval_request` 事件，并进入 canonical `approval` 输入生命周期（`turn/inputRequested` -> `turn/inputResolved`）。

`MATRIX-102`  
`Skill` preflight 的 approval payload SHOULD 使用 `toolName='Skill'` 与 `action.kind='skill.use'`，用于 renderer 在不引入 policy-scope 语义的前提下渲染审批流程。

## 2. 生命周期规则

以下规则针对 canonical 协议输入（`approval` / `ask_user_question`）。

`INPUT-001`  
每个 pending input MUST 来源于 `turn/inputRequested`。

`INPUT-002`  
每个 pending input MUST 最终通过 `turn/inputResolved` 收敛为且仅为一个终态。

`INPUT-003`  
进入终态后，后续 submit 尝试 MUST NOT 被当作新的 pending 提交接受。

`INPUT-004`  
客户端渲染 MUST 由生命周期状态驱动，不能依赖临时的本地布尔开关。

## 3. Approval 合同

支持的决策载荷：
1. `approve`
2. `approve_remember`
3. `feedback`（且 `feedback` 非空）
4. 拒绝路径（`cancel` 或 renderer 本地别名，如 `reject`）

`APPROVAL-001`  
Renderer 的视觉流程 MAY 不同（单步或多步），但提交后的决策语义 MUST 等价。

`APPROVAL-002`  
`approve_remember` MAY 包含 `scope`（`session|project|global`）。  
若缺失，服务端处理默认 `session`。

`APPROVAL-003`  
来自 renderer 的拒绝别名（如 `reject`）MUST 被服务端逻辑解释为拒绝/取消语义。

`APPROVAL-004`  
任何 renderer 变更都不能改变 app-server preflight/policy 语义。

`APPROVAL-005`  
renderer 变更 MUST NOT 改变 permissions/policy 的 canonical 结果；allow/ask/deny、remember、workspace 边界语义由 `docs/contracts/permissions-policy-contract.md` 所有。

### 3.1 Remember 语义归属

`approve_remember` 的语义结果、scope 生效范围、workspace allow 与 `acceptEdits` side effects 的唯一事实源为：`docs/contracts/permissions-policy-contract.md`。

本文件只约束 approval payload 形状与提交语义，不重复完整 policy semantics。

### 3.2 Scope 提示适用规则（Web Reference UI 规则）

当前 Web reference 规则：
1. `bash.exec`：不出现 scope 步骤
2. `fs.write`：不出现 scope 步骤
3. 带 `workspaceRequest.dir` 的 `fs.read`：不出现 scope 步骤
4. `skill.use`（或 `toolName='Skill'`）：不出现 scope 步骤
5. 其他支持 policy-scope 的 action：出现 scope 步骤
6. 缺失 `action.kind`：出现 scope 步骤（保守回退）

这属于 renderer 行为。最终语义结果由 `docs/contracts/permissions-policy-contract.md` 约束。

## 4. Ask User Question 合同

`ASK-001`  
提交载荷 MUST 保持为 `Record<string, string>`。

`ASK-002`  
当 `multiSelect=true` 时，翻页或提交前 MUST 至少选择 1 项。

`ASK-003`  
多选最终提交值 MUST 使用逗号分隔文本，并与现有 tool answer 解析语义兼容。

`ASK-004`  
`1 of N` 表示单个 input 内的问题分页，不是 pending input 队列分页。

## 5. Renderer 行为合同（TUI/Web）

`RENDER-001`  
TUI 与 Web MUST 共享同一生命周期与提交语义。展示与导航 MAY 不同。

`RENDER-002`  
Web approval input 采用 dock 且为会话级非模态；approval pending 期间 MUST 允许切换 session。

`RENDER-003`  
切换到无 pending input 的 session 时，Web dock MUST 隐藏。

`RENDER-004`  
TUI MAY 保持单步 confirm-menu；Web MAY 使用多步流程。

`RENDER-005`  
视觉密度或卡片尺寸调整 MUST NOT 改变 payload 形状与决策语义。

### 5.1 Ink REPL Active Prompt Surface

`RENDER-101`
Ink REPL MUST render at most one active interactive prompt at a time. The active prompt MUST be the FIFO head descriptor exposed by `UserInputManager.getActivePrompt()`.

`RENDER-102`
Ink REPL MUST render the active interactive prompt in the REPL bottom prompt slot, after transcript rows and before the ordinary `InputBar`. While an active prompt descriptor exists, the ordinary `InputBar` MUST be hidden.

`RENDER-103`
Ink REPL MUST NOT derive the active prompt by reverse-scanning visible transcript rows. Transcript rows MAY show tool status, summaries, and non-interactive previews, but the active decision/input controls are owned by the bottom prompt slot.

`RENDER-104`
Descriptor-less `requestAnswers` callers MAY remain supported for tests or non-rendering legacy callers, but they MUST NOT drive the Ink REPL bottom prompt slot.

`RENDER-105`
Renderer hints such as `descriptor.ui.promptVariant` MAY guide component selection, but canonical `requestEvent`, `action`, and `toolName` remain the semantic source for payload handling.

`RENDER-106`
Any production Ink REPL interactive path that expects bottom-slot rendering MUST pass a valid `InteractivePromptDescriptor` into `requestAnswers(...)`. Descriptor-less `requestAnswers(...)` remains allowed only for tests, non-rendering callers, or explicitly legacy-compatibility callers.

`RENDER-107`
`ask_user_question` MUST be treated as a protocol/lifecycle family, not a single UI family. Renderer/domain families under that protocol MAY include generic ask-user form rendering, `EnterPlanMode`, and `ExitPlanMode`, but they MUST continue to share the canonical `ask_user_question` protocol kind.

`RENDER-108`
Domain prompt variants that require snapshot data MUST bind `descriptor.ui.promptVariant` to `descriptor.promptData.kind`. In particular, `exit_plan_mode` bottom-slot descriptors MUST include `promptData.kind='exit_plan_mode'` plus the loaded/error `planContentState` snapshot required for rendering.

`RENDER-109`
When UI code needs to know whether a pending request is the currently renderable prompt, it SHOULD use the explicit active-prompt query (`isActivePrompt`) when available instead of overloading lifecycle-pending checks. In Phase 1, provider-wrapped `isPending` MAY remain as a compatibility alias for active-render guards, but new or migrated transcript-inline compatibility paths SHOULD prefer the explicit active query.

## 6. Web Dev Runtime Helper 合同

`DEV-001`  
在 dev runtime 中，注册以下 helper：
1. `window.__formaxDevAskUserQuestion`
2. `window.__formaxDevApprovalInput`
3. `window.__formaxDevClearPendingInputs`

`DEV-002`  
`__formaxDevAskUserQuestion` 与 `__formaxDevApprovalInput` MUST 触发：
1. `input_requested`
2. `set_selected_input`

`DEV-003`  
在 unmount/disable 时，helper 清理 MUST 从 `window` 移除全部相关函数。

`DEV-004`  
默认 fallback 行为（thread/turn/tool id、时间戳、过期窗口）MUST 保持可预测且由测试覆盖。

## 7. 一致性测试映射（Conformance Test Map）

本合同的主测试集：
1. `packages/web-reference-react/src/app/runtime/useDevRuntimeApi.test.tsx`
2. `packages/web-reference-react/src/components/InputApprovalDock.test.tsx`
3. `packages/web-reference-react/src/App.test.tsx`
4. `packages/core/src/tools/executor/approvalService.test.ts`
5. `packages/core/src/tools/executor/policyPreflight.test.ts`
6. `packages/core/src/components/tool/*approvalPrompt.test.tsx`
7. 与 `packages/core/src/components/tool/AskUserQuestionToolBlock.tsx` 相关的 presenter 测试
8. `packages/core/src/tools/runtime/userInputManager.test.ts`
9. `packages/core/src/screens/repl/ActivePromptSlot.test.tsx`
10. `packages/core/src/screens/REPL.coverage.test.tsx`

## 8. 变更控制

当变更以下任一行为时：
1. `approval` / `ask_user_question` 生命周期与提交语义
2. `AskUserQuestion` / `EnterPlanMode` / `ExitPlanMode` 到协议 `kind` 的映射
3. `Skill` preflight 的 approval payload 形状或协议映射（`approval_request` / `action.kind='skill.use'`）
4. Ink REPL active interactive prompt ownership or bottom-slot placement

必须：
1. 先更新本文件。
2. 在同一变更中更新实现与测试。
3. 将 `docs/contracts/app-server-interaction-contract.md`、`docs/references/app-server-api-reference.md`、`docs/frontend/app-server-ui-spec.md` 保持为摘要 + 链接，不重复完整语义。
4. 对行为对齐变更，在 `docs/learnings/` 下补充一条简短学习记录。

若实现与本合同冲突，应视为实现漂移并立即收敛修正。
