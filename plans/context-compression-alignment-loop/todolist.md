# Context Compression WebGPT Bugfix TODO

日期：2026-05-22

当前执行入口只看这个文件。旧 Gate 已完成并进入 git 历史。本文件已根据
`repomix-output/07-optimization-audit/response/{05.1,06.1,02.1}.md` 复审意见重排。

## 当前结论

- [x] 可以开始执行，但不能按“大 Batch 1”一次性做。
- [x] 每个条目按一个小 commit 执行：tests first → 实现 → targeted tests → `type-check`（如涉及类型/跨包）→ codex review → 修复 findings → commit。
- [x] `SDK durable snip resume parity` 可以先做；但 `SDK same-turn snip + collapse rebase` 不单独提前做，必须和 same-turn dependency / policy 一起处理。
- [x] `success-boundary` 必须前置到 cleanup 前，避免失败 turn 留下 replay-authoritative durable state。
- [ ] `session reader strictness` 是 correctness hardening，但不要和 runtime wiring / success-boundary 混在同一 commit。
- [ ] `Batch 3` 只作为 cleanup backlog，不能作为一个大 refactor commit。

## 通用 Commit Gate

每个 commit 都执行：

- [x] 明确本 commit 只解决一个问题域。
- [x] 先补 regression / characterization test。
- [x] 只改实现到让该测试通过，不顺手重构。
- [x] 跑本 commit 的 targeted tests。
- [x] 如改类型、跨 package import、公共 contract，跑 `bun run type-check`。
- [x] `mkdir -p .tmp/codex-review-result`
- [x] `codex review --uncommitted -c model="gpt-5.5" -c model_reasoning_effort="high" > .tmp/codex-review-result/review-latest.txt 2>&1`
- [x] `rg -n "Review comment:|Finding|findings|P0|P1|P2|P3|actionable|bug|regression|issue|I did not find|I did not identify" .tmp/codex-review-result/review-latest.txt`
- [x] 修完 review findings。
- [x] commit。

## Commit 1: SDK Durable Snip Resume Parity

建议提交名：`fix(sdk): replay durable snip state on file-backed resume`

主要文件：

- `packages/core/src/sdk/query/runner.ts`
- `packages/core/src/sdk/query.options-alignment.test.ts`
- 可能需要 `packages/core/src/features/repl/sessionSave/index.ts` 或相邻 export。

Tasks:

- [x] 新增 SDK resume regression：session JSONL 含 `durable_snip_applied`。
- [x] 断言 `runtime.engine.runTurn()` 收到的 `requestHistory` 不包含 snipped message。
- [x] 断言 `history` / persisted raw transcript 仍保留原始消息。
- [x] 新增 compact-boundary resume regression：active history 已裁掉 boundary 时，仍按 replay history 保留 boundary-scoped durable snip。
- [x] SDK `query()` path 读取 `readDurableSnipStateFromSession()`。
- [x] 每次 attempt 按 `currentHistory` 调 `scopeDurableSnipStateToHistory()`。
- [x] SDK durable snip scoping 使用 `replayHistory` 作为 generation 参考，避免 compact boundary 被 active history 裁掉后清空有效 snip。
- [x] 将 scoped snip state 传入 `prepareTurnRequestProjection({ durableState: { snip, collapse, toolResultContentReplacement } })`。
- [x] 不在本 commit 处理 SDK same-turn snip + collapse rebase。

Validation:

- [x] `bun run test -- packages/core/src/sdk/query.options-alignment.test.ts`
- [x] `bun run test -- packages/core/src/chat/context/turnRequestProjection.test.ts`
- [x] `bun run type-check`
- [x] 通用 Commit Gate。

## Commit 2: Boundaryless Durable Snip Scoping

建议提交名：`fix(context): preserve durable snip state on boundaryless resumes`

主要文件：

- `packages/core/src/chat/context/contextProjection.ts`
- `packages/core/src/chat/context/contextProjection.test.ts`
- `packages/core/src/chat/context/turnRequestProjection.test.ts`

Tasks:

- [x] 新增 `scopeDurableSnipStateToHistory()` regression：history 无 compact boundary，但 state 有 `activeCompactBoundaryFingerprint` 和 removals 时，应保留 removals。
- [x] 保留现有 “观察到 newer compact boundary 时清空旧 generation snip” 测试。
- [x] 将 snip scoping 调整为与 tool-result replacement 一致：只有 observed boundary 存在且 mismatch 时清空。
- [x] 不在本 commit 让 `buildContextProjection().facts.activeCompactBoundaryFingerprint` 从 snip state fallback；public facts 语义保持不变。

Validation:

- [x] `bun run test -- packages/core/src/chat/context/contextProjection.test.ts packages/core/src/chat/context/turnRequestProjection.test.ts`
- [x] `bun run type-check`
- [x] 通用 Commit Gate。

## Commit 3: Same-Turn Snip + Collapse Safety Policy

建议提交名：`fix(context): avoid unsafe same-turn snip collapse commits`

主要文件：

- `packages/core/src/chat/context/contextProjection.ts`
- `packages/core/src/chat/context/contextProjection.test.ts`
- `packages/core/src/features/repl/controller/send/contextCompressionService.ts`
- `packages/core/src/features/repl/controller/send/contextCompressionService.test.ts`
- `packages/core/src/app-server/turnRunner.ts`
- `packages/core/src/app-server/turnRunner.test.ts`
- `packages/core/src/sdk/query/runner.ts`
- `packages/core/src/sdk/query.options-alignment.test.ts`

Decision:

- [x] 先采用最小安全策略：same-turn request snip applied 且 collapse applied 时，collapse 仍可用于当轮 request，但不持久化依赖该 request snip 的 durable collapse commit。
- [x] 不在本 commit 引入 dependency metadata schema，除非 tests 证明 skip policy 不可行。

Tasks:

- [x] 新增 same-turn persistence regression：request snip + request collapse 同轮生效时，snip 可持久化但 collapse commit 为 null。
- [x] REPL/app-server/SDK 对 same-turn snip+collapse 使用统一 policy：不写 unsafe durable collapse commit。
- [x] 保留无 snip 场景 collapse commit 行为。
- [x] 保留 request-only collapse 当轮生效行为。
- [x] SDK 不再单独只补 rebase；如仍需要 rebase，只能在本 commit 与 dependency/safety policy 一起完成。

Validation:

- [x] `bun run test -- packages/core/src/chat/context/contextProjection.test.ts`
- [x] `bun run test -- packages/core/src/features/repl/controller/send/contextCompressionService.test.ts`
- [x] `bun run test -- packages/core/src/app-server/turnRunner.test.ts`
- [x] `bun run test -- packages/core/src/sdk/query.options-alignment.test.ts`
- [x] `bun run type-check`
- [x] 通用 Commit Gate。

## Commit 4: Durable Commit Success Boundary

建议提交名：`fix(context): gate durable compression commits on successful turns`

主要文件：

- `packages/core/src/features/repl/controller/send/sendMainTurn.ts`
- `packages/core/src/features/repl/controller/send/sendMainTurn.test.ts`
- `packages/core/src/app-server/turnRunner.ts`
- `packages/core/src/app-server/turnRunner.test.ts`
- `packages/core/src/features/repl/controller/session/sessionEvents.ts` if needed.

Clarification:

- [x] 区分 request attempt diagnostic event、pending collapse drain、durable future-state commit。
- [x] 不写反合同测试：如果当前设计需要 overflow 前 drain pending collapse commit，必须单独建模，不能把 pending 当 completed durable success。

Tasks:

- [x] REPL test：initial overflow + `prepared.collapseState.commit` + `runReactiveCompact` reject，不应留下 completed-turn durable snip/collapse success state。
- [x] REPL test：initial overflow + reactive compact success + retry `engine.runTurn` reject/abort，不应留下 completed-turn durable snip/collapse success state。
- [x] App-server test：durable snip/collapse candidate 存在，但 history snapshot append 或 flush 失败时，reader / replay surface 不暴露 completed durable state。
- [x] App-server completed turn 仍能持久化 durable snip/collapse，并更新 in-memory collapse store。
- [x] interrupted/failed turn 不写 completed durable snip/collapse success state。
- [x] 如实现 pending event，pending event 必须 reader-invisible。

Validation:

- [x] `bun run test -- packages/core/src/features/repl/controller/send/sendMainTurn.test.ts`
- [x] `bun run test -- packages/core/src/app-server/turnRunner.test.ts packages/core/src/app-server/server.test.ts`
- [x] `bun run test -- packages/core/src/features/repl/controller/send/contextCompressionService.test.ts`
- [x] `bun run type-check`
- [x] 通用 Commit Gate。

## Commit 5: App-Server Compact Boundary Cache Tri-State

建议提交名：`fix(app-server): preserve replay compact boundary cache on omitted facts`

主要文件：

- `packages/core/src/app-server/server.ts`
- `packages/core/src/app-server/server.test.ts`

Tasks:

- [x] 新增 replay cache test：已有 cached `latestCompactBoundary` 后，partial result 省略该字段时不得清空 cache。
- [x] 新增 explicit null test：`latestCompactBoundary: null` 应清空 cache。
- [x] 修改 `rememberLatestCompactBoundary()`：`undefined` 表示 omitted / no update；只有 explicit `null` 才写 null。

Validation:

- [x] `bun run test -- packages/core/src/app-server/server.test.ts`
- [x] 通用 Commit Gate。

## Commit 6: Web Compression Fact Tri-State Parsing

建议提交名：`fix(web): preserve compression fact tri-state parsing`

主要文件：

- `packages/web-reference-react/src/app/core/rpcParsers.ts`
- `packages/web-reference-react/src/app/core/rpcParsers.test.ts`
- `packages/web-reference-react/src/app/core/threadCache.test.ts`

Decision:

- [x] malformed-present compression fact object 使用 omit / non-authoritative，不 reject 整个 response。

Tasks:

- [x] 新增 parser/cache test：`thread/messages` 返回 malformed `latestCompactBoundary` / `durableSnip` / `latestRequestCollapse` object 时，不应输出 explicit null，也不应清空已有 authoritative cache。
- [x] 新增 explicit null test：raw field 为 `null` 时才输出 null 并清空 cache。
- [x] 保留 omitted test：raw field absent 时不输出字段且不覆盖 cache。
- [x] 修改 `asThreadMessages()` 三态处理：absent = omit，explicit null = null，valid object = value，invalid object = omit。

Validation:

- [x] `bun run test -- packages/web-reference-react/src/app/core/rpcParsers.test.ts packages/web-reference-react/src/app/core/threadCache.test.ts`
- [x] `bun run type-check`
- [x] 通用 Commit Gate。

## Commit 7: MicroCompact Durable-Replaced Tool Result Guard

建议提交名：`fix(context): skip durable-replaced tool results in microcompact`

主要文件：

- `packages/core/src/chat/context/microCompact.ts`
- `packages/core/src/chat/context/microCompact.test.ts`
- `packages/core/src/chat/context/toolResultBudget.ts` if sharing predicate.
- `packages/core/src/chat/context/toolResultBudget.test.ts` if sharing predicate.

Tasks:

- [x] 新增 cache-editing microcompact regression：带 `meta.durableToolResultContentReplacementToolUseIds` 的 long tool result 不产生 cache edit plan / fallback stub。
- [x] 新增 time-based microcompact regression：old assistant timestamp + durable-replaced old result，不被 `TIME_BASED_MC_CLEARED_MESSAGE` 覆盖。
- [x] 在 `collectTimeBasedToolResultRefs()` 跳过 durable-replaced tool result。
- [x] 在 `collectEligibleToolResults()` 跳过 durable-replaced tool result。
- [x] 如抽 helper，只抽 predicate，不改 microcompact 策略顺序。

Validation:

- [x] `bun run test -- packages/core/src/chat/context/microCompact.test.ts packages/core/src/chat/context/toolResultBudget.test.ts`
- [x] `bun run test -- packages/core/src/chat/context/turnRequestProjection.test.ts`
- [x] `bun run type-check`
- [x] 通用 Commit Gate。

## Commit 8: Durable Collapse Replay Idempotency

建议提交名：`fix(context): make durable collapse replay idempotent`

主要文件：

- `packages/core/src/features/repl/sessionSave/contextCollapseStoreEvents.ts`
- `packages/core/src/features/repl/sessionSave/contextCollapseStoreEvents.test.ts`
- `packages/core/src/chat/context/contextCollapseStore.ts`
- `packages/core/src/chat/context/contextProjection.test.ts`

Tasks:

- [x] 新增 duplicate same-id `context_collapse_committed` replay test：snapshot 只保留一条或 projection 与单 event 等价。
- [x] 实现 same-id committed collapse replay 幂等，避免 retry/重复 JSONL 行二次 collapse 删除尾部。
- [x] 不在本 commit 定义 all different-id overlap policy。
- [x] 如需记录 different-id overlap，先加 characterization / deferred note，不做大策略变更。

Validation:

- [x] `bun run test -- packages/core/src/features/repl/sessionSave/contextCollapseStoreEvents.test.ts`
- [x] `bun run test -- packages/core/src/chat/context/contextProjection.test.ts`
- [x] `bun run type-check`
- [x] 通用 Commit Gate。

## Commit 9: Malformed Collapse Committed Range Strictness

建议提交名：`fix(session): reject malformed collapse committed ranges`

主要文件：

- `packages/core/src/features/repl/sessionSave/contextCollapseStoreEvents.ts`
- `packages/core/src/features/repl/sessionSave/contextCollapseStoreEvents.test.ts`

Tasks:

- [x] 新增 malformed range tests：负数、反向 range、非有限 number、超大不安全整数。
- [x] JSONL-level 非有限 number case 使用 JSON 能实际表达的输入；parser-level 可单独覆盖 `Number.isFinite`。
- [x] `parseCommittedRange()` 严格要求 safe integer、`startIndex >= 0`、`endIndexExclusive > startIndex`。
- [x] 不满足条件时 reject event，不进入 constructor normalize。

Validation:

- [x] `bun run test -- packages/core/src/features/repl/sessionSave/contextCollapseStoreEvents.test.ts`
- [x] 通用 Commit Gate。

## Commit 10: Malformed Durable Snip Snapshot Strictness

建议提交名：`fix(session): reject malformed durable snip snapshots`

主要文件：

- `packages/core/src/features/repl/sessionSave/durableSnipStoreEvents.ts`
- `packages/core/src/features/repl/sessionSave/durableSnipStoreEvents.test.ts`

Tasks:

- [ ] 新增 mixed valid/invalid removals test：snapshot event 中任一 removal invalid 时整条 event 不接受，保留前一 valid snapshot。
- [ ] 保留 empty `removals: []` 可作为 intentional clear。
- [ ] 修改 `parseRemovals()` 为 strict all-or-nothing。

Validation:

- [ ] `bun run test -- packages/core/src/features/repl/sessionSave/durableSnipStoreEvents.test.ts`
- [ ] 通用 Commit Gate。

## Commit 11: Malformed Durable Tool Replacement Scope Strictness

建议提交名：`fix(session): reject malformed durable tool replacement scopes`

主要文件：

- `packages/core/src/features/repl/sessionSave/durableToolResultContentReplacementEvents.ts`
- `packages/core/src/features/repl/sessionSave/durableToolResultContentReplacementEvents.test.ts`

Tasks:

- [ ] 新增 malformed-present `sourceScope` test：不能 fallback 到 main_thread。
- [ ] 保留 sourceScope 缺省时 legacy main_thread fallback。
- [ ] 字段 present 但 `parseSourceScope()` 失败时 reject event。

Validation:

- [ ] `bun run test -- packages/core/src/features/repl/sessionSave/durableToolResultContentReplacementEvents.test.ts`
- [ ] 通用 Commit Gate。

## Cleanup Backlog: Only After Commits 1-11

每项必须独立 commit，不能合成一个大 cleanup batch。

- [ ] `refactor(session): share strict event parsing helpers`
- [ ] `refactor(context): share durable projection scoping helper`
- [ ] `refactor(web): centralize compression fact tri-state helper`
- [ ] `refactor(context): share durable commit candidate helpers`
- [ ] `docs(context): refresh CODEMAP durable projection owners`

## Explicitly Deferred

- [ ] 不在 correctness commits 中做测试文件大规模重命名。
- [ ] 不在 correctness commits 中重排 compression golden fixture。
- [ ] 不在 correctness commits 中抽大型 runtime object。
- [ ] 不在 correctness commits 中改变 Claude Code 对齐目标或上下文压缩策略。
- [ ] 不在 duplicate same-id 修复里同时定义 different-id overlap 大策略。
