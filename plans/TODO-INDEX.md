# Plans TODO Index

这份索引用于避免同时维护多份 TODO 导致“主线不清晰”。

## 当前主线（只盯这一份）

- `plans/app-server/TODO-INDEX.md`：Formax app-server（stdio JSON-RPC）+ GUI 集成 MVP
  - 当前状态：滚动执行清单（旧 `TODO.md` 已归档/删除，避免噪音）。
  - 关联实现：`apps/web-reference-react/`（React reference client）
  - 验收记录模板：`docs/runbooks/app-server-manual-runbook.md`

## 并行参考（不作为主线推进）

- `plans/harness-refactor-loop/TODO-INDEX.md`：Harness 分层债务滚动清理（固定循环：实现 -> 定向测试 -> review -> 提交）
- `plans/ui/ui-TODO-INDEX.md`：UI TODO 索引（串联 `plans/ui/` 下各 TODO）
- `plans/ui/BACKLOG-command-subline-output.md`：Slash command 子行输出（扩展范围 / 后置）
- `plans/ui/BACKLOG-approval-preview.md`：Approval UI 后置增强项（不作为执行清单）
- `plans/skills/TODO.md`：Skill 相关（抓包验证点 + 少量增强项），与权限主线会交叉
- `plans/sdk-contract-alignment-loop/TODO-INDEX.md`：SDK 对齐滚动循环（原则：外部契约对齐 + 内部实现解耦，未支持能力不做）
- `plans/hooks/TODO.md`：Hooks 事件清单 & matcher 规则（哪些已实现/待接线）
