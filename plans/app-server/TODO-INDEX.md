# TODO-INDEX：Semantics Single-Writer（Rolling）

更新时间：2026-02-17
任务来源（唯一）：
- `plans/app-server/ARCHITECTURE-ROADMAP.md`
- `plans/app-server/SEMANTICS-ARCHITECTURE-BLUEPRINT.md`

> 本清单用于下一阶段主线推进。旧 `plans/app-server/TODO.md` 视为历史执行记录，不再作为主线来源。

## 滚动维护规则（必须执行）

1. 这里始终只保留“未完成任务”；完成项从本文件删除，避免噪音累积。
2. 当本文件清空时，必须重新从 roadmap + blueprint 生成下一批任务并写回本文件。
3. 新任务按“小切片可提交”粒度拆分（每项尽量 2-6 文件改动）。
4. 每项执行顺序固定：实现 -> 定向测试 -> `codex review` -> 提交。
5. 历史完成记录以 Git commit 为准，不在 TODO-INDEX 长期保留。

## P2：Contract & Adapter Consolidation

## P3：Presentation IR

- [ ] N13 Projection 去 UI 偏置字段（phase 1）
  - 目标：减少 projection segment 中 UI-only 字段，确保 projection 更偏语义态，展示偏好留在 selector/presenter。
  - 验收：
    - 完成至少一个 UI 偏置字段的下沉（从 projection 持久状态转为 selector 派生）。
    - 现有 canonical/tool transcript 回归测试不变。
