# Plans TODO Index

这份索引用于避免同时维护多份 TODO 导致“主线不清晰”。

## 当前主线（只盯这一份）

- `plans/iam/TODO.md`：统一 permissions/审批体系 + `/permissions`（优先做基座，UI 后接线）

## 并行参考（不作为主线推进）

- `plans/ui/ui-TODO-INDEX.md`：UI TODO 索引（串联 `plans/ui/` 下各 TODO）
- `plans/ui/TODO-command-subline-output.md`：Slash command 子行输出对齐（/agents /permissions /hooks /todos）
- `plans/ui/BACKLOG-approval-preview.md`：Approval UI 后置增强项（不作为执行清单）
- `plans/skills/TODO.md`：Skill 相关（抓包验证点 + 少量增强项），与 IAM 主线会交叉但以 IAM 为准
- `plans/system-reminder/TODO.md`：TodoWrite reminders（不走 hooks，优先控 token）
- `plans/hooks/TODO.md`：Hooks 事件清单 & matcher 规则（哪些已实现/待接线）

## 暂停（等 IAM 稳定后再继续）

- `plans/code-refactor/TODO.md`：结构性重构（/commands + skills + /agents + 契约层/overlay），容易与 IAM 同时改导致返工

## 大项目（建议单独分支）

- `plans/product-strategy/PR6-improvements.md`：ApprovalService/审计/统一拦截等产品化改造（会改 executor/交互）
- `plans/product-strategy/PR9-multiprovider.md`：多 provider（Anthropic/OpenAI/Gemini）适配与 streaming 解耦

## 归档/Backlog（不作为执行清单）

- `plans/_archive/**`：历史抓包/研究/旧计划归档（不作为执行清单，仅供回看）
- `plans/_archive/common-refactor/OUTDATED-NOTES.md`：旧文档审计笔记（Done/Pending/Outdated），仅供回看
- `plans/_archive/stability/COMPLETED-2026-01-26.md`：已完成的稳定性/可预测性改动清单（回归点索引）
