# Formax App Server Interaction Contract（v0.2 基线）

更新时间：2026-03-07

本文件定义 GUI 与 app-server 之间的“行为合同”。  
任何实现或重构都必须满足本文件，不允许只满足“某个客户端刚好可用”。

相关文档：

- 项目语义边界：`docs/contracts/semantics-contract.md`
- UI 行为：`docs/frontend/app-server-ui-spec.md`
- 接口参考：`docs/references/app-server-api-reference.md`
- 交互输入唯一事实源：`docs/contracts/interactive-input-contract.md`
- Session persistence / resume 唯一事实源：`docs/contracts/session-persistence-contract.md`
- 学习记录（非规范）：`docs/learnings/2026-02-25-app-server-session-grouping-and-hidden-cwds.md`

本合同自身承担 app-server 行为边界，不以 `plans/*` 过程文档作为规范性上游。

## 1. 传输与握手合同

1. 传输协议固定为 `stdio + JSONL + JSON-RPC 2.0`。
2. 客户端握手顺序：
  - `initialize`（request）
  - `initialized`（notification）
3. 除 `initialize` 外，任何 request 在初始化前都返回 `NOT_INITIALIZED`。
4. `initialize.result` 必须包含：
  - `serverInfo`
  - `protocolVersion`
  - `serverInstanceId`
  - `limits`

## 2. 方法合同（Method Contract）

## 2.1 thread/start

- 入参：`{ cwd?: string }`
- 返回：`{ thread }`
- 失败条件：
  - 参数非法 -> `INVALID_PARAMS`

## 2.2 thread/resume

- 入参：`{ threadId: string }`
- 返回：`{ thread, staleInputs }`
- 共享恢复语义：
  - stale input 的推导、`server_restart` 过期语义、以及 provisional thread 的恢复边界以 `docs/contracts/session-persistence-contract.md` 为准
- 失败条件：
  - 线程不存在 -> `INVALID_PARAMS` + `Thread not found...`

## 2.3 thread/list

- 入参：`{ limit?: number, cursor?: string }`
- 约束：
  - `limit` 默认 20，最大 200
  - `cursor` 为非负整数字符串偏移量
- 返回：`{ data, nextCursor }`

## 2.4 thread/read

- 入参：`{ threadId: string }`
- 返回：`{ thread, transcriptPreview }`

## 2.4.1 thread/messages

- 入参：`{ threadId: string, limit?: number, cursor?: string }`
- 约束：
  - `limit` 默认 50，最大 200
  - `cursor` 为非负整数字符串偏移量
  - `cursor` 缺失时默认返回最新一页
- 返回：`{ data, nextCursor }`（`nextCursor` 指向更早一页）
  - `data` 包含两类项：
    - `kind: "message"`：`{ id, role: "user" | "assistant", text }`
    - `kind: "tool"`：`{ id, toolUseId?, toolName, status, summary, paramsText?, detailLines? }`
      - `toolName` 为 `toolUseId` 维度粘性字段（sticky），`update/end` 缺省时服务端应补齐。
      - 若 `toolUseId` 缺失（历史/降级数据），不承诺跨记录合并语义；客户端按该条 `id` 作为独立记录处理。

## 2.5 turn/start

- 入参：`{ threadId, input: { text }, cwd?: string }`
- 返回：`{ turn: { id, threadId, status: "running" } }`
- 并发约束：
  - 同一 `threadId` 同时最多 1 个 in-flight turn
  - 冲突时返回 `INVALID_PARAMS`（`Turn already running...`）

## 2.6 turn/interrupt

- 入参：`{ threadId, turnId }`
- 返回：`{}`
- 若 turn 不存在或非 in-flight：`INVALID_PARAMS`（`Turn not running...`）

## 2.7 turn/input/submit

- 入参：
  - `threadId`
  - `turnId`
  - `inputId`（优先）
  - `toolUseId`（`inputId` 缺失时用于回填）
  - `answers: Record<string,string>`
  - `submissionId?`
- 返回：
  - `accepted: boolean`
  - `status: accepted | already_submitted_same | conflict_already_submitted | not_pending | expired | canceled`

## 3. 通知合同（Notification Contract）

所有 turn 相关通知必须含以下 envelope 字段：

- `schemaVersion: 1`（可选；缺省按 `1` 处理）
- `replaySeq: number`（thread 内单调递增、唯一；客户端排序主键）
- `traceId: string`
- `seq: number`（turn 内单调递增）
- `ts: string`（ISO 时间）
- `eventId: string`（建议 `${turnId}:${seq}`）
- `source: engine | tool | policy | system | ui`

权威边界（path-scoped authority）：

- app-server 路径（network-visible）：envelope 由 server 侧产出并保证稳定，客户端不得补造后再进入 projector。
- local TUI 路径（no server hop）：可由本地 runtime 生成 envelope，但字段契约与排序语义必须与 app-server 路径等价。

版本兼容策略：

- `schemaVersion=1` 是当前 canonical envelope 基线版本。
- 新增可选字段属于向后兼容扩展，不需要升级主版本。
- 破坏性变更（改语义/改必填/改排序主键）必须升级 `schemaVersion`。
- 严格模式下，若显式传入未知 `schemaVersion`，应视为协议异常并拒绝进入 canonical projector。

`schemaVersion` 升级流程（必须按顺序）：

1. 先在本文件定义“变更类型”：
  - 向后兼容扩展：新增可选字段 / 新增可忽略 kind。
  - 破坏性变更：修改既有语义、必填字段、排序主键或终局判定规则。
2. 若为破坏性变更：先升级 `schemaVersion`，并在 adapter 中增加双版本兼容分支。
3. 同步更新：
  - `docs/references/app-server-api-reference.md`
  - `src/features/semantics/core/canonicalEvents.ts`
  - `src/features/semantics/adapters/turnNotificationCanonicalAdapter.ts`
4. 增加跨入口 contract fixture（stream / notification / replay-like）回归测试。
5. 通过后才能切默认版本；旧版本下线需单独发布迁移公告。

### 3.0 Canonical Event Contract（客户端投影输入）

本节约束 app-server 通知映射后进入 projector 的 canonical 事件结构，作为
`src/features/semantics/core/canonicalEvents.ts` 的文档镜像。

Canonical envelope 字段（投影输入）：

- `schemaVersion?: 1`（缺省按 `1`）
- `threadId: string`
- `replaySeq: number`
- `eventId: string`
- `ts: string`
- `source: engine | tool | policy | system | ui`
- `traceId?: string`
- `seq?: number`

Canonical kind 集合（当前基线）：

- `user_message`
- `system_message`
- `assistant_delta`
- `thinking_delta`
- `thinking_finalized`
- `tool_event`
- `tool_input_state`
- `turn_footer`

turn 通知到 canonical 的最小映射保证：

- `turn/event`（`assistant_delta|thinking_delta|tool_start|tool_input|tool_update|tool_end`）映射为 1..N canonical 事件。
- `turn/completed` 固定映射为：
  1. `thinking_finalized`
  2. `turn_footer(status=completed)`
- `turn/failed` 固定映射为：
  1. `thinking_finalized`
  2. `turn_footer(status=failed|interrupted, message=error)`
- `turn/inputRequested|turn/inputResolved` 映射为 `tool_input_state`。

严格模式（`requireEnvelope=true`）下，以下情况必须拒绝进入 projector：

- 缺少 `threadId|turnId|replaySeq|eventId|ts|source` 任一字段；
- `schemaVersion` 显式出现且不为 `1`。

## 3.1 turn/started

- 载荷：`{ turn: { id, threadId, status: "running", mode } }`
- `mode` 仅允许：`normal | acceptEdits | plan`

## 3.2 turn/event

- 载荷：`{ turnId, threadId, event }`
- `event` 类型沿用 `src/streaming/types.ts`（含 `tool_end` 命名，不做重命名）
- 最小保证：
  - 服务端不对未知 `event.type` 做强校验，按原样透传给客户端。
  - 客户端必须以“可降级渲染”处理未知事件（至少保留原始 JSON 可见）。
  - `event` 的结构稳定性低于 envelope 字段，客户端不应把未知字段当作错误。

## 3.3 turn/modeChanged

- 载荷：`{ threadId, turnId, previousMode, mode }`
- `previousMode` / `mode` 仅允许：`normal | acceptEdits | plan`

## 3.4 turn/inputRequested

交互输入（`approval` / `ask_user_question`）语义细节以 `docs/contracts/interactive-input-contract.md` 为准。

- 载荷：`{ threadId, turnId, input }`
- `input.kind` 仅允许：
  - `approval`
  - `ask_user_question`
- `input.status` 固定为 `pending`

## 3.5 turn/inputResolved

- 载荷：`{ threadId, turnId, input }`
- `input.status` 仅允许：
  - `submitted`
  - `canceled`
  - `expired`
  - `failed`

## 3.6 turn/completed / turn/failed

- `turn/completed`：`status = completed`
- `turn/failed`：`status = failed | interrupted` 且带 `error`
- `turn/failed.error` 稳定性级别：
  - 用途：面向用户可读诊断文案。
  - 非 machine code：客户端不可依赖精确文案做分支。
  - 机器可判定分支应优先使用 JSON-RPC `error.code` 或 typed `error.data.kind`。

## 4. 状态机合同

## 4.1 Turn 状态机

- `running -> completed`
- `running -> failed`
- `running -> interrupted`（通过 interrupt）

约束：

1. 每个 `turn/started` 必须以 `turn/completed` 或 `turn/failed` 终结。
2. turn 终结后不得再发该 turn 的 `turn/event`。

## 4.2 Input 状态机

初始：

- `turn/inputRequested` -> `pending`

终局：

- `pending -> submitted`（客户端成功提交）
- `pending -> canceled`（turn interrupted）
- `pending -> expired`（TTL 到期，或 server restart 后 stale）
- `pending -> failed`（turn failed/completed 前仍挂起）

约束：

1. 每个 `inputId` 至少有 1 次 `turn/inputRequested`。
2. 每个 pending input 最终必须收到 1 次 `turn/inputResolved`。
3. `turn/inputResolved` 后对同 input 的提交不得再返回 `accepted`。

## 5. 幂等与冲突合同

## 5.1 幂等提交

- 相同 `submissionId` + 相同答案 -> `already_submitted_same`
- 相同答案但不同 `submissionId` -> `already_submitted_same`（可视为成功）

## 5.2 冲突提交

- 已提交后再提交不同答案 -> `conflict_already_submitted`

## 5.3 过期提交

- stale input（例如 resume 后）提交 -> `INPUT_EXPIRED` 错误（`error.data.kind = INPUT_EXPIRED`）

## 6. 错误合同

固定错误码：

- `PARSE_ERROR`（-32700）
- `INVALID_REQUEST`（-32600）
- `METHOD_NOT_FOUND`（-32601）
- `INVALID_PARAMS`（-32602）
- `INTERNAL_ERROR`（-32603）
- `OVERLOADED`（-32001）
- `NOT_INITIALIZED`（-32600，依赖 message=`Not initialized` 区分）
- `PAYLOAD_TOO_LARGE`（-32002）

错误处理原则：

1. 参数、状态冲突、资源不存在优先归为 `INVALID_PARAMS`。
2. 系统内部异常归为 `INTERNAL_ERROR`。
3. 业务可识别错误（如 `INPUT_EXPIRED`）必须在 `error.data` 中提供 machine-readable 字段。
4. 请求入口过载时返回 `OVERLOADED`，message 固定为 `Server overloaded; retry later.`，客户端应按可重试处理。

## 7. 恢复与重启合同

## 7.1 进程重启

- `thread/resume` 必须返回 `staleInputs`。
- stale input 的 `status` 固定 `expired`，`reason` 建议 `server_restart`。
- stale input 后续提交不得成功。

## 7.2 客户端断连

- 客户端重连后应先 `initialize/initialized`，再 `thread/resume`。
- 客户端本地 pending input 状态以服务器 `resume` 结果为准。

## 8. 资源边界合同

1. 请求 payload 大小不能超过 `limits.maxRequestBytes`。
2. 事件/响应 payload 大小不能超过 `limits.maxEventBytes`。
3. 每线程 pending input 数量不能超过 `limits.maxPendingInputsPerThread`。
4. input 默认 TTL 以 `limits.defaultInputTtlMs` 为准。
5. app-server 必须使用有界队列隔离 ingress/process/outbound；当 ingress 饱和且消息为 request 时，返回 `OVERLOADED` 而不是无限排队。

## 9. 验收断言（Contract Assertions）

以下断言任一不满足，即视为合同破坏：

1. 在初始化前调用 `thread/start` 未返回 `NOT_INITIALIZED`。
2. 同线程并发 `turn/start` 未产生冲突错误。
3. `turn/inputRequested` 出现后没有对应 `turn/inputResolved`。
4. 同一 input 不同答案重复提交未返回冲突状态。
5. `thread/resume` 未返回 stale input，而后续提交又报 `INPUT_EXPIRED`。
6. 通知缺失 envelope 元字段（`replaySeq/traceId/seq/ts/eventId/source`）或显式携带未知 `schemaVersion`。
7. 请求突发超过 ingress 有界队列容量时，未返回 `OVERLOADED`。

## 10. 合同条目 -> 实现映射


| 合同条目                                                                  | 主要实现                                                                                                                          | 主要测试                                                                                                                     |
| --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `initialize` / `initialized` 握手                                       | `src/app-server/server.ts`, `src/app-server/protocol.ts`                                                                      | `src/app-server/server.test.ts`, `src/app-server/index.test.ts`                                                          |
| 未初始化拦截（`NOT_INITIALIZED`）                                             | `src/app-server/server.ts`, `src/app-server/jsonrpc.ts`                                                                       | `src/app-server/server.test.ts`, `src/app-server/index.test.ts`                                                          |
| `thread/start`                                                        | `src/app-server/server.ts`, `src/app-server/threadStore.ts`, `src/features/repl/sessionSave/index.ts`                         | `src/app-server/server.test.ts`, `src/app-server/threadStore.test.ts`                                                    |
| `thread/resume` + `staleInputs`                                       | `src/app-server/server.ts`, `src/app-server/threadStore.ts`, `src/app-server/store/sessionEventReader.ts`                     | `src/app-server/server.test.ts`, `src/app-server/threadStore.test.ts`, `src/app-server/store/sessionEventReader.test.ts` |
| `thread/list`（`limit/cursor`）                                         | `src/app-server/protocol.ts`, `src/app-server/threadStore.ts`                                                                 | `src/app-server/threadStore.test.ts`, `src/app-server/server.test.ts`                                                    |
| `thread/read`                                                         | `src/app-server/server.ts`, `src/app-server/threadStore.ts`                                                                   | `src/app-server/threadStore.test.ts`, `src/app-server/server.test.ts`                                                    |
| `thread/messages`（最新页 + 向前分页）                                         | `src/app-server/protocol.ts`, `src/app-server/server.ts`, `src/app-server/threadStore.ts`                                     | `src/app-server/server.test.ts`, `src/app-server/threadStore.test.ts`                                                    |
| `thread/replay` + runtime state snapshot                              | `src/app-server/server.ts`, `src/features/semantics/runtime/threadRuntimeState.ts`                                            | `src/app-server/server.test.ts`, `src/features/semantics/runtime/threadRuntimeState.test.ts`                             |
| `turn/start`（单线程单 in-flight）                                          | `src/app-server/server.ts`, `src/app-server/turnRunner.ts`                                                                    | `src/app-server/turnRunner.test.ts`, `src/app-server/server.test.ts`                                                     |
| `turn/interrupt`                                                      | `src/app-server/server.ts`, `src/app-server/turnRunner.ts`                                                                    | `src/app-server/turnRunner.test.ts`, `src/app-server/server.test.ts`                                                     |
| `turn/event` 转发                                                       | `src/app-server/turnRunner.ts`, `src/streaming/types.ts`                                                                      | `src/app-server/turnRunner.test.ts`, `src/app-server/server.test.ts`                                                     |
| `turn/modeChanged`（运行期 mode 同步）                                       | `src/app-server/turnRunner.ts`, `src/features/semantics/core/replModeTransition.ts`                                           | `src/app-server/turnRunner.test.ts`, `apps/web-reference-react/src/App.test.tsx`                                         |
| `turn/inputRequested` / `turn/inputResolved`                          | `src/app-server/turnRunner.ts`, `src/app-server/turn/inputStore.ts`, `src/app-server/protocol/input.ts`                       | `src/app-server/turnRunner.test.ts`, `src/app-server/server.test.ts`, `src/app-server/turn/inputStore.test.ts`           |
| `turn/input/submit` + `inputId/toolUseId` fallback                    | `src/app-server/protocol.ts`, `src/app-server/server.ts`, `src/app-server/turn/inputStore.ts`, `src/app-server/turnRunner.ts` | `src/app-server/server.test.ts`, `src/app-server/turn/inputStore.test.ts`, `src/app-server/turnRunner.test.ts`           |
| 提交幂等与冲突（`already_submitted_same` / `conflict_already_submitted`）      | `src/app-server/turn/inputStore.ts`, `src/app-server/turnRunner.ts`                                                           | `src/app-server/turn/inputStore.test.ts`, `src/app-server/server.test.ts`                                                |
| 过期提交（`INPUT_EXPIRED`）                                                 | `src/app-server/server.ts`, `src/app-server/threadStore.ts`, `src/app-server/store/sessionEventReader.ts`                     | `src/app-server/server.test.ts`, `src/app-server/store/sessionEventReader.test.ts`                                       |
| envelope 元字段（`schemaVersion/replaySeq/traceId/seq/ts/eventId/source`） | `src/app-server/server.ts`, `src/app-server/turnRunner.ts`, `src/app-server/protocol/input.ts`                                | `src/app-server/server.test.ts`, `src/app-server/turnRunner.test.ts`                                                     |
| 错误码常量                                                                 | `src/app-server/jsonrpc.ts`                                                                                                   | `src/app-server/jsonrpc.test.ts`                                                                                         |
| ingress/process/outbound 有界队列与过载拒绝                                    | `src/app-server/index.ts`, `src/app-server/jsonrpc.ts`                                                                        | `src/app-server/index.test.ts`, `src/app-server/index.coverage.test.ts`                                                  |
| `PAYLOAD_TOO_LARGE`（request/event）                                    | `src/app-server/index.ts`, `src/app-server/transport/stdio.ts`                                                                | `src/app-server/index.test.ts`, `src/app-server/transport/stdio.test.ts`                                                 |


