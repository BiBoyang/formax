## Architecture（基于你提供的 `src/**` 拼接文本）

1. **入口装配层（Composition Root）**
   `src/entrypoints/cli.tsx` 的 `main()` 负责读取运行时配置（`loadRuntimeConfig`）、构建 `ToolRegistry`、注册内置 Tool modules、加载 tools spec 并启动 Ink `REPL`。

2. **UI（Ink）层**
   `src/screens/REPL.tsx` 保存 `input/mode/slashIndex` 等 UI 状态，创建 `SlashCommandRegistry`，并通过 `useReplController()` 将 “UI 交互” 与 “对话引擎/流事件” 连接起来。

3. **Controller 层（对话编排 + UI 状态机）**
   `src/features/repl/useReplController.ts` 管理：

* `historyRef`（会话历史，给 LLM 的 messages）
* `transientMessages`（UI 当前展示的消息/工具运行态）
* 流式事件消费（assistant_text、tool_start/tool_end、usage、error…）
* mode/plan 注入块与下一轮清理
  这是目前“最厚”的一层，很多业务规则也在这里。

4. **Engine 层（多轮 tool-use loop）**
   `src/chat/engine.ts` 的 `createChatEngine().runTurn()` 负责调用 stream client，遇到 `stopReason === 'tool_use'` 就把 `toolResults` 回填到历史里继续跑下一轮，并设了 `maxIters` 上限防止死循环。

5. **Streaming Client 层（SSE 解析 + tool 执行调度）**
   `src/streaming/anthropic/StreamClient.ts`：解析 SSE，遇到 `tool_use` 就触发 `args.executeTool(call)`，同时发 `tool_input/tool_end` 事件；结束后 `Promise.all(pendingToolExecutions)` 并按 tool 调用顺序排序结果再返回。

6. **Tool Registry（spec/handler/presenter 聚合）**
   `src/tools/registry.ts` 的 `ToolRegistry` 把多个 `ToolModule` 合并：

* specs：`specSource.list()` + `specOverride` 覆盖 + `patches` 后处理
* handlers：聚合成数组
* presenters：按 tool name 找到 UI presenter


7. **Tool Executor（按 canHandle 路由）**
   `src/tools/executor/index.ts` 定义 `ExecutionContext`（含 `replMode/setReplMode/requestAnswers` 等）并用 `createToolExecutor()` 在 handlers 中找第一个 `canHandle()` 的执行。

8. **Tool UI 路由**
   `src/components/tool/ToolRouter.tsx` 根据 `toolRegistry.getPresenter()` 渲染特定 Presenter，否则 fallback。

9. **模式系统（Normal / Plan / AcceptEdits）**
   `src/features/repl/mode.ts` 定义 `ReplMode` 与 `nextReplMode()`；UI 用 `ModeIndicator` 文案提示 shift+tab cycle。

10. **“Prompt Mode”（等待用户输入时禁用主输入框）**
    `REPL.tsx` 的 `isPromptMode` 会扫描 `transientMessages`：当出现 running tool 且 `userInput.isPending(toolUseId)` 或 tool 属于硬编码 `alwaysInteractive` 集合时，进入 prompt mode。

11. **审批与写文件策略散落在 Tool Handler + Presenter**
    例如 `Edit` handler 会在 `replMode === 'plan'` 直接拒绝；否则走 `requestAnswers()` 决策，并在 `approve_all` 时通过 `ctx.setReplMode('acceptEdits')` 进入免审批模式。

12. **Plan mode 进入/退出是工具化的**
    `EnterPlanMode/ExitPlanMode` 通过 `requestAnswers()` 与 `setReplMode()` 改变模式，同时会触发 “下一轮注入提醒”。

13. **Slash commands：内置 + 文件插件命令**
    `src/features/commands/registry.ts` 会从 `.claude/commands/*.md` 加载文件命令（frontmatter + content），与内置 specs 合并。

14. **Frontmatter/YAML 解析非常轻量**（可维护性/安全点）
    subagents 与 commands 都用类似的 `parseFrontmatter/parseSimpleYaml`，只支持非常有限的 YAML 子集。

15. **层混在一起的地方（最关键）**
    `useReplController` 同时承担：UI state、history 构建、mode/plan 注入、tool/stream 事件归并、错误处理与节流策略 —— 这会成为后续扩展（更多 mode / 更多 tool / 更多 UI 形态）的瓶颈。

---

## Issues（按优先级 10 条，均含“症状/根因/影响/改法/关联代码”）

### 1) 高频 re-render + 长文本闪烁（P0）

* **症状**：assistant 长输出时闪烁、CPU 飙升；工具事件/文本 token 越多越明显。
* **根因**：`useReplController.handleEvent` 对 `transientMessages` 做频繁 `setState`，且常见写法是 `prev => prev.map(...)` 或拼接字符串；同时 “buffered” 仅用 50ms 定时 flush，仍会高频更新。
* **影响范围**：性能、交互体验、后续加富 UI（折叠/分页）会更糟。
* **推荐改法（小步）**：

  1. 把 message store 从 `Msg[]` 改为 `Map<id, Msg>` + 单独的 `order[]`；事件处理只更新目标 id，最后批量 `setVersion(v+1)` 触发渲染。
  2. buffered 模式下用 `requestAnimationFrame`/`setTimeout(120ms)` 合并更新；把 flush 间隔做成 config（而非硬编码 50ms）。
* **关联**：`src/features/repl/useReplController.ts`（`handleEvent`, `assistantTextMode`）；`src/env/config.ts`（`assistantTextMode` 配置）

---

### 2) Tool 执行结果排序 O(n²) + 可能丢结果（P0）

* **症状**：一次返回很多 tool_use 时，结束阶段会卡顿；极端情况下某些 tool_result 可能缺失（UI 有 tool_end，但 engine 没拿到对应结果）。
* **根因**：stream client 用 `toolCallOrder.map(id => toolResults.find(...))` 做排序，是 O(n²)；并且 `find` 找不到就直接过滤掉（`filter(r !== undefined)`），结果会被静默丢弃。
* **影响范围**：性能、正确性（history 回填缺 tool_result 会导致下一轮行为异常）。
* **推荐改法（小步）**：

  * 把 `toolResults` 改为 `Map<tool_use_id, ToolResult>`；排序用 `toolCallOrder.map(id => map.get(id) ?? makeErrorResult(...))`，不要静默丢弃。
* **关联**：`src/streaming/anthropic/StreamClient.ts`（`toolCallOrder/sortedToolResults`）

---

### 3) “Prompt Mode”硬编码工具名，新增交互工具容易漏（P0）

* **症状**：加了新的需要用户输入的工具后，要么主输入框没有禁用（导致键盘事件冲突），要么误禁用。
* **根因**：`REPL.tsx` 用 `alwaysInteractive = new Set(['AskUserQuestion','EnterPlanMode','ExitPlanMode'])` 硬编码。
* **影响范围**：可扩展性、插件工具生态、UX 一致性。
* **推荐改法（小步）**：

  * 在 `ToolModule` 增加 `ui?: { interactive?: boolean }` 或 `capabilities`；`ToolRegistry` 暴露 `isInteractive(toolName)`；`REPL` 不再 hardcode。
* **关联**：`src/screens/REPL.tsx`（`isPromptMode`）；`src/tools/registry.ts`（集中 registry 最适合放能力查询）

---

### 4) 模式/审批策略分散在多处，行为边界不清（P0）

* **症状**：用户很难预测 “当前为什么要审批/为什么不用”；某些工具在 plan mode 被拒绝，但另一些可能仍能写（未来扩展时更易出错）。
* **根因**：策略同时存在于：

  * handler（plan mode 直接 deny；approve_all 触发 setReplMode acceptEdits）
  * presenter（WriteToolPresenter 根据 `userInput.isPending` 弹审批 UI）
  * controller/REPL（mode state 管理）
* **影响范围**：正确性、可维护性、安全（越权写文件的风险在扩展时上升）。
* **推荐改法（分阶段）**：

  1. 抽一个 `PolicyEngine`：输入 `(replMode, toolName, input)` 输出 `DecisionRequired?`/`DeniedReason?`/`AutoApprove?`。
  2. handler/presenter 只负责“执行/展示”，不再各自判断 mode。
* **关联**：`src/tools/modules/edit/handler.ts`（`createEditToolHandler`）；`src/tools/executor/index.ts`（`ExecutionContext.replMode/setReplMode`）

---

### 5) Plan mode 注入块 + history 清理是“隐式协议”，易出边界 bug（P1）

* **症状**：偶发“模型读到了不该进历史的提醒/本地 stdout”；或相反，提醒丢了导致体验不一致。
* **根因**：controller 构造 “注入 blocks”（带 `cache_control: ephemeral`）并依赖下一轮 `stripInjectedBlocksFromHistory()` 清理；属于“约定式清理”，一旦某轮异常中断就可能污染 history。 
* **影响范围**：正确性、可解释性、debug 难度（尤其是 plan/exitplan）。
* **推荐改法**：

  * 把注入从 “塞进 user content 再清理” 改成 **显式的 `TurnContext`**：每次 `sendTurn()` 生成 `(systemBlocks, userBlocks, ephemeralBlocks)`，ephemeralBlocks 永不写入 history。
* **关联**：`src/features/repl/useReplController.ts`（`buildModeInjectedBlocks`, `stripInjectedBlocksFromHistory`） 

---

### 6) Slash 插件命令缺少安全边界（Prompt 注入/越权工具调用）（P1）

* **症状**：`.claude/commands/*.md` 里若包含“诱导执行本地命令/写文件”的文本，用户一运行命令就可能被带偏（尤其在 acceptEdits）。
* **根因**：插件命令内容基本原样进入 command content（frontmatter 解析也很弱），且没有 “allowed_tools / requires_confirm / sandbox” 的机制。 
* **影响范围**：安全、可信度、插件生态可持续性。
* **推荐改法（可小步落地）**：

  1. 在 frontmatter 支持：`allowed_tools`, `mode_required`, `requires_confirm`。
  2. 运行插件命令时先弹一个 preview + 二次确认（尤其触发写/exec 类 tool）。
  3. YAML 解析换成成熟库（并加文件大小上限/UTF-8 校验）。
* **关联**：`src/features/commands/registry.ts`（`loadPluginCommandEntries`）；`parseFrontmatter/parseSimpleYaml` 

---

### 7) ToolRegistry handler 冲突/优先级不显式（P1）

* **症状**：两个 handler 都 `canHandle(name)` 时，谁先注册谁赢；随着工具增多会出现“错 handler 被命中”的隐性 bug。
* **根因**：`ToolRegistry.getHandlers()` 只是把 modules 的 handlers 平铺；executor 找到第一个 `canHandle` 就执行。 
* **影响范围**：正确性、可扩展性、调试成本。
* **推荐改法**：

  * 给 `ToolHandler` 增加 `priority` 或在 `ToolModule` 上声明优先级；启动时做冲突检测（同名 tool 多 handler 直接报错或要求显式 order）。
* **关联**：`src/tools/registry.ts`（`getHandlers`）；`src/tools/executor/index.ts`（handler 选择逻辑）

---

### 8) Enter/Exit Plan Mode 的交互“工具化”很好，但缺“取消/超时/恢复”语义（P1）

* **症状**：用户卡在某个 prompt 时（例如 EnterPlanMode/ExitPlanMode），如果模型/网络中断，UI 可能进入半锁状态；恢复路径不清晰。
* **根因**：handler 依赖 `requestAnswers()`，但没有看到对 “abort/timeout/重入” 的统一语义（至少在 handler 层没有）。
* **影响范围**：UX、稳定性。
* **推荐改法**：

  * `UserInputManager` 引入：`timeoutMs`、`abortAll(reason)`、`resumeFromSnapshot()`；controller 在 abort 时确保清掉 pending。
* **关联**：`src/tools/modules/enterPlanMode/handler.ts` & `exitPlanMode` ；`REPL.tsx isPromptMode`（依赖 pending 状态）

---

### 9) WebSearch 通过抓 DuckDuckGo HTML，稳定性与合规风险（P2）

* **症状**：搜索结果偶发为空/解析错；某天 DDG DOM 结构变了就全挂。
* **根因**：`WebSearchToolHandler` 直接抓 HTML 并基于特定 class 解析，测试也只覆盖了固定 DOM。 
* **影响范围**：功能稳定性、长期维护成本。
* **推荐改法**：

  * 把 search provider 抽象成接口（DDG/SerpAPI/自建），并增加 fallback（WebFetch + LLM summarizer）。
* **关联**：`src/tools/modules/webSearch/handler.ts` 

---

### 10) Engine 的 max iteration 与错误呈现需要产品化（P2）

* **症状**：出现“Too many tool iterations”时用户只看到异常/中断，不知道如何自救。
* **根因**：`runTurn` 直接 throw，是否被 controller 捕获并转成 UI 消息不明确（在你给的片段里没看到统一错误边界）。
* **影响范围**：稳定性、可解释性。
* **推荐改法**：

  * 把该错误转换成一个系统提示消息：包含最后一次 tool_use 片段、建议 `/clear` 或 `/debug`。
* **关联**：`src/chat/engine.ts`（`maxIters`）

---

## Roadmap（P0 / P1 / P2）

### P0（1–3 天，高收益且尽量不破坏行为）

1. **消息更新批处理（降闪烁/降 CPU）**

* 目标：token/工具事件下 UI 更稳、更省 CPU。
* 改动范围：`useReplController.handleEvent` 的数据结构与更新策略。
* 风险：需要小心保持消息顺序与 ToolMessage 渲染一致。
* 验收：长输出（>5k tokens）时 CPU 明显下降；视觉闪烁显著减少。

2. **tool 结果排序改 Map，避免 O(n²) 与静默丢失**

* 改动范围：`StreamClient.streamOnce` 的 `toolResults` 收集与 `sortedToolResults` 构造。
* 风险：低。
* 验收：多 tool_use（>=10）时无明显卡顿；不会出现缺 tool_result 的下一轮异常。

3. **Prompt Mode 去硬编码（可扩展交互工具）**

* 改动范围：`REPL.tsx isPromptMode` + `ToolModule/ToolRegistry` 增加 `interactive` 元数据。
* 风险：低。
* 验收：新增交互工具无需改 REPL，输入禁用/恢复行为正确。

---

### P1（1–2 周：接口收敛 + 抽象落地）

1. **引入 PolicyEngine（统一 mode / 审批 / 工具权限矩阵）**

* 目标：把 “plan/acceptEdits/normal” 与 “Write/Edit/… 的审批” 规则集中起来，避免散落在 handler/presenter/controller。
* 改动范围：`tools/modules/*/handler.ts`、`useReplController` 的决策点、presenter 的 prompt 触发点。
* 风险：中（需要兼容现有 approve_all 行为）。
* 验收：用表驱动用例覆盖：不同 mode 下各工具是否可执行/是否要 prompt/是否自动批准。

2. **TurnContext 化（消灭“注入块 + 下一轮清理”隐式协议）**

* 目标：ephemeral 信息永不进入 history，避免污染与边界 bug。
* 风险：中（牵涉 history 构建）。
* 验收：对比前后同样操作（enter plan → run → exit plan）发给模型的 messages 在“可预期范围内一致”，且不再需要 strip。

3. **Slash 插件命令安全化 + 规范化 schema**

* 目标：为插件命令增加最小安全边界与元数据（allowed_tools / requires_confirm / mode_required）。
* 风险：中（会影响现有插件命令行为）。
* 验收：恶意/越权命令不能静默触发写/exec；用户必须确认。

4. **测试：加 2 类高价值集成测**

* “单轮 turn：stream events → transientMessages → history”
* “插件命令：md/frontmatter → registry → 执行前确认”
  你已有良好的单测基础（例如 Write handler 测试）。

---

### P2（长期演进：生态与产品化）

1. **插件生态**：可分发、版本化、签名/沙箱执行（至少对写/exec 类工具强约束）。
2. **后台任务化**：Task 工具、subagents 支持后台运行与状态持久化（断线重连仍可看到日志）。
3. **可观测性与调试**：提供 `/debug events`、回放某次 turn 的 SSE 事件与 tool 调用链。
4. **搜索/抓取能力产品化**：把 WebSearch 抽象 provider + cache + summarizer（避免 HTML 解析脆弱点）。

---

## Open Questions（最多 5 个，最关键的缺口）

1. **tools spec 的来源与更新策略**：`ToolRegistry` 依赖 `specSource.list()`，你现在是 `proxy/tools.json` 还是运行时动态生成？（影响插件工具的分发/版本化）
2. **“写/编辑审批”最终想对齐 Claude Code 哪个粒度**：仅 Write/Edit？还是所有“副作用工具”（Bash/Task/WebFetch）都走统一审批矩阵？
3. **会话/plan 的持久化**：目前我在你给的 `src/**` 里没看到 session store（例如 `~/.formax/...`）。你希望 plan 和历史如何落盘、何时清理？
4. **非流式展示的产品定义**：是“完全不流式，只在 message_end 一次性展示”，还是“按段落/按 200ms 批量刷”？（决定 flush 策略与 UI 组件设计）
5. **插件命令的权限模型**：`.claude/commands/*.md` 是否允许声明 `allowed_tools`？如果允许，是否需要签名/白名单目录来防止仓库内被植入恶意命令？

---

如果你愿意，我可以按 **P0** 直接给出一套“最小改动的落地接口草案”（例如 `MessageStore`、`PolicyEngine`、`ToolModule.capabilities`、`TurnContext` 的 TS 类型与迁移步骤），保证你能边跑边替换，而不是一次性大重构。


me: 好的

收到 ✅ 那我就按你现在这份代码的真实结构，直接把**最值得先落地的 3 个“可直接开 PR 的改动”**写成“接口 + 关键代码片段 + 验收方式”。（都尽量是小步、不改行为/少改行为的那种）

---

## PR-1：修复 `toolResults` 排序丢失（避免工具结果“凭空消失”）

你现在在 `src/streaming/anthropic/StreamClient.ts` 里按 `tool_use` 顺序排序 toolResults，但 **如果某个 tool_use 没有对应 result，会被 `.filter(r !== undefined)` 直接丢掉**，最终上层看不到这条 tool 的结果（你在 UI/History 上会出现“tool_start 了，但后续没 tool_end / 或 tool_end 没内容”的错觉）。相关代码在这里：

### 建议改法（最小修复，保持 API 形状不变）

在排序时：

1. 用 `Map` 预索引 result（O(n)）
2. 对缺失的 tool_use 生成一个 **is_error 的占位 ToolResult**（保证不丢）
3. 把“extras”（不在 tool_use 顺序里但确实产出的结果）追加到最后（可选但推荐）

```ts
// src/streaming/anthropic/StreamClient.ts

const toolCallOrder = result.contentBlocks
  .filter((b): b is ContentBlock & { type: 'tool_use' } => b.type === 'tool_use')
  .map((b) => b.id!)

const byId = new Map(toolResults.map((r) => [r.tool_use_id, r] as const))
const orderSet = new Set(toolCallOrder)

const sortedToolResults = toolCallOrder.map((id) => {
  const found = byId.get(id)
  if (found) return found
  return {
    tool_use_id: id,
    content: `Error: missing tool_result for tool_use_id=${id}`,
    is_error: true,
  } satisfies ToolResult
})

// optional：把不在顺序里的结果也保留下来（不吞）
const extras = toolResults.filter((r) => !orderSet.has(r.tool_use_id))

return {
  contentBlocks: result.contentBlocks,
  stopReason: result.stopReason,
  toolResults: [...sortedToolResults, ...extras],
}
```

### 验收

* 人为构造一个“tool_use 发出但 executeTool 抛错/或 aborted 导致没回填”的场景：UI 至少能看到一条 `is_error=true` 的 toolResult，不会 silently disappear。

### 单测（建议新增）

新增一个 `src/streaming/anthropic/StreamClient.sort.test.ts`：

* 输入：toolCallOrder=[a,b], toolResults=[b]
* 断言：返回 toolResults 长度为 2，且 a 是 is_error 占位

---

## PR-2：把 “哪些工具会进入 prompt mode” 变成 **ToolRegistry 的元数据**（去掉 REPL 里的 hardcode）

你现在在 `src/screens/REPL.tsx` 里 hardcode 了 `alwaysInteractive = new Set(['AskUserQuestion', 'EnterPlanMode', 'ExitPlanMode'])`：
这会导致：

* 新增交互式工具时要改 UI 层（破坏“插件化”）
* 多处需要同一判断（你也在别处依赖 `userInput.isPending`）

同时你 `ToolModule` 当前只有 `name/aliases/handler/presenter/specOverride`：
非常适合加一个 `meta` 字段，**不影响 handler/presenter/specOverride 的现有职责**。

### 1）扩展 ToolModule（兼容性极好）

```ts
// src/tools/registry.ts

export type ToolUiMeta = {
  // UI 层：运行中会占用输入焦点 / 必须显示 Prompt UI
  interactive?: boolean
}

export type ToolModule = {
  name: string
  aliases?: string[]
  handler?: ToolHandler
  presenter?: ToolPresenter
  specOverride?: ToolDefinition | ((base?: ToolDefinition) => ToolDefinition)
  meta?: ToolUiMeta
}

export class ToolRegistry {
  // ...
  private metaByName = new Map<string, ToolUiMeta>()

  register(module: ToolModule): void {
    if (module.handler) this.handlers.push(module.handler)
    if (module.presenter) this.presenters.set(module.name, module.presenter)
    if (module.specOverride) this.specOverrides.set(module.name, module.specOverride)
    if (module.meta) this.metaByName.set(module.name, module.meta)
    for (const alias of module.aliases ?? []) this.aliases.set(alias, module.name)
  }

  getMeta(name: string): ToolUiMeta | undefined {
    return this.metaByName.get(this.resolveName(name))
  }
}
```

### 2）在内置交互工具注册时挂 meta

你内置模块注册在 `registerBuiltinToolModules`，包含 Enter/ExitPlanMode：
所以只要在这些 tool module 的 `index.ts` 里加 meta 即可（示例）：

```ts
// src/tools/modules/enterPlanMode/index.ts
export function createEnterPlanModeToolModule(userInput: UserInputManager): ToolModule {
  return {
    name: 'EnterPlanMode',
    handler: createEnterPlanModeHandler(userInput),
    presenter: EnterPlanModePresenter,
    meta: { interactive: true },
  }
}
```

### 3）REPL.tsx 改成读 ToolRegistry（保留 fallback）

你 `REPL` 组件 props 里已经有 `toolRegistry?: ToolRegistry`：
所以可以无痛改：

```ts
// src/screens/REPL.tsx

const isPromptMode = useMemo(() => {
  if (!userInput) return false
  return state.transientMessages.some((m) => {
    if (m.role !== 'tool' || m.toolInfo?.status !== 'running') return false

    const toolUseId = m.toolInfo.toolUseId || (m.id.startsWith('tool-') ? m.id.slice('tool-'.length) : m.id)
    const name = m.toolInfo.name

    const interactive =
      toolRegistry?.getMeta(name)?.interactive ??
      // fallback：兼容老行为
      new Set(['AskUserQuestion', 'EnterPlanMode', 'ExitPlanMode']).has(name)

    return interactive || userInput.isPending(toolUseId)
  })
}, [state.transientMessages, userInput, toolRegistry])
```

### 验收

* 新增一个自定义交互工具（比如 `Confirm`），只要 module meta 标记 interactive，REPL 输入框就能自动隐藏/进入 prompt mode，不需要再改 UI 层。

---

## PR-3：让 “buffered” 不再等到 complete 才显示（解决长回答“像卡死”）

你在 `useReplController` 的 `assistant_delta` 里：buffered 模式只是 `assistantBufferRef += ev.text; return`，然后只在 `tool_start` 或 `complete` 才 flush：、
这会导致：**没有工具调用的长回答，UI 会一直不动，直到回答结束才一次性出现**（用户体验上像“卡死”）。

你 config 里也只有 `assistantTextMode: 'stream' | 'buffered'`：

### 最小体验修复：给 buffered 加“节流 flush”（chunked render）

新增一个配置：`FORMAX_ASSISTANT_BUFFERED_FLUSH_MS`（默认 60ms 或 80ms），让 buffered 变成“**低频流式**”：

#### 1）扩展 config

```ts
// src/env/config.ts
ui: {
  assistantTextMode: 'stream' | 'buffered'
  assistantBufferedFlushMs: number
}

// loadRuntimeConfig 里：
const flushMsRaw = Number(env.FORMAX_ASSISTANT_BUFFERED_FLUSH_MS || 60)
const assistantBufferedFlushMs = Number.isFinite(flushMsRaw) && flushMsRaw >= 0 ? flushMsRaw : 60

ui: { assistantTextMode, assistantBufferedFlushMs }
```

#### 2）useReplController：buffered 模式下定时 flush 到同一条 assistant message

核心点：**仍然只维护一个 streaming assistant message，但更新频率由 flush 定时器控制**。

```ts
// src/features/repl/useReplController.ts
const flushTimerRef = useRef<NodeJS.Timeout | null>(null)

const flushBufferedIntoAssistantMessage = useCallback(() => {
  const chunk = assistantBufferRef.current
  if (!chunk) return
  assistantBufferRef.current = ''

  setMessages((prev) => {
    const existingId = currentAssistantIdRef.current
    if (!existingId) {
      const id = `assistant-${Date.now()}`
      currentAssistantIdRef.current = id
      return [...prev, { id, role: 'assistant', content: chunk, timestamp: new Date(), isStreaming: true }]
    }
    return prev.map((m) => (m.id === existingId ? { ...m, content: m.content + chunk, isStreaming: true } : m))
  })
}, [])

const scheduleBufferedFlush = useCallback(() => {
  if (flushTimerRef.current) return
  const ms = deps.cfg.ui.assistantBufferedFlushMs
  flushTimerRef.current = setTimeout(() => {
    flushTimerRef.current = null
    flushBufferedIntoAssistantMessage()
    // 如果 buffer 又被追加了，继续 schedule（避免每个 delta 都 setTimeout）
    if (assistantBufferRef.current) scheduleBufferedFlush()
  }, ms)
}, [deps.cfg.ui.assistantBufferedFlushMs, flushBufferedIntoAssistantMessage])

// handleEvent: assistant_delta
case 'assistant_delta': {
  if (assistantTextMode === 'buffered') {
    assistantBufferRef.current += ev.text
    scheduleBufferedFlush()
    return
  }
  // stream 模式照旧...
}
```

并在 `complete` / `tool_start` 时：

* 先 `flushBufferedIntoAssistantMessage()`
* 再把 `isStreaming` 置 false，并清理 timer

### 验收

* `FORMAX_ASSISTANT_TEXT_MODE=buffered` 时，长回答也会“逐段出现”，但刷新频率明显低于 stream（闪烁显著减少）。

---

## 你现在就能直接开 PR 的顺序建议（最稳）

1. **PR-1（StreamClient 排序不丢）**：纯 correctness，风险最低，强收益
2. **PR-3（buffered 节流 flush）**：最直接改善“像卡死”的体验
3. **PR-2（Tool meta → prompt mode）**：让“插件化”闭环（UI 不再 hardcode）

---

## 你确认两点我就能把“PR-3 的完整 patch（含 complete/tool_start 清理逻辑）”也写出来

1. 你希望 buffered 的体验更像哪种？

   * A：**低频流式**（推荐，上面方案）
   * B：**完全不显示直到结束**（你现在其实就是这个）
2. `assistantBufferedFlushMs` 你倾向默认多少？（我建议 60ms 或 80ms，足够稳）

如果你直接说“按 A + 默认 60ms”，我下一条就把 PR-3 的完整 diff（包含所有边界条件）贴出来。
