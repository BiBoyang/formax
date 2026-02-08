# TODO：Formax App Server（MVP）

说明：本清单对应 `plans/app-server/DESIGN.md`，聚焦“一期可用闭环”。

## Phase 0 — 目录与文档基线

- [x] 新增 `plans/app-server/DESIGN.md` 与本 TODO（已建立，后续持续维护）。
- [x] 在 `CODEMAP.md` 预留 app-server 入口索引（先标注 WIP）。

## Phase 1 — 抽取共享 runtime（零行为变化）

目标：让 TUI 与 app-server 共用同一装配链，避免重复 wiring。

- [x] 新增 `src/runtime/createRuntime.ts`，封装运行时构造：
  - [x] `cfg`
  - [x] `engine`
  - [x] `toolRegistry`
  - [x] `taskManager`
  - [x] `userInputManager`
  - [x] `tools`
  - [x] `allowedSubagents/reloadSubagents`
- [x] `src/legacy/runLegacyCli.tsx` 切换为调用 `createRuntime()`。
- [x] 保持现有 REPL 行为完全不变。

验收：

- [x] `bun run test -- src/legacy/bootstrap/runtimeConfig.test.tsx`
- [x] `bun run test -- src/screens/REPL.test.tsx`
- [x] `bun run type-check`

## Phase 2 — app-server 骨架 + stdio 传输

目标：建立可运行的 `formax app-server` 基础进程。

- [x] 新增 `src/app-server/` 子系统：
  - [x] `index.ts`
  - [x] `server.ts`
  - [x] `jsonrpc.ts`
  - [x] `protocol.ts`
  - [x] `transport/stdio.ts`
- [x] 协议握手：`initialize` / `initialized`。
- [x] 初始化前拦截：除 `initialize` 外请求返回 `Not initialized`。

验收：

- [x] 新增测试：`src/app-server/*.test.ts`（握手/错误码/坏消息）。
- [x] 手工：`formax app-server` 启动后可读写 JSONL。

## Phase 3 — 线程 API（复用 sessionSave）

目标：可创建、恢复、浏览线程。

- [x] 新增 `src/app-server/threadStore.ts`。
- [x] 实现 `thread/start`。
- [x] 实现 `thread/resume`。
- [x] 实现 `thread/list`（支持 `limit/cursor`）。
- [x] 实现 `thread/read`（含最小 transcript 预览）。
- [x] `threadId` 与 `session_meta.sessionId` 对齐。
- [x] 需要时补充 `findSessionFileBySessionId(sessionId)` 到 `sessionSave/reader.ts`。

验收：

- [x] 新增 `threadStore.test.ts`。
- [x] 重启进程后 `thread/resume` 成功。

## Phase 4 — turn/start + 流式事件桥接

目标：客户端能驱动一轮完整对话并实时消费事件。

- [x] 新增 `src/app-server/turnRunner.ts`。
- [x] 实现 `turn/start`：
  - [x] 发 `turn/started`
  - [x] 转发 stream 事件到 `turn/event`
  - [x] 结束发 `turn/completed` 或 `turn/failed`
- [x] 并发限制：同线程仅允许一个 in-flight turn。
- [x] 实现 `turn/interrupt`。

验收：

- [x] 新增 `turnRunner.test.ts`（事件顺序 + interrupt）。
- [x] 集成测试覆盖 start/completed/failed 路径。

## Phase 5 — 审批与 AskUserQuestion 交互闭环

目标：GUI 可处理审批/提问，不依赖 TUI 弹层。

- [x] 边界锁定：本期只统一 input 协议状态机，不合并 approval 与 AskUserQuestion 业务语义。
- [x] 扩展 `StreamEvent`：新增
  - [x] `approval_request`
  - [x] `ask_user_question`
- [x] `approvalService.ensureApproved()` 在等待答案前发 `approval_request`。
- [x] `AskUserQuestion` handler 在等待答案前发 `ask_user_question`。
- [x] app-server 转发为 `turn/inputRequested` 通知。
- [x] 新增 `turn/input/submit` 方法并接 `userInputManager.submitAnswers()`。
- [x] `turn/inputRequested` 增补统一字段：`inputId/status/createdAt/expiresAt/traceId/seq/ts`。
- [x] AskUserQuestion 兼容策略：保留 `header -> answer`，并新增可选 `fieldId`（新客户端优先）。
- [x] 明确 `multiSelect` 的字符串编码规则（逗号拼接 label），并写入协议文档。
- [x] 新增 `turn/inputResolved` 通知（`submitted/canceled/expired/failed`）。
- [x] `turn/input/submit` 返回状态扩展：`accepted | already_submitted_same | conflict_already_submitted | not_pending | expired | canceled`。
- [x] 支持 `submissionId` 幂等键与 `answersHash` 冲突判断。

验收：

- [x] 单测：approval/ask_user_question 桥接。
- [x] 集成：可完成“服务端发请求 -> 客户端回答案 -> turn 继续并完成”。
- [x] 对同一 `inputId` 重复提交，能稳定收敛到“same/conflict”之一，且无重复执行。
- [x] turn 结束后 GUI 不存在悬挂 pending input（必须收到 `turn/inputResolved`）。

## Phase 6 — CLI 接入与帮助信息

目标：正式暴露 `formax app-server` 命令。

- [x] 更新 `src/cli/main.ts` 增加 `app-server` 分支。
- [x] 更新 `src/cli/help.ts` 显示新命令用法。
- [x] 更新 `src/entrypoints/cli.tsx` 调度。
- [x] 补 CLI 测试。

验收：

- [x] `src/cli/main.test.ts` 增加 app-server 用例。
- [x] `src/cli/help.test.ts` 快照更新通过。

## Phase 7 — Web 参考客户端（开发验证）

目标：快速验证协议可用，不作为生产传输方案。

- [x] 新增 dev bridge（本地进程 -> WebSocket，仅开发用途）。
- [x] 新增 Web 参考 UI：
  - [x] 线程列表
  - [x] 消息流
  - [x] 审批/提问弹层
- [ ] 打通最小闭环演示。

验收：

- [ ] 一次演示流程全通（start thread -> run turn -> approval -> completed）。

## Phase 8 — 文档与索引

- [x] 更新 `CODEMAP.md`：新增 app-server 模块索引。
- [x] 更新 `README.md`：新增 `formax app-server` 用法。
- [x] 更新 `src/streaming/README.md`：新增桥接事件说明。
- [x] 更新 `plans/TODO-INDEX.md`：纳入本主线。
- [x] 更新 `plans/app-server/DESIGN.md`：同步 v2 addendum（input 状态机、错误码、恢复策略）。
- [x] 在文档中显式声明 `StreamEvent` 命名沿用现状（`tool_end` 等），避免实现偏差。

## Approval Hardening（增量补充）

- [x] 在 `src/app-server/protocol/input.ts` 写入“语义边界注释”：统一状态机，不统一业务决策逻辑。
- [x] 新增 `src/app-server/protocol/input.ts`（或等价模块）：定义 `InputRequest/InputStatus/InputResolved` 类型。
- [x] 新增 `src/app-server/turn/inputId.ts`：统一 `inputId` 生成（`${turnId}:${toolUseId}:${kind}`）。
- [x] 新增 `src/app-server/turn/inputStore.ts`：维护 per-turn input 生命周期与索引。
- [x] 在 `turnRunner` 内维护 `seq` 计数器，并统一封装 `turn/event` envelope（含 `traceId/seq/ts/eventId/source`）。
- [x] 在 `approvalService.ensureApproved()` 的 `requestAnswers()` 前发 `approval_request` 事件（携带 action/effectiveDecision/workspaceRequest）。
- [x] 在 `AskUserQuestion` handler 的 `requestAnswers()` 前发 `ask_user_question` 事件（questions + optional fieldId）。
- [x] Router 实现 `turn/input/submit` 新入参校验：`threadId/turnId/inputId/answers`，可选 `submissionId`。
- [x] Router 实现提交幂等：同 `submissionId` + 同答案返回 `already_submitted_same`。
- [x] Router 实现冲突检测：同 `inputId` 不同答案返回 `conflict_already_submitted` + typed error。
- [x] `turn/interrupt` 路径先 cancel all pending inputs（逐个发 `turn/inputResolved(canceled)`）再结束 turn。
- [x] turn 正常 `completed/failed` 前执行 pending 清理，确保无 input 泄漏。
- [x] 新增 `src/app-server/store/sessionEventReader.ts`：读取 `event` 记录恢复 `staleInputs`。
- [x] `thread/resume` 返回 stale inputs（server restart 后统一 expired）。
- [x] stale input 的后续 submit 返回 `INPUT_EXPIRED`（typed error/data）。
- [x] 为 transport 增加 `maxRequestBytes/maxEventBytes`，超限返回 `PAYLOAD_TOO_LARGE`。
- [x] 为 inputStore 增加 `maxPendingInputsPerThread`，超限拒绝并打点。

验收：

- [x] approval 与 ask_user_question 均能观测到 `inputRequested -> inputResolved` 成对事件。
- [x] 任意异常路径（interrupt、timeout、restart）不会残留 pending input。
- [x] 断线重连后 `thread/resume` 可清理旧 pending UI，且错误码语义一致。

## 建议 PR 切分（小步可回滚）

- [x] PR1: shared runtime 抽取（零行为变化）
  - 目标：引入 `createRuntime()`，让 TUI 与 app-server 共享同一装配链。
  - 主要文件：
    - `src/runtime/createRuntime.ts`（new）
    - `src/legacy/bootstrap/chatRuntime.ts`
    - `src/legacy/bootstrap/llmClients.ts`
    - `src/legacy/bootstrap/tooling.ts`
    - `src/legacy/bootstrap/policyHooks.ts`
    - `src/legacy/bootstrap/subagents.ts`
    - `src/legacy/runLegacyCli.tsx`
  - 风险点：REPL wiring 回归（工具注册/策略钩子/subagent 装配）。
  - 合并前断言：现有 REPL 行为无变化，`runtimeConfig` 与 REPL 关键测试通过。

- [x] PR2: app-server 骨架 + JSON-RPC 握手
  - 目标：跑通 `initialize/initialized` 与未初始化拦截。
  - 主要文件：
    - `src/app-server/index.ts`（new）
    - `src/app-server/server.ts`（new）
    - `src/app-server/jsonrpc.ts`（new）
    - `src/app-server/protocol.ts`（new）
    - `src/app-server/transport/stdio.ts`（new）
    - `src/app-server/*.test.ts`（new）
  - 风险点：JSONL 解码鲁棒性、错误码一致性。
  - 合并前断言：坏行/坏 JSON/握手前调用都返回稳定错误。

- [x] PR3: thread API + sessionSave 映射
  - 目标：实现 `thread/start|resume|list|read` 最小闭环。
  - 主要文件：
    - `src/app-server/threadStore.ts`（new）
    - `src/features/repl/sessionSave/reader.ts`（新增 `findSessionFileBySessionId`）
    - `src/app-server/threadStore.test.ts`（new）
  - 风险点：会话文件扫描性能与 threadId 映射正确性。
  - 合并前断言：threadId 与 `session_meta.sessionId` 一致，重启后可 resume。

- [x] PR4: turnRunner 基础链路（不含 input 状态机）
  - 目标：实现 `turn/start`、`turn/interrupt`、`turn/event` 转发与单线程单 in-flight 约束。
  - 主要文件：
    - `src/app-server/turnRunner.ts`（new）
    - `src/app-server/server.ts`
    - `src/app-server/protocol.ts`
    - `src/app-server/turnRunner.test.ts`（new）
  - 风险点：事件顺序与 interrupt 竞态。
  - 合并前断言：`turn/started -> turn/event* -> turn/completed|failed` 顺序稳定。

- [x] PR5: approval / ask_user_question 事件桥接（语义不合并）
  - 目标：让 app-server 能观测到两类 input 请求来源，但保持业务语义分离。
  - 主要文件：
    - `src/streaming/types.ts`
    - `src/tools/executor/approvalService.ts`
    - `src/tools/modules/askUserQuestion/handler.ts`
    - 对应测试文件（approval / ask_user_question）
  - 风险点：影响现有 TUI 工具展示；误把语义层做“强合并”。
  - 合并前断言：仅新增事件，不改变 approval/ask_user_question 原有决策语义。

- [x] PR6: input 协议状态机 + submit 幂等
  - 目标：落地 `inputId`、`turn/inputRequested`、`turn/inputResolved`、`turn/input/submit` 幂等冲突策略。
  - 主要文件：
    - `src/app-server/protocol/input.ts`（new）
    - `src/app-server/turn/inputId.ts`（new）
    - `src/app-server/turn/inputStore.ts`（new）
    - `src/app-server/server.ts`
    - `src/app-server/turnRunner.ts`
    - `src/app-server/*.test.ts`
  - 风险点：submit 重复提交/冲突与 turn 终局并发竞态。
  - 合并前断言：同一 input 重复提交可收敛为 same/conflict；无悬挂 pending。

- [x] PR7: sessionSave 元事件恢复 + staleInputs
  - 目标：服务端重启后通过 event 记录识别 stale pending inputs 并统一 expired。
  - 主要文件：
    - `src/app-server/store/sessionEventReader.ts`（new）
    - `src/app-server/threadStore.ts`
    - `src/features/repl/sessionSave/records.ts`（仅在需要类型补充时）
    - `src/features/repl/sessionSave/reader.ts`（保持旧回放语义）
  - 风险点：event 解析兼容性与恢复一致性。
  - 合并前断言：resume 后旧 pending input 会被清理并返回一致错误语义。

- [x] PR8: 安全上限 + CLI 接入 + 文档同步
  - 目标：补全传输/资源边界并正式暴露 `formax app-server`。
  - 主要文件：
    - `src/app-server/transport/stdio.ts`
    - `src/app-server/server.ts`
    - `src/cli/main.ts`
    - `src/cli/help.ts`
    - `src/entrypoints/cli.tsx`
    - `src/cli/main.test.ts`
    - `src/cli/help.test.ts`
    - `CODEMAP.md`
    - `README.md`
    - `src/streaming/README.md`
    - `plans/app-server/DESIGN.md`
    - `plans/app-server/TODO.md`
  - 风险点：CLI 参数回归、错误码与 limits 文档不一致。
  - 合并前断言：`formax app-server` 可启动；文档与实现字段一致。

- [ ] PR9: Web reference client（开发验证）
  - 目标：验证 thread/turn/input 协议闭环，不作为生产客户端。
  - 主要文件：按选定目录新增（建议独立于核心 runtime 目录）。
  - 风险点：demo 代码反向污染核心协议实现。
  - 合并前断言：完整演示链路一次跑通（含 approval 与 ask_user_question）。

## DoD（一期完成定义）

- [x] CLI 可运行 `formax app-server`。
- [x] GUI 客户端可通过 stdio JSON-RPC 驱动完整回合。
- [x] 审批与提问交互可回传并继续执行。
- [x] sessionSave 可恢复 thread。
- [x] 现有 REPL 路径无行为回归。
