# Outdated / Inaccurate Notes (暂不修正)

这份文件用于记录 `plans/common-refactor/产品工程安全审计.md` 与 `plans/common-refactor/ink_ts专家代码优化.md` 中，少量已过时或与当前代码不一致的点，便于后续回看时不被误导。

## 1) `ToolMessage` 的 `Ctrl+O` 全局折叠问题

- 文档提到：`ToolMessage` 内部通过 `useInput` 监听 `Ctrl+O`，可能导致多张卡片同时 toggle。
- 当前代码现状：`src/components/tool/ToolMessage.tsx` 目前是纯展示组件，没有 `useInput`，也没有 `expanded` 状态切换逻辑，因此该问题在当前版本不成立。
- 后续如果要加“折叠/展开”：建议在 `src/screens/REPL.tsx` 做“选中消息/最新消息”的全局快捷键路由，而不是每个卡片各自监听键盘。

