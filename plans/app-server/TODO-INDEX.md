# TODO-INDEX：Semantics Single-Writer（Rolling）

更新时间：2026-02-18
任务来源（唯一）：
- `plans/_archive/app-server/ARCHITECTURE-ROADMAP.md`
- `docs/harness/design/semantics-architecture-blueprint.md`

> 本清单只保留未完成任务。历史完成记录以 Git commit 为准。

## 当前待办

- 暂无未完成项。

## 再生规则（当“当前待办”为空时）

1. 仅从 roadmap + blueprint 派生下一批任务。
2. 按“小切片可提交”拆分（每项尽量 2-6 文件改动）。
3. 每项固定流程：实现 -> 定向测试 -> `codex review` -> 提交。
4. 新任务写入本文件后，旧的已完成项不回填。

## Replay Fixture Boundary（长期约束）

- 共享 replay 测试夹具统一放在 `apps/web-reference-react/src/app/runtime/testFixtures/replayFixtures.ts`。
- 新增 replay fixture 时优先扩展该文件；避免在 `replayThreadEvents.test.ts` 与 `threadActions.test.ts` 内重复内联定义。
- 字段新增流程：
  1. 先改 `testFixtures/replayFixtures.ts`（默认值 + 类型）。
  2. 再改至少一个 replay 路径测试（`replayThreadEvents.test.ts`）。
  3. 最后改至少一个 notification 路径测试（`processNotification.test.ts`）。
- 固定 smoke 命令（在 `apps/web-reference-react` 下执行）：
  - `bunx vitest run --config vitest.config.ts src/app/runtime/processNotification.test.ts src/app/runtime/replayThreadEvents.test.ts src/app/runtime/threadActions.test.ts`
