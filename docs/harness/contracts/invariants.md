# Invariants

以下是不变量与所有权规则，且应可被执行验证。

语义治理唯一事实源见：`docs/harness/contracts/semantics-contract.md`。

## Single-Writer（REPL 语义）

- Canonical semantics 与 projection 拥有 transcript 真值。
- 直接 transcript 写入点不允许无声增加。
- 护栏脚本：`scripts/check-repl-single-writer.mjs`

命令：
- `bun run check:repl-single-writer`

## Replay Consistency

- Realtime 与 replay 必须收敛到同一语义状态。
- 契约测试位于 `src/features/semantics/__tests__/`。

命令：
- `bun run test -- src/features/semantics/__tests__/realtimeReplayParity.contract.test.ts`

## Trace 连续性

- 审计事件在可用时应携带 trace 上下文。
- Trace 字段：`traceId`, `threadId`, `turnId`, `toolUseId`, `eventId`, `replaySeq`。

验证：
- `bun run test -- src/tools/executor/index.test.ts src/hooks/audit.test.ts src/chat/engine.test.ts`
