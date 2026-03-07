# Tool Runtime Contract（唯一事实源）

最后更新：2026-03-07  
状态：规范性（Normative）

本文档定义 Formax tools 子系统的执行合同、deferred `ToolSearch` runtime 合同，以及 `ToolResult` 与 `CommandResult` 的边界。

范围：
- `ToolDefinition` / `ToolCall` / `ToolResult` 的共享形状
- executor 的早期 gate 顺序与 subagent deny / allow-list 边界
- deferred `ToolSearch` 的 session-scoped runtime 行为
- `ToolResult` 内容块与 slash-command `CommandResult` 的职责分层
- 工具执行与工具呈现的 ownership 边界

不在范围内：
- prompt 侧“哪些工具先暴露给模型”的策略
- approval / ask-user-question 生命周期细节
- transcript surface reset、overlay dismiss、command subline 的完整 UI 合同

相关文档（信息性镜像）：
- `docs/contracts/prompt-tool-exposure-contract.md`
- `docs/contracts/interactive-input-contract.md`
- `docs/contracts/slash-command-contract.md`
- `docs/contracts/semantics-contract.md`

相关实现（规范锚点）：
- `src/shared/toolContracts.ts`
- `src/tools/executor/index.ts`
- `src/tools/executor/subagentDenyTools.ts`
- `src/tools/runtime/deferredToolExposure.ts`
- `src/tools/runtime/toolSearchEngine.ts`
- `src/tools/modules/toolSearch/handler.ts`
- `src/shared/utils/toolResultContent.ts`
- `src/features/tools/presentation/toolSemantics.ts`
- `src/features/commands/contracts.ts`

规范关键字约定：
- `MUST`、`SHOULD`、`MAY` 采用 RFC 2119 语义。

## 1. 权威模型

`TOOL-001`  
共享工具协议形状 MUST 以 `src/shared/toolContracts.ts` 为准，而不是各个 tool module 的局部约定。

`TOOL-002`  
工具执行入口、allow/deny gate 顺序与 hook/preflight 编排 MUST 以 `src/tools/executor/index.ts` 为准。

`TOOL-003`  
deferred `ToolSearch` 的 session store、catalog、loaded-tools state 与 search/load 行为 MUST 以 `src/tools/runtime/deferredToolExposure.ts` 为准。

`TOOL-004`  
slash command 的 `CommandResult` / `UiEffect` / `ModelEffect` 语义 MUST 以 `src/features/commands/contracts.ts` 为准；它不是 tools runtime 的返回协议。

## 2. Tool Protocol Shape

`TOOL-101`  
`ToolDefinition` 当前 MUST 包含：
1. `name`
2. `description`
3. `input_schema`
4. 可选 `defer_loading`

`TOOL-102`  
`ToolCall` 当前 MUST 包含：
1. `id`
2. `name`
3. `input`

`TOOL-103`  
`ToolResult` 当前 MUST 以以下字段为 canonical shape：
1. `tool_use_id`
2. `content`
3. 可选 `is_error`
4. 可选 `extraTextBlocks`

`TOOL-104`  
`ToolResult.content` MUST 支持：
1. 纯字符串
2. block 数组

block 数组中的 canonical 已知块当前 MUST 包含：
1. `text`
2. `tool_reference`

`TOOL-105`  
`tool_reference` block 的 canonical 名字段 MUST 使用 `tool_name`。  
`name` 只可作为旧 payload / 旧测试的兼容别名，MUST NOT 视为新的主字段。

`TOOL-106`  
`extraTextBlocks` MUST 表示“附加到下一次模型调用的文本块”，而不是用户可见 transcript 中的第二套工具输出协议。

## 3. Executor Gate 与 Ownership

`TOOL-201`  
executor 早期 gate 顺序 MUST 保持当前固定顺序：
1. abort signal
2. subagent deny tools
3. allow / deny list
4. handler resolution
5. hooks `PreToolUse`
6. optional preflight
7. handler execute

`TOOL-202`  
若 signal 已中止，executor MUST 直接返回 error `ToolResult`；不得继续进入 allow-list、handler 或 hook 流程。

`TOOL-203`  
subagent deny 集 MUST 以 `src/tools/executor/subagentDenyTools.ts` 为准。  
当前 deny 集包含：
1. `Task`
2. `TaskOutput`
3. `AskUserQuestion`
4. `EnterPlanMode`
5. `ExitPlanMode`
6. `KillShell`

`TOOL-204`  
当 tool 被 allow-list 拒绝时，默认 MUST 返回 `Error: Tool not allowed: <name>`；只有满足 deferred ToolSearch soft-fallback 条件时，才 MAY 继续执行。

`TOOL-205`  
handler 负责工具执行结果，MUST 返回 `ToolResult`；它 MUST NOT 直接返回 slash-command `CommandResult`，也 MUST NOT 直接操纵 overlay / command subline UI。

`TOOL-206`  
tool presenter / presentation selector 只负责把 tool segment 转成可见摘要；它们 MUST NOT 重新定义工具执行协议。

## 4. Deferred ToolSearch Runtime

`TOOL-301`  
deferred tool exposure runtime MUST 是 session-scoped。  
每个 session key 拥有独立的 catalog、loaded-tools set 与 search index。

`TOOL-302`  
注册 deferred catalog 时，runtime MUST：
1. 排除 `ToolSearch` 自身
2. 将 catalog 项标记为 `defer_loading: true`
3. 构建可搜索索引
4. 复用仍然存在于新 catalog 中的已加载工具名

`TOOL-303`  
当当前 session 没有 deferred state 时，`resolveToolsForModel(sessionKey)` MUST 退化为仅返回 `ToolSearch`。

`TOOL-304`  
`ToolSearch` runtime 成功加载工具后，返回内容 MUST 同时支持：
1. 文本摘要块
2. `tool_reference` block

其中结构化 `tool_reference` block MUST 作为 canonical 机制。

`TOOL-305`  
`ToolSearch` 查询失败、空 query、无 catalog 或无匹配时，runtime MUST 返回 error `ToolResult` 内容；不得伪装为成功加载。

`TOOL-306`  
executor 的 deferred soft-fallback 仅在以下条件同时满足时 MAY 自动放行直接工具调用：
1. `deferredToolSoftFallback === true`
2. 存在 `toolExposureSessionKey`
3. `allowTools` 包含 `ToolSearch`
4. 当前调用工具不是 `ToolSearch`
5. `searchAndLoad(select:<toolName>)` 成功且匹配到该工具

`TOOL-307`  
deferred runtime 只定义“如何 search/load 与返回什么结果”；至于何时只向模型暴露 `ToolSearch`，MUST 由 `docs/contracts/prompt-tool-exposure-contract.md` 约束。

## 5. ToolResult 与 CommandResult 的分层

`TOOL-401`  
tools pipeline 与 slash-command pipeline MUST 保持两套独立结果协议：
1. tools -> `ToolResult`
2. slash commands -> `CommandResult`

`TOOL-402`  
`command_subline`、overlay open/close、toast、`injectNextTurn` 等 UI/model effect MUST 通过 `CommandResult` 表达；不得塞进 `ToolResult` 伪装为工具输出。

`TOOL-403`  
反之，工具执行结果 MUST 继续通过 `tool_result` history block 与 tool transcript segment 表达；slash command adapter MUST NOT 充当工具执行器。

`TOOL-404`  
当需要把 `ToolResult.content` 平铺为文本时，MUST 复用 `src/shared/utils/toolResultContent.ts` 的当前规则：
1. `text` block -> 文本
2. `tool_reference` block -> 名称或名称加描述
3. 其他对象块 -> best-effort JSON stringify

`TOOL-405`  
interactive / plan-mode 等工具展示语义分类 MUST 以 `src/features/tools/presentation/toolSemantics.ts` 为准；不得在零散 presenter 中复制第二套分类表。

## 6. 变更流程

当修改 tool protocol、executor gate 顺序、subagent deny set、ToolSearch runtime、`ToolResult` block shape、或 tools 与 slash-command 的边界时：
1. 先更新本文件。
2. 再更新 `docs/contracts/prompt-tool-exposure-contract.md` 或 `docs/contracts/slash-command-contract.md` 的受影响摘要边界。
3. 再更新 `src/tools/README.md` 等 code-local deep dive。
4. 若影响跨端 transcript / semantics，再同步 `docs/contracts/semantics-contract.md`。

若实现与本合同冲突，应视为实现漂移并立即收敛修正。
