# Subagents（子任务）

这一章记录子任务（Task/Explore/Plan 等）的行为与工程实现：
- 允许哪些工具（allowTools/denyTools）与安全边界
- 审批如何“向上”回到主代理处理
- 多个子任务并发时，UI 如何展示与聚合

## 推荐阅读顺序

1. `docs/LEARNINGS/subagents/overview.md`：全链路（从 `/agents` 到 `Task` 再到 UI）
2. 具体对齐点再按主题补充（例如并发聚合、后台任务、审批策略等）
