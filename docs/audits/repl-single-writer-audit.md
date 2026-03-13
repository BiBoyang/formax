# REPL Single-Writer Audit

更新时间：2026-02-18  
范围：`packages/core/src/features/repl/**`

## 1. Semantic-Critical 直写点（受门禁）

以下文件中的 `setMessages(` 会影响 turn 内语义顺序（assistant/thinking/tool/footer）。  
这些写点计数由 `scripts/check-repl-single-writer.mjs` 门禁，禁止无审计地新增。


| 文件                                                                    | 当前计数 | 说明                                        |
| --------------------------------------------------------------------- | ---- | ----------------------------------------- |
| `packages/core/src/features/repl/controller/streaming/streaming.ts`                 | 3    | canonical bridge 下的 legacy fallback 兼容写入。 |
| `packages/core/src/features/repl/controller/streaming/streamingLegacyTranscript.ts` | 1    | legacy transcript mutator 单入口。            |
| `packages/core/src/features/repl/controller/send/sendMainTurn.ts`                   | 2    | 含允许例外：user echo 锚点 + 错误 fallback。         |
| `packages/core/src/features/repl/controller/send/bashMode.ts`                       | 2    | 仅在 `writeLegacyTranscriptRows=true` 下启用。  |
| `packages/core/src/features/repl/useReplController.ts`                              | 3    | canonical tail merge / 本地 bash 完结收口。      |


## 2. UI-only 直写点（不计入 semantic 门禁）

这些写点用于 command subline、overlay 提示、会话切换展示，不承载 canonical 语义归并。


| 文件                                                           | 当前计数 | 分类                   |
| ------------------------------------------------------------ | ---- | -------------------- |
| `packages/core/src/features/repl/controller/send/send.ts`                  | 7    | slash/overlay/UI 输出。 |
| `packages/core/src/features/repl/controller/ui/overlays.ts`                | 3    | overlay 关闭/提示消息。     |
| `packages/core/src/features/repl/controller/send/sendAutoCompact.ts`       | 1    | compact notice UI。   |
| `packages/core/src/features/repl/controller/shared/providerError.ts`       | 1    | provider 错误提示。       |
| `packages/core/src/features/repl/controller/session/sessionTransitions.ts` | 4    | 生命周期切换/回放恢复。         |


## 3. 审计规则

1. semantic-critical 文件新增 `setMessages(` 视为架构回归，必须先走 canonical 写入路径评审。
2. UI-only 文件允许调整，但不得把 semantic merge 逻辑迁入 UI 直写分支。
3. 若确有必要新增 semantic 写点，需同时更新：
  - `scripts/check-repl-single-writer.mjs` baseline
  - 本文档对应条目与原因说明

