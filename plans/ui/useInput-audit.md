# `useInput` 调用点审计（防止键盘事件互抢）

目的：让“谁吃键盘事件”变成可检查、可维护的清单，避免未来新增 UI 后出现方向键/数字键/ESC 互抢。

说明：
- 优先使用 `useScopedInput(scope, handler, opts)`（来自 `packages/core/src/features/repl/inputScopeContext.tsx`）。
- 只有在“确实不需要 scope / 或必须全局监听”的场景才使用裸 `useInput`，且必须显式 `isActive`。

## Call sites（当前扫描结果）

### REPL / scope 基座

- `packages/core/src/screens/REPL.tsx:234`：REPL 的全局键盘处理（应只在 `scope=repl` 时生效）
- `packages/core/src/features/repl/inputScopeContext.tsx:78`：`useScopedInput` 的底层实现（带 `isActive`）
- `packages/core/src/components/ui/TextInput.tsx:80`：无 scope 时的 fallback `useInput`（带 `isActive`）

### 示例屏幕（可以不纳入硬约束）

- `packages/core/src/screens/ToolExamplesScreen.tsx:263`：示例/演示
- `packages/core/src/screens/LoadingExampleScreen.tsx:43`：示例/演示

### 已收敛为 `useScopedInput`（交互页 / prompt）

- `packages/core/src/tools/modules/askUserQuestion/presenter.tsx`：交互问答（`prompt:askUserQuestion`）
- `packages/core/src/tools/modules/enterPlanMode/presenter.tsx`：进入 plan mode 的确认 prompt（`prompt:enterPlanMode`）
- `packages/core/src/tools/modules/exitPlanMode/presenter.tsx`：退出 plan mode 的确认 prompt（`prompt:exitPlanMode`）

备注：
- 这些 prompt 依赖 `InputScopeProvider` 才能激活对应 scope；`packages/core/src/entrypoints/tool-examples.tsx` 已包一层 provider，避免示例屏幕里 prompt 变成“按键无效”。
