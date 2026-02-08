# Formax App Server + GUI 集成设计（借鉴 Codex 分层）

更新时间：2026-02-08

## 1. 背景与目标

`formax` 当前核心交互是 Ink REPL（TUI），尚无可供桌面 GUI/IDE 客户端复用的稳定服务层。目标是在不破坏现有 REPL 行为前提下，新增一个 `formax app-server`，让 GUI 通过标准化双向协议驱动同一套运行时能力。

核心原则：

- 借鉴 Codex 的分层（共享核心 + TUI 壳 + app-server 壳）。
- 不做 Codex 协议兼容，只做 Formax 自定义协议。
- 一期采用 Codex 默认进程模型：子进程 + stdio(JSONL)。

## 2. 一期范围（MVP）

### 2.1 In Scope

- 新增 `formax app-server` 子命令。
- 传输：stdio JSONL（每行一条 JSON-RPC 2.0 消息）。
- 线程能力：`thread/start`、`thread/resume`、`thread/list`、`thread/read`。
- 回合能力：`turn/start`、`turn/interrupt`。
- 流式通知：assistant/thinking/tool/usage/error/completed。
- 交互桥接：审批（approval）与 `AskUserQuestion`。
- 持久化复用 `src/features/repl/sessionSave/*`。
- 提供 Web 参考客户端（开发验证用途）。

### 2.2 Out of Scope

- REPL overlay 类 slash command GUI 对齐（`/agents`、`/permissions`、`/hooks`、`/config`）。
- WebSocket/HTTP 正式传输。
- 与 Codex `thread/*`/`turn/*` 字段级兼容。

## 3. 目标架构

```text
+--------------------+
| GUI Client         |
| (Web/IDE/Desktop)  |
+---------+----------+
          | stdio JSONL (JSON-RPC 2.0)
+---------v----------+
| formax app-server  |
| - protocol/router  |
| - thread store     |
| - turn runner      |
+---------+----------+
          | shared runtime
+---------v------------------------------+
| Formax Runtime (shared)                |
| cfg + engine + toolRegistry + taskMgr |
| userInputManager + subagent runtime    |
+----------------------------------------+
```

关键点：TUI 与 app-server 必须共享同一运行时装配，避免双实现漂移。

## 4. 目录与模块设计

新增目录：`src/app-server/`

建议模块：

- `src/app-server/index.ts`
  - `runAppServer()` 入口。
- `src/app-server/server.ts`
  - JSON-RPC 方法路由与状态调度。
- `src/app-server/jsonrpc.ts`
  - 消息编解码、统一错误响应。
- `src/app-server/protocol.ts`
  - 请求/响应/通知类型定义 + zod 校验。
- `src/app-server/transport/stdio.ts`
  - 按行读写 stdin/stdout。
- `src/app-server/threadStore.ts`
  - 线程内存态管理 + sessionSave 映射。
- `src/app-server/turnRunner.ts`
  - turn 生命周期执行、事件桥接、中断。

新增共享装配：`src/runtime/createRuntime.ts`

- 从现有 `src/legacy/bootstrap/*` 抽取通用运行时构造。
- TUI (`runLegacyCli`) 与 app-server 共用。

## 5. 协议设计（自定义 JSON-RPC 2.0）

### 5.1 握手

- `initialize` (request)
  - 入参：`clientInfo { name, version }`
  - 返回：`serverInfo { name: "formax", version }`
- `initialized` (notification)

非握手请求在初始化前返回 `Not initialized`。

### 5.2 线程 API

- `thread/start`
  - 入参：`{ cwd?: string }`
  - 出参：`{ thread: { id, cwd, createdAt, updatedAt } }`
  - 通知：`thread/started`
- `thread/resume`
  - 入参：`{ threadId }`
  - 出参：`{ thread }`
- `thread/list`
  - 入参：`{ limit?: number, cursor?: string }`
  - 出参：`{ data: ThreadSummary[], nextCursor?: string | null }`
- `thread/read`
  - 入参：`{ threadId }`
  - 出参：`{ thread, transcriptPreview }`

### 5.3 回合 API

- `turn/start`
  - 入参：`{ threadId, input: { text: string } }`
  - 出参：`{ turn: { id, threadId, status: "running" } }`
  - 通知：
    - `turn/started`
    - `turn/event` (多次)
    - `turn/inputRequested` (可选)
    - `turn/completed` 或 `turn/failed`
- `turn/interrupt`
  - 入参：`{ threadId, turnId }`
  - 出参：`{}`

### 5.4 用户输入回传

- `turn/input/submit`
  - 入参：`{ threadId, turnId, toolUseId, answers }`
  - 行为：调用 `userInputManager.submitAnswers(toolUseId, answers)`
  - 出参：`{ accepted: boolean }`

### 5.5 `turn/event` 一期事件联合

- `assistant_delta`
- `thinking_delta`
- `thinking_stop`
- `tool_start`
- `tool_input`
- `tool_update`
- `tool_end`
- `usage`
- `error`

### 5.6 `turn/inputRequested` 一期类型

- `approval`
  - `toolUseId`
  - `toolName`
  - `action`
  - `effectiveDecision`
  - `suggestions`
  - `workspaceRequest?`
- `ask_user_question`
  - `toolUseId`
  - `questions`

## 6. 关键代码改造

### 6.1 抽共享 runtime

新增：`src/runtime/createRuntime.ts`

整合并复用：

- `createRuntimeConfigContext`
- `createLlmClients`
- `createToolingRuntime`
- `createPolicyAndHooksRuntime`
- `createSubagentRuntime`
- `createChatRuntime`

### 6.2 扩展 StreamEvent（服务端可见审批/提问）

修改：`src/streaming/types.ts`

新增事件：

- `approval_request`
- `ask_user_question`

### 6.3 审批事件桥接

修改：`src/tools/executor/approvalService.ts`

在 `ensureApproved()` 进入等待 `requestAnswers()` 前，通过 `ctx.onEvent` 发 `approval_request`。

### 6.4 AskUserQuestion 事件桥接

修改：`src/tools/modules/askUserQuestion/handler.ts`

在 `requestAnswers()` 前，通过 `ctx.onEvent` 发 `ask_user_question`。

### 6.5 CLI 接入

修改：

- `src/cli/main.ts`
- `src/cli/help.ts`
- `src/entrypoints/cli.tsx`

新增命令：`formax app-server`

默认 `formax` 启动 REPL 行为保持不变。

## 7. 线程持久化策略（复用 sessionSave）

复用：

- `src/features/repl/sessionSave/writer.ts`
- `src/features/repl/sessionSave/reader.ts`

约定：

- `threadId = session_meta.sessionId`
- `thread/start` -> `SessionWriter.createNew`
- `thread/resume` -> 通过 `threadId` 查 session 文件并回放
- 每次 turn 完成落盘 `history_state` + 必要 `event`

建议补充能力：

- 在 `reader.ts` 增加 `findSessionFileBySessionId(sessionId)`

## 8. 并发与状态约束

- 同一 `threadId` 同时只允许一个 in-flight turn。
- 二次 `turn/start` 返回冲突错误（例如 `Turn already running`）。
- `turn/interrupt` 仅作用于对应 in-flight turn。
- server 重启后可通过 `thread/resume` 继续。

## 9. 测试与验收

### 9.1 单元测试

- 协议校验与 JSON-RPC 错误映射。
- stdio transport 解析与粘包/坏行处理。
- turnRunner 事件顺序与状态流转。
- approval/ask_user_question 事件桥接。
- threadStore 与 sessionSave 映射。

### 9.2 集成测试

端到端模拟：

1. initialize -> thread/start -> turn/start -> turn/completed
2. 触发审批 -> submit answers -> turn 继续并完成
3. AskUserQuestion -> submit answers -> turn 完成
4. turn/interrupt 正常生效
5. 重启后 thread/resume 可继续

### 9.3 回归要求

- 现有 `bun run test` 全绿。
- CLI 既有命令（status/doctor/setup/config/auth/policy/repl）行为不回归。

## 10. 分期实施顺序

1. 抽共享 runtime（零行为变化）
2. app-server 骨架（initialize + 基础路由）
3. thread/start-resume-list-read
4. turn/start + 流式事件桥接
5. approval 与 AskUserQuestion 回传闭环
6. turn/interrupt
7. Web 参考客户端（开发验证）
8. 文档与 CODEMAP 同步

## 11. 风险与对策

- 风险：运行时装配重构引入 TUI 回归
  - 对策：先做纯抽取 PR，保证快照/行为测试通过。
- 风险：审批桥接导致 REPL 现有路径行为变化
  - 对策：新事件只追加，不改变现有提交答案流程。
- 风险：sessionSave 查找性能随文件增多下降
  - 对策：一期先可用，后续再加索引优化（`session_index.jsonl` 或缓存）。

## 12. 结论

这套方案可在最小风险下，把 Formax 从“仅 TUI 工具”升级为“共享核心 + 可驱动 GUI 的本地 agent runtime”。它保留现有 REPL 资产，同时建立后续 IDE/Desktop 集成的稳定基础。

## 13. Design v2 Addendum（增量补丁）

说明：本节仅补充/修正一期设计，不推翻 `§5` 的方法集合与 `stdio JSONL + JSON-RPC 2.0` 约束。

### 13.1 决策摘要（先决策）

- 保持一期接口面不扩散：继续使用 `initialize`、`thread/*`、`turn/*`、`turn/input/submit`。
- 补齐协议可调试性：为 turn 相关通知增加统一元数据（`traceId/seq/ts/eventId/source`）。
- 将 approval 与 AskUserQuestion 收敛为统一 input 生命周期（`pending -> submitted/canceled/expired/failed`）。
- 本期仅做“协议/状态机收敛”，不合并两者业务语义：
  - approval 仍保留权限决策与持久化副作用。
  - ask_user_question 仍保留工具问答语义。
- 新增 `turn/inputResolved` 终局通知，解决 GUI pending 悬挂竞态。
- 持久化继续复用 `sessionSave`，但 app-server 使用独立 event reader 读取 `event` 记录，不改现有 REPL 回放语义。

### 13.2 协议字段补充（最小改动）

#### 13.2.1 initialize 返回能力与限制

`initialize` result 增补：

- `serverInstanceId: string`（进程级实例 ID，重启变化）
- `protocolVersion: "0.2"`（本次 input 生命周期协议为非兼容变更，显式升版）
- `limits`:
  - `maxRequestBytes`
  - `maxEventBytes`
  - `maxPendingInputsPerThread`
  - `defaultInputTtlMs`
  - `maxInFlightTurnsPerThread`（固定 1）

#### 13.2.2 turn 元数据与状态

turn 相关通知（`turn/started`、`turn/event`、`turn/inputRequested`、`turn/inputResolved`、`turn/completed|failed`）统一补充：

- `traceId: string`（turn 级固定）
- `seq: number`（每个 turn 内单调递增，从 1 开始）
- `ts: string`（ISO 时间）
- `eventId: string`（建议 `${turnId}:${seq}`）
- `source: "engine" | "tool" | "policy" | "system"`

turn 状态枚举补充：

- `queued | running | waiting_input | completed | failed | interrupted`

### 13.3 统一 input 模型（approval + ask_user_question）

`turn/inputRequested` 统一结构：

- `inputId: string`（服务端生成，建议 `${turnId}:${toolUseId}:${kind}`）
- `threadId` / `turnId` / `toolUseId`
- `kind: "approval" | "ask_user_question"`
- `status: "pending"`（请求发出时固定）
- `createdAt` / `expiresAt`
- `payload`（按 kind 区分）

approval payload（一期最小）：

- `decision` 选项：`approve | approve_remember | cancel | feedback`
- `scope` 选项：`session | project`（一期先不强加 global）
- `action` / `effectiveDecision` / `workspaceRequest?` / `suggestions?`
- `toolName`（供 GUI 明确展示审批来源工具）

ask_user_question payload（兼容现状）：

- 仍以 `Record<string,string>` 回答，不破坏现有 `header -> answer` 约定。
- 可选补充 `fieldId`（新客户端优先用 `fieldId`，旧客户端可继续回传 `header`）。
- `multiSelect` 一期维持字符串编码（当前 UI 为逗号拼接 label）。
  - 单选：值为单个 label（例如 `"A"`）。
  - 多选：值为按勾选顺序拼接的 label 字符串，分隔符固定 `,`（例如 `"A,B,C"`）。
  - 一期不做转义协议扩展；客户端需要将该字段视作“展示 label 串”，避免在一期做 label 反解析。

### 13.4 turn/input/submit 语义增强

`turn/input/submit` 入参补充：

- 必填：`threadId`、`turnId`、`inputId`、`answers`
- 可选：`submissionId`（幂等键）、`toolUseId`（诊断用）

返回补充：

- `accepted: boolean`
- `status`:
  - `accepted`
  - `already_submitted_same`
  - `conflict_already_submitted`
  - `not_pending`
  - `expired`
  - `canceled`

### 13.5 终局与竞态收敛

新增通知：`turn/inputResolved`

- 字段：`inputId`、`status(submitted|canceled|expired|failed)`、`resolvedAt`、`reason?`

约束：

- `turn/interrupt` 触发时，先对所有 pending input 发 `inputResolved(canceled)`，再发 turn 终局。
- turn 自然完成/失败前，必须清理剩余 pending input（发 resolved）。
- 服务端重启后不恢复等待中的 input；`thread/resume` 返回 stale inputs（统一 expired，reason=`server_restart`）。

### 13.6 错误模型与恢复策略

JSON-RPC `error.data` 增补：

- `kind: string`
- `recoverable: boolean`
- `retryable: boolean`
- `traceId?: string`

一期最小错误码建议：

- `NOT_INITIALIZED`
- `ALREADY_INITIALIZED`
- `THREAD_NOT_FOUND`
- `TURN_NOT_FOUND`
- `TURN_ALREADY_RUNNING`
- `INPUT_NOT_FOUND`
- `INPUT_NOT_PENDING`
- `INPUT_EXPIRED`
- `INPUT_CANCELED`
- `INPUT_CONFLICT`
- `PAYLOAD_TOO_LARGE`
- `INVALID_PARAMS`
- `INTERNAL_ERROR`

### 13.7 持久化补充（不破坏现有 reader/writer）

- 继续使用 `SessionWriter.appendEvent(...)` 写 app-server 元事件：
  - `app_turn_started`
  - `app_input_requested`
  - `app_input_resolved`
  - `app_turn_ended`
- 新增 app-server 专用 `sessionEventReader` 读取 `event` 记录（不改 `readSessionFile` 主回放路径）。
- 在 `sessionSave/reader.ts` 增补 `findSessionFileBySessionId(sessionId)`。

### 13.8 安全与资源上限

- stdio 请求大小限制：超限返回 `PAYLOAD_TOO_LARGE`。
- per-thread pending input 上限（超限拒绝新 inputRequested 并终止 turn）。
- transport outbound 队列上限与可观测丢弃计数。
- input TTL 默认值由 `initialize.limits.defaultInputTtlMs` 对外声明。

### 13.9 兼容性说明

- 本补丁不改现有 REPL UI 交互路径。
- `StreamEvent` 现有命名保持不变（例如 `tool_end`，不是 `tool_result`）。
- 新字段均按向后兼容新增处理，老客户端可忽略未知字段。
