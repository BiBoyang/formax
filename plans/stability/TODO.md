# TODO：稳定性 / 可预测性（仅保留未完成项）

目标：不急着加新功能，优先把“会导致误操作/难排查/不稳定契约”的问题压下去，让后续扩展更可控。

约束：
- 不做大搬家/大重构（避免 churn）
- 每个小项完成就独立 commit（可回滚）

---

## S7 — 错误输出契约统一（先做最关键的一条链）

目标：错误必须“可解释 + 可解析”，但不强行把所有错误都做成 JSON（先只统一字段与呈现）。

- [ ] 先只统一 `policyPreflight` 的拒绝类错误（workspace/policy/deny）
  - [ ] 输出固定字段：`ErrorCode` + `Hint` +（可选）`Path (absolute)` + `Workspace roots`
  - [ ] 仍保留一行简短主错误（Claude 风格：`Error: …`）
- [ ] presenter 的颜色/样式统一为 error 语义色（避免“红点 + 灰字”）
- [ ] 测试：至少覆盖 2 类错误（例如 `FS_PERMISSION` + `BASH_DENY`）

---

## S8 — 结构化输出保护（避免“结构被拼脏/被裁剪”）

目标：对 JSON/带标签输出（如 `<system-reminder>`）做到“不会被拼接破坏结构”，且不会被 prune 随意截断导致模型误解。

- [ ] 增加一个最小 “结构化输出不被污染” 的 golden 测试（JSON 工具/标签工具任选其一）
- [ ] 在 `prune` 或“history 写回”路径增加单点保护（只做最小范围）
