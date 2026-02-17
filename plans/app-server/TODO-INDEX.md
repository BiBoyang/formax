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

- [ ] N72 replay runtime-state 断言 helper 化（lastReplaySeq/cursor）
  - 目标：收敛重复的 runtime-state 断言模式，降低后续语义字段迁移时的改动面。
  - 验收：
    - 不改变现有断言语义，测试全量通过。

- [ ] N73 replay hasGap 场景 builder 收敛（gap/baseline 双页）
  - 目标：为 hasGap + baseline 双页路径提供轻量 fixture builder，减少重复数据拼装。
  - 验收：
    - 不改变现有断言语义，测试全量通过。
