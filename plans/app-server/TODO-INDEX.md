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

## P3：Presentation IR

- [ ] N15 Tool Presentation selector phase 3（Task 完成态文案派生）
  - 目标：把 Task 完成态（Started/Done）文案派生从 TUI mapping 进一步下沉到 shared selector，减少端内分支。
  - 验收：
    - TUI mapping 对 Task 完成态不再内联拼接 Started/Done 文案。
    - Web/TUI 均消费 selector 的 Task 完成态派生结果。

## P4：Replay-First Invariants

- [ ] N16 Realtime=Replay fixture 扩面（pending input 终局）
  - 目标：补齐“pending input 在 turn terminal 后必须终局”的跨路径 fixture，锁住 realtime/replay 一致。
  - 验收：
    - 新增 fixture 覆盖 realtime 与 replay 两条路径。
    - 同一输入序列下，两条路径输出一致且无 pending input leak。
