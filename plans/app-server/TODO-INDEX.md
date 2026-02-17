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

- [ ] N45 replay cursor 单调推进断言收敛
  - 目标：将 replay cursor 前进规则收敛到统一断言 helper，避免各分支手工比较导致的边界漂移。
  - 验收：
    - 引入 cursor 前进断言 helper（含 nextCursor/latestCursor 边界）。
    - `replayThreadEvents` 主循环使用统一 helper 判断中断/推进。

- [ ] N46 replay-vs-history 提升策略回归测试补齐
  - 目标：补齐 `shouldPromoteReplayAsCanonical` 在 hasGap/rebuild 后的回归用例，确保 transcript source 切换稳定。
  - 验收：
    - 新增/扩展 web runtime 定向测试并通过。
