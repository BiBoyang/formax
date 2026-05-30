# Context Compression Alignment TODO Index

只保留未完成项。已完成项不回填，历史以 Git commit 为准。

更新时间：2026-05-31

## 当前状态

2026-05-30 收口结论：

- Claude Code context compression architecture parity 已完成可执行主线；旧未勾选 gap 已由后续 commits 补齐或转入后续候选。
- Claude Code cache editing microcompact 迁移清单已收口。
- WebGPT / subagent 审查收敛修复清单已收口；后续不再从该清单继续派生大批次。
- `CCA-180` 现有 Batch 1 / Batch 2 已完成；下一步如恢复该方向，应先写一个 continuation TODO，而不是重做现有批次。
- `CCA-180` continuation / v8 已完成；active working TODO 已全部勾选，后续从 deferral register 选择下一主线。
- `CCA-181` preserved-segment relink validation parity 已完成。
- post-`CCA-181` compression boundary + reactive compact rolling TODO 已完成；Batch 1 锁住 `microcompact` / `tool_result_budget` / durable replacement 边界，Batch 2/3 收口 TUI `sendMainTurn` reactive compact fallback drainage。

## 已收口主线

- Claude Code context compression architecture parity：
  - [CLAUDE-CODE-COMPRESSION-ARCHITECTURE-PARITY-TODO-2026-05-21.md](./CLAUDE-CODE-COMPRESSION-ARCHITECTURE-PARITY-TODO-2026-05-21.md)
- Claude Code cache editing microcompact 迁移清单：
  - [CACHE-EDITING-MICROCOMPACT-TODO-2026-05-21.md](./CACHE-EDITING-MICROCOMPACT-TODO-2026-05-21.md)
- WebGPT / subagent 审查收敛修复清单：
  - [WEBGPT-REVIEW-FIX-TODO-2026-05-20.md](./WEBGPT-REVIEW-FIX-TODO-2026-05-20.md)

## 下一条推荐主线

- app-server / SDK reactive compact parity audit：
  - 当前 active working TODO：[todolist.md](./todolist.md)。
  - 先 characterization app-server / SDK request paths 是否需要 TUI `sendMainTurn` 同等级别的 reactive compact fallback；不要直接进入完整 durable collapse store / archived spans。
- `CCA-182` reactive compact shaping v3：
  - 当前 rolling TODO 的 Batch 2 / Batch 3 已完成：characterization-first 后只实现 pending request-collapse commit drainage before reactive compact。
  - 未选择新增 `latestReactiveCompact` thread surface，也未选择 broad outcome schema。
- 后续阶段参考清单：
  - [NEXT-TODO-2026-04-07.md](./NEXT-TODO-2026-04-07.md)
- 历史暂停状态：
  - [PAUSE-STATE-2026-05-16.md](./PAUSE-STATE-2026-05-16.md)

## 当前推荐顺序

1. 当前 active TODO Batch 1：characterize app-server / SDK overflow behavior。
2. 当前 active TODO Batch 2：选择 app-server / SDK parity direction。
3. 只有 Batch 2 明确选择实现时，才进入 app-server / SDK minimal implementation slice。
4. durable collapse store / archived spans 与 collapse different-id overlap policy 暂不进入主线，除非真实 bug 或后续 collapse store 扩展需要它。

## 说明

- 当前建议：执行 [todolist.md](./todolist.md) 的 app-server / SDK reactive compact parity audit；先 characterization，再决定是否实现。
- 2026-05-31 执行说明：post-`CCA-181` rolling TODO 已完成。Batch 1 明确 durable tool-result replacement 不新增 stable app-server/Web surface，只暴露 bounded diagnostics；Batch 2/3 锁住 reactive compact trigger / retry / cacheEditPlan / event semantics，并把 pending request-collapse commit drainage 放到 reactive full compact 前，同时隔离 drainage persistence failure，避免阻断 overflow retry。
- 2026-05-31 规划说明：新增 post-`CCA-181` rolling TODO，用一份计划覆盖 tool-result boundary audit 与 `CCA-182` prep / implementation，减少每个小阶段都重新询问 WebGPT 的成本。
- 2026-05-30 执行说明：`CCA-181` preserved-segment relink validation parity 已完成。实现收紧了 relink metadata validation、contiguous explicit refs、durable projection ordering guard、app-server / Web preservedSegment parity，并把 Web compact-boundary cache generation key 收敛到 matching `boundaryFingerprint`。
- 2026-05-30 执行说明：`CCA-180` continuation / v8 已完成，新增 structured `tool_reference` restore extraction、structured task continuity hints、pending restore diagnostics、Web v8 parser compatibility 与 no-new-authority guards。
- 2026-05-30 收口：architecture parity、cache-editing、WebGPT bugfix 三条 2026-05-20/21 主线均已完成，不再作为“当前主线”继续推进。
- 2026-05-21 历史说明：Claude Code cache editing microcompact 迁移清单要求在恢复 `CCA-180` 前先锁住 request-only side-channel 与 Anthropic payload 语义；该要求已满足。
- 2026-05-21 历史说明：Claude Code context compression architecture parity 清单把主线从“单点 cache-editing/WebGPT 收口”升级为“整层压缩架构对齐”。`snip` 与 `context collapse` 后续按 durable projection subsystem 处理，而不是先调 helper 内部启发式。
- 2026-05-20 历史说明：WebGPT / subagent 审查收敛清单要求先完成测试优先收敛，再恢复原 `CCA-180` 主线；该要求已满足。
- 2026-05-21 历史说明：`CCA-180` 的 Batch 1 / Batch 2 已通过 `a7a399ad` 提前完成并保留；当时暂停继续扩展 `CCA-180`，当前已进入 continuation 规划阶段。
- 历史暂停理由、剩余工作量估算、恢复顺序见：
  - [PAUSE-STATE-2026-05-16.md](./PAUSE-STATE-2026-05-16.md)
- `CCA-080` ~ `CCA-085` 与 `CCA-090` 这一波已经完成。
- `CCA-100` / `CCA-110` / `CCA-111` / `CCA-112` 已完成。
- `CCA-120` / `CCA-121` / `CCA-122` / `CCA-123` 这一波也已经完成，当前主线已切换。
- `CCA-130` / `CCA-131` / `CCA-132` 已完成，post-132 重排也已完成。
- `CCA-140` / `CCA-141` / `CCA-142` 已完成。
- `CCA-143` / `CCA-144` / `CCA-145` / `CCA-146` 已完成，当前 14x wave 已收口。
- `CCA-150` 已完成，working-set selector 现已按 anchor kind 区分 backtrack window，并把 `anchorMaxBacktrackTurns` 暴露到 diagnostics。
- `CCA-151` 已完成，app-server `thread/resume` 现在也会复用 canonical restore artifacts，并把 session-memory reminder 作为 next-turn-only injected blocks 在服务端消费一次。
- `CCA-152` 已完成，post-compact/manual/reactive/finalize 这些 surrounding flow 现在会复用 canonical middle-layer stack materialize persisted baseline；terminal prune 不再写回 future-turn history。
- `CCA-153` 已完成，app-server `thread/resume` 现在也会暴露 canonical `latestCompactBoundary`，Web runtime 会在 restore path 直接消费这份 compact protocol fact。
- post-`CCA-153` mainline re-rank 已完成。
- `CCA-160` 已完成，working-set selector 已从 filesystem-cluster-aware 推进到 task-minimal v5：当前会把 recent task planning/todo state 与 `task_execution_cluster`（例如 `Read + Edit + TodoWrite`）一起纳入 keep strategy，并把 `taskStateKinds` / `selectionReasons` 暴露到 diagnostics。
- `CCA-161` 已完成，session-memory restore utility 现在会通过 canonical restore-artifacts 路径生成结构化 `pendingSessionMemoryRestore` 摘要，并让 `thread/resume` / `thread/replay` 在 next-turn-only pending 窗口内共用这份 utility surface。
- `CCA-162` 已完成，`thread/replay` 现在会直接返回 canonical `latestCompactBoundary`，Web replay runtime 也会消费这份 compact protocol fact，并在 replay source 下继续显示 compact header。
- `CCA-163` 已完成，历史上曾引入基于 stale user-turn age 的 time-aware path；该路径已被 2026-05-21 Claude Code-style cache-editing / cold-cache wall-clock assistant-gap microcompact 语义 supersede。当前 active contract 见 `docs/contracts/context-strategy-stack-contract.md`。
- post-`CCA-163` mainline re-rank 已完成。
- `CCA-170` 已完成，manual `/compact` 现在会和 auto compact 一样复用 task-minimal `keep_combo` selector；即使 `keepLastTurns=0`，也会按当前 working-set anchor / planning state / recent files 保留最小任务上下文，而不再退回固定 `keep_last_turns`。
- `CCA-171` 已完成，higher-order restore utility v6 现在会在 canonical `pendingSessionMemoryRestore` / next-turn reminder 路径中额外暴露 bounded 的 `recentSkills` 与 `recentSubagentTypes`，让 restore surface 能恢复更高阶任务状态，而不引入新的 persisted authority。
- `CCA-172` 已完成，Web `thread/messages` inspection path 现在也会保留 canonical `keepStrategy`、`rehydrationPlan`、`rehydrationCost`、`preservedSegment` 这组 deeper compact-boundary fields；thread-scoped compact-boundary cache 也已改成用同一套 deep equality 刷新，避免 history/replay/read/resume 因消费路径不同而退化成不同深度的 compact summary。
- post-`CCA-172` mainline re-rank 已完成。
- 新的 18x 候选主线已恢复并进入排序：
  - deferred-task restore utility v7
  - preserved-segment relink parity（已完成）
  - reactive compact shaping v3
- WebGPT/cache-editing、deferred-task restore utility continuation 与 preserved-segment relink parity 均已收口，当前优先推进 compression-boundary follow-up。
- 仍然不建议直接进入完整 collapse store / archived span 设计。
