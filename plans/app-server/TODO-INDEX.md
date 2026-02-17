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

- [ ] N114 processNotification 与 replay fixture 协同约束用例补充
  - 目标：补充 1 个用例，明确共享 replay fixture 在 notification 侧的可用性边界。
  - 验收：
    - processNotification 或 replayThreadEvents 相关测试新增 1 条共享 fixture 协同断言。

- [ ] N115 replay fixture 目录边界在相关测试头部注释对齐
  - 目标：让使用共享 fixture 的测试文件有统一注释提示，降低后续误用概率。
  - 验收：
    - 至少 1 个使用方测试文件新增/更新边界注释并通过测试。
