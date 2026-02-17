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

## P2：Contract & Adapter Consolidation

- [ ] N17 Task result parsing 单点化（selector/send 复用）
  - 目标：消除 Task 结果解析逻辑重复（`taskResult.ts` 与 `toolPresentation`），避免后续行为漂移。
  - 验收：
    - `parseBackgroundTaskId` 仅保留一个实现并被两侧复用。
    - 现有 Task started/done 相关测试全部通过。

## P4：Replay-First Invariants

- [ ] N18 terminal invariant fixture 扩面（running tool）
  - 目标：补齐“turn terminal 后不应存在 running tool”的 realtime/replay fixture，和 pending-input fixture 对称。
  - 验收：
    - 新增一条 realtime/replay parity fixture，覆盖 terminal 后 running tool 清理。
    - 使用 shared invariant selector 校验无 `running_tool_after_terminal_turn`。

- [ ] N19 invariant selector 接入 app-server 诊断快照（只读）
  - 目标：在 app-server 诊断/快照路径提供 invariant issues 只读输出，便于跨端排障。
  - 验收：
    - 诊断输出新增 invariant issues 字段（不改业务语义）。
    - 至少一条测试覆盖该字段存在且结构稳定。
