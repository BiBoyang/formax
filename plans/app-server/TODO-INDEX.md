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
- 字段新增流程：
  1. 先改 `testFixtures/replayFixtures.ts`（默认值 + 类型）。
  2. 再改至少一个 replay 路径测试（`replayThreadEvents.test.ts`）。
  3. 最后改至少一个 notification 路径测试（`processNotification.test.ts`）。
- 字段变更 smoke 清单：
  - `apps/web-reference-react/src/app/runtime/replayThreadEvents.test.ts`
  - `apps/web-reference-react/src/app/runtime/processNotification.test.ts`
  - `apps/web-reference-react/src/app/runtime/threadActions.test.ts`

## P4：Replay-First Invariants

- [ ] N119 processNotification 异常 envelope 用例接入共享 fixture
  - 目标：让 invalid schema / missing envelope 分支也复用共享 fixture，降低字段漂移。
  - 验收：
    - processNotification.test 至少 1 个异常 envelope 用例改为基于共享 fixture派生。
