# Single Writer Write-Point Inventory（REPL Controller）

更新时间：2026-02-18  
范围：`src/features/repl/controller/**`（非测试文件）

## 1) 语义主路径直写点（下一步迁移目标）

这些写点会影响 turn 内 assistant/tool/thinking 的语义展示，属于 `S1` 的核心收敛对象。

- `src/features/repl/controller/streaming/streaming.ts:101`
- `src/features/repl/controller/streaming/streaming.ts:126`
- `src/features/repl/controller/streaming/streaming.ts:151`
- `src/features/repl/controller/streaming/streaming.ts:170`
- `src/features/repl/controller/streaming/streaming.ts:218`
- `src/features/repl/controller/streaming/streaming.ts:228`
- `src/features/repl/controller/streaming/streaming.ts:259`
- `src/features/repl/controller/streaming/streaming.ts:277`
- `src/features/repl/controller/send/sendMainTurn.ts:76`

结论：

- `streaming.ts` 是语义双写风险最高点（canonical bridge + legacy transcript 并行分支）。
- `sendMainTurn.ts` 错误 subline 主路径已改为 canonical 写入；残留直写主要是 user anchor 行与 fallback 分支。

## 1.1) bashMode 迁移状态

- `src/features/repl/controller/send/bashMode.ts:106`
- `src/features/repl/controller/send/bashMode.ts:157`

说明：

- `runLocalBashTurn` 已支持 `writeLegacyTranscriptRows` 开关，主路径现已切换为 `writeLegacyTranscriptRows=false`。
- `useReplController` transient 展示门控已从 `isLoading` 改为 `canonicalTransientActive`，保证非 loading 的 canonical turn（含本地 bash）可见。
- `appendCanonicalTailFinalRows` 已用于本地 bash turn 的终局持久化，避免回退到 legacy tool row 直写。
- legacy 直写仍保留兼容开关，仅用于回退与测试覆盖。

## 2) UI-only 写点（可保留）

这些写点主要用于 slash/overlay/subline 展示，不参与 canonical 语义不变量。

- `src/features/repl/controller/send/send.ts:38`
- `src/features/repl/controller/send/send.ts:95`
- `src/features/repl/controller/send/send.ts:178`
- `src/features/repl/controller/send/send.ts:245`
- `src/features/repl/controller/send/send.ts:325`
- `src/features/repl/controller/send/send.ts:385`
- `src/features/repl/controller/send/send.ts:398`
- `src/features/repl/controller/ui/overlays.ts:54`
- `src/features/repl/controller/ui/overlays.ts:152`
- `src/features/repl/controller/ui/overlays.ts:164`
- `src/features/repl/controller/shared/providerError.ts:10`

结论：

- 这类写点可继续保留在 renderer/UI 层，不作为 single-writer 的 first-class 迁移对象。
- `sendAutoCompact.ts` notice 主路径已改为 canonical 写入；`setMessages` 仅保留 fallback，不计入主路径双写。

## 3) 生命周期写点（可保留）

这些写点用于 clear/resume/remount，不属于 turn 语义投影职责。

- `src/features/repl/controller/session/sessionTransitions.ts:45`
- `src/features/repl/controller/session/sessionTransitions.ts:49`
- `src/features/repl/controller/session/sessionTransitions.ts:88`
- `src/features/repl/controller/session/sessionTransitions.ts:142`

## 4) S1 下一步建议顺序

1. 先收敛 `streaming.ts`：让 turn 内 assistant/tool/thinking 行只由 canonical 投影驱动。  
2. 再收敛 `sendMainTurn.ts`：用户输入与失败 subline 的语义路径分层。  
3. 最后收敛 `sendMainTurn.ts:76` user anchor 写点：确认是否保留为 single-writer 允许例外。
