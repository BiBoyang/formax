# Plans TODO Index

这份索引用于避免同时维护多份 TODO 导致“主线不清晰”。

## 当前主线（只盯这一份）

- `plans/iam/TODO.md`：统一 permissions/审批体系 + `/permissions`（UI 最后接线）

## 并行参考（不作为主线推进）

- `plans/skills/TODO.md`：Skill 相关（抓包验证点 + 少量增强项），与 IAM 主线会交叉但以 IAM 为准

## 暂停（等 IAM 稳定后再继续）

- `plans/code-refactor/TODO.md`：结构性重构（/commands + skills + /agents + 契约层/overlay），容易与 IAM 同时改导致返工

## 大项目（建议单独分支）

- `plans/product-strategy/PR6-improvements.md`：ApprovalService/审计/统一拦截等产品化改造（会改 executor/交互）
- `plans/product-strategy/PR9-multiprovider.md`：多 provider（Anthropic/OpenAI/Gemini）适配与 streaming 解耦

## 归档/Backlog（不作为执行清单）

- `plans/_archive/common-refactor-OUTDATED-NOTES.md`：旧文档审计笔记（Done/Pending/Outdated），仅供回看
