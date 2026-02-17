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

- [ ] N111 hasGap 重建路径 fixture 复用到 threadActions
  - 目标：将 replayThreadEvents 的 hasGap baseline fixture 在 threadActions 侧复用，减少恢复路径漂移。
  - 验收：
    - `replayThreadEvents` 与 `threadActions` 至少各 1 个用例复用同一 fixture helper。

- [ ] N112 threadActions replay 失败路径与 hasGap fixture 对齐
  - 目标：让 threadActions 的 fallback/replay-fail 场景使用与 replay tests 一致的数据语义。
  - 验收：
    - 至少 1 个 threadActions 用例使用 shared replay fixture builder。
