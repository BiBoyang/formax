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

- [ ] N113 replay fixture 目录边界文档化
  - 目标：说明 `testFixtures/replayFixtures.ts` 的定位与可复用边界，防止后续散落重复 fixture。
  - 验收：
    - 在 TODO 相关文档中新增 1 条边界说明并指向该文件。

- [ ] N114 processNotification 与 replay fixture 协同约束用例补充
  - 目标：补充 1 个用例，明确共享 replay fixture 在 notification 侧的可用性边界。
  - 验收：
    - processNotification 或 replayThreadEvents 相关测试新增 1 条共享 fixture 协同断言。
