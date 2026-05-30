# CCA-181 Preserved-Segment Relink Validation Parity Todo

日期：2026-05-30

当前执行入口只看这个文件。上一份 `CCA-180 Deferred-Task Restore Utility Continuation / v8 Todo` 已完成并进入 Git 历史；本文件接续 `TODO-INDEX.md` 中的下一条推荐主线：`CCA-181 preserved-segment relink parity`。

本 TODO 的目标不是“重写成 Claude Code 的 storage model”，而是把 Formax 已有 preserved-segment metadata / relink guard 推进到更可靠的 replay / resume / inspection validation parity。

## 0. Context and Boundary

### 0.1 Confirmed Facts

- [x] `CCA-180` restore continuity hints 已完成，`pendingSessionMemoryRestore` 继续保持 next-turn-only / best-effort / no-new-authority。
- [x] `TODO-INDEX.md` 当前把 `CCA-181 preserved-segment relink parity` 排在下一候选主线首位。
- [x] Formax 已有 compact `preservedSegment` metadata，包含 continuation count、preserved-tail count、summary/head/tail fingerprints，以及新 boundary 的 ordered identities / fingerprints。
- [x] Formax 已有 `relinkLatestCompactPreservedContinuation(...)`，会在 compact summary 匹配、preserved tail 整体缺失且可唯一匹配时 relink。
- [x] Formax 已有 `continuationMatchesPreservedSegment(...)`，可验证 continuation view 与 boundary preserved metadata 是否匹配。
- [x] Durable projection replay 中，preserved-segment relink 已要求先于 durable snip removal / durable collapse replacement。
- [x] app-server / Web surfaces 已能携带 deeper compact-boundary facts，包括 `keepStrategy`、`rehydrationPlan`、`rehydrationCost`、`preservedSegment`。
- [x] 当前 gap 不是“没有 preserved segment”，而是 replay / resume / inspection surfaces 是否都稳定消费同一 relink/validation truth。

### 0.2 Goals

- [x] 明确 CCA-181 的 canonical validation contract：relink 只能补全已验证的 missing preserved tail，只影响 model-facing baseline，不能重排、重复、删除或写回 raw transcript / UI scrollback。
- [x] 先审计已有 compact/projection/app-server/Web coverage，再补 compact continuation validation 的真实缺口：partial preserved tail、duplicate matches、identity/fingerprint drift、summary mismatch、legacy boundary fallback、contiguity/order mismatch。
- [x] 验证 preserved-segment relink 在 model-facing projection 中先于 durable snip / collapse 发生。
- [x] 以 verify-first / patch-if-needed 方式验证 replay / resume / read / messages / diagnostics surfaces 都保留同一份 canonical `preservedSegment` facts。
- [x] 验证 Web parser/cache 不会把 `preservedSegment` 降级、清空、跨 boundary generation 继承、或重建成第二套 summary。
- [x] diagnostics 默认 tests-only；只有现有 `/context --json` 或 projection facts 无法检查 preserved-segment parity 时，才新增 bounded read-only validation signal。
- [x] 完成后更新 TODO index、learning note、必要 contracts / README。

### 0.3 Non-goals

- [x] 不引入 Claude Code parentUuid / transcript UUID storage rewrite。
- [x] 不引入 partial-compact store。
- [x] 不引入 archived collapse spans。
- [x] 不重写 replay-time projection owner。
- [x] 不把 preserved-segment validation 变成 destructive raw transcript rewrite。
- [x] 不让 Web 从 transcript rows 自行重建 compact summary 或 preserved segment。
- [x] 不在本主线处理 durable tool-result replacement summary surface。
- [x] 不在本主线处理 `CCA-182` reactive compact shaping / provider-specific overflow telemetry。
- [x] 不定义 collapse different-id overlap 大策略，除非发现真实 failing fixture。

### 0.4 Loop 0 Coverage Audit

| Area | Current evidence | Action |
| --- | --- | --- |
| explicit identity relink success | `compact.test.ts` already covered same-content continuation vs explicit preserved identity | already-covered |
| legacy fingerprint fallback | `compact.test.ts` already covered old single-message and multi-message boundaries | already-covered |
| duplicate pre-boundary refs | added `compact.test.ts` duplicate fingerprint regression | missing-characterization -> covered |
| partial preserved tail after summary | added `compact.test.ts` partial-tail skip regression | missing-characterization -> covered |
| complete preserved tail after summary | added `compact.test.ts` no-duplicate no-op regression | missing-characterization -> covered |
| summary mismatch | added `compact.test.ts` summary fingerprint mismatch regression | missing-characterization -> covered |
| ordered / contiguous explicit refs | added `compact.test.ts` non-contiguous and out-of-order explicit ref regressions; implementation now requires contiguous pre-boundary refs | implementation-failing -> fixed |
| malformed identity/fingerprint/count metadata | added `compact.test.ts` malformed metadata regressions; implementation now skips malformed arrays/counts | implementation-failing -> fixed |
| zero preserved tail | added `continuationMatchesPreservedSegment(...)` zero-tail validation assertion | strengthen -> covered |
| relink before durable snip | `contextProjection.test.ts` already covered success; added skipped-relink coordinate guard regression | strengthen -> covered |
| diagnostics fields | existing diagnostics expose `preservedSegment`; no stable validation status added in Loop 0 | defer |
| app-server/Web surface parity | CCA-172 coverage exists; verify-first loops remain pending | defer |

## 1. Definitions First

### 1.0 Canonical Validation Contract

- [x] Relink is model-facing only; it MUST NOT mutate raw transcript, UI scrollback, or persisted JSONL rows.
- [x] Relink MAY run only for the latest compact boundary with `preservedSegment` metadata.
- [x] Relink MAY only fill a wholly missing preserved tail immediately after a compact summary whose fingerprint matches `preservedSegment.summaryFingerprint`.
- [x] Complete preserved tail already present after the summary is valid/no-op.
- [x] Partial preserved tail already present after the summary MUST skip relink to avoid duplicate or ambiguous splice.
- [x] Summary fingerprint mismatch MUST skip relink.
- [x] Explicit identity refs, when present, MUST resolve uniquely, preserve `preservedSegment` order, and fingerprint-match.
- [x] Explicit preserved-tail refs SHOULD resolve as one contiguous pre-boundary segment unless sparse-tail semantics are intentionally documented before implementation.
- [x] Legacy boundaries without identity metadata MAY use only guarded count/head/tail/full-fingerprint uniqueness fallback where available.
- [x] Duplicate matches, missing refs, malformed counts, identity drift, fingerprint drift, or ambiguous legacy fallback MUST skip relink.
- [x] Durable snip/collapse MUST continue to rely on their own coordinate guards; relink status MUST NOT become a new downstream authority.
- [x] Diagnostics MAY report projection-observed status/reason, but MUST NOT participate in relink, replay, cache merge, or persisted session reconstruction decisions.

### 1.1 Canonical Docs

- [x] 检查并更新 `docs/contracts/session-persistence-contract.md` 的 preserved-segment relink 条款，确保 replay / resume / inspection validation parity 写清楚。
- [x] 检查并更新 `docs/contracts/context-strategy-stack-contract.md`，确认 relink-before-snip/collapse 顺序与 validation owner 一致。
- [x] 检查并更新 `docs/contracts/app-server-interaction-contract.md`，确保 `thread/read` / `thread/messages` / `thread/replay` / `thread/resume` 对 deeper compact-boundary fields 的语义一致。
- [x] 检查并更新 `docs/contracts/web-parity-adapter-contract.md`，确保 Web 只解析 app-server canonical preserved facts，不重建第二套 relink state。
- [x] 检查并更新 `packages/core/src/chat/context/README.md`，只记录 implementation ownership，不重复 canonical contract。
- [x] 若实现只补 tests / diagnostics wording，不新增 stable fields，则避免新增平行设计文档。

### 1.2 Data Model

- [x] 保持现有 `preservedSegment` schema additive / backward-compatible。
- [x] 明确 required validation inputs：
  - [x] `continuationMessageCount`
  - [x] `preservedTailMessageCount`
  - [x] `summaryFingerprint`
  - [x] `headFingerprint`
  - [x] `tailFingerprint`
  - [x] optional `messageFingerprints`
  - [x] optional `messageIdentities`
  - [x] optional named `summaryIdentity` / `headIdentity` / `anchorIdentity` / `tailIdentity`
- [x] 明确 old boundary fallback：缺少 identity metadata 时，只允许 fingerprint/count guard，不允许 destructive identity-based replay。
- [x] 明确 mismatch / duplicate / partial-tail cases must skip relink and preserve current continuation.
- [x] 明确 same-boundary merge 与 different-boundary generation 的区别：omitted optional facts 只能在同一 canonical boundary 上保留缓存，不能跨新 boundary generation 继承旧 `preservedSegment`。
- [x] 若新增 diagnostics 字段，必须是 read-only validation fact，不参与 replay authority。

### 1.3 Types / Interfaces

- [x] 检查 `CompactPreservedSegment` / `CompactBoundaryMeta` 类型是否已经能表达 validation parity 需要的 facts。
- [x] 如需新增 validation result type，优先放在 compact/context diagnostics owner 层，不放到 Web reducer。
- [x] app-server compact-boundary payload 类型必须继续与 core `CompactBoundaryMeta` 对齐。
- [x] Web parser types 必须接受 complete preservedSegment fields，并对 malformed optional fields 使用 omit/unavailable 策略。

## 2. Runtime / Platform

### 2.1 Core Compact / Relink

- [x] Characterize current relink behavior for explicit identities, legacy fingerprints, duplicate matches, partial tail, and summary mismatch.
- [x] Strengthen `continuationMatchesPreservedSegment(...)` tests for ordered identity/fingerprint matching.
- [x] Verify missing preserved tail is relinked only when every required ref uniquely resolves before boundary.
- [x] Verify explicit refs resolve in order and as a contiguous pre-boundary segment, or explicitly document sparse-tail semantics before allowing non-contiguous relink.
- [x] Verify partial preserved tail already present after summary does not trigger duplicate relink.
- [x] Verify complete preserved tail already present after summary is valid/no-op.
- [x] Verify same-content non-preserved continuation messages do not steal explicit preserved identity.
- [x] Verify drifted explicit identity in continuation skips relink rather than replacing user-visible continuation.
- [x] Verify malformed `messageIdentities` / `messageFingerprints` length or count metadata skips validation/relink safely.
- [x] Verify no-preserved-tail boundary remains valid with null head/tail fingerprints.

### 2.2 Durable Projection Coordinate Guard

- [x] Add/strengthen tests that preserved-segment relink happens before durable snip removal.
- [x] Add/strengthen tests that preserved-segment relink happens before durable collapse replacement only if current collapse replay fixtures expose that path.
- [x] Verify skipped relink does not bypass durable snip/collapse's own coordinate guards.
- [x] Do not introduce committed collapse store, archived spans, range-rewrite metadata, or collapse overlap policy in CCA-181.
- [x] Verify raw transcript / UI scrollback remains unchanged; only model-facing baseline is affected.

### 2.3 App-Server / Replay / Resume Verification

- [x] Verify `thread/resume` exposes canonical `latestCompactBoundary.preservedSegment` after file-backed restore.
- [x] Verify `thread/replay` exposes the same preservedSegment facts before and after replay pagination boundaries.
- [x] Verify `thread/read` and `thread/messages` preserve deeper compact-boundary fields instead of downgrading to a shallow summary.
- [x] Verify omitted compact-boundary facts do not clear cached preservedSegment; explicit null remains the only cache-clearing signal.
- [x] Verify resume/read/messages/replay use the same canonical compact protocol source, not per-surface reconstruction.
- [x] Patch implementation only if verification finds shallow downgrade, tri-state drift, or source divergence.

### 2.4 Diagnostics / Inspection

- [x] Lock `/context --json` or context diagnostics payload for preservedSegment presence and basic validation facts.
- [x] Prefer tests-only; add stable validation diagnostics only if existing diagnostics cannot inspect preserved-segment parity.
- [x] If adding validation diagnostics, include only projection-observed read-only status/reason such as matched / skipped / missing / duplicate / drift.
- [x] Keep diagnostics bounded and non-authoritative.
- [x] Ensure diagnostics do not introduce a second relink path.

## 3. Frontend Boundary

- [x] Web RPC parser accepts complete `preservedSegment` with identities/fingerprints if surfaced.
- [x] Web RPC parser keeps old shallow compact-boundary payloads compatible.
- [x] Web thread cache keeps deep equality over preservedSegment fields for change detection.
- [x] Web cache merge/retention distinguishes omitted optional fields from explicit null and does not carry old `preservedSegment` across a different compact boundary generation.
- [x] Out-of-order same-boundary regression: deep replay/resume compact boundary followed by later read/messages boundary with the same `boundaryFingerprint` but omitted optional nested details must not clear or downgrade cached deep compact-boundary facts.
- [x] Malformed optional preservedSegment details are omitted/unavailable, not response-fatal.
- [x] Explicit null compact boundary clears cache; omitted/malformed optional details must not clear authoritative cache.
- [x] Web does not infer preservedSegment from transcript rows.
- [x] No UI redesign; if UI text changes, keep it diagnostic-only and backed by app-server payload.

## 4. Tests

### 4.1 Core Compact Tests

- [x] `packages/core/src/chat/context/compact.test.ts`: explicit identity relink success.
- [x] `packages/core/src/chat/context/compact.test.ts`: legacy fingerprint fallback success.
- [x] `packages/core/src/chat/context/compact.test.ts`: duplicate pre-boundary matches skip relink.
- [x] `packages/core/src/chat/context/compact.test.ts`: partial preserved tail already present skips relink.
- [x] `packages/core/src/chat/context/compact.test.ts`: complete preserved tail already present is valid/no-op.
- [x] `packages/core/src/chat/context/compact.test.ts`: summary fingerprint mismatch skips relink.
- [x] `packages/core/src/chat/context/compact.test.ts`: identity drift / fingerprint drift skips relink.
- [x] `packages/core/src/chat/context/compact.test.ts`: non-contiguous or out-of-order explicit refs skip relink unless sparse-tail semantics are explicitly documented.
- [x] `packages/core/src/chat/context/compact.test.ts`: malformed identity/fingerprint/count metadata skips safely.
- [x] `packages/core/src/chat/context/compact.test.ts`: continuation validation detects ordered identity/fingerprint mismatch.

### 4.2 Durable Projection Tests

- [x] `packages/core/src/chat/context/contextProjection.test.ts`: relink before durable snip replay.
- [x] `packages/core/src/chat/context/contextProjection.test.ts`: relink before durable collapse replacement only if existing fixtures expose committed collapse replay.
- [x] `packages/core/src/chat/context/contextProjectionBaseline.test.ts`: preservedSegment facts remain stable in golden projection fixture.
- [x] Negative guard: skipped relink does not duplicate preserved tail, mutate raw transcript, or bypass downstream durable coordinate guards.

### 4.3 App-Server Tests

- [x] `packages/core/src/app-server/threadStore.test.ts`: file-backed resume returns compact boundary with preservedSegment.
- [x] `packages/core/src/app-server/server.test.ts`: replay mirrors cached preservedSegment facts.
- [x] `packages/core/src/app-server/server.test.ts`: read/messages/replay/resume keep deep compact-boundary parity.
- [x] `packages/core/src/app-server/server.test.ts`: omitted compact facts do not clear cached preservedSegment; explicit null does.
- [x] `packages/core/src/app-server/threadStore.test.ts` or `store/sessionEventReader.test.ts`: persisted session reader preserves boundary metadata needed for validation.

### 4.4 Diagnostics Tests

- [x] `packages/core/src/chat/context/contextDiagnostics.test.ts`: diagnostics includes preservedSegment summary/fingerprints/validation facts.
- [x] If validation status is added, cover success and skip reasons.
- [x] Ensure diagnostics remain bounded and do not include raw message bodies.

### 4.5 Web Tests

- [x] `packages/web-reference-react/src/app/core/rpcParsers.test.ts`: complete preservedSegment payload parses.
- [x] `packages/web-reference-react/src/app/core/rpcContracts.test.ts`: replay/resume payloads preserve deep compact-boundary facts.
- [x] `packages/web-reference-react/src/app/core/threadCache.test.ts`: omitted/malformed optional preservedSegment does not clear authoritative cache.
- [x] `packages/web-reference-react/src/app/core/threadCache.test.ts`: out-of-order same-boundary payload with omitted optional nested details does not downgrade earlier deep replay/resume `preservedSegment`.
- [x] `packages/web-reference-react/src/app/core/threadCache.test.ts`: omitted optional fields do not carry old `preservedSegment` across a different compact boundary generation.

## 5. Recommended Execution Order

### Loop 0: Coverage Audit + Contract Freeze

- [x] Audit current preserved-segment implementation and tests for gaps against this todo.
- [x] Produce a coverage audit table marking planned cases as already-covered / strengthen / missing-characterization / implementation-failing / defer.
- [x] Remove or merge duplicate checklist items before adding new fixtures.
- [x] Freeze the canonical validation contract, including contiguous-vs-sparse preserved-tail semantics; default to contiguous unless intentionally documented otherwise.
- [x] Add missing characterization tests for duplicate match, partial tail, complete-tail no-op, summary mismatch, ordered/contiguous validation, and malformed metadata.
- [x] Characterize one relink-before-durable-snip projection fixture here if current coverage is unclear; leave full coordinate guard to Loop 2.
- [x] Freeze whether any new diagnostics field is needed; default to tests-only unless inspection lacks required signal.
- [x] Update canonical docs only where current contracts are too vague.
- [x] Run targeted core compact tests.
- [x] Run `bun run type-check` if types/contracts changed.
- [x] Run `codex review` for this loop after targeted verification passes.

Suggested commit: `test(context): characterize preserved segment relink parity`

### Loop 1: Core Relink / Validation Parity Patch-if-needed

- [x] If Loop 0 tests already pass, Loop 1 may be docs/tests-only.
- [x] Implement the smallest core changes required by Loop 0 failing characterization tests.
- [x] Keep relink non-destructive and model-facing only.
- [x] Preserve legacy boundary fallback while preferring explicit identity refs only when they are explicit, unique, ordered, and fingerprint-matched.
- [x] Legacy fallback must require guarded count/head/tail and any available full-message fingerprint uniqueness.
- [x] Verify partial/duplicate/drift cases skip relink.
- [x] Verify continuation validation handles ordered identity and fingerprint lists.
- [x] Run targeted `compact.test.ts`.
- [x] Run `bun run type-check` if types changed.
- [x] Run `codex review` for this loop after targeted verification passes.

Suggested commit: `fix(context): validate preserved segment relink parity`

### Loop 2: Durable Projection Coordinate Guard

- [x] Strengthen projection tests proving relink runs before durable snip.
- [x] Strengthen projection tests for collapse replacement ordering only if current fixtures expose committed durable collapse replay.
- [x] Verify skipped relink does not bypass downstream durable coordinate guards.
- [x] Do not introduce a new global rule that relink skip automatically disables all durable stages unless required by an existing validation invariant.
- [x] Do not introduce committed collapse store, archived spans, range-rewrite metadata, or collapse overlap policy in CCA-181.
- [x] Verify raw transcript / UI scrollback remains unchanged.
- [x] Run targeted projection tests.
- [x] Run `bun run type-check`.
- [x] Run `codex review` for this loop after targeted verification passes.

Suggested commit: `test(context): guard preserved segment projection coordinates`

### Loop 3: App-Server / Inspection Surface Verification

- [x] Verify-first / patch-if-needed: implement only if tests find shallow downgrade, tri-state drift, or source divergence.
- [x] Ensure threadStore resume/replay surfaces preserve canonical `preservedSegment` facts.
- [x] Ensure read/messages surfaces preserve deep compact-boundary facts after resume/replay parity is locked.
- [x] Ensure app-server cache tri-state preserves deep compact-boundary facts.
- [x] Add diagnostics tests only if current diagnostics cannot expose validation parity adequately.
- [x] Update app-server interaction contract and context README as needed.
- [x] Run targeted app-server and diagnostics tests.
- [x] Run `bun run type-check`.
- [x] Run `codex review` for this loop after targeted verification passes.

Suggested commit: `test(app-server): verify preserved segment facts across surfaces`

### Loop 4: Web Parser / Cache Regression Guard

- [x] Ensure Web RPC parsers preserve full `preservedSegment` details.
- [x] Ensure Web cache deep equality includes all meaningful preservedSegment fields.
- [x] Add malformed/omitted/explicit-null parser/cache regressions.
- [x] Add out-of-order same-boundary regression: deep replay/resume payload followed by same-`boundaryFingerprint` read/messages payload with omitted optional nested details must not clear or downgrade deep compact-boundary facts.
- [x] Add different-boundary guard: omitted optional fields must not cause Web to carry old `preservedSegment` across a new compact boundary generation.
- [x] Ensure Web does not infer preservedSegment from transcript rows.
- [x] Run targeted Web parser/cache tests.
- [x] Run `npm run type-check` in `packages/web-reference-react`.
- [x] Run `codex review` for this loop after targeted verification passes.

Suggested commit: `test(web): preserve compact segment parity in rpc cache`

### Loop 5: Closure / Deferral Routing

- [x] Update `plans/context-compression-alignment-loop/TODO-INDEX.md` after CCA-181 lands.
- [x] Add/update a learning note under `docs/learnings/`.
- [x] Keep durable tool-result replacement summary surface as a separate projection-surface follow-up.
- [x] Keep `CCA-182` reactive compact shaping as a later runtime/provider mainline.
- [x] Keep collapse different-id overlap deferred unless a concrete failing fixture appears.
- [x] Record that CCA-181 landed as validation hardening plus surface/cache parity, not as a storage-model rewrite.
- [x] Run docs/path checks through `bun run type-check` if docs changed.
- [x] Run `codex review` for this loop after targeted verification passes.

Suggested commit: `docs(context): close CCA-181 preserved segment parity`

## 6. Deferral Register

- [x] Durable tool-result replacement summary surface: valuable, but belongs to projection-surface follow-up.
- [x] `CCA-182` reactive compact shaping: provider-specific overflow/retry/telemetry work, not preserved-segment validation.
- [x] Collapse different-id overlap policy: defer until a concrete failing fixture exists.
- [x] ParentUuid / transcript UUID storage rewrite: explicitly not part of Formax CCA-181.
- [x] Full partial-compact store / archived span design: defer; this todo only validates current preserved-segment relink and surfaces.

## 7. Completion Criteria

- [x] Core relink validation covers success, legacy fallback, duplicate, partial, drift, and summary mismatch cases.
- [x] Durable projection ordering tests prove relink-before-snip/collapse where relevant.
- [x] App-server replay/resume/read/messages preserve the same canonical preservedSegment facts.
- [x] Diagnostics are either tests-only or expose enough bounded read-only information to inspect preserved-segment parity without becoming authority.
- [x] Web parser/cache preserves deep compact-boundary facts, handles same-boundary omitted nested details vs explicit-null correctly, blocks cross-generation preservedSegment carryover, and does not reconstruct preservedSegment locally.
- [x] Contracts / README / learning note are aligned.
- [x] TODO index points to the next real follow-up after CCA-181.
