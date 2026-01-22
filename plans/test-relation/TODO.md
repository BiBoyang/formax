# Test Coverage TODO（基于 `webgpt-response-2.md` 汇总）

来源：`plans/test-relation/webgpt-response-2.md`  
目标：把 WebGPT 的建议整理成“可执行 TODO List”，按 P0→P2 推进；不输出大段补丁代码，以 TODO 为纲。

## Top 大文件盘点（来自 WebGPT）

1. `src/features/repl/useReplController.ts`（~1407 LOC，❌无同名测试，P0）
2. `src/ui/agents/AgentsDialog.tsx`（~860 LOC，✅已有测试，P1：只补异常/边界）
3. `src/screens/REPL.tsx`（~763 LOC，✅已有测试，P1：可能缺 abort/overlay 竞态）
4. `src/cli/main.ts`（~743 LOC，✅已有测试，P1）
5. `src/tools/modules/askUserQuestion/presenter.tsx`（~729 LOC，✅已有测试，P1）
6. `src/ui/SetupWizard.tsx`（~717 LOC，✅已有测试，P1）
7. `src/tools/executor/handlers/taskSubAgent.ts`（~552 LOC，✅已有测试，P1）
8. `src/utils/consoleLogger.ts`（~543 LOC，❌无测试，P0）
9. `src/services/models.ts`（~471 LOC，❌无测试，P0）
10. `src/features/commands/registry.ts`（~471 LOC，✅已有测试，P1）

额外高优先级（未进 Top10，但缺口明显）：
- `src/tools/modules/exitPlanMode/presenter.tsx`（~313 LOC，❌无测试，P0/P1）

## 需要你确认（来自 WebGPT E 节）

- [ ] 1) `useReplController.abort()`：`AskUserQuestion` abort 时追加的文案 `'User declined to answer questions.'` 是否要当作稳定合约锁定？
- [ ] 2) `fetchAnthropicModels`：`/v1/models` fetch 失败后走 SDK 校验并 fallback common models，这是明确的产品行为吗（要不要测试锁死）？
- [ ] 3) `exitPlanMode/presenter.tsx`：ESC=cancel、数字键直选项、typing 模式“直接输入字母进入”，是否都要当作稳定交互合约锁定？
- [ ] 4) `consoleLogger.ts`：payload 字段 `{ type, level, timestamp, formatted, args }`，测试要锁到“必须包含全部字段”，还是只锁 `type/level/args`（timestamp/formatted 更宽松）？

## P0（必须优先补）

### [x] W2-01：`useReplController` 基础 send + assistant/thinking/usage（核心状态机）
- Target：`src/features/repl/useReplController.ts`（`send()` / `handleEvent()`）
- Tests：新增 `src/features/repl/useReplController.test.tsx`
- Mock/依赖：
  - engine stub：在 `runTurn({ onEvent, signal })` 内发事件并返回 `{ nextHistory }`
  - mock subagent reload（`loadSubAgentsFromDirectories -> []`），避免真实 FS
  - `vi.useFakeTimers()` + `vi.setSystemTime(...)` 控节流
- Test cases（Given/When/Then）：
  - [x] buffered：多次 `assistant_delta` + `complete` → 最终只落 1 条 assistant，content 拼接 `Hi there`，完成态非 streaming
  - [x] stream：多次 `assistant_delta` → assistant content 逐步增长（只锁最终顺序一致）
  - [x] thinking 节流：<200ms 多个 `thinking_delta` → 推进 timers 后 `thinkingText` 合并
  - [x] usage：`usage` 事件 → `state.context.source === 'usage'` 且 token 更新（不测算法细节）
  - [x] 空白输入：`send('   ')` → 不调用 `runTurn` 且不新增消息
  - [x] loading 重入：未结束时再次 `send()` → 第二次 no-op（`runTurn` 仍 1 次）
- Done when：`bun run test -- src/features/repl/useReplController.test.tsx`

### [x] W2-02：`useReplController` tool lifecycle（tool_start/input/update/end）+ Task/Skill 特例
- Target：`src/features/repl/useReplController.ts`（tool 事件分支）
- Tests：扩展 `src/features/repl/useReplController.test.tsx`
- Mock/依赖：
  - engine stub 在一次 send 内发：`tool_start → tool_input → tool_update → tool_end`
  - 如 `formatToolResult` 断言太脆：只断言关键字段存在，或 mock `../../utils/toolFormatting.js` 固定输出
- Test cases：
  - [x] `tool_start` → 新增 tool message，`status='running'`，`loadingText` 变为 `Working`（AskUserQuestion 为 `Waiting`）
  - [x] `tool_input` + `tool_update`（含 input/middleLines/nestedTools/transcriptLines）→ 同 toolUseId 增量更新
  - [x] generic `tool_end` → tool message 变 success，填充 result（不锁精确格式）
  - [x] `tool_end` + `toolName==='Task'` + result 含 backgroundTaskId/tokens/duration → doneText 呈现“后台 + tokens + duration”（锁含义）
  - [x] `tool_end` + `toolName==='Skill'` + result JSON 含 summary → toolResultSummary 设置，且“中间输出”被隐藏/压缩
- Done when：同上（覆盖 generic/Task/Skill 三条路径）

### [x] W2-03：`useReplController` abort（竞态 + AskUserQuestion 特例）
- Target：`src/features/repl/useReplController.ts`（`abort()`）
- Tests：扩展 `src/features/repl/useReplController.test.tsx`
- Mock/依赖：
  - `runTurn` 返回“直到 signal abort 才 reject AbortError”的 Promise
  - runTurn 开始先发 `tool_start(AskUserQuestion)` 造出 running tool
- Test cases：
  - [x] idle abort：`isLoading=false` → `abort()` no-op（不抛错、无用户可见变化）
  - [x] running tools：abort 后所有 running tool message → `status='error'` 且 result/content 含 `Request aborted`
  - [x] AskUserQuestion：abort → 追加 assistant declined message（本仓库当前文案，不锁全文句号）
  - [x] AbortError：abort 后不应追加普通 `Error:` assistant 消息（只断言“没有错误消息”）
  - [x] double abort：`abort(); abort()` 不应重复追加 declined（至少不无限增长）
- Done when：同上（abort 分支覆盖到 AskUserQuestion）

### [x] W2-04：`useReplController` slash command “consumed” UI effects（overlay/local_async）
- Target：`src/features/repl/useReplController.ts`（`send()` consumed 分支）
- Tests：扩展 `src/features/repl/useReplController.test.tsx`
- Mock/依赖：
  - commandRegistry.dispatch mock 返回不同 effect
  - engine.runTurn mock：断言未/被调用
- Test cases：
  - [x] `/agents` → `agentsDialogOpen=true` 且不调用 runTurn
  - [x] `/permissions` → `permissionsDialogOpen=true`
  - [x] `local_async`：进入 loading 再回落，追加 messages（不触网）
  - [x] `local_async`：run throw → 追加 `Error: ...`（不触网）
- Done when：同上（稳定无随机依赖）

### [x] W2-05：`services/models.ts` `fetchCustomModels`（baseURL 规范化 + 状态码映射 + 多返回形状）
- Target：`src/services/models.ts`（`fetchCustomModels`）
- Tests：新增 `src/services/models.test.ts`
- Mock/依赖：mock `globalThis.fetch`；`vi.spyOn(console, 'error')` 静默；禁止真实网络
- Test cases：
  - [x] baseURL 无 `/v1` 且尾 `/`：请求 URL 规范化为 `.../v1/models`
  - [x] baseURL 已带 `/v1`：请求 `.../v1/models`（走 `/models` 拼接）
  - [x] status 401/403/404/429/5xx：错误 message 包含对应可读信息（断言关键片段）
  - [x] JSON `{ data: [...] }` 解析
  - [x] JSON `[...]` 或 `{ models: [...] }` 解析
  - [x] JSON 非预期结构：抛 `Unexpected response format...`（断言前缀/关键子串）
- Done when：`bun run test -- src/services/models.test.ts`

### [x] W2-06：`services/models.ts` `fetchAnthropicModels`（/v1/models 多形状 + fetch→SDK fallback）
- Target：`src/services/models.ts`（`fetchAnthropicModels`）
- Tests：扩展 `src/services/models.test.ts`
- Mock/依赖：
  - fetch mock（ok/throw）
  - `vi.mock('@anthropic-ai/sdk', ...)`：mock `messages.create`
- Test cases：
  - [x] baseURL `.../v1/`：请求 `.../v1/models`；解析 `{ data: [...] }` 并推导 tokens 字段
  - [x] 解析数组形态 `[...]`
  - [x] 解析 `{ models: [...] }`
  - [x] fetch 失败/非 ok：SDK `messages.create` 成功 → 返回 common models（fallback 覆盖；是否锁语义见“需要确认 #2”）
- Done when：同上（无真实 SDK 请求）

### [x] W2-07：`services/models.ts` `fetchAnthropicModels` 错误映射（401/403/network/others）
- Target：`src/services/models.ts`（SDK 错误映射）
- Tests：扩展 `src/services/models.test.ts`
- Mock/依赖：fetch 强制 throw；Anthropic mock `messages.create` 分别 reject 不同错误
- Test cases：
  - [x] 401/authentication → `Invalid API key...`
  - [x] 403 → `...permission...`
  - [x] 其他 Error → `API error: ...`
  - [x] network/fetch → `Unable to connect...`
  - [x] 非 Error（字符串等）→ `Failed to fetch Anthropic models`
- Done when：同上（覆盖 401/403/network）

### [x] W2-08：`services/models.ts` `fetchOpenAIModels`（过滤 + metadata 映射 + 错误映射）【暂时只考虑anthropic的接口类型】
- Target：`src/services/models.ts`（`fetchOpenAIModels`）
- Tests：扩展 `src/services/models.test.ts`
- Mock/依赖：`vi.mock('openai', ...)`；mock `openai.models.list()`；禁止真实网络
- Test cases（按 WebGPT 原文）：
  - [x] list 返回混合模型（chat + 非 chat）：只保留 chat-like（`gpt-4*`/`gpt-3.5-turbo`/`o1-`/`o3-`），并对 `gpt-4o`/`gpt-4-turbo` 标记 `supports_vision=true`
  - [x] list 返回空数组：fallback 到 default models（断言 `length>0` 且包含 `gpt-4o` 等关键 id）
  - [x] SDK throw 含 `401/authentication`：映射为 Invalid API key
  - [x] SDK throw 含 `403`：映射为 Permission denied
  - [x] SDK throw 含 `fetch/network`：映射为 Unable to connect
- Done when：同上

### [x] W2-09：`consoleLogger.ts` 日志 payload 合约（type/timestamp/formatted/args）+ 序列化边界
- Target：`src/utils/consoleLogger.ts`（`sendToBrowserClients` / wsLog 系列）
- Tests：新增 `src/utils/consoleLogger.test.ts`
- Mock/依赖：
  - 不启动真实 server/端口；通过纯函数 `buildLogMessage` + `sendLogMessageToClients` 断言结构契约
- Test cases：
  - [x] 未启动：`wsLog/wsWarn/wsError/wsInfo/wsDebug` no-op 不抛错
  - [x] `sendLogMessageToClients`：仅对 OPEN client 发送可 parse JSON，字段包含 `{ type, timestamp, formatted, args }`
  - [x] `wsError(new Error('boom'))`：args 含 message/stack（stack 只断言存在且 string）
  - [x] 参数为 function 或循环引用对象：不 throw，args 对应项可序列化（至少是 string fallback）
- Notes：
  - [x] 模块级 `loggerInstance` 可能跨用例残留：每个用例后调用 `stopConsoleLogger()` 或 `vi.resetModules()`
- Done when：`bun run test -- src/utils/consoleLogger.test.ts`

### [x] W2-10：`exitPlanMode/presenter.tsx` 最少 1 个 Ink 交互测试（数字选择 + Enter + ESC）
- Target：`src/tools/modules/exitPlanMode/presenter.tsx`（`ExitPlanModePrompt` 键盘路径）
- Tests：新增 `src/tools/modules/exitPlanMode/presenter.test.tsx`
- Mock/依赖：
  - `ink-testing-library` + `stdin.write(...)`
  - 参考 `askUserQuestion/presenter.test.tsx` 的 Provider 组合（`InputScopeProvider` / `UserInputProvider` 等）
  - plan 文本用临时文件写入（避免 mock fs）
- Notes：
  - [x] `stdout.columns` 可能影响分隔线长度：断言只看关键文本，不做整帧快照
- Test cases：
  - [x] running + 有 planText：UI 含 `Ready to code?` / `Would you like to proceed?` / 3 个选项文案（锁用户可见 copy）
  - [x] `1`+Enter → `{ choice: 'auto' }`
  - [x] `2`+Enter → `{ choice: 'manual' }`
  - [x] ESC → `{ choice: 'cancel' }`
  - [x] 多次 Enter：`submitAnswers` 只调用一次（submittedRef 保护）
- Done when：`bun run test -- src/tools/modules/exitPlanMode/presenter.test.tsx`

## P1（高价值，但可在 P0 后）

### [x] W2-11：`exitPlanMode/presenter.tsx` typing 模式 + 截断提示
- Target：`src/tools/modules/exitPlanMode/presenter.tsx`
- Tests：扩展 `src/tools/modules/exitPlanMode/presenter.test.tsx`
- Test cases：
  - [x] `3` → 输入 `fix this` → Enter → `{ choice:'feedback', feedback:'fix this' }`
  - [x] 光标在第 3 项且直接输入字母 → 自动进入 typing 并带首字符
  - [x] typing 状态按 Up/Down → 退出 typing 并移动光标（不提交）
  - [x] planText > 80 行 → 出现 `... (N more lines)` 截断提示
- Notes：
  - [x] Ink 输入事件可能需要 `await tick()` 再断言，避免偶发抖动
- Done when：同上

### [x] W2-12：`exitPlanMode/presenter.tsx` approved/aborted/错误展示分支
- Target：`src/tools/modules/exitPlanMode/presenter.tsx`
- Tests：扩展 `src/tools/modules/exitPlanMode/presenter.test.tsx`
- Test cases：
  - [x] success + result 含 `User has approved your plan` → 显示 `User approved Claude's plan` + `Plan saved to ...`
  - [x] result 含 `auto-accept` → 显示 `Auto-accepted plan changes`；`manual edit` → `Manually approved...`
  - [x] error + result 含 `Request aborted` → component 渲染为 `null`
  - [x] 普通 error → 显示 `ExitPlanMode error` + 第一行错误
- Notes：
  - [x] 这组用例可只做渲染断言（不需要 stdin）
- Done when：同上

### [x] W2-13：`useReplController` `/compact` 命令路径（锁定“压缩历史”契约）
- Target：`src/features/repl/useReplController.ts`（`/compact` 分支）
- Tests：扩展 `src/features/repl/useReplController.test.tsx`
- Test cases：
  - [x] `'/compact because …'`：进入 loading（`loadingText==='Compacting'`），compact runTurn 时 `tools: []`
  - [x] compact summary 被写入后续 turn 的 history（只锁 summary 被采用）
  - [x] 无 summary：展示 `Error: Compact failed...`
  - [x] throw：展示 `Error: <message>`
- Done when：同上

### [x] W2-14：`useReplController` auto-compact 触发条件 + “只触发一次”保护
- Target：`src/features/repl/useReplController.ts`（auto-compact 逻辑）
- Tests：扩展 `src/features/repl/useReplController.test.tsx`
- Mock/依赖：建议 mock `estimatePromptTokens` 直接返回超阈值，避免构造超长 history
- Test cases：
  - [x] enableAutoCompact=true 且估算超阈值 → `engine.runTurn` 调用两次（先 compact 后正常 turn），第二次使用 compact 后 history
  - [x] `autoCompactMinTurnsBetweenRuns`：触发后在阈值内不再次 auto-compact（只断言 tools:[] runTurn 仍 1 次）
  - [x] showAutoCompactNotice=true → messages 追加 notice（只断言存在）
- Done when：同上（不 flaky）

### [x] W2-15：`useReplController` slash command `inject_next_turn` 注入 + strip 合约
- Target：`src/features/repl/useReplController.ts`（pendingInjectedBlocksRef）
- Tests：扩展 `src/features/repl/useReplController.test.tsx`
- Notes：
  - [x] 建议 `promptProfile='lite'`，减少其它 injected blocks 干扰
- Test cases：
  - [x] consumed command 返回 `inject_next_turn` blocks：下一次 send 的 `engine.runTurn` 入参 user content 含这些 blocks（在 user message 前）
  - [x] turn 完成：history 中 injected blocks 被 strip（只断言最终不包含标识/内容）
  - [x] 连续两次 inject：blocks 累积并在下一次 send 一次性消费
- Done when：同上

### [x] W2-16：`consoleLogger.ts` start/stop 幂等与资源清理
- Target：`src/utils/consoleLogger.ts`（`startConsoleLogger` / `stopConsoleLogger`）
- Tests：扩展 `src/utils/consoleLogger.test.ts`
- Test cases：
  - [x] 连续两次 start：`createServer` 只调用一次（instance guard）
  - [x] stop：`httpServer.close` / `wss.close` 被调用；之后 wsLog 不再发送
  - [x] 未 start 就 stop：不抛错
- Done when：同上

## P2（可选/低优先级）

### [x] W2-17：`src/ui/permissions/ui.tsx` 最小 UI/文案合约测试（不测 reducer 实现）
- Target：`src/ui/permissions/ui.tsx`（TabsBar/描述文案/边界 clamp）
- Tests（二选一）：
  - 新增 `src/ui/permissions/ui.test.tsx`，或
  - 扩展 `src/ui/permissions/PermissionsDialog.test.tsx`
- Test cases：
  - [x] 不同 activeTab：显示对应描述文案（锁 copy）
  - [x] clamp 输入 NaN/超界：不崩溃且落到边界（只锁结果）
  - [x] 列表行数超 MAX_LIST_ROWS：不渲染超过上限/不崩溃
- Done when：`bun run test -- src/ui/permissions/ui.test.tsx`

### [x] W2-18：`src/prompts/system.ts` 可测性改动（依赖注入）+ 合约测试（仅当你们真的要测）
- Target：`src/prompts/system.ts`（child_process/fs/os/path 强耦合）
- Tests：新增 `src/prompts/system.test.ts`
- TODO（可测性改动）：
  - [x] 把“环境探测（platform/os/git）”封装成可注入依赖（默认实现保持现状）
  - [x] 用关键片段断言锁定输出（不做全量快照）
- Test cases：
  - [x] 注入固定 OS/git snapshot → system prompt 含关键片段
  - [x] 注入依赖 throw → prompt 不崩溃并 fallback
  - [x] profile 切换（lite/full）→ 关键段落变化符合预期
- Done when：`bun run test -- src/prompts/system.test.ts`（CI 不依赖真实 shell）

## 建议的执行顺序（来自 WebGPT D 节）

1. W2-01..W2-04、W2-13..W2-15 → `bun run test -- src/features/repl/useReplController.test.tsx`
2. W2-05..W2-08 → `bun run test -- src/services/models.test.ts`
3. W2-09、W2-16 → `bun run test -- src/utils/consoleLogger.test.ts`
4. W2-10..W2-12 → `bun run test -- src/tools/modules/exitPlanMode/presenter.test.tsx`
5. W2-17 → `bun run test -- src/ui/permissions/ui.test.tsx`（或你选的现有文件）
6. W2-18 → `bun run test -- src/prompts/system.test.ts`（若做）
7. 合并前：`bun run test && bun run type-check`
