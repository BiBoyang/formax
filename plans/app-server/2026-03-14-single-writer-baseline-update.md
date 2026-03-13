# Single-Writer Baseline Update (2026-03-14)

## 背景

`bun run test:repl-semantic-gate` 在 `check:repl-single-writer` 阶段失败，原因是：

- `packages/core/src/features/repl/controller/turnActions.ts` 出现 2 处 `setMessages(`，但 baseline 未登记。
- `packages/core/src/features/repl/controller/canonical/canonicalProjectionPipeline.ts` 出现 1 处 `setMessages(`，但 baseline 未登记。

## 架构评审结论

1. `canonicalProjectionPipeline.ts` 的 `setMessages` 属于 canonical projection 到 static surface 的合并入口（`mergeProjectedStaticRows`），仍由 canonical projection 状态驱动，不是任意 UI 旁路写入。
2. `turnActions.ts` 的两处写入分别用于：
  - 本地 bash 空命令 usage 提示（UI-only 提示行）。
  - 本地 bash turn 结束时补 canonical tail 并执行 invariant 断言（语义收口）。
3. 上述写点并未绕开 canonical owner；它们是 `useReplController` 抽离后的写点迁移。`useReplController.ts` 的写点因此下降到 0。

## 本次基线更新

- 在 `scripts/check-repl-single-writer.mjs` baseline 新增：
  - `packages/core/src/features/repl/controller/canonical/canonicalProjectionPipeline.ts: 1`
  - `packages/core/src/features/repl/controller/turnActions.ts: 2`
- 将 `packages/core/src/features/repl/useReplController.ts` baseline 从 `3` 收紧为 `0`，避免未来在该文件回流直写点时被漏检。

## Canonical ownership 约束（继续生效）

- canonical 语义投影仍由 projection pipeline 主导，不允许新增无投影语义的静态 transcript 旁路写入。
- 本地 bash 分支允许 UI-only 提示，但 turn 完结必须经 canonical tail 合并并通过 invariant 校验。
- 任何新增 `setMessages(` 写点，需先完成同等级别评审并同步 baseline 与审计文档。
