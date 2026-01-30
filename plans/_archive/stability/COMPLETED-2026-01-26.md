# Stability Completed (Archive)

Date: 2026-01-26

This file archives items that were completed and removed from `plans/stability/TODO.md` to keep the active TODO list focused.

## Input routing / overlays

- `/agents` / `/permissions` / `/hooks` overlay 打开时，↑↓ 不再被 REPL 抢键：见 `src/screens/REPL.overlays.test.tsx`
- `/hooks` overlay 打开时：prompt mode 会更新、`Esc` 不会被 REPL 抢键：见 `src/screens/REPL.tsx`、`src/screens/repl/hotkeys.ts`、`src/screens/REPL.overlays.test.tsx`、`src/screens/repl/hotkeys.test.tsx`
- `/permissions` overlay 打开期间：`Enter/Esc/Tab/←→/Backspace/Delete/数字键` 不会被 REPL 抢键：见 `src/screens/REPL.overlays.test.tsx`
- `/permissions` overlay：`Esc` 由 overlay 处理并关闭，REPL 不抢键：见 `src/screens/REPL.overlays.test.tsx`
- InputScope 路由契约：`Esc/Enter/数字键` 只路由到 active scope：见 `src/features/repl/inputScopeContext.test.tsx`
- InputScopeProvider：引入 router 基座（`registerHandler`，仅供测试/后续接线）：见 `src/features/repl/inputScopeContext.tsx`、`src/features/repl/inputScopeContext.test.tsx`
- useScopedInput：在 Provider 存在时改为走 router；无 Provider 时保留 fallback：见 `src/features/repl/inputScopeContext.tsx`、`src/features/repl/inputScopeContext.test.tsx`
- TextInput：`Tab` 不作为文本输入：见 `src/components/chat/InputBar.test.tsx`
- InputScope router：支持 consumed 语义（`handler(...) === true` 则停止分发）：见 `src/features/repl/inputScopeContext.tsx`、`src/features/repl/inputScopeContext.test.tsx`
- TextInput：在 scope 下 left/right/backspace/delete/enter/newline 即使在边界也 consume（避免漏到外层 list/快捷键）：见 `src/components/ui/TextInput.tsx`、`src/components/ui/TextInput.test.tsx`
- InputScope router：支持 group suspend/resume（含嵌套 refcount）：见 `src/features/repl/inputScopeContext.tsx`、`src/features/repl/inputScopeContext.test.tsx`
- REPL hotkeys：拆分 command/selector 两组输入注册并给出 priority（slash suggestions 导航 consume）：见 `src/screens/repl/hotkeys.ts`、`src/screens/repl/hotkeys.test.tsx`、`src/screens/REPL.slashSuggestions.test.tsx`
- overlay 打开期间：`Esc`/`Shift+Tab` 不触发 REPL abort/mode 切换：见 `src/screens/REPL.overlays.test.tsx`、`src/screens/repl/hotkeys.test.tsx`
- `/hooks` Add new hook：输入时 scope 不应 flicker 回 `repl`（避免丢字/闪屏）：见 `src/ui/hooks/HooksDialog.test.tsx`
- overlay scope id 已对齐：`overlay:agents` / `overlay:permissions` / `overlay:hooks`：见 `src/ui/agents/AgentsDialog.tsx`、`src/ui/permissions/PermissionsDialog.tsx`、`src/ui/hooks/HooksDialog.tsx`
- InputScope router：active scope / routed handler refs 改为 `useLayoutEffect` 同步（避免 scope/handler 切换后首个按键落到旧 scope/旧闭包）：见 `src/features/repl/inputScopeContext.tsx`、`src/features/repl/inputScopeContext.test.tsx`
- PermissionsDialog：输入页（add rule / add directory）改为由 TextInput `onSubmit` 处理 Enter（避免 Enter 冒泡到 list/hotkeys，且避免在 scoped TextInput 下丢提交）：见 `src/ui/permissions/PermissionsDialog.tsx`、`src/ui/permissions/ui.tsx`、`src/ui/permissions/PermissionsDialog.test.tsx`
- TextInput：修复 burst 输入丢字（Ink 可能把多次写入合并，但 `key.sequence` 只反映最后一个字符；同时用 `useLayoutEffect` 同步 value/cursor refs，避免下一次按键读到旧值）：见 `src/components/ui/TextInput.tsx`、`src/components/ui/TextInput.test.tsx`
- useReplOverlays：overlay manager 订阅在 unmount 时会 unsubscribe（避免 listener 泄漏）：见 `src/features/repl/controller/overlays.ts`、`src/features/repl/controller/overlays.test.tsx`
- `/permissions` overlay 测试：断言输入事件的 scope 始终为 `overlay:permissions`（避免 “activeScope 已切换但事件仍被记为 repl”）：见 `src/screens/REPL.overlays.test.tsx`

## Terminal / clear semantics

- pitfalls 已补齐输入路由稳定契约（consumed/priority/scope）：见 `pitfalls.md`
- `/clear`：会话重置抽为 `actions.newSession()`（保持现有行为与清屏顺序，不改 UI）：见 `src/features/repl/useReplController.ts`、`src/features/repl/controller/send.ts`
- “发送后清输入”：抽为 `clearPrompt()`（只清输入与 slash selector 内部状态，不动 session）：见 `src/screens/REPL.tsx`
- REPL：prompt line（input + slash suggestions）状态收敛到内部 hook `usePromptLine()`（仅重构，不改行为）：见 `src/screens/REPL.tsx`、`src/screens/REPL.slashSuggestions.test.tsx`
