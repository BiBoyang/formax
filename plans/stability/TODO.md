# TODO：稳定性 / 可预测性（仅保留未完成项）

目标：不急着加新功能，优先把“会导致误操作/难排查/不稳定契约”的问题压下去，让后续扩展更可控。

约束：
- 不做大搬家/大重构（避免 churn）
- 每个小项完成就独立 commit（可回滚）

---

## S7 — 错误输出契约统一（先做最关键的一条链）

目标：错误必须“可解释 + 可解析”，但不强行把所有错误都做成 JSON（先只统一字段与呈现）。

- [ ] S7-1：列出“拒绝类错误”入口与现状（只做注释/备忘，不改行为）
  - [ ] workspace 拒绝：Read/Glob/Grep/Edit/Write/NotebookEdit
  - [ ] policy 拒绝：Bash deny、plan mode 写入拒绝、其他 deny
  - [ ] 输出路径：tool_result（主路径） vs 纯文本（少数 handler）
  - **DoD**：补充到本文件的小清单（包含文件路径与分支条件）
- [x] S7-2：统一 `policyPreflight` 的拒绝类输出格式（不改拒绝条件）
  - [ ] 保留第一行主错误：`Error: ...`
  - [ ] 追加固定字段（逐行输出，便于人读/机器 grep）：
    - [ ] `ErrorCode: <...>`
    - [ ] `Hint: <...>`（给出下一步建议；比如去 `/permissions`、或退出 plan mode）
    - [ ] `Path: <...>`（展示用，允许 `~`）
    - [ ] `Path (absolute): <...>`（绝对路径，便于排查）
    - [ ] `Workspace roots:` + 每个 root 一行（既有 `~` 又有绝对路径时，两行都列）
  - [ ] 只在有意义时输出 `Workspace roots`（例如 `FS_PERMISSION`）
  - **DoD**：至少覆盖 2 个分支：
    - workspace 越界（`FS_PERMISSION`）
    - policy deny（`POLICY_DENIED`）
- [ ] S7-3：补齐 handler 侧“绕过 preflight 的拒绝输出”（不改拒绝条件）
  - [x] `src/tools/modules/bash/handler.ts`：Bash deny 输出补齐 `ErrorCode`
  - [ ] plan mode 相关 handler（如果存在直接拒绝分支）补齐 `ErrorCode` + `Hint`
  - **DoD**：grep 一次，确认同类错误输出不再出现“只有一行 Error: ...”
- [x] S7-4：presenter 统一 error 语义色（避免“红点 + 灰字”）
  - [x] Read/Glob/Grep/Bash 的 presenter：错误段落使用 `theme.error`
  - [x] 仍保留原有结构（不改 layout/换行规则，避免 UI 回归）
  - [ ] **DoD**：手动触发一次 `FS_PERMISSION` 与一次 `Bash deny`，确认颜色与字段齐全
- [x] S7-5：测试覆盖（只加最小集合，避免测试膨胀）
  - [x] `policyPreflight.test.ts`：新增 2 个断言用例（`FS_PERMISSION` / `POLICY_DENIED`）
  - [ ] 如果 presenter 格式有变化：补 1 个快照/字符串断言（只锁关键字段，不锁全输出）
  - **DoD**：
    - `bun run test -- src/tools/executor/policyPreflight.test.ts`
    - `bun run type-check`

---

## S8 — 结构化输出保护（避免“结构被拼脏/被裁剪”）

目标：对 JSON/带标签输出（如 `<system-reminder>`）做到“不会被拼接破坏结构”，且不会被 prune 随意截断导致模型误解。

- [ ] S8-1：只先加 golden 测试（不改实现）
  - [ ] 选一个代表性结构化输出：
    - [ ] JSON：工具返回 JSON（例如 TodoWrite/TaskOutput/其他）
    - [ ] Tag：`<system-reminder>...</system-reminder>`（或类似）
  - [ ] 测试断言策略：
    - [ ] 结构必须保持成对/闭合（不出现半截 tag）
    - [ ] JSON 末尾必须保留 `}`（不出现半截 JSON）
  - **DoD**：`bun run test -- src/chat/context/prune.test.ts`
- [ ] S8-2：最小实现保护（只在“即将截断结构”时采取策略）
  - [ ] 规则 1：宁可“整段丢弃”也不“截半段结构化输出”
  - [ ] 规则 2：只对 tool_result / system tags 生效（不影响普通文本）
  - [ ] 先只改 1 处写回/裁剪路径（避免改动散落）
  - **DoD**：golden 测试通过 + 额外加 1 个反例（验证普通文本仍可裁剪）
