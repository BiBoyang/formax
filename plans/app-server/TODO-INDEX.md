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

## Replay Fixture Boundary

- 共享 replay 测试夹具统一放在 `apps/web-reference-react/src/app/runtime/testFixtures/replayFixtures.ts`。
- 新增 replay fixture 时优先扩展该文件；避免在 `replayThreadEvents.test.ts` 与 `threadActions.test.ts` 内重复内联定义。

## P4：Replay-First Invariants

- [ ] N116 processNotification envelope 用例接入共享 replay fixture
  - 目标：把 processNotification 里完整 envelope 的测试数据接到 `replayFixtures.ts`，减少协议字段漂移。
  - 验收：
    - processNotification.test 至少 1 个 envelope 用例改为使用共享 fixture。

- [ ] N117 replay fixture 扩展策略补充（字段新增流程）
  - 目标：定义共享 fixture 新增字段时的最小更新流程（fixture -> 相关测试），降低遗漏风险。
  - 验收：
    - TODO-INDEX 或相关计划文档新增 1 条“字段新增流程”说明。
