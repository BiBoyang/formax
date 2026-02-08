# Formax App Server 方案与 TODO（当前基线打包）

更新时间：2026-02-08
来源：
- `plans/app-server/DESIGN.md`
- `plans/app-server/TODO.md`

---

## Part A — DESIGN.md

<!-- BEGIN DESIGN -->
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
<!-- END DESIGN -->

---

## Part B — TODO.md

<!-- BEGIN TODO -->
# TODO：Formax App Server（MVP）

说明：本清单对应 `plans/app-server/DESIGN.md`，聚焦“一期可用闭环”。

## Phase 0 — 目录与文档基线

- [ ] 新增 `plans/app-server/DESIGN.md` 与本 TODO（已建立，后续持续维护）。
- [ ] 在 `CODEMAP.md` 预留 app-server 入口索引（先标注 WIP）。

## Phase 1 — 抽取共享 runtime（零行为变化）

目标：让 TUI 与 app-server 共用同一装配链，避免重复 wiring。

- [ ] 新增 `src/runtime/createRuntime.ts`，封装运行时构造：
  - [ ] `cfg`
  - [ ] `engine`
  - [ ] `toolRegistry`
  - [ ] `taskManager`
  - [ ] `userInputManager`
  - [ ] `tools`
  - [ ] `allowedSubagents/reloadSubagents`
- [ ] `src/legacy/runLegacyCli.tsx` 切换为调用 `createRuntime()`。
- [ ] 保持现有 REPL 行为完全不变。

验收：

- [ ] `bun run test -- src/legacy/bootstrap/runtimeConfig.test.tsx`
- [ ] `bun run test -- src/screens/REPL.test.tsx`
- [ ] `bun run type-check`

## Phase 2 — app-server 骨架 + stdio 传输

目标：建立可运行的 `formax app-server` 基础进程。

- [ ] 新增 `src/app-server/` 子系统：
  - [ ] `index.ts`
  - [ ] `server.ts`
  - [ ] `jsonrpc.ts`
  - [ ] `protocol.ts`
  - [ ] `transport/stdio.ts`
- [ ] 协议握手：`initialize` / `initialized`。
- [ ] 初始化前拦截：除 `initialize` 外请求返回 `Not initialized`。

验收：

- [ ] 新增测试：`src/app-server/*.test.ts`（握手/错误码/坏消息）。
- [ ] 手工：`formax app-server` 启动后可读写 JSONL。

## Phase 3 — 线程 API（复用 sessionSave）

目标：可创建、恢复、浏览线程。

- [ ] 新增 `src/app-server/threadStore.ts`。
- [ ] 实现 `thread/start`。
- [ ] 实现 `thread/resume`。
- [ ] 实现 `thread/list`（支持 `limit/cursor`）。
- [ ] 实现 `thread/read`（含最小 transcript 预览）。
- [ ] `threadId` 与 `session_meta.sessionId` 对齐。
- [ ] 需要时补充 `findSessionFileBySessionId(sessionId)` 到 `sessionSave/reader.ts`。

验收：

- [ ] 新增 `threadStore.test.ts`。
- [ ] 重启进程后 `thread/resume` 成功。

## Phase 4 — turn/start + 流式事件桥接

目标：客户端能驱动一轮完整对话并实时消费事件。

- [ ] 新增 `src/app-server/turnRunner.ts`。
- [ ] 实现 `turn/start`：
  - [ ] 发 `turn/started`
  - [ ] 转发 stream 事件到 `turn/event`
  - [ ] 结束发 `turn/completed` 或 `turn/failed`
- [ ] 并发限制：同线程仅允许一个 in-flight turn。
- [ ] 实现 `turn/interrupt`。

验收：

- [ ] 新增 `turnRunner.test.ts`（事件顺序 + interrupt）。
- [ ] 集成测试覆盖 start/completed/failed 路径。

## Phase 5 — 审批与 AskUserQuestion 交互闭环

目标：GUI 可处理审批/提问，不依赖 TUI 弹层。

- [ ] 扩展 `StreamEvent`：新增
  - [ ] `approval_request`
  - [ ] `ask_user_question`
- [ ] `approvalService.ensureApproved()` 在等待答案前发 `approval_request`。
- [ ] `AskUserQuestion` handler 在等待答案前发 `ask_user_question`。
- [ ] app-server 转发为 `turn/inputRequested` 通知。
- [ ] 新增 `turn/input/submit` 方法并接 `userInputManager.submitAnswers()`。

验收：

- [ ] 单测：approval/ask_user_question 桥接。
- [ ] 集成：可完成“服务端发请求 -> 客户端回答案 -> turn 继续并完成”。

## Phase 6 — CLI 接入与帮助信息

目标：正式暴露 `formax app-server` 命令。

- [ ] 更新 `src/cli/main.ts` 增加 `app-server` 分支。
- [ ] 更新 `src/cli/help.ts` 显示新命令用法。
- [ ] 更新 `src/entrypoints/cli.tsx` 调度。
- [ ] 补 CLI 测试。

验收：

- [ ] `src/cli/main.test.ts` 增加 app-server 用例。
- [ ] `src/cli/help.test.ts` 快照更新通过。

## Phase 7 — Web 参考客户端（开发验证）

目标：快速验证协议可用，不作为生产传输方案。

- [ ] 新增 dev bridge（本地进程 -> WebSocket，仅开发用途）。
- [ ] 新增 Web 参考 UI：
  - [ ] 线程列表
  - [ ] 消息流
  - [ ] 审批/提问弹层
- [ ] 打通最小闭环演示。

验收：

- [ ] 一次演示流程全通（start thread -> run turn -> approval -> completed）。

## Phase 8 — 文档与索引

- [ ] 更新 `CODEMAP.md`：新增 app-server 模块索引。
- [ ] 更新 `README.md`：新增 `formax app-server` 用法。
- [ ] 更新 `src/streaming/README.md`：新增桥接事件说明。
- [ ] 更新 `plans/TODO-INDEX.md`：纳入本主线。

## 建议 PR 切分（小步可回滚）

- [ ] PR1: shared runtime 抽取
- [ ] PR2: app-server 骨架 + initialize
- [ ] PR3: thread API + sessionSave mapping
- [ ] PR4: turn/start + event streaming + interrupt
- [ ] PR5: approval/ask_user_question input bridge
- [ ] PR6: CLI/help/tests + 文档同步
- [ ] PR7: web reference client

## DoD（一期完成定义）

- [ ] CLI 可运行 `formax app-server`。
- [ ] GUI 客户端可通过 stdio JSON-RPC 驱动完整回合。
- [ ] 审批与提问交互可回传并继续执行。
- [ ] sessionSave 可恢复 thread。
- [ ] 现有 REPL 路径无行为回归。
<!-- END TODO -->
