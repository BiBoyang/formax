# 2026-03-12 Interactive / Preflight 统一编排收口

## 背景

在 `approval`、`ask_user_question`、plan-mode 交互工具（`EnterPlanMode` / `ExitPlanMode`）上，历史实现存在“同语义多处重复解释”的风险点：

1. 交互失败文本的 `Error:` 前缀处理分散在不同 handler/preflight。
2. approval-like 决策字符串（`approve` / `approve_remember` / `feedback` / fallback cancel）在多个模块重复分支。
3. ask 流程存在 throw 路径与 result 路径并存，易引入 GUI/TUI 细节漂移。

## 本次收口

1. 新增并统一交互事务核心：`packages/core/src/tools/runtime/interactivePromptTransaction.ts`  
2. ask 路径增加非抛错 API：`requestAskUserQuestionAnswersResult`（`ok/result`）  
3. `AskUserQuestion` / `EnterPlanMode` / `ExitPlanMode` 三个 handler 统一改为显式 `ok/result` 分支  
4. approval-like 决策解释统一到 `resolveApprovalLikeOutcome`，并由：
   - `packages/core/src/tools/executor/approvalService.ts`
   - `packages/core/src/tools/executor/skillPreflight.ts`
   共同复用

后续补强（同日）：

5. approval request payload 统一通过 descriptor 构造（`createApprovalPromptDescriptor`），避免 `approvalService` / `skillPreflight` 手写事件体分叉。  
6. ask request payload 统一通过 descriptor 构造（`createAskUserQuestionPromptDescriptor`）。  
7. 新增 app-server 跨流一致性测试：`packages/core/src/app-server/interactiveLifecycleConsistency.test.ts`，覆盖 `approval / skill / ask / enter-plan / exit-plan` 的 `inputRequested -> submit -> inputResolved -> completed` 顺序与 payload shape。

## 关键收益

1. 交互失败映射和 rejection 文案收敛到共享 helper，减少重复分叉。  
2. ask/approval 两条交互主线都具备“事务层 -> 入口层”可追踪路径。  
3. 后续 GUI/TUI 对齐时，优先对同一 helper 做变更，降低“某一端忘改”的概率。

## 验证

回归覆盖（节选）：

1. `packages/core/src/tools/runtime/interactivePromptTransaction.test.ts`
2. `packages/core/src/tools/runtime/askUserQuestionPrompt.test.ts`
3. `packages/core/src/tools/modules/askUserQuestion/handler.test.ts`
4. `packages/core/src/tools/modules/enterPlanMode/handler.test.ts`
5. `packages/core/src/tools/modules/exitPlanMode/handler.test.ts`
6. `packages/core/src/tools/executor/approvalLikePrompt.test.ts`
7. `packages/core/src/tools/executor/approvalService.test.ts`
8. `packages/core/src/tools/executor/skillPreflight.test.ts`

并通过 `bun run type-check` 与提交前 `codex review --uncommitted`。
