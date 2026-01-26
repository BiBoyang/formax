# TODO：稳定性 / 可预测性（仅保留未完成项）

目标：不急着加新功能，优先把“会导致误操作/难排查/不稳定契约”的问题压下去，让后续扩展更可控。

约束：
- 不做大搬家/大重构（避免 churn）
- 每个小项完成就独立 commit（可回滚）
- TODO 只记录“未完成项”，完成后删除（有 git 不怕丢）

---

## 0. 已完成（不再追踪，仅做定位参考）

- `/agents` / `/permissions` / `/hooks` overlay 打开时，↑↓ 不再被 REPL 抢键：见 `src/screens/REPL.overlays.test.tsx`
- `/hooks` overlay 打开时：prompt mode 会更新、`Esc` 不会被 REPL 抢键：见 `src/screens/REPL.tsx`、`src/screens/repl/hotkeys.ts`、`src/screens/REPL.overlays.test.tsx`、`src/screens/repl/hotkeys.test.tsx`
- `/permissions` overlay 打开期间：`Enter/Esc/Tab/←→/Backspace/Delete/数字键` 不会被 REPL 抢键：见 `src/screens/REPL.overlays.test.tsx`
- InputScope 路由契约：`Esc/Enter/数字键` 只路由到 active scope：见 `src/features/repl/inputScopeContext.test.tsx`
- TextInput：`Tab` 不作为文本输入：见 `src/components/chat/InputBar.test.tsx`

---

## S8 — 结构化输出保护（先写 TODO，等抓包确认后再动）

说明：Claude Code 有一类 `<system-reminder>` 会出现在 tool_result 的尾部（抓包能看到），但我们无法 100% 判断其“注入位置/注入时机/是否所有工具都这样”。为了避免误改业务逻辑，S8 先只做“测试设计/待确认”，等你抓包确认后再落地实现。

- [ ] S8-1：列出“需要抓包确认”的问题清单（不改代码）
  - [ ] `<system-reminder>` 是否会被附加到 Read/Glob/Grep/其它 tool_result？
  - [ ] 是否只有特定安全场景才出现（例如 malware 相关）？
  - [ ] 发生在 streaming 的哪个事件后（tool_result / content_block_stop / 其它）？
  - [ ] 是否会影响 prune/compact 的截断策略？

---

## S9 — 借鉴 OpenCode 的 TUI Runtime 思路（不改框架）

目标：吸收 OpenCode 的“输入优先级/对话框栈/命令挂起”这些**框架无关**的稳定性设计点，但不迁移渲染框架（OpenCode 非 Ink/React，迁移代价过大）。

### S9-0：先补“稳定性契约”的回归网（小改动、低风险）

- [ ] S9-0.4：补 hooks 输入“闪屏/丢字”回归（只加测试或最小复现）
  - [ ] 目标：`/hooks` → Add new hook 的输入框，连续输入时不应触发 scope flicker（不会丢字符/闪屏）
  - [ ] 修复点（如果再次复现）：检查 hooks 内 `useScopeActivation(...)` 的依赖，避免依赖整个 `view` 对象（应只依赖 `view.kind` / `open`），否则每次输入可能触发 effect cleanup → scope pop/push → 丢键/闪屏
    - [ ] 重点文件：`src/ui/hooks/HooksDialog.tsx`、`src/ui/hooks/reducer.ts`
  - [ ] 备注：优先用 `ink-testing-library` 做最小复现；如果难以稳定断言，至少把“触发过回归的关键点”写进 `pitfalls.md` 并保留一个可复现脚本/步骤

- [ ] S9-0.5：overlay scope 接线到位（只做“缺什么补什么”，不改 UI）
  - [ ] 确认/补齐 scope id：
    - [ ] `/agents`：`overlay:agents`（`src/ui/agents/AgentsDialog.tsx`）
    - [ ] `/permissions`：`overlay:permissions`（`src/ui/permissions/PermissionsDialog.tsx`）
    - [ ] `/hooks`：`overlay:hooks`（`src/ui/hooks/HooksDialog.tsx`）
  - [ ] overlay 打开/关闭时，scope push/pop 稳定（不因输入导致反复 pop/push）
  - [ ] 测试：在 `src/screens/REPL.overlays.test.tsx` 至少覆盖 1 个 overlay 的 “Esc 由 overlay 处理并关闭 overlay，REPL 不抢”

### S9-1：同一 scope 内的“输入消费(consumed)”与“优先级”基座（偏底层，改动较大）

目标：解决“输入框边界不动时按键漏到外层列表/快捷键”的根因：Ink 的多个 `useInput` 默认都会收到事件，我们需要一个**集中路由器**来做 stop-propagation。

- [ ] S9-1.1：在 `InputScopeProvider` 内引入集中路由器（router）（不替换现有 useScopedInput，先预埋）
  - [ ] `src/features/repl/inputScopeContext.tsx`：增加 `registerHandler()`（scope + priority + group）
  - [ ] `src/features/repl/inputScopeContext.test.tsx`：新增最小 router 测试（activeScope 切换时只分发到当前 scope）
- [ ] S9-1.2：把 `useScopedInput` 接入 router（保留无 Provider fallback，避免破坏现有用例）
  - [ ] router 存在时：`useInput` 仍调用但 `isActive=false`，避免重复触发
  - [ ] router 不存在时：保持旧行为
  - [ ] 测试：无 `InputScopeProvider` 时 `useScopedInput` 仍工作（fallback 不回归）
- [ ] S9-1.3：引入 consumed 语义（`handler(...) === true` 则停止分发）
  - [ ] 测试：同 scope 下 A consume 后 B 不应收到
- [ ] S9-1.4：TextInput 明确 consume 规则（即使在边界也 consume）
  - [ ] `src/components/ui/TextInput.tsx`：left/right/backspace/delete/enter/newline 返回 consumed（true）
  - [ ] 测试：输入框聚焦时，外层 list 不应因 backspace/delete/方向键误触发

> 说明：S9-1 属于“底座级”改造，建议在 S9-0 的回归网齐全后再做；否则很容易出现“改动大、回归难定位”。

### S9-2：全局快捷键挂起（suspend）（中等改动）

- [ ] S9-2.1：定义 “group-based suspend” API（优先只覆盖 REPL command handlers）
  - [ ] 当 overlay/dialog 打开时：挂起 `group=command`（REPL 全局快捷键）
  - [ ] 当 slash suggestions / selector 打开时：挂起与 selector 冲突的 command
  - [ ] 支持嵌套/refcount：多层 overlay 打开/关闭时不会“永久挂起”或“提前恢复”
    - [ ] 测试：suspend 两次 → resume 一次仍应保持挂起；resume 两次才恢复
- [ ] S9-2.2：补测试：overlay 打开期间，REPL 的 mode 切换/abort/面板切换不触发

- [ ] S9-2.3：把 REPL 热键/选择器导航拆成不同 group（降低冲突面）
  - [ ] `src/screens/repl/hotkeys.ts`（或相邻模块）：将 “全局快捷键（command）” 与 “slash selector 导航（selector）” 分开注册，并给出明确 priority
  - [ ] 测试：`src/screens/REPL.slashSuggestions.test.tsx` 不回归（上下/Tab/Enter 仍按预期工作）

### S9-3：不要直写 ANSI 控制码（工程约束）

- [ ] S9-3.1：新增 “ANSI 直写审计” 测试（只允许 `src/utils/terminal.ts` 内含 raw ANSI）
  - [ ] 排除 `*.test.*`（tests 里会出现 `\u001b[A` 等按键序列）
  - [ ] 失败输出要能定位到文件/行号

### S9-4：`prompt.clear` vs `session.new`（语义清晰化，按需做）

- [ ] S9-4.1：把 `/clear` 的“会话重置”抽成 `actions.newSession()`（保持现有行为与清屏顺序，不改 UI）
- [ ] S9-4.2：把 “发送后清输入” 抽成 `clearPrompt()`（只清输入与 slash selector 内部状态，不动 session）

---

## S9-doc：把“新稳定契约”写回文档（避免下次再踩坑）

- [ ] 更新 `pitfalls.md`：至少包含
  - [ ] TextInput consume 规则（哪些键永远不该漏到外层）
  - [ ] group suspend 规则（command/selector/text）与嵌套 refcount
  - [ ] overlay scope 规范：`overlay:agents` / `overlay:permissions` / `overlay:hooks` + `useScopeActivation` 依赖只用 `view.kind`（避免 scope flicker）

---

## 备注（来自 opencode-study，但这里先不展开）

- Phase 4 的 “mock overlay 做 end-to-end 按键路由” 方案：你们已经有 `src/screens/REPL.overlays.test.tsx`，优先把它补齐到覆盖更多按键即可（避免再造一套测试基建）。
