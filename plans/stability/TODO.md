# TODO：稳定性 / 可预测性（仅保留未完成项）

目标：不急着加新功能，优先把“会导致误操作/难排查/不稳定契约”的问题压下去，让后续扩展更可控。

约束：
- 不做大搬家/大重构（避免 churn）
- 每个小项完成就独立 commit（可回滚）
- TODO 只记录“未完成项”，完成后删除（有 git 不怕丢）

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

- [ ] S9-1：把“键盘优先级规则”写成可执行的约束 + 回归测试
  - [ ] 规则：Overlay/Dialog 打开时 REPL 不得抢键（↑↓←→Tab/数字键/Esc）
  - [ ] 规则：输入框聚焦时，仅输入框消费左右/Backspace/Delete；外层列表不应被误触发
  - [ ] 测试：覆盖 `/agents`、`/permissions`、`/hooks` 的关键路径（至少 Enter/Esc/Tab/↑↓/←→/Backspace/Delete）
- [ ] S9-2：实现“全局快捷键挂起（suspend）”的统一机制
  - [ ] 当 overlay/dialog stack > 0 时，挂起全局快捷键（类似 OpenCode 的 CommandProvider suspension）
  - [ ] 当 autocomplete/选择器可见时，挂起与之冲突的全局快捷键
  - [ ] 目标：避免每个页面自己写一套 `useInput` 分支来防冲突
- [ ] S9-3：沉淀“不要直写 ANSI 控制码”的工程约束
  - [ ] 统一从 `src/utils/terminal.ts` 暴露受控 API（必要时联动 Ink 的 `instance.clear()`）
  - [ ] 文档：在 `pitfalls.md` 增补“为什么会闪屏/两次才生效”的根因说明（log-update 帧缓存 vs ANSI clear）
