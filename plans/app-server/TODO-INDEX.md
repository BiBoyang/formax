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

- [ ] N112 threadActions replay 失败路径与 hasGap fixture 对齐
  - 目标：让 threadActions 的 fallback/replay-fail 场景使用与 replay tests 一致的数据语义。
  - 验收：
    - 至少 1 个 threadActions 用例使用 shared replay fixture builder。

- [ ] N113 replay fixture 目录边界文档化
  - 目标：说明 `testFixtures/replayFixtures.ts` 的定位与可复用边界，防止后续散落重复 fixture。
  - 验收：
    - 在 TODO 相关文档中新增 1 条边界说明并指向该文件。
