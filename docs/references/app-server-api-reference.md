# Formax App Server API Reference（v0.2）

本文档基于当前实现代码整理，目标是给 Web/GUI 客户端提供可直接对接的接口手册。

优先级说明：

- 若与产品/合同文档冲突，以 `plans/app-server/PRODUCT-SPEC.md`、`docs/contracts/semantics-contract.md`、`docs/contracts/app-server-interaction-contract.md` 与 `docs/contracts/interactive-input-contract.md` 为准。
- 本文档主要用于“字段结构 + 示例 + 对接实现参考”，不作为协议决策源。

- 传输：`stdio` + `JSONL`（每行一个 JSON）
- 协议：`JSON-RPC 2.0`
- 协议版本：`0.2`
- 代码来源：
  - `src/app-server/protocol.ts`
  - `src/app-server/protocol/input.ts`
  - `src/app-server/server.ts`
  - `src/app-server/turnRunner.ts`
  - `src/app-server/jsonrpc.ts`
  - `src/app-server/transport/stdio.ts`

## 0. UI 对接阅读顺序（推荐）

前端开发时建议按以下顺序阅读，先定协议边界，再看实现细节：

1. `docs/references/app-server-api-reference.md`
2. `src/app-server/protocol.ts`
3. `src/app-server/protocol/input.ts`
4. `src/app-server/server.ts`
5. `src/app-server/turnRunner.ts`
6. `src/app-server/threadStore.ts`
7. `src/app-server/jsonrpc.ts`
8. `src/app-server/transport/stdio.ts`

说明：

- 1-3：先确认方法、字段和 input 生命周期，避免 UI 先写后改。
- 4-6：确认 thread/turn 的真实行为与状态流。
- 7-8：确认 JSON-RPC 解析、错误码和传输边界（如 payload 限制）。

## 1. 快速集成流程

1. 启动服务：`formax app-server`
2. 发送 `initialize` 请求
3. 发送 `initialized` 通知
4. 调 `thread/start`（或 `thread/resume`）
5. 调 `turn/start` 或 `command/dispatch`
6. 持续监听通知：`turn/*`
7. 如收到 `turn/inputRequested`，调用 `turn/input/submit`
8. 直到收到 `turn/completed` 或 `turn/failed`

## 2. 传输与消息格式

## 2.1 JSONL 规则

- 每一行必须是完整 JSON。
- 空行会被忽略。
- 请求与通知都使用 `jsonrpc: "2.0"`。

## 2.2 请求 / 响应 / 通知

请求：

```json
{"jsonrpc":"2.0","id":"1","method":"thread/start","params":{"cwd":"/repo"}}
```

成功响应：

```json
{"jsonrpc":"2.0","id":"1","result":{"thread":{"id":"...","cwd":"...","createdAt":"...","updatedAt":"..."}}}
```

错误响应：

```json
{"jsonrpc":"2.0","id":"1","error":{"code":-32602,"message":"Invalid params.threadId: expected non-empty string"}}
```

通知（服务端推送）：

```json
{"jsonrpc":"2.0","method":"turn/started","params":{"replaySeq":101,"traceId":"...","seq":1,"ts":"...","eventId":"turnId:1","source":"system","turn":{"id":"...","threadId":"...","status":"running"}}}
```

## 2.3 大小限制

`initialize.result.limits` 会返回限制值：

- `maxRequestBytes`
- `maxEventBytes`
- `maxPendingInputsPerThread`
- `defaultInputTtlMs`
- `maxInFlightTurnsPerThread`（当前固定 `1`）

注意：

- 请求超过 `maxRequestBytes`：返回 `PAYLOAD_TOO_LARGE`（`-32002`）。
- 响应超过 `maxEventBytes`：返回 `PAYLOAD_TOO_LARGE`（`-32002`）。
- 通知超过 `maxEventBytes`：当前实现会发送失败并被吞掉（客户端收不到该条通知），UI 侧要做超时/兜底策略。

## 3. 握手与会话状态

## 3.1 initialize

### Request

`method: "initialize"`

`params`（可选）：

```ts
{
  clientInfo?: {
    name: string
    version: string
  }
}
```

### Response

```ts
{
  serverInfo: {
    name: 'formax'
    version: string
  }
  protocolVersion: '0.2'
  serverInstanceId: string
  limits: {
    maxRequestBytes: number
    maxEventBytes: number
    maxPendingInputsPerThread: number
    defaultInputTtlMs: number
    maxInFlightTurnsPerThread: number
  }
}
```

## 3.2 initialized（notification）

- `method: "initialized"`（notification，无 `id`）
- 当前实现不强制要求先收到它才可调用业务方法，但推荐发送，后续版本可能加强校验。

## 3.3 未初始化错误

除 `initialize` 外，所有请求在未初始化时返回：

```json
{"code":-32001,"message":"Not initialized"}
```

## 4. 核心数据结构

## 4.1 Thread

```ts
type Thread = {
  id: string
  cwd: string
  createdAt: string // ISO
  updatedAt: string // ISO
}
```

`ThreadSummary` 额外字段：

```ts
{
  messageCount: number | null
  lastUserPrompt: string | null
  label: string | null
}
```

## 4.2 Turn 状态

```ts
type TurnStatus = 'running' | 'completed' | 'failed' | 'interrupted'
```

## 4.3 Input（approval / ask_user_question）

`approval` / `ask_user_question` 的行为语义（如 decision/scope、多选编码）以 `docs/contracts/interactive-input-contract.md` 为准；本节仅定义字段结构与类型。

### kind

```ts
type InputKind = 'approval' | 'ask_user_question'
```

### status

```ts
type InputStatus = 'pending' | 'submitted' | 'canceled' | 'expired' | 'failed'
```

### InputRequestedPayload

```ts
{
  inputId: string
  threadId: string
  turnId: string
  toolUseId: string
  kind: 'approval' | 'ask_user_question'
  status: 'pending'
  createdAt: string
  expiresAt: string
  payload: ApprovalInputPayload | AskUserQuestionInputPayload
}
```

Approval payload：

```ts
{
  toolName: string
  action: unknown
  effectiveDecision: unknown
  suggestions?: string[]
  workspaceRequest?: { dir: string } | null
}
```

AskUserQuestion payload：

```ts
{
  questions: Array<{
    question: string
    header: string
    fieldId?: string
    options: Array<{ label: string; description: string }>
    multiSelect: boolean
  }>
}
```

### InputResolvedPayload

```ts
{
  inputId: string
  threadId: string
  turnId: string
  toolUseId: string
  kind: 'approval' | 'ask_user_question'
  status: 'submitted' | 'canceled' | 'expired' | 'failed'
  createdAt: string
  expiresAt: string
  resolvedAt: string
  reason?: string
}
```

## 4.4 通知 envelope（turn 事件统一元信息）

以下通知统一带：

```ts
{
  schemaVersion?: 1 // 缺省按 1 处理；未知版本在严格模式下视为协议异常
  replaySeq: number // thread 内单调递增、唯一；客户端排序主键
  traceId: string
  seq: number
  ts: string
  eventId: string // "${turnId}:${seq}"
  source: 'engine' | 'tool' | 'policy' | 'system'
  ...
}
```

说明：

- `schemaVersion=1` 是当前 canonical envelope 基线版本。
- 新增可选字段属于向后兼容扩展；破坏性变更需要升级 `schemaVersion`。
- `replaySeq` 是跨 turn 的全局游标，客户端应优先按它排序与去重。
- `seq` 仅在单个 turn 内递增，不能单独作为跨 turn 排序键。
- authority 按路径分层：
  - app-server 路径：envelope 必须由 server 侧完整产出；客户端不应补造后参与语义投影。
  - local TUI 路径：可由 runtime 本地产出 envelope，但必须与本节字段契约保持等价。

版本治理规则（镜像说明，规范以 interaction contract 为准）：

1. 先在 `docs/contracts/app-server-interaction-contract.md` 标注变更类型（兼容扩展 / 破坏性变更）。
2. 破坏性变更必须先升级 `schemaVersion`，再落 adapter 双版本兼容。
3. 同步更新本节、`canonicalEvents.ts` 类型定义与 notification adapter。
4. 必须补齐 cross-path contract fixture 回归（stream / notification / replay-like）。
5. 版本切换后再调整默认值；旧版本移除需有迁移窗口。

## 5. JSON-RPC 方法

## 5.1 `thread/start`

### Params

```ts
{
  cwd?: string
}
```

### Result

```ts
{
  thread: Thread
}
```

## 5.2 `thread/resume`

### Params

```ts
{
  threadId: string
}
```

### Result

```ts
{
  thread: Thread
  staleInputs: InputResolvedPayload[]
}
```

说明：

- `staleInputs` 表示服务重启后恢复出的“过期输入”（`status = "expired"`，`reason = "server_restart"`）。
- 客户端应在恢复线程后把这些输入标记为不可提交。

## 5.3 `thread/list`

### Params

```ts
{
  limit?: number // 默认 20，最大 200
  cursor?: string // 数字偏移量字符串，如 "20"
}
```

### Result

```ts
{
  data: ThreadSummary[]
  nextCursor: string | null
}
```

## 5.4 `thread/read`

### Params

```ts
{
  threadId: string
}
```

### Result

```ts
{
  thread: Thread
  transcriptPreview: Array<{ role: 'user' | 'assistant'; text: string }>
}
```

## 5.4.1 `thread/messages`

### Params

```ts
{
  threadId: string
  limit?: number // 默认 50，最大 200
  cursor?: string // 偏移量字符串；留空时默认返回最新一页
}
```

### Result

```ts
{
  data: Array<
    | { id: string; kind: 'message'; role: 'user' | 'assistant'; text: string }
    | {
        id: string
        kind: 'tool'
        toolUseId?: string
        toolName: string
        status: 'running' | 'completed' | 'error'
        summary: string
        paramsText?: string
        detailLines?: string[]
      }
  >
  nextCursor: string | null // 指向“更早一页”的 cursor；null 表示已到最早
}
```

说明：

- `toolName` 以 `toolUseId` 为维度保持粘性（sticky）；服务端会在 `update/end` 缺省时补齐，客户端可以按同一 `toolUseId` 视为同一工具。
- `toolUseId` 可能缺失（历史数据或降级路径）。当缺失时，这条 tool 记录只保证自身字段完整，不承诺跨记录合并；客户端应按该条记录的 `id` 作为本地渲染键。

## 5.4.2 `thread/replay`

### Params

```ts
{
  threadId: string
  after?: number // 从某个 replaySeq 之后增量拉取
  limit?: number // 默认 200，最大 500
}
```

### Result

```ts
{
  data: Array<{
    replaySeq: number
    method: string
    params: Record<string, unknown>
  }>
  nextCursor: number
  latestCursor: number
  hasGap: boolean
  state: {
    mode: 'normal' | 'acceptEdits' | 'plan'
    activeTurnId: string | null
    lastTurnId: string | null
    lastTurnStatus: 'running' | 'completed' | 'failed' | 'interrupted' | null
    pendingInputCount: number
    canonicalProtocolAnomalyCount: number
    pendingInputs: Array<{
      inputId: string
      threadId: string
      turnId: string
      toolUseId: string
      kind: 'approval' | 'ask_user_question'
      status: 'pending'
      createdAt: string
      expiresAt: string
      payload: unknown
    }>
    invariantIssues: Array<
      | {
          kind: 'running_tool_after_terminal_turn'
          turnId: string
          toolUseId: string
        }
      | {
          kind: 'pending_input_after_terminal_turn'
          turnId: string
          inputId: string
          toolUseId: string
        }
    >
    projection: {
      segments: Array<Record<string, unknown>>
      lastReplaySeq: number
      toolNameByUseId: Record<string, string>
      openAssistantSegmentIdByTurn: Record<string, string>
      openThinkingSegmentIdByTurn: Record<string, string>
    } | null
    toolNameByUseId: Record<string, string>
    updatedAt: string
  } | null
}
```

说明：

- `hasGap = true` 表示 `after` 指向的游标与服务端可重放窗口不连续（例如事件被裁剪）；客户端应丢弃本地增量缓存并改走 `thread/messages` 全量重建，再使用新的 `latestCursor` 继续增量同步。
- `hasGap = false` 且 `data` 为空，表示当前仅“无新增事件”，不是错误。
- `data[*].params` 是原始通知 `params`（包含完整 envelope 元字段），因此包含 `replaySeq/traceId/seq/ts/eventId/source`。
- `data[*].replaySeq` 与 `data[*].params.replaySeq` 必须一致；前者作为分页游标字段保留，客户端应优先使用顶层 `replaySeq` 做排序与去重。
- `state.toolNameByUseId` 是 replay state 的 sticky cache；当增量窗口首条是 tool update/end 且缺少名称时，客户端可用该映射恢复 toolName（服务端会保留最近窗口，避免无限增长）。
- `state.projection` 仅在“首帧同步（`after` 缺省）”或“`hasGap=true`”时可能返回快照；普通增量拉取下通常为 `null`。
- `state.invariantIssues` 仅在存在 projection 时可检测；当 projection 缺失时固定为空数组 `[]`。
- `state.canonicalProtocolAnomalyCount` 为当前线程 strict-envelope 协议异常累计计数（缺失按 `0` 处理）。
- `state = null` 条件：服务端当前无该线程 runtime state，且未命中 fallback 条件（`hasGap=true` 且存在 projection）。`state != null` 时上述字段全部可用。

## 5.5 `turn/start`

### Params

```ts
{
  threadId: string
  input: { text: string }
  mode?: 'normal' | 'acceptEdits' | 'plan'
  cwd?: string
}
```

### Result

```ts
{
  turn: {
    id: string
    threadId: string
    status: 'running'
  }
}
```

约束：

- 单线程仅允许一个 in-flight turn。重复启动会返回 `Invalid params`（`Turn already running...`）。

## 5.6 `command/dispatch`

### Params

```ts
{
  threadId: string
  command: string // 必须以 "/" 开头
  mode?: 'normal' | 'acceptEdits' | 'plan'
  cwd?: string
}
```

### Result（两种形态）

形态 A：转发为 turn（当前 `/init`、`/compact`）

```ts
{
  command: string
  dispatched: true
  turn: {
    id: string
    threadId: string
    status: 'running'
  }
}
```

形态 B：本地命令输出（当前 `/todos`）

```ts
{
  command: string
  dispatched: true
  local: {
    stdout: string // 已去除 ANSI 控制序列，可直接在 Web 渲染
  }
}
```

当前支持范围（server 侧）：

- `/init`：走形态 A（转发 turn）
- `/compact`：走形态 A（转发 turn；由 TurnRunner 执行 compact 语义）
- `/todos`：走形态 B（本地输出）
- 其他命令：返回 `INVALID_PARAMS`（Unsupported params.command）

## 5.7 `turn/interrupt`

### Params

```ts
{
  threadId: string
  turnId: string
}
```

### Result

```ts
{}
```

## 5.8 `turn/input/submit`

### Params

```ts
{
  threadId: string
  turnId: string
  inputId?: string
  toolUseId?: string // 若 inputId 缺失，可用 toolUseId 回填
  answers: Record<string, string>
  submissionId?: string // 用于幂等
}
```

### Result

```ts
{
  accepted: boolean
  status:
    | 'accepted'
    | 'already_submitted_same'
    | 'conflict_already_submitted'
    | 'not_pending'
    | 'expired'
    | 'canceled'
}
```

幂等建议：

- 同一业务提交请复用 `submissionId`。
- 返回 `already_submitted_same` 可按成功处理。
- 返回 `conflict_already_submitted` 说明已提交过不同答案，应提示用户冲突。

`inputId` / `toolUseId` fallback 规则：

- 优先使用 `inputId`。
- 当 `inputId` 缺失时，服务端会尝试使用 `toolUseId` 反查当前 turn 的 input。
- 若 `toolUseId` 对应多个 input，服务端优先当前仍 `pending` 的 input；若无 pending，则回落到该 `toolUseId` 的最后一个记录。

正例（推荐）：

```json
{"jsonrpc":"2.0","id":"4","method":"turn/input/submit","params":{"threadId":"t1","turnId":"u1","inputId":"u1:ask-1:ask_user_question","answers":{"Choice":"A"},"submissionId":"sub-001"}}
```

正例（兼容）：

```json
{"jsonrpc":"2.0","id":"5","method":"turn/input/submit","params":{"threadId":"t1","turnId":"u1","toolUseId":"ask-1","answers":{"Choice":"A"},"submissionId":"sub-002"}}
```

负例（`inputId` 与 `toolUseId` 都缺失）：

```json
{"jsonrpc":"2.0","id":"6","method":"turn/input/submit","params":{"threadId":"t1","turnId":"u1","answers":{"Choice":"A"}}}
```

结果：`INVALID_PARAMS`（缺少 `params.inputId` 或 `params.toolUseId`）。

负例（`toolUseId` 指向已 stale/expired 输入）：

```json
{"jsonrpc":"2.0","id":"7","method":"turn/input/submit","params":{"threadId":"t1","turnId":"u1","toolUseId":"ask-1","answers":{"Choice":"A"}}}
```

结果：`INPUT_EXPIRED`（`error.data.kind = INPUT_EXPIRED`）。

## 6. 服务端通知（`turn/*`）

## 6.1 `turn/started`

```ts
{
  ...envelopeMeta,
  turn: {
    id: string
    threadId: string
    status: 'running'
    mode: 'normal' | 'acceptEdits' | 'plan'
  }
}
```

## 6.2 `turn/event`

```ts
{
  ...envelopeMeta,
  threadId: string
  turnId: string
  event: StreamEvent
}
```

`event` 类型来自 `src/streaming/types.ts`，典型值：

- `assistant_delta`
- `thinking_delta` / `thinking_stop`
- `tool_start` / `tool_input` / `tool_update` / `tool_end`
- `usage`
- `approval_request`
- `ask_user_question`
- `error`
- `complete`

兼容性约束：

- 服务端会透传未知 `event.type`。
- 客户端应以“unknown event fallback”处理（展示原始 payload），不要因未知类型中断渲染。

## 6.3 `turn/modeChanged`

```ts
{
  ...envelopeMeta,
  threadId: string
  turnId: string
  previousMode: 'normal' | 'acceptEdits' | 'plan'
  mode: 'normal' | 'acceptEdits' | 'plan'
}
```

## 6.4 `turn/inputRequested`

```ts
{
  ...envelopeMeta,
  threadId: string
  turnId: string
  input: InputRequestedPayload
}
```

## 6.5 `turn/inputResolved`

```ts
{
  ...envelopeMeta,
  threadId: string
  turnId: string
  input: InputResolvedPayload
}
```

## 6.6 `turn/completed`

```ts
{
  ...envelopeMeta,
  turn: { id: string; threadId: string; status: 'completed' }
}
```

## 6.7 `turn/failed`

```ts
{
  ...envelopeMeta,
  turn: { id: string; threadId: string; status: 'failed' | 'interrupted' }
  error: string
}

说明：

- `error` 字段是可读错误信息，不是稳定 machine code。
- 需要机器分支时，应优先依赖 JSON-RPC `error.code` 与 `error.data.kind`。
```

## 7. 输入状态机（客户端实现建议）

状态迁移（简化）：

1. `turn/inputRequested` -> `pending`
2. 客户端 `turn/input/submit`
3. 成功时收到 `turn/inputResolved(status='submitted')`
4. 其他终止路径：
   - turn 被中断 -> `canceled`（reason: `turn_interrupted`）
   - 输入 TTL 到期 -> `expired`（reason: `input_expired`）
   - turn 失败/完成但仍挂起输入 -> `failed`
   - 服务重启后恢复 -> `expired`（reason: `server_restart`）

UI 建议：

- 以 `inputId` 为主键，`toolUseId` 为辅助索引。
- 收到 `turn/completed|turn/failed` 后，将该 turn 的 pending 输入全部冻结为不可提交。
- 若 `thread/resume` 返回 `staleInputs`，本地直接标记为已过期。

## 8. 错误模型

## 8.1 JSON-RPC 标准/扩展错误码

- `-32700` `PARSE_ERROR`
- `-32600` `INVALID_REQUEST`
- `-32601` `METHOD_NOT_FOUND`
- `-32602` `INVALID_PARAMS`
- `-32603` `INTERNAL_ERROR`
- `-32001` `NOT_INITIALIZED`
- `-32002` `PAYLOAD_TOO_LARGE`

## 8.2 业务错误（当前实现）

### INPUT_EXPIRED

`turn/input/submit` 命中过期输入会返回：

```json
{
  "code": -32602,
  "message": "INPUT_EXPIRED",
  "data": {
    "kind": "INPUT_EXPIRED",
    "recoverable": false,
    "retryable": false,
    "inputId": "..."
  }
}
```

处理建议：

- 不要重试同一 input；
- 引导用户发起新 turn 或恢复线程后继续。

### PAYLOAD_TOO_LARGE

请求或事件超出 `limits.maxRequestBytes/maxEventBytes` 时返回：

```json
{
  "code": -32002,
  "message": "PAYLOAD_TOO_LARGE",
  "data": {
    "kind": "PAYLOAD_TOO_LARGE",
    "recoverable": true,
    "retryable": true,
    "direction": "request | event",
    "maxBytes": 1048576,
    "actualBytes": 1234567
  }
}
```

客户端建议：

- `direction = request`：裁剪 payload 后重试（例如缩短输入、减少附加字段）。
- `direction = event`：提示“输出过大已被截断/拒绝”，允许用户改用更小粒度操作重试。

## 9. 前端对接最小实现清单

1. 建立 JSONL 通道（每行 JSON）。
2. 完成 `initialize` + `initialized`。
3. 实现请求-响应关联（`id` 维度）。
4. 实现通知分发（`turn/*`）。
5. 用 `threadId + turnId + inputId` 做输入状态管理。
6. `turn/input/submit` 携带稳定 `submissionId`（幂等）。
7. 对 `PAYLOAD_TOO_LARGE`、`NOT_INITIALIZED`、`INPUT_EXPIRED` 做明确 UI 提示。
8. 为通知丢失设计兜底：
   - turn 长时间无事件时给“连接可能异常”提示；
   - 允许用户手动 `thread/read` 或重开 turn。

## 10. 端到端示例（JSONL）

```json
{"jsonrpc":"2.0","id":"1","method":"initialize","params":{"clientInfo":{"name":"web-ref","version":"0.1.0"}}}
{"jsonrpc":"2.0","method":"initialized"}
{"jsonrpc":"2.0","id":"2","method":"thread/start","params":{"cwd":"/path/to/repo"}}
{"jsonrpc":"2.0","id":"3","method":"turn/start","params":{"threadId":"<thread-id>","input":{"text":"请先读取 README"}}}
{"jsonrpc":"2.0","id":"4","method":"turn/input/submit","params":{"threadId":"<thread-id>","turnId":"<turn-id>","inputId":"<input-id>","answers":{"decision":"approve"},"submissionId":"sub-001"}}
```

上面的第 4 条只在收到 `turn/inputRequested` 后发送。
