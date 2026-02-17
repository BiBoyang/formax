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

## P2：Adapter 单点化补全（来自 Milestone 2 / G2）

- [ ] AD-02 增加一组跨入口 contract fixture（stream / notification / replay）
  - 目标：同一 fixture 在三入口下得到同构 canonical 序列（至少校验 kind + replaySeq + 关键 payload）。
  - 已完成切片 A：新增 `crossPathContractFixture.ts` 并在 `canonicalEventAdapter.contract.test.ts` 校验 stream/notification/replay-like 入口同构输出。
  - 验收：新增 contract test 文件并纳入常用回归命令。
  - 未完成切片：
    - [x] AD-02.B：补 replay 真路径同构断言（接入 `apps/web-reference-react` replay 测试路径）。
    - [x] AD-02.C：补乱序 + 重复 `replaySeq` 的归一化同构断言。
    - [x] AD-02.D：将 contract fixture 纳入固定语义回归命令（gate/smoke）。

## P3：Replay-First 强化（来自 Milestone 3 / G4）

- [ ] RP-01 收紧 `hasGap=true` 的客户端路径：禁止隐式继续增量拼接
  - 目标：所有 gap 场景都显式进入 rebuild/replay-first 路径。
  - 验收：现有 replay tests 继续通过，并新增“gap 后禁止旧增量落地”的反例测试。
  - 未完成切片：
    - [ ] RP-01.A：新增反例测试：`hasGap=true` 且同页有 `data` 时，不允许继续增量落地旧事件。
    - [ ] RP-01.B：新增反例测试：rebuild 后 cursor 推进正确，且不重复落地 tail。
    - [ ] RP-01.C：在 `replayThreadEvents.ts` 显式收紧 `hasGap` 分支保护（只走 rebuild，不消费当前页 `data`）。
    - [ ] RP-01.D：补一条 reconnect/gap/restart 一致性回归（Realtime = Replay）。

## P4：Tool Presentation IR 长期化（来自 Milestone 4 / G3）

- [ ] IR-01 提取一个工具（建议 `Bash` 或 `Task`）的 presenter IR 契约样板
  - 目标：形成“语义 -> IR -> renderer”最小模板，后续工具可照搬。
  - 验收：TUI/Web 渲染不分叉语义；新增工具展示字段时不需要改 projection 逻辑。
  - 未完成切片：
    - [ ] IR-01.A：选择 `Bash` 作为样板，抽离最小 IR 契约（语义输入 -> IR）。
    - [ ] IR-01.B：TUI renderer 仅消费 IR（不依赖语义层细节字段）。
    - [ ] IR-01.C：Web renderer 仅消费 IR（与 TUI 保持同语义输入）。
    - [ ] IR-01.D：补 IR 契约测试：新增展示字段不需要改 projection。

## Closure：文档收口与验收

- [ ] CLOSE-01：回写 `ARCHITECTURE-ROADMAP.md` 与 `SEMANTICS-ARCHITECTURE-BLUEPRINT.md` 的完成证据（Milestone 2/3/4 + Exit Criteria 1-4）。

## 关系说明（避免重复）

- 当前待办总计 12 项：`AD-02`(3) + `RP-01`(4) + `IR-01`(4) + `CLOSE-01`(1)。
- 这 12 项是对现有 `AD-02 / RP-01 / IR-01` 的展开与收口，不是新增并行主线。
- Blueprint Exit Criteria 1-4 作为验收映射使用：通过 `AD-02 / RP-01 / IR-01 / CLOSE-01` 给出证据闭环。
