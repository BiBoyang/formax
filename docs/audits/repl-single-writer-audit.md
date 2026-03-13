# REPL Single-Writer Audit

更新时间：2026-03-14  
范围：`packages/core/src/features/repl/**`

## 1. 门禁 baseline（`check-repl-single-writer`）

以下文件中的 `setMessages(` 被纳入单写入门禁 baseline。规则是“可下降、不可无审计上升”。


| 文件                                                                                    | 当前计数 | 说明                                               |
| ------------------------------------------------------------------------------------- | ---- | ------------------------------------------------ |
| `packages/core/src/features/repl/controller/streaming/streaming.ts`                   | 3    | canonical stream bridge + legacy fallback 兼容写入。  |
| `packages/core/src/features/repl/controller/streaming/streamingLegacyTranscript.ts`   | 1    | legacy transcript mutator 单入口。                   |
| `packages/core/src/features/repl/controller/canonical/canonicalProjectionPipeline.ts` | 1    | canonical projection 合并到 static surface 的受控写入。   |
| `packages/core/src/features/repl/controller/turnActions.ts`                           | 2    | 本地 bash usage 提示 + local bash canonical tail 收口。 |
| `packages/core/src/features/repl/controller/send/sendMainTurn.ts`                     | 2    | user echo 锚点 + 错误 fallback。                      |
| `packages/core/src/features/repl/controller/send/bashMode.ts`                         | 2    | legacy transcript 模式下的本地 bash 写入。                |
| `packages/core/src/features/repl/controller/send/send.ts`                             | 7    | slash/overlay/UI 输出。                             |
| `packages/core/src/features/repl/controller/send/sendAutoCompact.ts`                  | 1    | compact notice UI。                               |
| `packages/core/src/features/repl/controller/session/sessionTransitions.ts`            | 2    | 会话切换/恢复写入。                                       |
| `packages/core/src/features/repl/controller/ui/overlays.ts`                           | 4    | overlay 关闭/提示消息。                                 |
| `packages/core/src/features/repl/controller/ui/surfaceReset.ts`                       | 1    | surface reset 交易中的 UI 写入。                        |
| `packages/core/src/features/repl/controller/shared/providerError.ts`                  | 1    | provider 错误提示。                                   |
| `packages/core/src/features/repl/useReplController.ts`                                | 0    | 直写点已下沉到 controller 层。                            |


## 2. 2026-03-14 变更说明

- 新增 baseline 条目：
  - `controller/canonical/canonicalProjectionPipeline.ts`（1）
  - `controller/turnActions.ts`（2）
- `useReplController.ts` baseline 从 `3` 收紧到 `0`，防止未来写点回流被漏检。
- 评审记录：`plans/app-server/2026-03-14-single-writer-baseline-update.md`

## 3. 审计规则

1. 任何新增 `setMessages(` 写点（新增文件或计数上升）必须先做架构评审，再更新 baseline。
2. canonical/projection 相关写点必须保持“由 canonical 状态驱动”，不得引入 UI 旁路语义写入。
3. baseline 更新时，需同步维护：
  - `scripts/check-repl-single-writer.mjs`
  - 本审计文档
  - `plans/app-server/` 下对应评审记录

