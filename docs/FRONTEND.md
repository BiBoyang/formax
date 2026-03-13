# FRONTEND（Docs 索引）

最后更新：2026-03-07

本文档是前端治理入口（index），不承载完整行为细节。  
具体行为规范请在对应子文档维护，避免与合同重复。

## 1. 阅读顺序（由高到低）

1. 项目语义合同（SoT）：`docs/contracts/semantics-contract.md`
2. 交互输入合同（SoT）：`docs/contracts/interactive-input-contract.md`
3. app-server 行为合同：`docs/contracts/app-server-interaction-contract.md`
4. Web parity adapter 合同（event adapter / reducer / cursor）：`docs/contracts/web-parity-adapter-contract.md`
5. app-server UI 行为规范（前端具体实现摘要）：`docs/frontend/app-server-ui-spec.md`
6. app-server API 参考（字段与示例）：`docs/references/app-server-api-reference.md`

## 2. 责任边界

1. `contracts/*`：规范性事实源（Normative）。
2. `frontend/*`：前端行为摘要与交互规范（实现导向，非唯一真值）。
3. `references/*`：字段结构、示例与对接说明（参考性质）。

## 3. 前端改动最低约束

1. UI 改动不得改变 `src/features/semantics/*` 语义真值。
2. `approval` / `ask_user_question` 的提交 payload 形状不得私自变更。
3. `permissions.allow` 与 preflight/policy 生效逻辑由服务端拥有，前端不得补丁式篡改。

## 4. 回归建议（Web Reference）

1. `npm --prefix packages/web-reference-react run test -- src/app/runtime/useDevRuntimeApi.test.tsx`
2. `npm --prefix packages/web-reference-react run test -- src/components/InputApprovalDock.test.tsx src/App.test.tsx`
3. `npm --prefix packages/web-reference-react run type-check`

## 5. 文档更新顺序

当前端行为变更涉及语义或交互输入时：
1. 先更新 `docs/contracts/*.md`（事实源）。
2. 再更新实现与测试。
3. 最后更新 `docs/{frontend,references}/*.md` 摘要与链接；过程记录如需保留，放到 `docs/learnings/*`。
