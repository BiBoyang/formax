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
- 固定 smoke 命令（在 `apps/web-reference-react` 下执行）：
  - `bunx vitest run --config vitest.config.ts src/app/runtime/processNotification.test.ts src/app/runtime/replayThreadEvents.test.ts src/app/runtime/threadActions.test.ts`
- 运行顺序：先阅读本节边界规则，再执行固定 smoke 命令，最后执行 `codex review --uncommitted`。

## P1：Single Writer 闭环（移除直写 transcript）

- [ ] S1 清理语义路径中的 direct transcript write 残留
  - 已完成：切片 A（直写点梳理）见 `plans/app-server/SINGLE-WRITER-WRITE-POINTS.md`。
  - 待做：切片 B，把保留路径改为 canonical -> projection -> renderer 单链路。
  - 待做：切片 C，补回归测试（重复 tool 行、assistant 消息缺失、turn 终局 running 泄漏）。
  - 验收：关键语义路径不存在 direct transcript write，不依赖止血补丁。

## P2：Replay-First 恢复一致性

- [ ] R1 gap/reconnect/restart 三场景统一恢复流程
  - 切片 A：统一 `hasGap=true` 的 baseline replay + snapshot hydrate 流程。
  - 切片 B：统一 `connectRpcClient` 断线重连后的 replay 重建行为。
  - 切片 C：补齐恢复路径不变量测试（无重复完成行、turn 终局无 running）。
  - 验收：realtime 与 replay 输出一致，恢复路径不再分叉。
