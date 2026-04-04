# Session Persistence Contract（唯一事实源）

最后更新：2026-03-07  
状态：规范性（Normative）

本文档定义 Formax 本地 session 文件、resume 语义、以及 app-server 恢复 stale input 的共享合同。

范围：
- 本地 session 存储根目录、文件命名与 active lookup 边界
- REPL / SDK query 的 file-backed persistence 与 resume 语义
- SDK `unstable_v2_resumeSession` 的 in-process resume 语义
- app-server `thread/start` / `thread/resume` 的 provisional thread 与 stale input 恢复边界
- `listSessions` / `getSessionMessages` 的目录作用域

不在范围内：
- transcript reset / remount 的 UI 行为
- hooks、permissions、tool transcript 的独立合同
- archived thread 的完整管理流程

相关文档（信息性镜像）：
- `docs/contracts/transcript-surface-contract.md`
- `docs/contracts/interactive-input-contract.md`
- `docs/contracts/app-server-interaction-contract.md`
- `docs/references/app-server-api-reference.md`

相关实现（规范锚点）：
- `packages/core/src/features/repl/sessionSave/paths.ts`
- `packages/core/src/features/repl/sessionSave/writer.ts`
- `packages/core/src/features/repl/sessionSave/reader.ts`
- `packages/core/src/sdk/query/resume.ts`
- `packages/core/src/sdk/query/persistence.ts`
- `packages/core/src/sdk/query/runner.ts`
- `packages/core/src/sdk/session/core.ts`
- `packages/core/src/sdk/sessions.ts`
- `packages/core/src/app-server/threadStore.ts`
- `packages/core/src/app-server/store/sessionEventReader.ts`
- `packages/core/src/app-server/server.ts`

规范关键字约定：
- `MUST`、`SHOULD`、`MAY` 采用 RFC 2119 语义。

## 1. 权威模型

`SES-001`  
跨进程可恢复的 session 状态 MUST 以本地 JSONL session 文件为准；其根目录与命名规则 MUST 由 `packages/core/src/features/repl/sessionSave/paths.ts` 定义。

`SES-002`  
active session root MUST 位于 `<config-root>/sessions`；archived session root MUST 位于 `<config-root>/archived_sessions`。

`SES-003`  
`<config-root>` 的解析 MUST 复用当前 session path 逻辑：
1. 若显式配置 `FORMAX_CONFIG_DIR`，使用其 global config root。
2. 否则若存在 `FORMAX_VITEST_SESSION_CONFIG_DIR`，使用该测试隔离目录。
3. 否则使用默认 global config root。

`SES-004`  
active session 文件路径 MUST 保持当前按日期分层的格式：
`sessions/YYYY/MM/DD/session-<iso-timestamp>-<sessionId>.jsonl`

`SES-005`  
session 文件的可读 replay、summary 与 history 解释 MUST 以 `packages/core/src/features/repl/sessionSave/reader.ts` 为准；写入格式与 session id 合法性 MUST 以 `packages/core/src/features/repl/sessionSave/writer.ts` 为准。

## 2. 存储生命周期

`SES-101`  
REPL / SDK query 的 persisted session MAY 延迟物化；在真正需要写盘前，不要求提前创建 session 文件。

`SES-102`  
app-server `thread/start` 当前 MUST 返回 provisional thread。  
该阶段 thread id 已分配，但本地 session 文件 MAY 尚不存在。

`SES-103`  
当 app-server 后续需要 durable thread file 时，MUST 通过当前 `ensureThreadFile(...)` 路径收敛：
1. 先查找现有 session 文件
2. 若仍不存在且 thread 仍是 provisional，则创建新 session 文件
3. 若 provisional thread 已有 label，创建文件时 MUST 一并写入 `session_rename`

`SES-104`  
对仍然是 provisional 且尚未物化文件的 thread 执行 `thread/resume` 时，MUST 返回该 thread 本身，且 `staleInputs` MUST 为空数组。

## 3. SDK Resume 语义

`SES-201`  
`unstable_v2_resumeSession(sessionId, options)` MUST 是 in-process resume。  
它 MUST 只从当前 Node.js 进程内的 `sessionStore` 恢复状态，MUST NOT 扫描本地 session 文件做跨进程恢复。

`SES-202`  
当 `sessionStore` 中不存在目标 `sessionId` 时，`unstable_v2_resumeSession` MUST 抛错，并明确当前仅支持 in-process resume。

`SES-203`  
当目标 session 仍有 active stream 或 pending prompt 时，`unstable_v2_resumeSession` MUST 拒绝恢复，以避免状态分叉。

`SES-204`  
in-process resume 成功后，session options MAY 与传入 options 合并；该行为只影响当前进程内会话句柄，不改变本地 session 文件查找逻辑。

`SES-205`  
`query(..., { resume })` 与 `query(..., { continue })` MUST 属于 file-backed resume 路径；其历史恢复来源 MUST 是本地 session 文件，而不是内存 `sessionStore`。

`SES-206`  
`options.resumeSessionAt` 当前 MUST 仅作为 compatibility no-op 接受；不得在当前实现中改变 replay 截断点或 message 选择结果。

`SES-207`  
`options.continue=true` 与 `options.resume=<sessionId>` MUST 互斥；同时提供时 MUST 失败。

`SES-208`  
`options.resume=<sessionId>` 时，系统 MUST 按当前 cwd 作用域查找对应 session 文件；若找不到，MUST 明确报错该 session 不在本地 session storage 中。

`SES-209`  
`options.continue=true` 时，系统 MUST 在当前 cwd 作用域解析 latest session 文件；若不存在 latest session，MUST 回退为“无历史恢复”的普通启动。

`SES-210`  
当 `options.sessionId` 与 `options.resume` 或 `options.continue` 的目标 session 冲突时，若 `forkSession !== true`，MUST 报冲突错误。

`SES-211`  
当 `forkSession === true` 时，resume / continue 路径 MUST 只复用历史内容，不复用原 session 文件绑定；新的 query 持久化 MUST 视为新会话写入。

## 4. Query Persistence 与 Session Discovery

`SES-301`  
query 持久化当前 MUST 只在以下任一条件满足时启用：
1. `options.persistSession === true`
2. `options.enableFileCheckpointing === true`

`SES-302`  
当 file-backed resume 绑定了既有 `sessionFilePath` 且未 `forkSession` 时，持久化 writer MUST 重新打开原文件并追加写入；不得默默新建第二个 active session 文件。

`SES-303`  
当未绑定既有 `sessionFilePath` 时，持久化 writer MUST 创建新的 session 文件。

`SES-304`  
query 持久化后的 session 文件 MUST 至少支撑以下能力继续工作：
1. `listSessions`
2. `getSessionMessages`
3. 后续 `options.resume`
4. 后续 `options.continue`

`SES-304A`
当会话经历 compact 后，history snapshot MAY 在 compaction summary 前写入 metadata-only compact boundary message。
该 boundary：
1. MUST 能被 replay / resume 原样恢复
2. MUST NOT 依赖可见文本内容来识别
3. MUST 在真实 prompt 组装前被忽略，不得作为模型可见历史正文发送
4. 当前 SHOULD 至少包含：`trigger`、`preTokens`、`summaryKind`、`keepStrategy`
5. 当前 SHOULD 允许携带最小 `rehydrationPlan`，用于声明 compact 后优先恢复的状态集合；当前最小集合 MAY 包含 `recent_files`、`plan_state`、`todo_state`、`mode_state`
6. 当前当 `recent_files` 已实际注入 compaction summary reminder 时，对应 `rehydrationPlan.items[*].status` SHOULD 升为 `applied`
7. 当前当 compact summary 已实际注入 plan excerpt、todo summary、mode text 时，对应 `plan_state`、`todo_state`、`mode_state` 的 `status` SHOULD 升为 `applied`

`SES-305`  
`listSessions(options)` 与 `getSessionMessages(sessionId, options)` MUST 共享同一目录作用域规则：
1. `options.dir` 存在时以其为 lookup cwd
2. 否则以当前 `process.cwd()` 为 lookup cwd

`SES-306`  
`listSessions` MUST 对单个损坏或不可读 session 文件保持弹性；单文件失败 MUST NOT 让其余 session 从列表中消失。

## 5. App-Server Recovery 与 Stale Inputs

`SES-401`  
app-server `thread/resume` 的持久化恢复 MUST 基于 session 文件，而不是仅凭内存线程状态。

`SES-402`  
`staleInputs` MUST 由 session 文件中的未解决输入推导：
1. 扫描 `app_input_requested`
2. 用后续 `app_input_resolved` 抵消已解决项
3. 剩余项全部转成 stale input

`SES-403`  
`thread/resume` 返回的 stale input MUST 统一映射为：
1. `status = "expired"`
2. `reason = "server_restart"`
3. `resolvedAt = 恢复扫描时刻`

`SES-404`  
app-server 在 `thread/resume` 返回 stale input 后，MUST 记住这些 `inputId` / `toolUseId`，并在后续提交时将其视为已过期输入处理。

`SES-405`  
客户端在收到 `thread/resume.staleInputs` 后，MUST 以服务端恢复结果为准更新本地 pending-input 状态；不得继续把这些输入视为可提交。

## 6. 变更流程

当修改 session 文件根目录、resume 选择逻辑、provisional thread 物化、stale input 恢复或 SDK session discovery 行为时：
1. 先更新本文件。
2. 再更新 `docs/contracts/app-server-interaction-contract.md` 与 `docs/references/app-server-api-reference.md` 中受影响的摘要。
3. 再更新 `packages/core/src/sdk/README.md` 等 code-local deep dive。
4. 若影响 transcript reset 或 input lifecycle，再同步相关合同。

若实现与本合同冲突，应视为实现漂移并立即收敛修正。
