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

## P4：Replay-First Invariants

- [ ] N59 replayThreadEvents 测试基座工厂精简
  - 目标：收敛 `createBaseContext` 的可选覆盖写法，减少后续新增 case 时样板噪音。
  - 验收：
    - 不改变现有断言语义，测试全量通过。

- [ ] N60 replay test fixture builder 复用化
  - 目标：为常见 replay 响应体（empty/hasGap/baseline/paged）引入小型 builder，减少重复字面量。
  - 验收：
    - 不改变现有断言语义，测试全量通过。
