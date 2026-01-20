# `useInput` 调用点审计（防止键盘事件互抢）

目的：让“谁吃键盘事件”变成可检查、可维护的清单，避免未来新增 UI 后出现方向键/数字键/ESC 互抢。

说明：
- 优先使用 `useScopedInput(scope, handler, opts)`（来自 `src/features/repl/inputScopeContext.tsx`）。
- 只有在“确实不需要 scope / 或必须全局监听”的场景才使用裸 `useInput`，且必须显式 `isActive`。

## Call sites（当前扫描结果）

### REPL / scope 基座

- `src/screens/REPL.tsx:234`：REPL 的全局键盘处理（应只在 `scope=repl` 时生效）
- `src/features/repl/inputScopeContext.tsx:78`：`useScopedInput` 的底层实现（带 `isActive`）
- `src/components/ui/TextInput.tsx:80`：无 scope 时的 fallback `useInput`（带 `isActive`）

### 示例屏幕（可以不纳入硬约束）

- `src/screens/ToolExamplesScreen.tsx:263`：示例/演示
- `src/screens/LoadingExampleScreen.tsx:43`：示例/演示

### 需要收敛为 `useScopedInput`（交互页 / prompt）

- `src/tools/modules/askUserQuestion/presenter.tsx:162`：交互问答（应迁到 `useScopedInput('prompt:askUserQuestion', ...)`）
- `src/tools/modules/enterPlanMode/presenter.tsx:78`：进入 plan mode 的确认 prompt（应迁到 `useScopedInput('prompt:enterPlanMode', ...)`）
- `src/tools/modules/exitPlanMode/presenter.tsx:149`：退出 plan mode 的确认 prompt（应迁到 `useScopedInput('prompt:exitPlanMode', ...)`）

