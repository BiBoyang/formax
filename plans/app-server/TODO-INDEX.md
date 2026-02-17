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

## P0b：Contract Governance + Single Writer

## P1：Projection/Renderer 长期解耦

- [ ] N6 projection 状态去 UI 偏置
  - 目标：projection 仅保留语义状态，不携带 renderer 偏好。
  - 验收：
    - UI 派生逻辑下沉到 selector 层。
    - projection reducer 不再因 TUI/Web 展示差异产生分支。

- [ ] N7 selector 层稳定接口
  - 目标：为 TUI/Web 提供统一 view-model 入口，限制渲染层直接访问原始语义细节。
  - 验收：
    - 新增 selector API（最小集合）并被两端消费。
    - renderer 仅处理展示，不做语义纠偏。
