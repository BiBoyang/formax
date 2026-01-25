下面是一份**“可执行、分阶段、可回滚”**的 REPL 拆分重构 todolist（**先补测试锁行为，再拆文件**），目标是把两个过大的文件拆开并提升可维护性/稳定性，同时**保证用户可见行为 100% 不变**（布局/文案/交互：↑↓←→Tab 数字键 Enter Esc 等）。

> 约束我会贯穿全程：
>
> * **不改变任何 UI 文本/符号/空格/树状线（└─/├─/│/⎿ 等）**
> * **不改变键位逻辑与优先级（尤其 overlay scope、slash suggestions、Static append-only）**
> * 每一步都能在主干跑起来（测试全绿 + 能 `bun run dev` 起来）

---

## 1) 目标拆分目录结构（最重要）

### 1.1 最小搬家、增量拆分后的目录树（目标态）

#### `REPL.tsx`（渲染层）拆分目标

```
src/screens/
  REPL.tsx                       # 入口与“编排层”：组装依赖/状态，调用 controller，render Layout
  repl/
    createReplCommandRegistry.ts # 仅负责 createSlashCommandRegistry 的 wiring（doctor/status/config/roots）
    promptMode.ts                # 仅负责 isPromptMode 计算（纯函数 + 少量类型）
    hotkeys.ts                   # 仅负责 useInput/useScopedInput 键位绑定（ctrl+o/esc/shift+tab/上下/tab）
    transcript.tsx               # 仅负责 Static + transient 渲染（含 HeaderBanner 作为 Static 第一个 item）
    panels.tsx                   # ExploreAgentsPanel / DetailedTranscriptPanel +其 helper（标题/截断/统计）
    messageItems.ts              # deriveMessageItemDescriptors + explore grouping helpers（纯逻辑）
```

#### `useReplController.ts`（controller/state 层）拆分目标

```
src/features/repl/
  useReplController.ts           # 入口 hook：只做状态/refs 初始化 + 组合各子模块 + 对外返回 state/actions
  controller/
    utils.ts                     # 纯函数：isAbortLikeError / isExactSlashCommand / token&duration 格式化等
    messages.ts                  # 纯逻辑：isTransient 判定 + partition(static/transient)（供 useMemo 调用）
    overlays.ts                  # overlay manager + closeXxxDialog + agents wizard 的 actions（无 Ink）
    streaming.ts                 # handleEvent/flushAssistantBuffer（工具生命周期/assistant_delta/thinking/usage）
    send.ts                      # send action：/clear /compact /slash consumed /LLM turn/auto-compact
```

> 说明：
>
> * 这不是“大搬家”。保留原入口文件路径：`src/screens/REPL.tsx` 和 `src/features/repl/useReplController.ts` **仍是唯一入口**；其余为“内部模块”。
> * 新增目录与文件数量控制在可管理范围；每次只迁一块。

---

## 1.2 每个新模块的职责边界（做什么 / 不做什么）

### 渲染层（`src/screens/repl/*`）

#### `createReplCommandRegistry.ts`

* ✅ 做：

  * 把当前 `REPL.tsx` 里那段巨大的 `useMemo(() => createSlashCommandRegistry({...}))` **原封不动搬出来**
  * 负责 `status.get()` / `doctor.run()` / workspaceRoots/warnings wiring
* ❌ 不做：

  * 不 render
  * 不处理键盘
  * 不直接依赖 controller state（只依赖入参）

#### `promptMode.ts`

* ✅ 做：

  * 计算 `isPromptMode(state, userInput, toolRegistry)`（保持逻辑一致：agents/permissions/hooks + AskUserQuestion/EnterPlanMode/ExitPlanMode + Task nestedTools pending）
* ❌ 不做：

  * 不 setState
  * 不触发 side effects

#### `hotkeys.ts`

* ✅ 做：

  * 完整承接 `REPL.tsx` 当前的键盘行为（**逐行迁移**，不改逻辑）：

    * `useInput`：ctrl+c → abort + exit
    * `useScopedInput('repl')`：ctrl+o / esc / shift+tab / slash suggestions 上下/Tab
* ❌ 不做：

  * 不 render
  * 不直接调用 commandRegistry.dispatch（只操作 UI state / 调用 controller actions）

#### `transcript.tsx`

* ✅ 做：

  * 渲染：

    * `<Static key={transcriptSeq} items={[header, ...staticMessages]}>...`
    * transient messages（非 Static）
  * 保留“Header 作为 Static 第一个 item”的策略（避免 Static items 把消息刷到 header 上方）
* ❌ 不做：

  * 不做 suggestions
  * 不做 promptMode
  * 不做 overlay

#### `panels.tsx`

* ✅ 做：

  * `ExploreAgentsPanel`
  * `DetailedTranscriptPanel`
  * 以及相关 helper（`formatTaskPanelTitle/getTaskShortLabel/sumTokens/formatTokens/truncate`）
* ❌ 不做：

  * 不访问 controller refs
  * 不改动树状符号/文案（严格 copy）

#### `messageItems.ts`

* ✅ 做：

  * `deriveMessageItemDescriptors` 及 explore grouping helpers（纯函数）
* ❌ 不做：

  * 不 render

---

### controller/state 层（`src/features/repl/controller/*`）

#### `utils.ts`

* ✅ 做（纯函数集合）：

  * `isAbortLikeError`
  * `isExactSlashCommand` + `escapeRegex`
  * token/usage/duration 相关格式化：`sumInputTokens/formatTokens/formatDuration/parseBackgroundTaskId/parseTaskTranscript/...`
  * prompt 注入 helper：`buildModeInjectedBlocks/buildExitPlanInjectedBlocks/stripInjectedBlocksFromHistory/patchToolsForTurn`
* ❌ 不做：

  * 不使用 React hooks
  * 不读写 state/ref（由调用方传入数据）

#### `messages.ts`

* ✅ 做：

  * `isTransientMessage(m)` 判定逻辑（当前：running tool 或 isStreaming assistant）
  * `partitionMessages(messages)` → `{staticMessages, transientMessages}`
* ❌ 不做：

  * 不持有 React state

#### `overlays.ts`

* ✅ 做：

  * overlay manager (`createOverlayManager`) 与订阅
  * `closeAgentsDialog/closePermissionsDialog/closeHooksDialog`（append “dismissed” 文案保持一致）
  * agents wizard：`generateAgentDraft/saveAgentFromDialog`（包含 reloadSubagents、错误提示文案保持一致）
* ❌ 不做：

  * 不处理 streaming events
  * 不处理 send/LLM turn

#### `streaming.ts`

* ✅ 做：

  * `handleEvent` 的所有 event 分支（assistant_delta/thinking_delta/usage/tool_* /error/complete）
  * `flushAssistantBuffer`
  * tool 生命周期内容格式化（Task Done(...)、Skill summary hidden、Explore batch 完成提示）
* ❌ 不做：

  * 不直接调用 engine.runTurn
  * 不处理 /clear /compact（这些属于 send.ts）

#### `send.ts`

* ✅ 做：

  * `send(text, opts)` 的完整逻辑（保持行为）：

    * /clear（含 Static append-only 的 transcriptSeq remount + clear 顺序）
    * /compact（tools-free compact turn + rebuild history）
    * slash dispatch/consumed（ui effects：append/openOverlay/closeOverlay/toast；model effects 注入）
    * local_async 执行与 recordForNextTurn 注入
    * LLM turn 路径：system/user 构造、budget、prune、auto-compact、runTurn、historyRef 更新
* ❌ 不做：

  * 不定义 overlay UI
  * 不定义 Ink 渲染

---

## 1.3 依赖方向 / 边界规则（避免 UI ↔ domain/infra 污染）

> 目标：把“wiring”集中在入口，把“纯渲染”与“业务状态机”隔离。

### 规则（建议写进 CODEMAP / 或作为团队约定）

1. **`src/screens/repl/*`（纯 UI 子模块）不得 import：**

   * `src/chat/*`, `src/core/*`, `src/adapters/*`（这类 infra/domain）
   * ✅ 例外：`createReplCommandRegistry.ts` 允许（它是 wiring 模块）
2. **`src/features/repl/controller/*` 不得 import Ink/React 组件：**

   * 不允许 `ink`、`src/components/*`、`src/screens/*` 的运行时依赖
   * ✅ 如果短期必须用到 UI 类型（例如 `Msg` 目前在 `ToolMessage.tsx`），务必只用 `import type`，并把“未来抽公共类型”列为后续任务（见下方可选项）
3. **REPL 渲染层与 controller 的唯一边界：**

   * `useReplController()` 返回的 `{state, actions}`
   * 渲染层不读写 `historyRef` / tool refs；controller 不知道 Ink

---

## 1.4 拆分后各模块 Public API（重点：render ↔ controller 边界）

### 入口保持不变（对外 API 不变）

#### `src/screens/REPL.tsx`

```ts
type Props = {
  onExit?: () => void
  onClearTerminal?: () => void | Promise<void>
  engine: ChatEngine
  tools: ToolDefinition[]
  cfg: RuntimeConfig
  allowedSubagents?: Array<{ name: string; description: string }>
  reloadSubagents?: () => Promise<Array<{ name: string; description: string }>>
  toolRegistry?: ToolRegistry
  taskManager?: TaskManager
}

export function REPL(props: Props): React.ReactNode

// 仍然对外导出（测试依赖）
export type MessageItemDescriptor =
  | { kind: 'message'; key: string; message: Msg }
  | { kind: 'explore-group'; key: string; tasks: Msg[] }

export function deriveMessageItemDescriptors(
  messages: Msg[],
  opts: { groupExploreTasks: boolean },
): MessageItemDescriptor[]
```

#### `src/features/repl/useReplController.ts`

```ts
export type ReplControllerState = {
  messages: Msg[]
  staticMessages: Msg[]
  transientMessages: Msg[]
  transcriptSeq: number
  isLoading: boolean
  loadingText: string
  thinkingText: string
  error: string | null
  allowedSubagents: Array<{ name: string; description: string }>
  agentsDialogOpen: boolean
  permissionsDialogOpen: boolean
  hooksDialogOpen: boolean
  context: null | {
    usedTokens: number
    limitTokens: number
    percentRemaining: number
    source: 'estimate' | 'usage'
  }
}

export type ReplController = {
  state: ReplControllerState
  actions: {
    send: (text: string, opts?: { preferredSlashSpecId?: string }) => Promise<void>
    abort: () => void
    closeAgentsDialog: (args: { createdAgents: string[] }) => void
    closePermissionsDialog: () => void
    closeHooksDialog: () => void
    generateAgentDraft: (description: string, signal?: AbortSignal) => Promise<AgentsDialogGenerateDraft>
    saveAgentFromDialog: (args: AgentsDialogSaveArgs) => Promise<AgentsDialogSaveResult>
  }
}

export function useReplController(deps: {
  engine: ChatEngine
  tools: ToolDefinition[]
  cfg: RuntimeConfig
  onClearTerminal?: () => void | Promise<void>
  allowedSubagents?: Array<{ name: string; description: string }>
  reloadSubagents?: () => Promise<Array<{ name: string; description: string }>>
  mode: ReplMode
  promptProfile?: SystemPromptProfile
  onModeChange?: (mode: ReplMode) => void
  commandRegistry?: SlashCommandRegistry
  planSession?: PlanSessionManager
}): ReplController
```

### 新增内部模块 API（供拆分使用）

#### `src/screens/repl/hotkeys.ts`

```ts
export function useReplHotkeys(args: {
  onExit?: () => void
  ensurePlanPath: () => string
  isPromptMode: boolean

  state: Pick<ReplControllerState,
    'isLoading'|'thinkingText'|'agentsDialogOpen'|'permissionsDialogOpen'
  >
  actions: Pick<ReplController['actions'], 'abort'>

  // UI 本地 state setters（保持 REPL.tsx 现有行为）
  setMode: React.Dispatch<React.SetStateAction<ReplMode>>
  setInput: (next: string) => void
  setSlashIndex: React.Dispatch<React.SetStateAction<number>>
  setSlashSelectionTouched: (next: boolean) => void

  // ctrl+o 面板相关
  allMessages: Msg[]
  showThinking: boolean
  setShowThinking: React.Dispatch<React.SetStateAction<boolean>>
  showDetailedTranscript: boolean
  setShowDetailedTranscript: React.Dispatch<React.SetStateAction<boolean>>
  setDetailedTranscriptTargetId: React.Dispatch<React.SetStateAction<string | null>>
  showExploreAgentsPanel: boolean
  setShowExploreAgentsPanel: React.Dispatch<React.SetStateAction<boolean>>

  // slash suggestions
  slashSuggestions: Array<{ id: string; command: string }>
  selectedSlash: { id: string; command: string } | null
}): void
```

#### `src/features/repl/controller/messages.ts`

```ts
export function isTransientMessage(m: Msg): boolean

export function partitionMessages(messages: Msg[]): {
  staticMessages: Msg[]
  transientMessages: Msg[]
}
```

#### `src/features/repl/controller/overlays.ts`

```ts
export function useReplOverlays(args: {
  initialOverlay: OverlaySpec | null // 处理 FORMAX_START_AGENTS_DIALOG
  setMessages: React.Dispatch<React.SetStateAction<Msg[]>>
  engine: ChatEngine
  cfg: RuntimeConfig
  reloadSubagents?: () => Promise<Array<{name:string; description:string}>>
}): {
  overlay: OverlaySpec | null
  closeAgentsDialog: ...
  closePermissionsDialog: ...
  closeHooksDialog: ...
  generateAgentDraft: ...
  saveAgentFromDialog: ...
  openOverlay: (spec: OverlaySpec) => void
  closeOverlay: () => void
}
```

#### `src/features/repl/controller/streaming.ts`

```ts
export function useReplStreaming(args: {
  assistantTextMode: RuntimeConfig['ui']['assistantTextMode']
  setMessages: React.Dispatch<React.SetStateAction<Msg[]>>
  setThinkingText: (t: string) => void
  setLoadingText: (t: string) => void
  setContext: (c: ReplControllerState['context']) => void
  setError: (e: string | null) => void
  refs: {
    currentAssistantIdRef: React.MutableRefObject<string | null>
    assistantBufferRef: React.MutableRefObject<string>
    thinkingBufferRef: React.MutableRefObject<string>
    thinkingLastFlushAtRef: React.MutableRefObject<number>
    toolNameByIdRef: React.MutableRefObject<Map<string,string>>
    taskStatsByToolUseIdRef: React.MutableRefObject<Map<string, ...>>
    taskKindByToolUseIdRef: React.MutableRefObject<Map<string, ...>>
    exploreBatchRef: React.MutableRefObject<ExploreTaskBatch | null>
    contextBudgetConfigRef: React.MutableRefObject<ContextBudgetConfig | null>
    reminderServiceRef: React.MutableRefObject<ReminderService | null>
  }
}): {
  handleEvent: (ev: StreamEvent) => void
  flushAssistantBuffer: () => void
}
```

#### `src/features/repl/controller/send.ts`

```ts
export function useReplSend(args: {
  deps: ... // 原 useReplController 的 deps + 必要的 setters/refs/handlers
  handleEvent: (ev: StreamEvent) => void
  overlayApi: { openOverlay; closeOverlay }
  messageApi: { setMessages; setTranscriptSeq; ... }
  refs: { historyRef; abortControllerRef; ... }
}): {
  send: ReplController['actions']['send']
}
```

---

# 2) 测试先行：必须新增/增强的回归用例清单（具体到按键序列）

> 目标：先把“交互不可变”锁住，避免拆分时误改。

下面每条都给：**建议测试文件位置 / 模拟按键序列 / 关键期望**。

---

## 2.1 overlay 打开时 REPL 不抢键（方向键/Tab/数字键/ESC）

### 建议位置

* **增强现有测试**：`src/features/repl/inputScopeContext.test.tsx`

  * 已有 “routes navigation keys only to the active scope” 用例，建议扩展覆盖：

### 按键序列

* Up: `\u001B[A`
* Down: `\u001B[B`
* Left: `\u001B[D`
* Right: `\u001B[C`
* Tab: `\t`
* Number: `'1'`
* Esc: `\u001B`

### 期望

* 当 activeScope = `'repl'`：

  * replEvents 收到：`up/down/left/right/tab/num/esc`
  * overlayEvents 不变
* 当 push overlay scope（例如 `'overlay:test'`）后：

  * overlayEvents 收到全部键
  * replEvents 不再增长
* pop overlay scope 后：

  * 键事件重新回到 replEvents

### 额外建议（能抓更多回归）

* 把 Esc 单独测试（避免与箭头序列混淆）：只发送 `\u001B` 一次。

---

## 2.2 slash command 建议列表与 dispatch（含优先级/选择/Enter）

### 2.2.1 UI 层：Enter 自动补全 vs 真正 dispatch

#### 建议位置

* `src/screens/REPL.slashSuggestions.test.tsx`（新增）

  * 用 `ink-testing-library` 渲染 `<REPL />`
  * **推荐 mock `useReplController`**：只验证 REPL 的 handleSend/按键行为（更稳、更快）

#### 模拟按键序列 & 期望

用例 A：**部分输入 + Enter 应该“补全”，不应 send**

* 输入：`/st`
* Enter：`\r`
* 期望：

  * input 被替换为选中 suggestion 的完整 command（例如 `/status`）
  * `actions.send` **未被调用**
* 再 Enter：`\r`
* 期望：

  * `actions.send('/status', undefined)` 被调用（或 opts 不包含 preferred）

用例 B：**精确输入 + 上下选择变体 + Enter 应携带 preferredSlashSpecId**

* 输入：`/status`
* Down：`\u001B[B`（确保 `slashSelectionTouched=true` 且选中第二条）
* Enter：`\r`
* 期望：

  * `actions.send('/status', { preferredSlashSpecId: 'project:/status' })`（示例 id）被调用

用例 C：**Tab 自动补全**

* 输入：`/st`
* Tab：`\t`
* 期望：

  * input 变为 `/status`
  * `actions.send` 未被调用

> 注意：REPL 当前逻辑里，Tab 补全不会把 `slashSelectionTouched` 置 true（需要锁住这个“细节行为”）。

---

### 2.2.2 controller 层：preferredSlashSpecId 必须透传给 registry.dispatch

#### 建议位置

* `src/features/repl/useReplController.test.tsx`（增强）

#### 测试方式

* 提供一个假的 `commandRegistry`：

  * `dispatch` 是 spy
  * 返回一个 **consumed** 的 effect（比如 `{kind:'unimplemented', message:'x'}`），避免进入 engine LLM turn

#### 调用

* `controller.actions.send('/status', { preferredSlashSpecId: 'project:/status' })`

#### 期望

* `commandRegistry.dispatch` 被调用，且第二参包含 `{ preferredSpecId: 'project:/status' }`
* `engine.runTurn` 不应被调用（因为 consumed）

---

## 2.3 Static append-only 风险（items 不可“回缩”导致丢渲染）

这里建议锁两类“最常见回归”：

### 2.3.1 `/clear` 必须通过 transcriptSeq 强制 remount Static

#### 建议位置

* `src/features/repl/useReplController.test.tsx`（增强已有 `/clear` 用例）
* 期望新增断言：

  * 调用 `/clear` 前记下 `transcriptSeq`
  * `/clear` 后 `transcriptSeq === prev + 1`
  * `messages` 变为 `[]`

### 2.3.2 running tool / streaming assistant 必须属于 transientMessages（不能进 Static）

#### 建议位置

* `src/features/repl/useReplController.test.tsx`（新增用例，放在 tool lifecycle 附近）

#### 流程（模拟 engine.onEvent）

* tool_start（status running）后：

  * 期望：该 tool msg 在 `transientMessages`，不在 `staticMessages`
* tool_end 后：

  * 期望：该 tool msg 进入 `staticMessages`，不在 `transientMessages`

> 这条能防止“把 running tool 渲染进 Static 导致 tool_update 不刷新”的灾难性回归。

---

## 2.4 TextInput 在各 dialog 中输入/删除/左右移动（避免闪屏/游标错位）

### 建议位置

* `src/components/ui/TextInput.test.tsx`（新增）

### 建议用例（用 controlled harness，不依赖渲染 ANSI）

用例 A：基本编辑 + 游标移动

* 初始 value：`"abcd"`，cursorOffset 初始为 0（或末尾，按你 harness 设定）
* 发送：

  * Left：`\u001B[D`
  * Backspace：`\u007F`（或 `\b`，以你当前测试环境为准）
  * Right：`\u001B[C`
  * Delete：`\u001B[3~`（TextInput 有识别 delete 的逻辑）
* 期望：

  * value 与 cursorOffset 按预期变化（通过 `onChange`/`onCursorOffsetChange` 断言）

用例 B：ctrl+u 清空行 / ctrl+w 删除词

* ctrl+u：发送 input `'u'` + key.ctrl（ink-testing-library 里通常直接写 `\x15`）
* ctrl+w：`\x17`
* 期望：

  * value 清空/删除一个词，cursorOffset 正确更新

用例 C：multiline 下 shift+enter 插入换行，enter submit

* multiline=true
* shift+enter（通常为 `\u001B[13;2u` 或测试库提供的方式；如果不稳定，就只测 `enter` submit 并单测 `handleMultilineNewline` 的路径）
* 期望：

  * shift+enter：value 增加 `\n`，不触发 onSubmit
  * enter：触发 onSubmit，value 是否清空取决于外部（保持当前行为）

用例 D：受控 value 外部变短时 cursorOffset clamp

* 设置 cursorOffset 在末尾
* 外部把 value 从 `"abcdef"` 改成 `"ab"`
* 期望：

  * cursorOffset 被 clamp 到合法范围（避免“游标跑飞”导致闪烁）

---

# 3) 分阶段迁移计划（超细 checklist，每步可回滚、主干可跑）

> 我按**30–60 分钟/条**拆任务。每条都包含：改动文件、具体改动点、风险、验收、回滚。

---

## Phase 0 — 测试先行：把“不可变行为”钉死

### [ ] 0.1 扩展 input scope 导航键测试（30–45min）

* **改动文件**

  * `src/features/repl/inputScopeContext.test.tsx`
* **具体改动点**

  * 扩展现有 “routes navigation keys only to the active scope”：

    * NavProbe 记录：`left/right/escape`
    * 增加 stdin 写入：`\u001B[D`, `\u001B[C`, `\u001B`
* **风险点**

  * Esc 与箭头序列都以 `\u001B` 开头，避免误判：Esc 测试要单独发送 `\u001B`。
* **验收方式**

  * `bun run test -- src/features/repl/inputScopeContext.test.tsx`
* **回滚策略**

  * 只改测试文件，回滚直接 `git checkout -- <file>`。

---

### [ ] 0.2 新增 TextInput 受控编辑回归测试（45–60min）

* **改动文件**

  * 新增：`src/components/ui/TextInput.test.tsx`
* **具体改动点**

  * 写一个 ControlledHarness：

    * `value`/`cursorOffset` 用 React state 持有
    * 传入 `onChange/onCursorOffsetChange/onSubmit`
  * 覆盖：左右移动、backspace/delete、ctrl+u/ctrl+w、外部 value 变短 clamp
* **风险点**

  * 不同终端/库对 Delete 序列可能不同：尽量复用你项目里已有测试里使用的序列（例如 InputScopeContext 已经用到了箭头；InputBar.test 已经用到了 left）。
* **验收方式**

  * `bun run test -- src/components/ui/TextInput.test.tsx`
* **回滚策略**

  * 新增文件，回滚直接删除即可。

---

### [ ] 0.3 增强 controller：preferredSlashSpecId 透传（30–45min）

* **改动文件**

  * `src/features/repl/useReplController.test.tsx`
* **具体改动点**

  * 新增用例：`send('/status', {preferredSlashSpecId})` → `commandRegistry.dispatch(_, {preferredSpecId})`
  * commandRegistry.dispatch 返回 `{kind:'unimplemented', message:'x'}` 确保 consumed
* **风险点**

  * 不要让测试走到 engine.runTurn（会变慢且复杂）；用 consumed effect 终止路径。
* **验收方式**

  * `bun run test -- src/features/repl/useReplController.test.tsx`
* **回滚策略**

  * 回滚单个测试块。

---

### [ ] 0.4 增强 controller：/clear 必须 bump transcriptSeq（30–45min）

* **改动文件**

  * `src/features/repl/useReplController.test.tsx`（复用已有 `/clear` describe）
* **具体改动点**

  * 在 `/clear` 前读取 `controller.state.transcriptSeq`
  * `/clear` 后断言 `+1`
* **风险点**

  * transcriptSeq 初始值在测试中可能为 0，但别写死，写相对断言。
* **验收方式**

  * 同上
* **回滚策略**

  * 回滚该断言即可。

---

### [ ] 0.5 新增 REPL：slash suggestions 行为（45–60min）

* **改动文件**

  * 新增：`src/screens/REPL.slashSuggestions.test.tsx`
* **具体改动点**

  * mock `useReplController`（只测 REPL 的 handleSend/按键逻辑）
  * mock `createSlashCommandRegistry` 或直接 mock 返回 registry（让 suggest 可控）
  * 覆盖：

    * `/st` + Enter → 补全，不 send
    * `/status` + Down + Enter → send 带 preferredSlashSpecId
* **风险点**

  * 由于选中态多是样式（bold/color），测试尽量断言 **send 入参**、**input 值变化**，不要依赖 ANSI 样式。
* **验收方式**

  * `bun run test -- src/screens/REPL.slashSuggestions.test.tsx`
* **回滚策略**

  * 新增文件，删除即可回滚。

---

## Phase 1 — 拆 `src/screens/REPL.tsx`（先拆纯逻辑/纯 UI）

### [ ] 1.1 引入 `src/screens/repl/messageItems.ts`，迁移 deriveMessageItemDescriptors（30–45min）

* **改动文件**

  * 新增：`src/screens/repl/messageItems.ts`
  * 修改：`src/screens/REPL.tsx`
  * 修改：`src/screens/REPL.deriveMessageItemDescriptors.test.ts`（如需更新 import）
* **具体改动点**

  * 把以下从 REPL.tsx **原样搬迁**：

    * `MessageItemDescriptor`
    * `deriveMessageItemDescriptors`
    * `isExploreTaskMessage/findContiguousExploreTaskGroupFrom/findLastContiguousExploreTaskGroup/exploreGroupId`
  * 在 `REPL.tsx`：

    * 要么继续 `export { deriveMessageItemDescriptors, ... }` re-export
    * 要么保留 export 但实现改为调用新模块（推荐 re-export）
* **风险点**

  * 测试 import 路径变更；建议维持 `from './REPL'` 不变（通过 re-export）。
* **验收方式**

  * `bun run test -- src/screens/REPL.deriveMessageItemDescriptors.test.ts`
  * 全量跑：`bun run test`
* **回滚策略**

  * 回滚 commit；或把函数复制回 REPL.tsx 并删新文件。

---

### [ ] 1.2 引入 `src/screens/repl/panels.tsx`，迁移 Explore/Detailed 面板（45–60min）

* **改动文件**

  * 新增：`src/screens/repl/panels.tsx`
  * 修改：`src/screens/REPL.tsx`
* **具体改动点**

  * 原样搬迁（不要改任何文本/符号/截断逻辑）：

    * `ExploreAgentsPanel`
    * `DetailedTranscriptPanel`
    * `formatTaskPanelTitle/getTaskShortLabel/truncate/sumTokens/formatTokens`
  * `REPL.tsx` 改为 import 使用
* **风险点**

  * 极容易引入 UI 细微变化（空格、换行、树形字符）。**迁移时只做剪切粘贴**。
* **验收方式**

  * `bun run test -- src/screens/REPL.test.tsx`
  * 手动：`bun run dev`，跑一次 ctrl+o（thinking/transcript/explore）相关路径
* **回滚策略**

  * 回滚该 commit 或将组件搬回原文件。

---

### [ ] 1.3 引入 `src/screens/repl/createReplCommandRegistry.ts`（30–60min）

* **改动文件**

  * 新增：`src/screens/repl/createReplCommandRegistry.ts`
  * 修改：`src/screens/REPL.tsx`
* **具体改动点**

  * 把 `useMemo(() => createSlashCommandRegistry({...}))` 整段搬到新文件导出的函数：

    * 输入：cfg/taskManager/planSession/promptProfile getter-setter/workspaceRoots/warnings
    * 输出：SlashCommandRegistry
  * REPL.tsx 中 useMemo 保留（或在新文件内部 useMemo，但更推荐 REPL 仍负责 memo）
* **风险点**

  * 依赖数组（deps）不能漏：`promptProfile/workspaceRoots/warnings/cfg.llm.*` 等必须一致，否则行为变。
* **验收方式**

  * `bun run test -- src/screens/REPL.test.tsx`
  * 手动：`/doctor`、`/status` 输出仍一致（至少 smoke）
* **回滚策略**

  * 把 wiring 段粘回 REPL.tsx。

---

### [ ] 1.4 引入 `src/screens/repl/promptMode.ts`（30–45min）

* **改动文件**

  * 新增：`src/screens/repl/promptMode.ts`
  * 修改：`src/screens/REPL.tsx`
* **具体改动点**

  * 把 `const isPromptMode = useMemo(() => {...})` 的内部逻辑搬到 `computeIsPromptMode(...)` 纯函数
  * REPL.tsx 仍用 useMemo 调用该函数（保持依赖数组完全一致）
* **风险点**

  * promptMode 是交互开关，任何漏依赖会导致“该禁用时没禁用”或“该启用时没启用”。
* **验收方式**

  * `bun run test`（尤其 InputBar 与 overlay 相关）
  * 手动：打开 /agents /permissions /hooks 时 input 是否隐藏、键是否不抢
* **回滚策略**

  * 直接回滚到内联版本。

---

### [ ] 1.5 引入 `src/screens/repl/hotkeys.ts`（45–60min）

* **改动文件**

  * 新增：`src/screens/repl/hotkeys.ts`
  * 修改：`src/screens/REPL.tsx`
  * 可能修改：`src/screens/REPL.slashSuggestions.test.tsx`（如果你新增了键位测试）
* **具体改动点**

  * 把 `useInput(ctrl+c)` 和 `useScopedInput('repl', ...)` 原样迁移到 `useReplHotkeys(args)`
  * REPL.tsx 只负责组装 args 并调用 hook
* **风险点**

  * hook 参数很多，最怕：

    * 闭包抓到旧 state（依赖数组错）
    * setState 回调改写（例如把函数式更新改成直接 set）
* **验收方式**

  * `bun run test`（新增的 slashSuggestions 测试应能抓住 Enter/Tab/上下选择）
  * 手动：↑↓Tab Enter Esc ctrl+o shift+tab ctrl+c 都过一遍
* **回滚策略**

  * 把键位逻辑搬回 REPL.tsx（hotkeys.ts 保留也无妨）。

---

### [ ] 1.6 引入 `src/screens/repl/transcript.tsx`（45–60min）

* **改动文件**

  * 新增：`src/screens/repl/transcript.tsx`
  * 修改：`src/screens/REPL.tsx`
* **具体改动点**

  * 把这三段渲染拆出来，保持 JSX 结构不变：

    * Static（key=transcriptSeq，header 为第一个 item）
    * transient messages map
    * showLoadingBlock / error block（可先不搬，按你风险偏好）
* **风险点**

  * `<Static>` 行为敏感：items 必须 append-only；header 必须仍是第一项；key 必须仍是 transcriptSeq。
* **验收方式**

  * `bun run test -- src/screens/REPL.test.tsx`
  * 手动：多轮对话 + /clear + 再对话，确认 Static 行为一致
* **回滚策略**

  * 把渲染段粘回 REPL.tsx。

---

## Phase 2 — 拆 `src/features/repl/useReplController.ts`（先抽纯函数，再抽 hook 块）

> 原则：先做“机械搬迁”（纯函数），再做“逻辑块拆分”（streaming / overlays / send）。

### [ ] 2.1 新建 `controller/utils.ts`，迁移纯 helper（30–60min）

* **改动文件**

  * 新增：`src/features/repl/controller/utils.ts`
  * 修改：`src/features/repl/useReplController.ts`
* **具体改动点**

  * 迁移（剪切粘贴、保持实现一致）：

    * `isAbortLikeError`
    * `buildModeInjectedBlocks/buildExitPlanInjectedBlocks/stripInjectedBlocksFromHistory`
    * `patchToolsForTurn`
    * `isExactSlashCommand/escapeRegex`
    * `sumInputTokens/formatTokenTotal/formatTokens/formatDuration/parseBackgroundTaskId/parseTaskTranscript/...`
* **风险点**

  * 任何格式化函数的小改动都会变 UI 文案（尤其 Task Done(...)）。只允许“搬迁”，不允许重写。
* **验收方式**

  * `bun run test -- src/features/repl/useReplController.test.tsx`
* **回滚策略**

  * 将 helper 复制回原文件并删除 utils.ts。

---

### [ ] 2.2 新建 `controller/messages.ts`，抽离 static/transient 分区（30–45min）

* **改动文件**

  * 新增：`src/features/repl/controller/messages.ts`
  * 修改：`src/features/repl/useReplController.ts`
  * 修改：`src/features/repl/useReplController.test.tsx`（若新增用例）
* **具体改动点**

  * 把 useMemo 内联的 `isTransient` + filter 逻辑抽成：

    * `isTransientMessage(m)`
    * `partitionMessages(messages)`
  * useReplController 内 `useMemo(() => partitionMessages(messages), [messages])`
* **风险点**

  * 判定条件改错会直接破坏 Static append-only 安全性。
* **验收方式**

  * 跑新增的 “running tool 必须 transient” 用例
  * 全量 controller tests
* **回滚策略**

  * 回滚该 commit。

---

### [ ] 2.3 新建 `controller/overlays.ts`，抽 overlay manager + dialog actions（45–60min）

* **改动文件**

  * 新增：`src/features/repl/controller/overlays.ts`
  * 修改：`src/features/repl/useReplController.ts`
* **具体改动点**

  * 迁移：

    * `overlayManagerRef` 初始化（含 `FORMAX_START_AGENTS_DIALOG`）
    * `overlay` state + subscribe effect
    * `closeAgentsDialog/closePermissionsDialog/closeHooksDialog`
    * `generateAgentDraft/saveAgentFromDialog`
* **风险点**

  * closeXxxDialog 的追加消息文案必须一致（包括缩进 `⎿` 前后空格）。
  * reloadSubagents 失败提示文案一致。
* **验收方式**

  * `bun run test -- src/features/repl/useReplController.test.tsx`
  * 手动：打开 AgentsDialog 保存/退出（如果你本地能跑）
* **回滚策略**

  * 把 overlay 相关代码粘回 useReplController.ts。

---

### [ ] 2.4 新建 `controller/streaming.ts`，抽 handleEvent + flushAssistantBuffer（60min）

* **改动文件**

  * 新增：`src/features/repl/controller/streaming.ts`
  * 修改：`src/features/repl/useReplController.ts`
* **具体改动点**

  * 把 `flushAssistantBuffer` 与 `handleEvent` 整块迁移到新 hook `useReplStreaming(...)`
  * useReplController 中保留 refs 初始化，作为参数传入 streaming hook（第一版不要移动 refs 所属，降低风险）
* **风险点**

  * `useCallback` 依赖数组必须保持一致，避免事件 handler 变化导致性能/行为差异。
  * Task tool_end 的 Done(...) 字符串格式与 Explore batch “X Explore agents finished ...” 不能变。
* **验收方式**

  * 重点跑 tool lifecycle tests（Read/Task/Skill/AskUserQuestion 等）
  * `bun run test -- src/features/repl/useReplController.test.tsx`
* **回滚策略**

  * 还原 handleEvent 回主文件（streaming.ts 可保留）。

---

### [ ] 2.5 抽离 send：先只搬 `/clear` 分支（45–60min）

* **改动文件**

  * 新增：`src/features/repl/controller/send.ts`（先放一个最小版本）
  * 修改：`src/features/repl/useReplController.ts`
* **具体改动点**

  * 在 send.ts 内做一个 helper：

    * `maybeHandleClearCommand(text, api)`：命中则执行并 `return true`
    * 其中“Static remount + clear terminal 的顺序”必须与现有完全一致
  * useReplController.ts 的 send callback 内先调用该 helper
* **风险点**

  * /clear 顺序是已知坑：`setTranscriptSeq` 与 `setMessages([])` 必须先调，`onClearTerminal` 必须最后调（保持原注释语义）。
* **验收方式**

  * controller `/clear` 测试 + transcriptSeq 断言
  * REPL.test.tsx 的 `/clear` 集成路径也要过
* **回滚策略**

  * revert commit（这是结构性拆分的第一步，别手工乱改）。

---

### [ ] 2.6 抽离 send：再搬 `/compact` 分支（60min）

* **改动文件**

  * `src/features/repl/controller/send.ts`
  * `src/features/repl/useReplController.ts`
* **具体改动点**

  * 将 `/compact` 整段迁入 send.ts：

    * tools-free compact runTurn
    * rebuildHistoryAfterCompaction
    * context 估算更新（estimatePromptTokens + computeContextStats）
  * 保持 loadingText/thinkingText/error/abortControllerRef 清理逻辑一致
* **风险点**

  * compactSink 仅允许特定事件类型传到 handleEvent（保持一致）。
* **验收方式**

  * `/compact` tests 全跑
* **回滚策略**

  * revert commit。

---

### [ ] 2.7 抽离 send：搬 slash consumed 分支（45–60min）

* **改动文件**

  * send.ts / useReplController.ts
  * 可能新增：`applyCommandResultUiEffects(...)` helper（放 send.ts 或 utils.ts）
* **具体改动点**

  * 把这段拆成函数（保持逻辑）：

    * `dispatchSlash(text, preferredSpecId)`
    * `applyUiEffects(uiEffects)`：appendMessages/openOverlay/closeOverlay/toast
    * `applyModelEffects(modelEffects)`：injectNextTurn
* **风险点**

  * openOverlay/closeOverlay 对 overlayManager 的调用顺序必须一致（会影响 promptMode/抢键）。
* **验收方式**

  * 新增的 preferredSpecId 透传测试必须仍过
  * 手动：`/agents` `/permissions` `/hooks` 是否仍能打开 overlay
* **回滚策略**

  * revert commit。

---

### [ ] 2.8 抽离 send：搬 LLM turn（剩余主体）与 auto-compact（60min+，建议拆两条）

* **改动文件**

  * send.ts / useReplController.ts
* **具体改动点**

  * 先把 “构建 system/user、注入 blocks、patchToolsForTurn、runTurn、historyRef 更新” 搬到 send.ts
  * 再把 auto-compact 子流程单独 helper（保持 lastAutoCompactSeqRef 行为）
* **风险点**

  * 这是最大风险块：任何顺序/条件改变都会影响历史、UI、以及 context meter。
* **验收方式**

  * 全量 controller tests
  * 全量 REPL tests
  * 手动：连续多轮对话、触发 auto-compact、/compact、/clear
* **回滚策略**

  * 只要出现回归，优先 revert 最近那条拆分 commit（不要“继续改到测试过”为止）。

---

### [ ] 2.9 useReplController.ts 收尾：变成“组合层”（30–45min）

* **改动文件**

  * `src/features/repl/useReplController.ts`
* **具体改动点**

  * 文件只保留：

    * state/refs 初始化
    * 调用 overlays/streaming/send 子模块
    * `abort`（如果你没拆，保留；如果拆了，则从模块引入）
    * return { state, actions }
* **风险点**

  * 不要在收尾顺手做“清理/格式化/重命名”，容易无意改行为。
* **验收方式**

  * `bun run test`
  * `bun run ui:boundaries`（确保新文件放置不触发边界违规）
* **回滚策略**

  * revert commit。

---

# 4) 手动验收清单（每个 Phase 结束都要做）

> 你们已经有教训：UI refactor 不能只靠测试。下面是**最短手动 smoke**：

1. 进入 REPL：header/Model/CWD 行是否一致
2. 输入普通文本 → Enter：assistant 输出样式 `⏺` 与前缀缩进是否一致
3. 输入 `/`：suggestions 是否出现；↑↓ 选择是否一致；Tab 补全是否一致
4. 输入 `/st` + Enter：是否补全到 `/status` 而非直接执行
5. `/agents` 打开 overlay 后：

   * ↑↓Tab 数字键 Esc 是否只作用于 overlay，不影响 REPL（REPL 不抢键）
6. tool 运行中（例如触发一个 Read/Task）：

   * running tool 的 UI 是否能持续更新（说明它没被塞进 Static）
7. `/clear`：

   * 清屏后旧 transcript 不应闪回
   * 新对话从干净 header 下开始

---

# 5) 可选：建议给 CODEMAP.md 增补的 “拆分后去哪改什么”

不改代码，只建议新增几行（你们自己加）：

* REPL UI：

  * `src/screens/REPL.tsx`：入口编排
  * `src/screens/repl/hotkeys.ts`：键位（ctrl+o/esc/shift+tab/上下/tab）
  * `src/screens/repl/transcript.tsx`：Static & transient 渲染
  * `src/screens/repl/panels.tsx`：Explore/Detailed 面板
* REPL controller：

  * `src/features/repl/useReplController.ts`：入口组合
  * `src/features/repl/controller/send.ts`：/clear /compact /slash /LLM turn
  * `src/features/repl/controller/streaming.ts`：tool/assistant streaming events
  * `src/features/repl/controller/overlays.ts`：dialogs

---

如果你希望我把“Phase 0 的测试用例”再进一步写成**逐条 test skeleton（describe/it 名称、mock 结构、按键序列常量、断言点）**，我也可以按你们现有测试风格（vitest + ink-testing-library）给出更接近可直接粘贴实现的版本。
