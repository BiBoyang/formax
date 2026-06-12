# Transcript Surface 合同（唯一事实源）

最后更新：2026-06-12
状态：规范性（Normative）

本文档定义 Formax REPL transcript 物理渲染面的 reset/remount 语义，以及 `/clear`、`/resume`、compact / expanded view 切换时的 shared reset transaction 合同。

范围：
- Ink `Static` append-only 约束下的 transcript surface reset/remount 语义
- `replaceTranscript` / `resetTranscriptSurface` / `surfaceOpQueueRef` 的 shared owner 合同
- `transcriptSeq` 与 transcript Static key 的 remount 规则
- `/clear`、`/resume`、Ctrl+O / Ctrl+E、compact boundary 触发的 surface reset 路径
- Ink REPL transcript rows 与 active interactive bottom prompt 的 surface ownership 边界
- legacy runner 的 terminal clear ownership

不在范围内：
- canonical event mapping 与语义状态机本身
- tool / assistant / thinking 的业务语义排序
- Web / app-server transcript renderer

相关文档（信息性镜像）：
- `docs/contracts/invariants.md`
- `docs/audits/repl-single-writer-audit.md`
- `docs/runbooks/repl-surface-debugging.md`
- `docs/pitfalls/repl-transcript-static-rootcause.md`
- `docs/pitfalls/repl-transcript-surface-handoff-pitfall.md`

规范关键字约定：
- `MUST`、`SHOULD`、`MAY` 采用 RFC 2119 语义。

## 1. 规范模型（Canonical Model）

`SURFACE-001`  
logical transcript truth MUST 继续由 canonical semantics / message state 拥有；本合同只约束“物理终端 surface 如何与该真值重新对齐”。

`SURFACE-002`  
Ink `Static` MUST 被视为 append-only 渲染面。任何对已渲染 static rows 的删除、前插、切片回退、视图折叠切换，都不得依赖“下一帧自然覆盖”，而 MUST 通过 reset/remount transaction 对齐。

`SURFACE-003`  
消息所属渲染面 MUST 以显式 `surfaceOwner` / `surfaceHint` 为准，而不是依赖 `isStreaming` 等临时状态推断。

## 2. Shared Reset Transaction 合同

`SURFACE-101`  
“替换整段 transcript 内容” MUST 走：
1. `replaceTranscript`
2. `queueTranscriptSurfaceReplace`

不得为 `/clear`、`/resume` 等路径再发明第二条局部 clear/remount 流程。

`SURFACE-102`  
“仅需要刷新物理 surface，不替换 messages 内容” MUST 走：
1. `resetTranscriptSurface`
2. `queueTranscriptSurfaceReset`

`SURFACE-103`  
所有 transcript surface 操作 MUST 串行化到同一个 `surfaceOpQueueRef` 上；新的 surface path 不得绕开 shared queue。

`SURFACE-104`  
reset transaction MUST 被视为一个原子顺序：
1. terminal clear
2. `transcriptSeq` 自增触发 remount
3. 等待一个 macrotask 让 Ink/TTY settle

`SURFACE-105`  
replace transaction MUST 在同一个串行 surface op 中完成：
1. `setMessages(nextMessages)`
2. terminal clear
3. `transcriptSeq` 自增
4. macrotask settle

`SURFACE-106`  
即使 terminal clear 失败，transaction 仍 MUST 完成 remount 与 settle；错误 MAY 向上抛出，但队列本身 MUST 保持可继续使用。

## 3. 路由与所有权合同

`SURFACE-201`  
`/clear` 新会话切换与 `/resume` 历史恢复 MUST 通过 `replaceTranscript(...)` 收口，而不是手工排列 `setMessages` / `onClearTerminal` / `setTranscriptSeq`。

`SURFACE-202`  
expanded transcript 开关、expanded hide-history 开关、compact boundary 引起的 primary transcript 切片变化 MUST 通过 `useSurfaceTransitionManager` 请求 shared surface reset。

`SURFACE-203`  
已有 surface queue access 的 feature flow MUST NOT 再直接调用 `onClearTerminal` 作为独立副作用。

`SURFACE-204`  
legacy runner 的 terminal clear path MUST 只有一个 owner：
1. `resetInkStaticOutputForStdout(process.stdout)`
2. `clearTerminal()`

不得叠加第二套 `replInstance.clear()` 或额外 ANSI clear path 去竞争下一帧 repaint。

## 4. Static Key 与 Remount 合同

`SURFACE-301`  
当 Ink `Static` 启用时，primary transcript 与 expanded transcript MUST 通过 `transcriptSeq` 驱动 remount，而不是试图就地修补旧 surface。

`SURFACE-302`  
primary transcript 的 Static key MUST 同时包含：
1. `transcriptSeq`
2. `primaryTranscriptStartIndex`

因为 compact boundary 会改变 primary slice，即使底层消息数组未整体替换，也可能需要新的物理 surface。

`SURFACE-303`  
expanded transcript 的 Static key MUST 至少由 `transcriptSeq` 控制；凡是会让已渲染 expanded rows 失效的切换，都必须推动新的 reset/remount transaction。

`SURFACE-304`  
优先策略 SHOULD 是“保持 static rows append-only”；若现有修正属于 non-append correction，则 MUST 走 reset/remount，不得用 render-edge merge/hide hack 充当长期修复。

## 5. Transcript Projection View 合同

`SURFACE-501`
REPL transcript surface MUST 明确声明自己消费的是 UI scrollback projection，而不是 model-facing projection。model-facing baseline、durable snip/collapse replay、request-only reducers 与 diagnostics projection 的唯一事实源是 `buildContextProjection()` / context strategy stack；TUI transcript helper 不得重新定义这些 stage 语义。

`SURFACE-502`
primary transcript view MUST 使用 `projectCompactPrimaryTranscript(...)`，并声明以下二选一 view kind：
1. `ui_scrollback_full`：没有 compact boundary，显示完整 UI scrollback。
2. `ui_scrollback_compact_slice`：存在 compact boundary，显示 boundary 之后的 UI scrollback slice，并允许为了用户可读性把最近的 `/compact` command 重新插回 compact banner 后。

`SURFACE-503`
expanded transcript view MUST 使用 `projectExpandedTranscript(...)`，并声明以下二选一 view kind：
1. `ui_scrollback_raw`：显示完整 UI scrollback。
2. `ui_scrollback_recent_window`：Ctrl+E hide-history 模式下显示最近窗口；这是 UI scrollback 的 display window，不是 compacted model-facing context。

`SURFACE-504`
任何新增 diagnostics transcript surface MUST 消费 `buildContextProjection(...).diagnosticsProjection` 或其 canonical facts，并在 UI 层只做展示适配；不得在 renderer 中重新扫描 transcript 来推导 compression stage 顺序。

## 6. Interactive Prompt Surface Ownership

`SURFACE-601`
Ink REPL transcript rows MUST NOT own active interactive controls for pending `approval` or `ask_user_question` inputs. Active controls belong to the REPL bottom prompt slot defined by `docs/contracts/interactive-input-contract.md`.

`SURFACE-602`
Transcript rows MUST remain responsible for tool status, summaries, and non-interactive previews. Large Write/Edit diffs or argument previews SHOULD stay in transcript rows, while decision controls render in the bottom prompt slot.

`SURFACE-603`
When later running tool rows are appended while an active prompt is visible, those rows MUST render above the active prompt slot. The UI MUST NOT produce an ordering where a later transcript row appears below the active prompt.

`SURFACE-604`
Inline prompt presenters MAY exist as compatibility components, but in an Ink REPL bottom-slot surface they MUST suppress interactive controls and avoid registering prompt key handlers.

`SURFACE-605`
Inline compatibility presenters rendered under the Ink REPL bottom-slot surface MUST NOT re-own active prompt data. If a presenter is only showing fallback/status output while the real interactive prompt is owned by the bottom slot, it MUST avoid view-time reads whose only purpose is to reconstruct active prompt content from session state, filesystem state, or transcript-row-local state.

## 7. Guardrails

`SURFACE-401`  
不得把 `HeaderBanner` 或主消息列表搬出 `Static` 作为规避重复渲染的长期方案。

`SURFACE-402`  
不得通过新增分散的 clear/remount 排序逻辑来“修单一路径”；surface reset 必须继续归 shared transaction owner 所有。

`SURFACE-403`  
若问题根因是 semantic row ownership / handoff 漂移，而不是 surface transaction，本合同不允许用 surface-only 补丁掩盖数据层问题。

## 8. 一致性测试映射（Conformance Test Map）

本合同的主测试集：
1. `packages/core/src/features/repl/controller/ui/surfaceReset.test.ts`
2. `packages/core/src/features/repl/controller/session/sessionTransitions.test.ts`
3. `packages/core/src/screens/repl/useSurfaceTransitionManager.test.tsx`
4. `packages/core/src/screens/repl/surfaceSmoke.test.tsx`
5. `packages/core/src/runtime/bootstrap/runLegacyCli.test.tsx`
6. `packages/core/src/features/repl/useReplController.test.tsx`
7. `packages/core/src/screens/repl/compactProjection.test.ts`
8. `packages/core/src/screens/repl/ActivePromptSlot.test.tsx`
9. `packages/core/src/screens/REPL.coverage.test.tsx`
10. `packages/core/src/tools/modules/exitPlanMode/presenter.test.tsx`

## 9. 变更控制

当变更以下任一行为时：
1. `/clear` / `/resume` 的 transcript reset 路径
2. `Ctrl+O` / `Ctrl+E` / compact 的 surface reset 路径
3. `transcriptSeq` / Static key / remount 规则
4. legacy runner terminal clear path
5. Ink REPL transcript row ownership for active interactive controls

必须按以下顺序执行：
1. 先更新本文件。
2. 再更新 `surfaceReset.ts`、`useReplController.ts`、`sessionTransitions.ts`、`useSurfaceTransitionManager.ts`、`runLegacyCli.tsx` 的相关实现。
3. 对应更新 `docs/runbooks/repl-surface-debugging.md` 与必要的 pitfall 文档链接。
4. 保持 `formax-surface-reset-workflow` 指向本合同，而不是在 skill 中长期承载全部真相。

若实现与本合同冲突，应视为实现漂移并立即收敛修正。
