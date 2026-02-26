# FRONTEND（Harness 视角）

最后更新：2026-02-27

本文档定义 Formax 前端改动在 Harness 治理下的最小约束，目标是让 UI 迭代可验证、可回归、可跨端对齐。

## 1. 核心原则

1. 语义优先：UI 改动不得改变 `src/features/semantics/*` 的语义真值。
2. 单一语义源：交互行为先看合同，再做 renderer 适配。
3. 非模态优先：Web approval 为 session 级非模态 dock，可切换 session。
4. 先行为后视觉：先锁定交互路径与提交语义，再做尺寸/排版/文案收敛。

## 2. 合同入口

- 项目语义唯一事实源：`docs/harness/contracts/semantics-contract.md`
- 交互输入唯一事实源：`docs/harness/contracts/interactive-input-contract.md`
- 交互合同摘要：`plans/app-server/INTERACTION-CONTRACT.md`
- UI 摘要：`plans/app-server/UI-SPEC.md`

## 3. Approval / Ask 改动守则

1. approval 与 ask 的提交 payload 形状不得私自变更。
2. `approval` 的 renderer 可单步或多步，但提交语义必须等价。
3. `ask_user_question` 多选提交保持 `Record<string, string>`（逗号分隔值）。
4. `permissions.allow` 与 preflight/policy 生效逻辑由服务端拥有，前端不得补丁式篡改。

## 4. 必测清单（Web Reference）

至少覆盖以下测试集：
1. `apps/web-reference-react/src/app/runtime/useDevRuntimeApi.test.tsx`
2. `apps/web-reference-react/src/components/InputApprovalDock.test.tsx`
3. `apps/web-reference-react/src/App.test.tsx`

变更建议命令：
1. `npm --prefix apps/web-reference-react run test -- src/app/runtime/useDevRuntimeApi.test.tsx`
2. `npm --prefix apps/web-reference-react run test -- src/components/InputApprovalDock.test.tsx src/App.test.tsx`
3. `npm --prefix apps/web-reference-react run type-check`

## 5. 文档维护

当前端行为变更涉及语义或交互输入时：
1. 先更新 `docs/harness/contracts/*.md`（事实源）。
2. 再更新实现与测试。
3. 最后更新 `plans/app-server/*.md` 摘要与链接。
