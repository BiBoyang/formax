# Web Parity Adapter Contract（唯一事实源）

最后更新：2026-05-21
状态：规范性（Normative）

本文档定义 web reference client 在 adapter / reducer / cursor 层的共享边界，确保 Web 只消费 canonical semantics，而不再发明第二套语义状态机。

范围：
- `eventAdapters.ts` 的历史回放适配边界
- `store.ts` 的 render-model / projection-state 分层
- `projectionEngine.ts` 的 projection-to-log 合并边界
- `turnEventCursor.ts` 的排序 / 去重职责
- 通知进入 Web 后何时允许进入 canonical projection

不在范围内：
- 页面布局、三区域 UI 文案与组件视觉
- app-server 协议本身的字段定义
- TUI transcript surface reset 或本地 CLI 渲染细节

相关文档（信息性镜像）：
- `docs/contracts/semantics-contract.md`
- `docs/contracts/app-server-interaction-contract.md`
- `docs/frontend/app-server-ui-spec.md`
- `docs/references/app-server-api-reference.md`

相关实现（规范锚点）：
- `packages/web-reference-react/src/eventAdapters.ts`
- `packages/web-reference-react/src/store.ts`
- `packages/web-reference-react/src/turnEventCursor.ts`
- `packages/web-reference-react/src/app/core/projectionEngine.ts`
- `packages/web-reference-react/src/app/runtime/processNotification.ts`
- `packages/web-reference-react/src/app/runtime/connectRpcClient.ts`

规范关键字约定：
- `MUST`、`SHOULD`、`MAY` 采用 RFC 2119 语义。

## 1. 权威模型

`WEB-001`  
Web 的语义真值 MUST 继续来自共享 canonical semantics 层；Web adapter / reducer / cursor 只能消费该真值，不得重新定义语义规则。

`WEB-002`  
`eventAdapters.ts`、`store.ts`、`projectionEngine.ts` 与 `turnEventCursor.ts` 只拥有 Web adapter ownership；它们 MUST NOT 取代 `packages/core/src/features/semantics/*` 成为新的 source of truth。

`WEB-003`  
通知进入 canonical projection 前的 envelope 校验与排序 gate，MUST 由 Web runtime adapter 负责；一旦进入 projection，状态变迁 MUST 由 canonical reducer 决定。

`WEB-004`
Web MAY 持有 renderer-local transient surface state（例如 `newThreadDraft`），但该状态 MUST 保持在 runtime/UI ownership，MUST NOT 被 adapter/reducer 当作 canonical thread semantics。

`WEB-005`
`newThreadDraft` 之类的 transient surface MUST NOT 继续通过 `!activeThreadId` 隐式推断。Web 必须用显式 draft state 派生 `visibleSurface`，避免把 welcome、draft、real thread 混为同一 gate。

`WEB-006`
Web page shell MUST 保持 `thread-owned`、`draft-owned` 与 `workspace selection only` 三类 owner boundary 清晰分离：
1. `thread-owned` chrome / diagnostics（例如 right rail diff、request collapse、compact boundary、context meter、active-turn chrome）只允许在真实 `thread` surface 下显示；
2. `draft-owned` chrome 只允许读取显式 draft state（例如 `draftCwd`），不得回退到旧的 `selectedCwd` 或 `diffSnapshot.cwd`；
3. `workspace selection only` 状态（例如 `selectedCwd`）可以继续服务左栏 group selection / workspace navigation，但 MUST NOT 冒充当前 thread cwd 或 draft cwd。

## 2. 历史回放适配（`eventAdapters.ts`）

`WEB-101`  
thread history hydrate MUST 通过以下路径完成：
1. `thread/messages` 历史记录
2. `mapHistoryMessagesToCanonicalEvents(...)`
3. `reduceTranscriptProjection(...)`
4. projection segments -> Web transcript items

`WEB-102`  
history adapter MUST 优先把 assistant / tool 历史行映射到 canonical projection 结果，而不是直接把 server history 文本原样视为最终渲染真值。

`WEB-103`  
user 历史消息当前 MAY 继续直接保留原始文本；其 turn/log identity MUST 使用稳定的 history-scoped id 规则，避免 hydrate 后与 live projection 冲突。

`WEB-104`  
当 canonical projection 无法为历史 assistant/tool 行生成对应 segment 时，adapter MAY 回退到原始历史记录内容；该回退只是兼容路径，MUST NOT 反向写回 canonical state。

## 3. Store 与 Projection 分层（`store.ts`）

`WEB-201`  
Web store MUST 保持当前双层模型：
1. `logs`：给 UI 消费的 render model
2. `transcriptProjection`：当前线程的 canonical projection patch state

`WEB-202`  
`logs` 可以包含本地 log / UI message / hydrated items，但 `apply_canonical_event` 的语义更新 MUST 委托给 projection engine；store MUST NOT 直接在 reducer 中重写 canonical turn semantics。

`WEB-203`  
`set_active_thread` 与 `replace_logs` 在当前 contract 下 MUST 清空 `transcriptProjection`，以表示“需要为新线程或新 hydrate 结果重新建立 canonical patch baseline”。

`WEB-204`  
`hydrate_projection_tool_names` MUST 只用于恢复 `toolUseId -> toolName` 的粘性映射；它 MAY 合并当前 logs、现有 projection 与外部 hydrate 输入，但 MUST NOT 借机修改 turn/message 语义。

`WEB-205`  
`hydrate_projection_snapshot` MUST 以 snapshot 为新的 projection baseline：
1. 用 snapshot segments 重建 logs
2. 重建 `toolNameByUseId`
3. 重建 open assistant / thinking maps
4. 重置 seen-event baseline

`WEB-206`  
reducer 对无语义变化的 housekeeping action SHOULD 保持 no-op identity 稳定，避免纯引用抖动触发额外 rerender。

## 4. Projection Engine 边界（`projectionEngine.ts`）

`WEB-301`  
projection engine MUST 负责把 canonical projection segment 转为 Web transcript item，并将同一 turn 的 projection-managed rows 合并回现有 logs。

`WEB-302`  
projection-managed rows 当前 MUST 包含：
1. user message
2. assistant message
3. thinking rows
4. tool rows
5. turn footer

其他 UI/log rows MUST 在 merge 时尽量保留，不得因 canonical patch 被无关覆盖。

`WEB-303`  
tool name 粘性恢复 MUST 继续以 `toolUseId` 为 key；从 logs 收集到的 `toolNameByUseId` 仅用于补全投影，不得替代 canonical tool sequencing。

`WEB-304`  
turn footer 的 `createdAt` 在 projection rebuild 时 SHOULD 尽量保持稳定；Web 不应因为局部 patch 而无意义刷新 footer identity。

## 5. Notification Cursor 与排序（`turnEventCursor.ts`）

`WEB-401`  
`turnEventCursor` MUST 只负责 sequenced notification 的去重与接受判定；它 MUST NOT 决定语义状态迁移、thread 选择、或 replay gap 修复策略。

`WEB-402`  
当通知携带 `replaySeq` 时，Web MUST 以 `replaySeq` 作为 canonical ordering key。  
若新的 `replaySeq` 不大于已见最大值，通知 MUST 被拒绝进入后续处理。

`WEB-403`  
当缺少 `replaySeq` 时，cursor MAY 回退到以下策略：
1. 优先按 `eventId` 去重
2. 若存在 `traceId + seq`，仅在同 trace 内保持单调
3. 若两者都缺失，则接受通知

`WEB-404`  
`seenEventIds` 去重窗口 MUST 是有界的；当超过 cap 驱逐旧 id 后，过旧事件 MAY 再次被接受。该行为属于 bounded dedupe tradeoff，不表示语义重复合法化。

## 6. 通知进入 Projection 的门禁

`WEB-501`  
Web runtime 在处理 turn notifications 时 MUST 先经过 sequenced-notification gate，再决定是否进入 canonical projection。

`WEB-502`  
只有 active thread 的 turn notification 才 MAY 进入当前可见 transcript 的 canonical projection path。  
非 active thread 的通知 MAY 更新 runtime bookkeeping，但 MUST NOT 污染当前可见 transcript。

`WEB-502A`
`newThreadDraft` 不是 active thread。draft surface 期间，Web URL sync MUST 继续保持 thread-only；draft 本地状态不得写入 URL query/route，也不得触发 canonical projection hydrate。

`WEB-502B`
当 `visibleSurface !== 'thread'` 或 `activeThreadId == null` 时，thread-only shell state MUST 不可见且不得继续被当作当前 surface owner：
1. `diffSnapshot`、`latestRequestCollapse`、`latestCompactBoundary`、context meter 等 thread chrome MAY 继续作为 by-thread cache 存在；
2. 但当前 active projection / shell chrome MUST 为空，不得把旧 thread 数据渲染到 draft / no-thread surface；
3. `selectedCwd` 与 `diffSnapshot.cwd` MUST NOT 参与 draft cwd fallback。

`WEB-503`  
当通知缺失 canonical envelope 必需字段，或 `schemaVersion` 非法时，Web MUST 跳过 canonical projection，并留下可诊断的 warn 日志；MUST NOT 伪造缺失字段继续投影。

`WEB-504`  
`turn/started`、`turn/completed`、`turn/failed` 等通知的 UI 副作用（active turn、mode、日志）可以留在 Web runtime 层处理，但 canonical turn segments MUST 仍然通过 adapter + projection 路径收口。

`WEB-505`
Web context meter state MUST remain thread-scoped runtime side state. Raw meter facts from `turn/started.contextMeter`, `turn/event` usage events, and `/context --json` `local.diagnostics.contextMeterRaw` MAY update `contextMeterRawByThreadId`, including for non-active threads, after sequenced-notification gating. They MUST NOT be inserted into transcript logs, canonical projection segments, history hydrate rows, or `eventAdapters.ts`.
Visible Web context-meter rendering MUST honor `initialize.result.ui.showContextMeter`; disabling visibility MUST NOT require dropping the cached raw side state.

`WEB-506`
Web MUST derive displayed context percentages locally from raw budget, usage, and snapshot facts. `percentRemaining`, `percentUsed`, labels, colors, and warning tones are render/view-model projections, not protocol authority.

## 7. Compression Projection Facts

`WEB-601`
Web runtime MUST treat `latestCompactBoundary`, `durableSnip`, and `latestRequestCollapse` from `thread/messages`, `thread/resume`, and `thread/replay` as server-owned compression projection facts. They MUST be cached from the parsed RPC result object through a single facts helper per response, not independently derived from transcript rows.

`WEB-602`
These cached facts are display metadata for thread chrome and inspection panes. They MUST NOT be inserted into transcript logs, canonical projection segments, or history hydrate rows.

`WEB-603`
`durableSnip` is the durable projection-stage fact exposed by app-server. Request projection diagnostics remain under `/context` diagnostics (`nextTurnFixed.snipImpact`, `nextTurnFixed.collapseImpact`, and `strategyControlPlane`). Web MUST NOT interpret `durableSnip` as request-time snip impact or use it to mutate transcript rows.

## 8. 变更流程

当修改 Web 的 history adapter、projection baseline、notification cursor、active-thread gating 或 replay hydrate 语义时：
1. 先更新本文件。
2. 若变更触及共享 canonical 语义，再先更新 `docs/contracts/semantics-contract.md`。
3. 再更新 `docs/frontend/app-server-ui-spec.md` 的实现摘要。
4. 最后更新 `packages/web-reference-react/AGENTS.md` 等 code-local guide。

若实现与本合同冲突，应视为实现漂移并立即收敛修正。
