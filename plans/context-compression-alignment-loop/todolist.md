# Claude Code Context Compression Execution TODO

日期：2026-05-22

当前执行入口只看这个文件。旧的 architecture parity TODO、WebGPT 回复、repomix prompt 都只作为历史材料，不再作为当前执行队列。

## 当前结论

- [x] 下一步从 **Gate 1A: core golden projection fixture + durable projection coordinates** 开始。
- [x] Gate 1 不修 parent-chain、snip UUID replay、collapse-active rebase、tool-result durable side-state。
- [x] Gate 1 的目标是锁住同一段压缩历史在 raw transcript、UI visible scrollback、model-facing baseline、next request projection、app-server/Web replay facts 中的坐标关系。
- [x] collapse-active request snip 不写 durable snip event 的 safety guard 当前已存在；Gate 4 前继续保持 request-only。
- [x] Gate 4 collapse-active durable snip rebase 独立成 milestone，不和 Gate 2B 混做。

## Gate 1A: Core Fixture And Durable Projection Coordinates

建议提交名：`test(context): strengthen compression golden projection fixture`

主要文件：

- `packages/core/src/chat/context/compressionProjectionFixture.ts`
- `packages/core/src/chat/context/contextProjectionBaseline.test.ts`
- `packages/core/src/chat/context/contextProjection.test.ts`

Non-goals:

- [x] 不实现 Claude Code-style parentUuid relink。
- [x] 不实现 compact preserved segment `head/anchor/tail` relink。
- [x] 不实现 snip removed UUID replay / relink。
- [x] 不实现 collapse-active durable snip rebase。
- [x] 不实现 `tool_result_budget` / content replacement durable side-state。
- [x] 不 snapshot TUI ANSI、滚动位置、临时文案、token estimate 细节。

Tests first:

- [x] Fixture 包含 pre-boundary 旧 user/assistant 历史：raw transcript 保留，model-facing baseline 不包含。
- [x] Fixture 包含 metadata-only compact boundary，并带 `trigger`、`preTokens`、`summaryKind`、`keepStrategy`、`preservedSegment`、`messageFingerprints`。
- [x] Fixture 包含 compact summary continuation message：作为 continuation head 进入 model-facing baseline；角色按当前 Formax compact summary contract 断言，不在 TODO 层绑定 Claude Code 角色。
- [x] Fixture 包含 post-boundary `assistant tool_use` + `user tool_result` pair。
- [x] Fixture durable snip 删除 tool pair 的一侧，projection 后必须 drop orphan tool block。
- [x] Fixture 包含 recent user / assistant tail：必须进入 model-facing baseline、next request projection、diagnostics projection。
- [x] Fixture request-collapse fact 只作为 latest request-collapse surface fact，不作为 committed durable collapse projection。
- [x] Fixture pending session-memory restore 只作为 restore surface fact / next-turn restore context，不改 raw transcript。
- [x] 断言 `rawTranscript` 保留完整输入，包括 pre-boundary 历史和被 durable snip 删除的消息。
- [x] 断言 `uiScrollback` 保留完整可见消息行，包括 pre-boundary 历史和被 durable snip 从 model-facing baseline 删除的可见消息；但不包含 metadata-only compact boundary、durable snip event、request-collapse event、restore sidecar event。
- [x] 断言 `modelFacingBaseline` 从 latest compact boundary 后开始。
- [x] 断言 compact boundary 自身不进入 model-facing baseline。
- [x] 断言 durable snip 删除目标消息。
- [x] 断言 durable snip 删除 tool pair 一侧后，orphan tool block 被清理。
- [x] 断言同一条被 durable snip 删除的消息满足：raw/session 仍存在、UI visible scrollback 仍可见、model-facing baseline 不包含。
- [x] 断言 `diagnosticsProjection` 与当前 model-facing baseline 在 message order、role、tool linkage 上语义一致。
- [x] 断言 `latestCompactBoundary` 保留 `preservedSegment`、`messageFingerprints`、`keepStrategy`、`summaryKind`。
- [x] 断言 `modelFacingBaseline` 的 exact order / role / key ids-or-fingerprints 正确，不能只比 summary facts。
- [x] 断言 `durableState.toolResultContentReplacement.status = "deferred"`。
- [x] 断言 request-collapse fact 不会被当成 committed durable collapse store。

Validation:

- [x] `bun run test -- packages/core/src/chat/context/contextProjectionBaseline.test.ts packages/core/src/chat/context/contextProjection.test.ts`
- [x] Codex review 前创建输出目录：`mkdir -p .tmp/codex-review-result`
- [x] Codex review: `codex review --uncommitted -c model="gpt-5.5" -c model_reasoning_effort="high" > .tmp/codex-review-result/review-latest.txt 2>&1`；如有 findings，全部修完再提交。
- [x] 检索 review 结论和 findings：`rg -n "Review comment:|Finding|findings|P0|P1|P2|P3|actionable|bug|regression|issue|I did not find|I did not identify" .tmp/codex-review-result/review-latest.txt`；不要只依赖 tail。

## Gate 1B: Next Request Projection Coordinates

建议提交名：`test(context): lock request projection inputs after durable projection`

主要文件：

- `packages/core/src/chat/context/turnRequestProjection.test.ts`
- `packages/core/src/chat/context/contextProjectionBaseline.test.ts` if shared fixture expectations move.

Tests first:

- [x] `prepareTurnRequestProjection()` 断言 `persistedHistory` 仍是 raw transcript。
- [x] `prepareTurnRequestProjection()` 断言 middle-layer stack 输入来自 `contextProjection.modelFacingBaseline`。
- [x] `prepareTurnRequestProjection()` 断言 reducers no-op 时 `requestHistory` 等于 model-facing baseline。
- [x] `prepareTurnRequestProjection()` 断言 pending session-memory restore 不进入 raw transcript 或 durable model-facing baseline；它只属于 restore surface fact / next-turn restore context。
- [x] `prepareTurnRequestProjection()` 断言 request-only reducer output 不被反推成 durable state。

Validation:

- [x] `bun run test -- packages/core/src/chat/context/turnRequestProjection.test.ts packages/core/src/chat/context/contextProjectionBaseline.test.ts`
- [x] Codex review 前创建输出目录：`mkdir -p .tmp/codex-review-result`
- [x] Codex review: `codex review --uncommitted -c model="gpt-5.5" -c model_reasoning_effort="high" > .tmp/codex-review-result/review-latest.txt 2>&1`；如有 findings，全部修完再提交。
- [x] 检索 review 结论和 findings：`rg -n "Review comment:|Finding|findings|P0|P1|P2|P3|actionable|bug|regression|issue|I did not find|I did not identify" .tmp/codex-review-result/review-latest.txt`；不要只依赖 tail。
- [ ] commit。

## Gate 1C: Generation Reset Fixture

建议提交名：`test(context): lock compression generation reset fixture`

主要文件：

- `packages/core/src/chat/context/contextProjection.test.ts`
- `packages/core/src/features/repl/sessionSave/durableSnipStoreEvents.test.ts`
- `packages/core/src/features/repl/sessionSave/requestCollapseEvents.ts` tests if adjacent test coverage exists.

Tests first:

- [x] old compact boundary + old durable snip + newer compact boundary：newer generation 后旧 durable snip removals 被清空或忽略。
- [x] old request-collapse event 在 newer compact boundary 前：`latestRequestCollapse` 不跨 boundary 暴露。
- [x] old durable collapse facts 不跨 newer compact boundary 暴露，除非 future contract 明确支持 boundaryless recovered generation。
- [x] `latestCompactBoundary` 是 newer boundary。
- [x] raw transcript 仍保留 old boundary / old events。
- [x] UI visible rows 不受 stale control-plane events 影响。
- [x] collapse-active request snip safety guard 保持：request-time snip 可以影响当轮 request，但不写 `durable_snip_applied`。
- [x] failed / aborted / interrupted turn 不会把 live compact/snip/collapse facts 提升为 committed durable facts。

Validation:

- [x] `bun run test -- packages/core/src/chat/context/contextProjection.test.ts packages/core/src/features/repl/sessionSave/durableSnipStoreEvents.test.ts`
- [x] `bun run test -- packages/core/src/features/repl/controller/send/contextCompressionService.test.ts` if collapse-active guard test moves or is expanded.
- [x] `bun run type-check` only if runtime types/schema are changed。
- [x] Codex review 前创建输出目录：`mkdir -p .tmp/codex-review-result`
- [x] Codex review: `codex review --uncommitted -c model="gpt-5.5" -c model_reasoning_effort="high" > .tmp/codex-review-result/review-latest.txt 2>&1`；如有 findings，全部修完再提交。
- [x] 检索 review 结论和 findings：`rg -n "Review comment:|Finding|findings|P0|P1|P2|P3|actionable|bug|regression|issue|I did not find|I did not identify" .tmp/codex-review-result/review-latest.txt`；不要只依赖 tail。
- [ ] commit。

## Gate 1D: App-Server / Web Surface Fixture Tests

建议提交名：`test(app-server): route compression fixture facts across replay surfaces`

主要文件：

- `packages/core/src/app-server/server.test.ts`
- `packages/core/src/app-server/threadStore.test.ts`
- Web runtime tests if Web currently caches or displays these compression facts. Gate 1 claims app-server/Web replay facts, so Web coverage is required unless this TODO is explicitly narrowed to core + app-server.

Tests first:

- [x] `thread/resume` 返回 fixture-derived `latestCompactBoundary`。
- [x] `thread/read` 返回同一份 fixture-derived `latestCompactBoundary`。
- [x] `thread/messages` 返回同一份 fixture-derived `latestCompactBoundary`。
- [x] `thread/replay` 返回同一份 fixture-derived `latestCompactBoundary`。
- [x] 四个 surface 返回同一份 durable snip summary。
- [x] 四个 surface 返回同一份 latest request-collapse fact。
- [x] `thread/resume` 返回 pending session-memory restore summary。
- [x] Replay pagination / cached facts 不把 omitted durable snip 当 authoritative null。
- [x] Web 只缓存 RPC compression facts，不从 transcript rows 反推 compact/snip/collapse state。
- [x] Web 遇到 transcript rows 中 compact-looking text 但 RPC facts 为 null 时，不自行推导 compression facts。
- [x] Web 遇到 omitted durable snip 时，不覆盖已有 authoritative durable snip fact。

Validation:

- [x] `bun run test -- packages/core/src/app-server/threadStore.test.ts packages/core/src/app-server/server.test.ts`
- [x] Web targeted tests covering RPC/cache compression facts if Web compression facts remain in Gate 1 scope.
- [x] Codex review 前创建输出目录：`mkdir -p .tmp/codex-review-result`
- [x] Codex review: `codex review --uncommitted -c model="gpt-5.5" -c model_reasoning_effort="high" > .tmp/codex-review-result/review-latest.txt 2>&1`；如有 findings，全部修完再提交。
- [x] 检索 review 结论和 findings：`rg -n "Review comment:|Finding|findings|P0|P1|P2|P3|actionable|bug|regression|issue|I did not find|I did not identify" .tmp/codex-review-result/review-latest.txt`；不要只依赖 tail。
- [ ] commit。

## Gate 2A: Message Identity Groundwork

目标：在不大重写 session writer/reader 的前提下，为 compact preserved segment 和 durable snip 提供稳定 identity substrate。

Non-goals:

- [ ] 不一次性实现完整 Claude Code parentUuid chain。
- [ ] 不改变旧 session 的可恢复性。
- [ ] 不删除 fingerprint guard；fingerprint 仍作为 drift detection / legacy fallback。

Tasks:

- [ ] 先更新 contract，定义 Formax message identity 的最小语义：stable message id、message fingerprint、可选 parent id、旧历史 fallback。
- [ ] 为 compact continuation messages 生成或读取 stable identity。
- [ ] 在 projection/test diagnostics 内暴露 identity-aware fingerprint/debug 信息；除非 contract 明确升级，否则不新增 app-server/Web public fields。
- [ ] 增加 tests，确保旧 boundary 缺 identity 时继续使用 fingerprint/count guard。
- [ ] 增加 tests，确保 identity 不改变 raw transcript / UI scrollback。
- [ ] 定义 identity uniqueness / collision handling。
- [ ] 定义 legacy fallback identity 是否跨进程稳定；如果不能稳定，必须标记为 legacy fallback，不允许被当作强 identity。
- [ ] 增加 tests：duplicate identity 不触发 destructive identity-based replay。
- [ ] 增加 tests：missing parent id 不影响 raw transcript / UI scrollback / model-facing baseline。
- [ ] 增加 tests：SDK validation roundtrip 不丢 identity/fingerprint 扩展字段。

## Gate 2B: Snip Removed UUID / Identity Replay

目标：优先解决日常长会话风险：snipped messages 在 resume 后不得复活进 model-facing baseline。

Non-goals:

- [ ] 不实现 full Claude Code parentUuid chain reconstruction。
- [ ] 不实现 compact preserved segment `head/anchor/tail` relink。
- [ ] 不处理 collapse-active durable snip rebase；collapse-active 仍保持 request-only snip，不写 durable event。

Tasks:

- [ ] 更新 `durable_snip_applied` snapshot schema：保留 current range，同时增加 removed message identity / fingerprint / base projection fingerprint / source projection kind。
- [ ] 明确 `durable_snip_applied` 是 snapshot 语义，不是 incremental patch；latest valid snapshot 覆盖 older snapshot，empty snapshot 清空 state。
- [ ] 收紧 mismatch 策略：removed identity 存在但 fingerprint 不匹配时，必须 skip durable removal，并在 facts/debug reason 中标记 drift；只有旧事件缺 identity 时，才允许 fallback 到 legacy range/count/fingerprint guard。
- [ ] 写 tests：failed turn 不写 durable snip。
- [ ] 写 tests：new compact boundary generation 后旧 snip state 清空或忽略。
- [ ] 写 tests：snip 删除 tool pair 一侧后 provider-facing model baseline 不含 orphan tool block。
- [ ] 写 tests：collapse-active request snip 成功 turn 后仍不写 `durable_snip_applied`，resume 后不应用 collapsed-coordinate removal。
- [ ] 写 tests：removed identity 找不到时 skip，不按旧 range 盲删。
- [ ] 写 tests：duplicate fingerprint / duplicate identity 进入 safe path，不做 destructive removal。
- [ ] 写 tests：raw JSONL/session 文件仍包含 removed messages 和 durable snip event。

## Gate 2C: Compact Preserved Segment Relink

目标：把 compact preserved segment 从 fingerprint/count guard 推向 Claude Code-style `head/anchor/tail` relink 语义。

Tasks:

- [ ] 更新 `session-persistence-contract.md`，定义 preserved segment identity / relink 语义与旧 boundary fallback。
- [ ] 扩展 compact boundary metadata，记录 summary/head/anchor/tail identity。
- [ ] 明确最终 replay/load order：compact preserved segment relink 先于 snip removal/relink，即使工程交付顺序是先 Gate 2B 后 Gate 2C。
- [ ] 写 tests：preserved tail resume 后不丢、不重复、不截断。
- [ ] 写 tests：old boundary 缺新 identity 字段时 fallback 到 fingerprint guard。
- [ ] 写 tests：anchor 缺失时不 relink，不重复 preserved tail，fallback 到 fingerprint/count guard。
- [ ] 写 tests：head/tail fingerprint mismatch 时 skip relink 或 fallback，但不能产生重复 tail。
- [ ] 写 tests：compact preserved segment + later durable snip 组合。

## Gate 4: Collapse-Active Durable Snip Rebase

目标：只有在 message identity、durable snip replay、compact preserved segment relink 稳定后，才处理 collapse-active 下 durable snip persistence。

Current safe behavior:

- [x] collapse-active request snip 可以 request-only 降低当轮请求体积。
- [x] collapse-active request snip 不写 durable snip event。

Tasks:

- [ ] 先更新 contract，定义坐标空间：raw compact continuation、durable snip baseline、durable collapse projection、request reducer output。
- [ ] Gate 4 不做泛化 compression migration framework；只解决 collapse-active request snip removal -> durable baseline removal -> collapse ranges recompute or skip。
- [ ] 拆成可 review 子提交：contract + failing tests；snip removal rebase；collapse range recompute/skip policy；surface/facts tests。
- [ ] removal 命中 synthetic collapse recap 本身，默认 skip durable persistence。
- [ ] removal 横跨 recap 和普通消息，不能简单平移 index。
- [ ] removal 删除 collapse source range 的一部分，默认 skip durable persistence，除非 contract 明确支持 delete source range。
- [ ] partial rebase failure 整体不写 durable snip event，不做部分 durable 写入。
- [ ] turn 成功后 projection、resume 后 projection、repeat replay projection 幂等一致。

## Gate 5: Tool Result Durable Side-State

目标：最后处理 Claude Code-style durable tool-result content replacement。继续和 Anthropic cache editing 区分。

Tasks:

- [ ] 先更新 contract：定义 request-only `tool_result_budget` 与新增 durable tool-result content replacement side-state 的边界；不要把 `tool_result_budget` 本身改写成 durable stage。
- [ ] 定义 content replacement event / snapshot schema。
- [ ] 支持 main thread 与 agent/sidechain 最小 scope 隔离；不做完整 agent transcript 架构改造。
- [ ] projection owner 应用 durable replacement，但 raw transcript 不变。
- [ ] request-only `tool_result_budget` 与 durable replacement 不重复替换。
- [ ] Anthropic `cache_reference/cache_edits` 仍保持 provider side effect，不成为 durable authority。

## Global Review Checklist

- [ ] Diff 只包含当前 Gate，不夹带 cleanup 或 unrelated behavior。
- [ ] 如改变 durable behavior，contract 先更新。
- [ ] raw transcript / UI visible scrollback 不被 durable projection 改写。
- [ ] persisted history、model-facing baseline、request history 不混淆。
- [ ] compact generation scope 不泄漏旧 snip/collapse state。
- [ ] 删除/collapse/replacement 后 provider payload 不出现 orphan tool_use/tool_result。
- [ ] app-server/Web/TUI 只消费 canonical facts，不各自推导 compression semantics。
- [ ] failed / aborted turn 不写成功态 durable state。
- [ ] targeted tests 通过。
- [ ] Codex review 使用 `gpt-5.5 high`，输出到 `.tmp/codex-review-result/review-latest.txt`；用 `rg` 检索 findings / no-finding 结论，不只看 tail；如有 findings，全部修完再提交。
