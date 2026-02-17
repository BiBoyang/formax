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

## P1：Single Writer 收口（来自 Milestone 1 / G1）

- [ ] SW-02 为 turn 终局建立统一 invariant 检查入口（TUI 侧）
  - 目标：将“无 running 泄漏、toolUseId 不重复、终局不可回写”整合到单一检查函数。
  - 已完成切片 A：新增 `canonicalInvariants.ts`，并在 main turn/bash turn final merge 后统一触发检查（按当前 turn 范围收敛）。
  - 验收：现有 REPL 语义门禁与 controller 测试都通过，并新增至少 1 个“终局后回写被拒绝/忽略”回归用例。

## P2：Adapter 单点化补全（来自 Milestone 2 / G2）

- [ ] AD-01 盘点并消除剩余的 turn notification 本地分支映射
  - 目标：通知到 canonical 的类型分发只保留在 `src/features/semantics/adapters/*`。
  - 验收：Web/TUI/app-server 路径不再出现并行 mapping 分支（允许薄封装调用，不允许重写规则）。

- [ ] AD-02 增加一组跨入口 contract fixture（stream / notification / replay）
  - 目标：同一 fixture 在三入口下得到同构 canonical 序列（至少校验 kind + replaySeq + 关键 payload）。
  - 验收：新增 contract test 文件并纳入常用回归命令。

## P3：Replay-First 强化（来自 Milestone 3 / G4）

- [ ] RP-01 收紧 `hasGap=true` 的客户端路径：禁止隐式继续增量拼接
  - 目标：所有 gap 场景都显式进入 rebuild/replay-first 路径。
  - 验收：现有 replay tests 继续通过，并新增“gap 后禁止旧增量落地”的反例测试。

## P4：Tool Presentation IR 长期化（来自 Milestone 4 / G3）

- [ ] IR-01 提取一个工具（建议 `Bash` 或 `Task`）的 presenter IR 契约样板
  - 目标：形成“语义 -> IR -> renderer”最小模板，后续工具可照搬。
  - 验收：TUI/Web 渲染不分叉语义；新增工具展示字段时不需要改 projection 逻辑。
