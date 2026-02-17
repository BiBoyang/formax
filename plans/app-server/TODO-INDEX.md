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

- [ ] N49 replay 状态水位同步拆分副作用边界
  - 目标：将 `replayThreadEvents` 中 runtimeState/source/cursor/pending/mode 的写入边界进一步拆分，降低分支间耦合。
  - 验收：
    - 形成清晰的“state hydrate / source-cursor commit / active-thread sync”三段式调用。
    - 主流程分支深度继续下降且行为不变。

- [ ] N50 deferred projection 后激活线程回放回归测试
  - 目标：覆盖“先在非激活线程 deferred，再切换为激活线程 replay”场景，确保最终可正确 hydration。
  - 验收：
    - 新增/扩展 web runtime 定向测试并通过。
