# TODO：UI 稳定基座（键盘路由 + 复用组件）

目标：暂停“加新功能”，先把 UI 交互的**稳定性/可预测性**做起来，减少“按键互抢、输入失灵、风格不一致”的返工成本。

## 0. 约束（必须遵守）

- [ ] **行为优先**：先保证交互稳定与可预测，再考虑目录搬迁与大重构
- [ ] **不做大搬家**：在键盘路由稳定之前，不大规模移动 `src/screens/ src/ui/ src/components/`（减少 churn）
- [ ] **焦点优先级明确**：Overlay/Prompt 打开时，REPL 不得抢按键（方向键/Tab/数字键/ESC 等）
- [ ] **尽量复用现有**：优先复用 `src/components/ui/TextInput.tsx` + `getTheme()`，避免重写输入逻辑

## 1. 已完成（最近）

- P0 键盘路由基座：`InputScopeProvider` + `useScopedInput` 已接入 REPL/AgentsDialog/PermissionsDialog（含 `src/entrypoints/permissions.tsx`），并补了最小测试覆盖。

## 2. P1 — 通用交互组件抽离（减少重复与 bug 漂移）

目的：把“列表选择 / 确认菜单 / 键位提示条 / overlay 框”做成复用件，减少每处手写交互。

- [ ] `OverlayFrame`：统一边框/标题/副标题/留白（对齐 Claude Code 风格）
- [x] `OverlayFrame`：统一边框/标题/副标题/留白（对齐 Claude Code 风格）
- [x] `KeyHintBar`：统一底部提示文案（`↑↓`、`Enter`、`Esc`、`Tab` 等）
- [ ] `SelectList`：统一“上下/回车/ESC/数字快捷键/滚动”行为（可配置是否支持数字）
- [ ] `ConfirmMenu`：统一确认/取消/记忆选项（避免每个 ApprovalPrompt 各写一套）
- [ ] `InlineTextEditorRow`：统一“列表里可编辑项”的输入与导航（减少 `typing + refs` 私货）

**DoD**
- [ ] 至少 2 处页面复用 `SelectList`
- [x] 至少 2 处页面复用 `OverlayFrame + KeyHintBar`（AgentsDialog/PermissionsDialog）

## 3. P2 — 对齐现有 flows（按收益顺序逐个改）

目的：把最容易出 bug 的 flows 迁移到统一基座与组件上。

- [ ] Permissions flow：`src/ui/permissions/PermissionsDialog.tsx`
  - [ ] 使用 `useScopedInput` + `SelectList` + `OverlayFrame`（不改业务逻辑）
  - [ ] 修复左右方向键无效的问题（来自统一 input 处理）
- [ ] Setup flow：`src/ui/SetupWizard.tsx`
  - [ ] 用统一 `SelectList`/focus 机制，避免“上下键无效/数字键失灵”
- [ ] Agents flow：`src/ui/AgentsDialog.tsx`
  - [ ] 用统一 `SelectList` + scope，避免 REPL 抢键 & 闪屏
- [ ] Tool approval prompts：`src/tools/presenters/*ApprovalPrompt.tsx`
  - [ ] 逐个替换为 `ConfirmMenu`/`SelectList`（减少重复 `useInput`）

## 4. P3 — Theme/颜色/间距统一（后置，但要做）

目的：解决“颜色硬编码 + 组件风格不一致”。

- [ ] 统一从 `getTheme()` 取语义色（primary/secondaryText/warn/error/success）
- [ ] 统一边框与选中高亮色（当前对齐目标：`#B1B9F9`）
- [ ] 清理 UI 内散落的颜色常量（或集中到单处）

## 5. P4 — 回归与防回归

目的：让 UI 交互的稳定性可持续，而不是靠“人肉记忆”。

- [ ] 增加最小交互测试（ink-testing-library）
  - [ ] overlay 打开时 REPL 不响应方向键/Tab/数字键
  - [ ] Permissions/Agents/SetupWizard 的基本导航不回归
- [ ] 补一份手动回归清单（只列关键路径）
