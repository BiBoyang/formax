# 交互输入合同（唯一事实源）

最后更新：2026-02-26  
状态：规范性（Normative）

本文档是 Formax 中交互输入行为的唯一事实来源（Single Source of Truth）。

范围：
- `approval`
- `ask_user_question`
- 覆盖 app-server、TUI、Web 共享的生命周期与提交语义

不在范围内：
- 非交互式 tool 输出渲染
- 通用 transcript 布局与样式
- 与交互输入无关的 slash command 行为

相关文档（信息性镜像）：
- `docs/contracts/app-server-interaction-contract.md`
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

## 2. 生命周期规则

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
通过 `.formax/settings.local.json` 与 `permissions.allow` 的自然传播 MUST 保持由服务端/preflight 所有，且 MUST NOT 通过仅 renderer 代码打补丁实现。

### 3.1 Remember 行为矩阵（语义效果）

| Action 类别 | Remember 效果 |
|---|---|
| `bash.exec` | 持久化仓库本地 allow key（permissions allow list） |
| `fs.write` | 切换到会话级 edit-accept 模式（`acceptEdits`） |
| 带 `workspaceRequest.dir` 的 `fs.read` | 会话/工作区目录级 allow 行为，不做全局 policy rule 持久化 |
| 其他 policy action | 走 session/project/global policy rule 路径 |

说明：
- 该矩阵定义的是语义结果，不是强制 UI 文案。
- scope 提示 UI 可以因 renderer 而异，但结果必须符合此矩阵。

### 3.2 Scope 提示适用规则（Web Reference UI 规则）

当前 Web reference 规则：
1. `bash.exec`：不出现 scope 步骤
2. `fs.write`：不出现 scope 步骤
3. 带 `workspaceRequest.dir` 的 `fs.read`：不出现 scope 步骤
4. 其他支持 policy-scope 的 action：出现 scope 步骤
5. 缺失 `action.kind`：出现 scope 步骤（保守回退）

这属于 renderer 行为。最终语义结果仍由第 3.1 节约束。

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
1. `apps/web-reference-react/src/app/runtime/useDevRuntimeApi.test.tsx`
2. `apps/web-reference-react/src/components/InputApprovalDock.test.tsx`
3. `apps/web-reference-react/src/App.test.tsx`
4. `src/tools/executor/approvalService.test.ts`
5. `src/tools/executor/policyPreflight.test.ts`
6. `src/tools/presenters/*approvalPrompt.test.tsx`
7. 与 `src/components/tool/AskUserQuestionToolBlock.tsx` 相关的 presenter 测试

## 8. 变更控制

当变更 `approval` 或 `ask_user_question` 行为时：
1. 先更新本文件。
2. 在同一变更中更新实现与测试。
3. 将 `docs/contracts/app-server-interaction-contract.md`、`docs/references/app-server-api-reference.md`、`docs/frontend/app-server-ui-spec.md` 保持为摘要 + 链接，不重复完整语义。
4. 对行为对齐变更，在 `docs/learnings/` 下补充一条简短学习记录（必要时再关联 `plans/app-server/`）。

若实现与本合同冲突，应视为实现漂移并立即收敛修正。
