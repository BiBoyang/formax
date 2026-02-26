# TUI Interactive Input Inventory（approval / ask_user_question）

更新时间：2026-02-26

本文件是信息性盘点（informative inventory），用于统计当前形态。  
`approval` / `ask_user_question` 的规范性唯一事实源已固定为：`docs/harness/contracts/interactive-input-contract.md`。

范围约束：
- 本轮只统计 `approval` 与 `ask_user_question` 两类输入形态。
- 暂不并入 `EnterPlanMode` / `ExitPlanMode` 的专用提示 UI（可在下一轮补充为附录）。

## 统计口径

为避免“形式”定义歧义，采用两层口径并行记录：

1. 协议口径（Input kind）
2. TUI 渲染口径（用户实际看到的交互组件）

## 统计结果

### A. 协议口径：2 类

1. `approval`
2. `ask_user_question`

参考：
- `docs/harness/contracts/app-server-interaction-contract.md`
- `docs/harness/references/app-server-api-reference.md`

### B. TUI 渲染口径：6 类

1. `BashApprovalPrompt`
2. `FsReadApprovalPrompt`
3. `FsWriteApprovalPrompt`（`header/inline` 两种布局变体，归同一交互形态）
4. `SkillApprovalPrompt`
5. `EditApprovalPrompt`（remember scope 可循环：`session/project/global`）
6. `AskUserQuestionToolBlock`

> 说明：这里按“交互形态组件”计数，不按工具数量计数。

## 形态与工具映射

| # | TUI 交互形态 | 主要组件 | 当前使用工具（示例） | 决策/提交语义 |
|---|---|---|---|---|
| 1 | Bash 审批 | `src/tools/presenters/BashApprovalToolBlock.tsx` + `src/tools/presenters/bashApprovalPrompt.tsx` | `Bash` | `approve / approve_remember / feedback / cancel` |
| 2 | 文件读取审批 | `src/tools/presenters/FsReadApprovalToolBlock.tsx` + `src/tools/presenters/fsReadApprovalPrompt.tsx` | `Read / Grep / Glob` | 同上 |
| 3 | 文件写入审批 | `src/tools/presenters/fsWriteApprovalPrompt.tsx` | `Write / Edit / NotebookEdit` | 同上 |
| 4 | Skill 审批 | `src/tools/presenters/skillApprovalPrompt.tsx` | `Skill` | 同上 |
| 5 | 带 remember-scope 的审批 | `src/tools/presenters/editApprovalPrompt.tsx` | `WebFetch / WebSearch` | `approve_remember` 额外包含 `scope` |
| 6 | Ask 问题交互 | `src/tools/presenters/AskUserQuestionToolBlock.tsx` | `AskUserQuestion`（及 ask 类输入） | `Record<string,string>` |

## AskUserQuestion 子形态（不单独计入 6 类总数）

`AskUserQuestionToolBlock` 内部包含 4 个可见子形态：

1. 单选（single-select）
2. 多选（multi-select）
3. 单选下的自由文本输入（other/typing）
4. Review + Submit 页面

## 当前结论（用于你这轮“先统计”）

- 若按协议层：**2 类**。
- 若按 TUI 实际交互组件层：**6 类**。
- 若追问 ask 内部页面层：`AskUserQuestion` 另有 **4 个子形态**（已记录但不并入 6 类总数）。

## 维护建议（当前）

1. 本文件保持“盘点与映射”定位，不承载规范条款。
2. 在 `docs/harness/frontend/app-server-ui-spec.md` 仅保留摘要并链接本文件，避免双写漂移。
3. 为每个形态增加“对应测试文件”索引，形成规范 -> 测试的可追溯映射。
