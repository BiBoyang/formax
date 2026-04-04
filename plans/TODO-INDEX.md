# Plans TODO Index

这份索引用于避免同时维护多份 TODO 导致“主线不清晰”。

## 当前主线（只盯这一份）

- `plans/monorepo/PLAN.md`：Monorepo 执行计划（v2，按 Phase 推进）
  - 当前状态：执行中（workspace 化与 `apps -> packages` 已完成，正在推进 shared/semantics 分包与发布链路收敛）
  - 关联方案：`plans/monorepo/MIGRATION-PLAN.md`
  - 关键约束：发布身份不变（`@yusifeng/formax` + `formax`）

## 并行参考（不作为主线推进）

- `plans/app-server/TODO-INDEX.md`：Formax app-server（stdio JSON-RPC）+ GUI 集成 MVP
  - 当前状态：滚动执行清单（旧 `TODO.md` 已归档/删除，避免噪音）。
  - 关联实现：`packages/web-reference-react/`（React reference client）
  - 验收记录模板：`docs/runbooks/app-server-manual-runbook.md`

- `plans/monorepo/MIGRATION-PLAN.md`：Monorepo 改造方案细节（与 `TODO-EXECUTION.md` 同步）

- `plans/harness-refactor-loop/TODO-INDEX.md`：Harness 分层债务滚动清理（固定循环：实现 -> 定向测试 -> review -> 提交）
- `plans/ui/ui-TODO-INDEX.md`：UI TODO 索引（串联 `plans/ui/` 下各 TODO）
- `plans/ui/BACKLOG-command-subline-output.md`：Slash command 子行输出（扩展范围 / 后置）
- `plans/ui/BACKLOG-approval-preview.md`：Approval UI 后置增强项（不作为执行清单）
- `plans/skills/TODO.md`：Skill 相关（抓包验证点 + 少量增强项），与权限主线会交叉
- `plans/sdk-contract-alignment-loop/TODO-INDEX.md`：SDK 对齐滚动循环（原则：外部契约对齐 + 内部实现解耦，未支持能力不做）
- `plans/hooks/TODO.md`：Hooks 事件清单 & matcher 规则（哪些已实现/待接线）
- `plans/context-compression-alignment-loop/TODO-INDEX.md`：上下文压缩对齐滚动清单（Claude Code 差异地图 + 分阶段补齐）
  - 当前状态：新建执行清单，建议作为上下文压缩主线参考
  - 关联调研：`docs/references/claude-code-context-compression-research.md`

## 参考材料（非执行清单）

- `plans/config-settings/`：`/config` 历史验证与设计记录
- `plans/session-save/`：session save 设计与后续草案
- `plans/coverage/`：覆盖率快照与历史清单
- `plans/web-reference-react-refactor/`：web reference 重构循环历史记录
