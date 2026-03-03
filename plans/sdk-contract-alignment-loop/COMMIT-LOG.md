# Commit Log：sdk-contract-alignment-loop

> 规则：每次该循环产生新提交，必须在本文件追加一条记录。

## 2026-03-04

- `6b1597a` `feat(sdk): support query persistSession option`
  - 切片：`QRY-43`
  - 说明：`query` 正式支持 `options.persistSession=true`（新会话写入或在 `resume/continue` 文件上追加）；`forkSession/enableFileCheckpointing` 仍显式报“暂不支持”。

- `35bffaa` `feat(sdk): support query tools option`
  - 切片：`QRY-42`
  - 说明：`query` 正式支持 `options.tools`（数组子集过滤 + `preset` 默认集）；`mcpServers` 仍显式报“暂不支持”。

- `1cb305c` `feat(sdk): support query continue option`
  - 切片：`QRY-41`
  - 说明：`query` 正式支持 `options.continue`（恢复当前 cwd 最近本地会话历史；无历史则按新会话继续）；`fallbackModel` 仍显式报“暂不支持”。

- `13dc31f` `feat(sdk): support query resume and sessionId`
  - 切片：`QRY-40`
  - 说明：`query` 正式支持 `options.resume/options.sessionId`（基于本地持久化会话恢复历史）；`resumeSessionAt` 仍显式报“暂不支持”。

## 2026-03-03

- `110149e` `feat(sdk): align query permission and abort inputs`
  - 切片：`QRY-01`、`QRY-02`
  - 说明：新增 `permissionMode` 与 `abortController` 对齐入口，补类型/校验/测试/文档。

- `e247e3a` `refactor(sdk): extract query input request handlers`
  - 切片：`QRY-03`
  - 说明：将 approval/ask_user_question 处理分支从 `query/runner` 抽离为独立模块，保持行为不变。

- `0c96a72` `docs(sdk): add query contract alignment matrix`
  - 切片：`QRY-04`
  - 说明：新增 query 对齐矩阵文档，并在 SDK README 建立引用。

- `4d6d9e4` `feat(sdk): align systemPrompt preset option`
  - 切片：`QRY-05`
  - 说明：支持 `systemPrompt` 官方 preset 形态子集（`claude_code` + `append`），并补充校验与测试。

- `46af01d` `feat(sdk): align thinking config option`
  - 切片：`QRY-06`
  - 说明：支持 `thinking` 子集对齐（`adaptive/enabled/disabled`）并映射现有执行开关。

- `7ce0ef4` `test(sdk): add query option alignment regression suite`
  - 切片：`QRY-07`
  - 说明：新增 query 选项对齐回归测试组，覆盖 `permissionMode`、`abortController`、`systemPrompt preset`、`thinking`。

- `7012aa5` `feat(sdk): align async iterable prompt input`
  - 切片：`QRY-08`、`QRY-09`
  - 说明：支持 `query` 的 `prompt: AsyncIterable<SDKUserMessage>` 子集输入，并补齐空流/非法结构/中断清理等边界测试。

- `86e7553` `feat(sdk): align full permissionMode input set`
  - 切片：`QRY-10`
  - 说明：对齐官方 `permissionMode` 输入全集，并为当前未支持值提供显式一致错误。

- `9483220` `feat(sdk): align maxThinkingTokens option`
  - 切片：`QRY-11`
  - 说明：增加 `maxThinkingTokens` 输入对齐，并与 `thinking`/`thinkingEnabled` 做一致性约束。

- `3c5118c` `feat(sdk): align maxTurns option`
  - 切片：`QRY-12`
  - 说明：增加 `maxTurns` 对齐入口，当前仅支持 `1` 并对更大值显式报不支持。

- `bdc2fce` `feat(sdk): align maxBudgetUsd option`
  - 切片：`QRY-13`
  - 说明：增加 `maxBudgetUsd` 对齐入口，输入通过后统一显式报当前不支持。

- `6a2887a` `feat(sdk): align query interrupt handle`
  - 切片：`QRY-14`
  - 说明：将 `query` 返回值升级为带 `interrupt()` 的 Query 对象，并保持 `for await` 兼容。

- `a8c93bc` `feat(sdk): align query close handle`
  - 切片：`QRY-15`
  - 说明：为 `query` 增加 `close()`，复用中断语义实现进程内关闭控制。

- `6555043` `feat(sdk): align query resume option inputs`
  - 切片：`QRY-16`
  - 说明：接收 `resume/sessionId/resumeSessionAt` 输入字段，并统一显式报当前不支持。

- `11c7d79` `feat(sdk): align query debug option inputs`
  - 切片：`QRY-17`
  - 说明：接收 `debug/debugFile` 输入字段，并统一显式报当前不支持。

- `e023b5f` `feat(sdk): align query stderr option input`
  - 切片：`QRY-18`
  - 说明：接收 `stderr` 输入字段，并统一显式报当前不支持。

- `7a2426b` `feat(sdk): align query process spawn option inputs`
  - 切片：`QRY-19`
  - 说明：接收 `pathToClaudeCodeExecutable/spawnClaudeCodeProcess` 输入字段，并统一显式报当前不支持。

- `0a88cad` `feat(sdk): align query cli execution option inputs`
  - 切片：`QRY-20`
  - 说明：接收 `extraArgs/executable/executableArgs/betas` 输入字段，并统一显式报当前不支持。

- `ac94fa3` `feat(sdk): align query permission prompt option inputs`
  - 切片：`QRY-21`
  - 说明：接收 `allowDangerouslySkipPermissions/permissionPromptToolName/promptSuggestions` 输入字段，并统一显式报当前不支持。

- `7180f84` `feat(sdk): align query continuation option inputs`
  - 切片：`QRY-22`
  - 说明：接收 `continue/fallbackModel` 输入字段，并统一显式报当前不支持。

- `46d939d` `feat(sdk): align query strict MCP option input`
  - 切片：`QRY-23`
  - 说明：接收 `strictMcpConfig` 输入字段，并统一显式报当前不支持。

- `3379599` `feat(sdk): align query session persistence option inputs`
  - 切片：`QRY-24`
  - 说明：接收 `persistSession/forkSession/enableFileCheckpointing` 输入字段，并统一显式报当前不支持。

- `c896955` `feat(sdk): align query filesystem sandbox option inputs`
  - 切片：`QRY-25`
  - 说明：接收 `additionalDirectories/sandbox` 输入字段，并统一显式报当前不支持。

- `6633be1` `feat(sdk): align query agent option inputs`
  - 切片：`QRY-26`
  - 说明：接收 `agent/agents` 输入字段，并统一显式报当前不支持。

- `ced59ea` `feat(sdk): align query tools and MCP option inputs`
  - 切片：`QRY-27`
  - 说明：接收 `tools/mcpServers` 输入字段，并统一显式报当前不支持。

- `70ac09f` `feat(sdk): align query hook permission option inputs`
  - 切片：`QRY-28`
  - 说明：接收 `hooks/canUseTool` 输入字段，并统一显式报当前不支持。

- `dc5e9c2` `feat(sdk): align query extension option inputs`
  - 切片：`QRY-29`
  - 说明：接收 `plugins/settingSources/onElicitation` 输入字段，并统一显式报当前不支持。

- `34f3d3d` `feat(sdk): align query pre-start control methods`
  - 切片：`QRY-30`
  - 说明：为 `Query` 增加 `setModel/setPermissionMode/setMaxThinkingTokens` 启动前覆盖能力，并在启动后拒绝修改。

- `44396d3` `feat(sdk): add session query APIs with validated outputs`
  - 切片：`SES-01`
  - 说明：新增 `listSessions/getSessionMessages`、统一入口导出、校验与测试。

- `ca4c333` `feat(sdk): enrich session list metadata safely`
  - 切片：`SES-02`
  - 说明：补齐 `firstPrompt/fileSize` 元数据与容错，并更新测试与文档。

- `4b81f4d` `feat(sdk): align query initializationResult method`
  - 切片：`QRY-31`
  - 说明：为 `Query` 增加 `initializationResult()`（含 pre-start close 中止路径），并补测试与文档。

- `9573b1c` `feat(sdk): align query supportedCommands method`
  - 切片：`QRY-32`
  - 说明：为 `Query` 增加 `supportedCommands()`，返回已支持 slash command 清单并做输出校验。

- `17fba5d` `feat(sdk): align query supportedAgents method`
  - 切片：`QRY-33`
  - 说明：为 `Query` 增加 `supportedAgents()`，返回当前可用子代理清单并做输出校验。

- `7defd30` `feat(sdk): align query supportedModels method`
  - 切片：`QRY-34`
  - 说明：为 `Query` 增加 `supportedModels()`，返回当前 provider 的可用模型子集并做输出校验。

- `47c7f3e` `feat(sdk): align query accountInfo method`
  - 切片：`QRY-35`
  - 说明：为 `Query` 增加 `accountInfo()`，返回当前账号配置子集并做输出校验。

- `f54f859` `feat(sdk): align query mcpServerStatus method`
  - 切片：`QRY-36`
  - 说明：为 `Query` 增加 `mcpServerStatus()`，当前能力下返回显式“不支持”错误语义。

- `7bca16c` `feat(sdk): align query MCP control methods`
  - 切片：`QRY-37`
  - 说明：为 `Query` 增加 `setMcpServers/reconnectMcpServer/toggleMcpServer()`，当前能力下返回显式“不支持”错误语义。

- `18cec9e` `feat(sdk): align query task control methods`
  - 切片：`QRY-38`
  - 说明：为 `Query` 增加 `streamInput()/stopTask()`，当前能力下返回显式“不支持”错误语义。

- `23448c0` `feat(sdk): align query rewindFiles method`
  - 切片：`QRY-39`
  - 说明：为 `Query` 增加 `rewindFiles()`，当前能力下返回显式“不支持”错误语义。

- `b4603c0` `feat(sdk): align HOOK_EVENTS constant export`
  - 切片：`SDK-01`
  - 说明：新增 `HOOK_EVENTS` 常量导出（基于现有 hooks 事件能力），并补测试与文档。

- `abc263c` `feat(sdk): align AbortError export`
  - 切片：`SDK-02`
  - 说明：新增 `AbortError` 导出，并在 query 中断相关路径统一使用该错误类型。

- `8fdc555` `feat(sdk): align EXIT_REASONS constant export`
  - 切片：`SDK-03`
  - 说明：新增 `EXIT_REASONS` 常量导出，并补测试与文档。

- `a3887eb` `feat(sdk): align HookEvent and ExitReason types`
  - 切片：`SDK-04`
  - 说明：新增 `HookEvent/ExitReason` 类型导出，并确保与常量导出保持一致。

- `e6c6372` `docs(sdk): add exports alignment index`
  - 切片：`SDK-05`
  - 说明：新增 SDK 导出对齐索引文档，并在 README 增加入口链接。

- `61b70dc` `feat(sdk): add official-aligned type aliases`
  - 切片：`SDK-06`
  - 说明：新增 `Options` 与 `SDK*Message` 系列官方同名类型别名导出，并补类型回归测试。

- `a943bbf` `feat(sdk): align supportedCommands shape fields`
  - 切片：`SDK-07`
  - 说明：`supportedCommands()` 补齐官方同名 `name/argumentHint` 字段，并保留 `command/argHint` 兼容字段。

- `3506c80` `feat(sdk): align supportedModels shape fields`
  - 切片：`SDK-08`
  - 说明：`supportedModels()` 补齐官方常用 `value/displayName/supportsEffort` 字段，并保留 `model/provider` 兼容字段。

- `0f8c3fd` `feat(sdk): align MCP control return types`
  - 切片：`SDK-09`
  - 说明：补齐 `setMcpServers()/rewindFiles()` 等控制方法的官方同名返回类型（仅类型层对齐）。

- `c8e7c60` `feat(sdk): align options effort input contract`
  - 切片：`SDK-10`
  - 说明：新增 `options.effort` 官方值输入校验，并保持当前显式“暂不支持”语义。

- `e463e4a` `feat(sdk): add prompt request type aliases`
  - 切片：`SDK-11`
  - 说明：新增 `PromptRequest/PromptRequestOption/PromptResponse` 官方同名类型别名（已支持交互子集）。

- `e34210a` `feat(sdk): add output format type aliases`
  - 切片：`SDK-12`
  - 说明：新增 `OutputFormatType/BaseOutputFormat` 官方同名类型别名（当前 `json_schema` 子集）。

- `c49372a` `feat(sdk): add elicitation type aliases`
  - 切片：`SDK-13`
  - 说明：新增 `ElicitationRequest/ElicitationResult/OnElicitation` 官方同名类型别名（类型层对齐）。

- `[pending]` `feat(sdk): align accountInfo shape fields`
  - 切片：`SDK-14`
  - 说明：计划补齐 `accountInfo()` 官方常用兼容字段子集，并保持现有字段向后兼容。
