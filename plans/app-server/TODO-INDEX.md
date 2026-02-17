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

- [ ] N43 hasGap 路径补齐 replay refs 重建事务语义
  - 目标：`hasGap=true` 触发重建时，确保 replay 相关 refs（cursor/anomaly/runtime）以“单事务重建”方式落地，避免中间态读写。
  - 验收：
    - 明确 reset/hydrate 顺序并统一到单入口 helper。
    - 不再在多个回调路径重复手工重置 replay refs。

- [ ] N44 hasGap 重建回归测试补齐
  - 目标：覆盖“gap 后重建 + 后续增量 replay”场景，验证无重复 tool 行、无遗留 anomaly 重复告警。
  - 验收：
    - 新增/扩展 web runtime 定向测试并通过。
