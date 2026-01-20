# TODO：稳定性 / 可预测性（仅保留未完成项）

目标：不急着加新功能，优先把“会导致误操作/难排查/不稳定契约”的问题压下去，让后续扩展更可控。

约束：
- 不做大搬家/大重构（避免 churn）
- 每个小项完成就独立 commit（可回滚）
- TODO 只记录“未完成项”，完成后删除（有 git 不怕丢）

---

## S7 — 错误输出契约统一（先做最关键的一条链）

目标：错误必须“可解释 + 可解析”。不强行把所有错误都做成 JSON（先只统一关键字段与呈现）。

### S7-6：手动回归（不抓包也能验证）

- [ ] S7-6a：workspace 越界（Read/Glob/Grep 任一即可）
  - [ ] 运行：`bun run dev`
  - [ ] 在 REPL 触发越界（示例）：`Read(~/.codex/copy.json)`
  - [ ] 验收（DoD）：
    - [ ] 输出包含 `ErrorCode: FS_PERMISSION`
    - [ ] 输出包含 `Hint:`
    - [ ] 同时显示 `Path:`（~ 格式）与 `Path (absolute):`（绝对路径）
    - [ ] `Workspace roots:` 至少包含项目根的 `~` 与绝对路径两种展示
    - [ ] 错误文本用 error 语义色（red），而不是 secondaryText
- [ ] S7-6b：Bash deny
  - [ ] 在 REPL 触发 deny（示例）：`Bash(sudo ls)`
  - [ ] 验收（DoD）：
    - [ ] 输出包含 `ErrorCode: POLICY_DENIED`
    - [ ] 输出包含拒绝原因（至少一行 human readable reason）
    - [ ] 错误文本用 error 语义色

---

## S8 — 结构化输出保护（先写 TODO，等抓包确认后再动）

说明：Claude Code 有一类 `<system-reminder>` 会出现在 tool_result 的尾部（抓包能看到），但我们无法 100% 判断其“注入位置/注入时机/是否所有工具都这样”。为了避免误改业务逻辑，S8 先只做“测试设计/待确认”，等你抓包确认后再落地实现。

- [ ] S8-1：列出“需要抓包确认”的问题清单（不改代码）
  - [ ] `<system-reminder>` 是否会被附加到 Read/Glob/Grep/其它 tool_result？
  - [ ] 是否只有特定安全场景才出现（例如 malware 相关）？
  - [ ] 发生在 streaming 的哪个事件后（tool_result / content_block_stop / 其它）？
  - [ ] 是否会影响 prune/compact 的截断策略？
