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

## S9 — 键盘路由稳定性（先修已知回归）

目标：Overlay/Prompt 打开时，方向键/Tab/数字键等不会被错误路由；输入框内 `←/→` 可移动光标。

- [ ] S9-1：修复 `/permissions` 的 TextInput 左右键无效
  - [ ] 复现：进入 `/permissions` → Workspace → Add directory，在输入框里按 `←/→`
  - [ ] 期望：光标可移动并可在中间插入字符；`Esc` 返回上一级；退出后主 REPL 仍可正常输入
  - [ ] 原因定位：Overlay 的全局 `useInput` 与 TextInput 的 `useInput/useScopedInput` 抢键/优先级不对
  - [ ] 实现方向：当 view 进入输入态时，Overlay 层不要消费 `left/right/up/down`；或提升 TextInput scope 的优先级
  - [ ] 回归：更新 `plans/ui/REGRESSION.md` 第 3 条手测保持通过
  - [ ] 测试：为 `PermissionsDialog` 的输入态加最小 ink-test（至少覆盖 `leftArrow/rightArrow`）
