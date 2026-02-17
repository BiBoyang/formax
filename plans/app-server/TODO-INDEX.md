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

- [ ] N21 invariant issue 派生与快照构建解耦
  - 目标：把 app-server 内 replay state snapshot 组装中的 invariant 派生抽到独立 helper，降低 `server.ts` 复杂度。
  - 验收：
    - `server.ts` 中 thread/replay 快照组装逻辑减少重复分支。
    - 新 helper 有最小单元测试覆盖。

- [ ] N22 realtime/replay parity fixture 扩面（inputResolved 边界）
  - 目标：补齐 `turn/inputResolved` 边界（submitted/canceled/expired/failed）的 realtime/replay parity fixture。
  - 验收：
    - 至少覆盖两种 resolved 终局状态。
    - parity fixture 下 runtime pendingInputs 无泄漏且两路径一致。
