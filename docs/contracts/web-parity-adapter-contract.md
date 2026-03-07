# Web Parity Adapter Contract（唯一事实源）

最后更新：2026-03-07  
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
- `apps/web-reference-react/src/eventAdapters.ts`
- `apps/web-reference-react/src/store.ts`
- `apps/web-reference-react/src/turnEventCursor.ts`
- `apps/web-reference-react/src/app/core/projectionEngine.ts`
- `apps/web-reference-react/src/app/runtime/processNotification.ts`
- `apps/web-reference-react/src/app/runtime/connectRpcClient.ts`

规范关键字约定：
- `MUST`、`SHOULD`、`MAY` 采用 RFC 2119 语义。

## 1. 权威模型

`WEB-001`  
Web 的语义真值 MUST 继续来自共享 canonical semantics 层；Web adapter / reducer / cursor 只能消费该真值，不得重新定义语义规则。

`WEB-002`  
`eventAdapters.ts`、`store.ts`、`projectionEngine.ts` 与 `turnEventCursor.ts` 只拥有 Web adapter ownership；它们 MUST NOT 取代 `src/features/semantics/*` 成为新的 source of truth。

`WEB-003`  
通知进入 canonical projection 前的 envelope 校验与排序 gate，MUST 由 Web runtime adapter 负责；一旦进入 projection，状态变迁 MUST 由 canonical reducer 决定。

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

`WEB-503`  
当通知缺失 canonical envelope 必需字段，或 `schemaVersion` 非法时，Web MUST 跳过 canonical projection，并留下可诊断的 warn 日志；MUST NOT 伪造缺失字段继续投影。

`WEB-504`  
`turn/started`、`turn/completed`、`turn/failed` 等通知的 UI 副作用（active turn、mode、日志）可以留在 Web runtime 层处理，但 canonical turn segments MUST 仍然通过 adapter + projection 路径收口。

## 7. 变更流程

当修改 Web 的 history adapter、projection baseline、notification cursor、active-thread gating 或 replay hydrate 语义时：
1. 先更新本文件。
2. 若变更触及共享 canonical 语义，再先更新 `docs/contracts/semantics-contract.md`。
3. 再更新 `docs/frontend/app-server-ui-spec.md` 的实现摘要。
4. 最后更新 `apps/web-reference-react/README.md` 等 code-local deep dive。

若实现与本合同冲突，应视为实现漂移并立即收敛修正。
