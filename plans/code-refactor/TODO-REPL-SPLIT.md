# TODO — 拆分 `REPL.tsx` / `useReplController.ts`（行为 100% 不变）

来源：`plans/code-refactor/REPL_and_useReplController.md`（此 TODO 旨在让你后续可以删掉原文档也不丢信息）。

硬约束（执行过程中任何一步都不能违反）：
- 不改变任何 UI 文本/符号/空格/树状线（`└─/├─/│/⎿` 等）。
- 不改变任何键位逻辑与优先级（overlay scope、slash suggestions、Static append-only 等）。
- 每一步都必须：测试全绿 + `bun run dev` 可跑；若出现回归，优先 `git revert` 最近拆分 commit（不要“继续改到测试过”为止）。

## 目标目录结构（Spec，按这个拆）

### `src/screens/REPL.tsx`（渲染层）

```
src/screens/
  REPL.tsx
  repl/
    createReplCommandRegistry.ts
    promptMode.ts
    hotkeys.ts
    transcript.tsx
    panels.tsx
    messageItems.ts
```

### `src/features/repl/useReplController.ts`（controller/state 层）

```
src/features/repl/
  useReplController.ts
  controller/
    utils.ts
    messages.ts
    overlays.ts
    streaming.ts
    send.ts
```

说明：
- 不是“大搬家”：入口文件路径保持不变（`src/screens/REPL.tsx`、`src/features/repl/useReplController.ts` 仍是唯一入口）。
- 每次只迁一块；新文件数量控制在可管理范围。

## 模块职责边界（Spec，按原文保留，避免拆分时“顺手多做/少做”）

### 渲染层（`src/screens/repl/*`）

#### `createReplCommandRegistry.ts`
- ✅ 做：
  - 把当前 `REPL.tsx` 里那段巨大的 `useMemo(() => createSlashCommandRegistry({...}))` **原封不动搬出来**
  - 负责 `status.get()` / `doctor.run()` / workspaceRoots/warnings wiring
- ❌ 不做：
  - 不 render
  - 不处理键盘
  - 不直接依赖 controller state（只依赖入参）

#### `promptMode.ts`
- ✅ 做：
  - 计算 `isPromptMode(state, userInput, toolRegistry)`（保持逻辑一致：agents/permissions/hooks + AskUserQuestion/EnterPlanMode/ExitPlanMode + Task nestedTools pending）
- ❌ 不做：
  - 不 setState
  - 不触发 side effects

#### `hotkeys.ts`
- ✅ 做：
  - 完整承接 `REPL.tsx` 当前的键盘行为（**逐行迁移**，不改逻辑）：
    - `useInput`：ctrl+c → abort + exit
    - `useScopedInput('repl')`：ctrl+o / esc / shift+tab / slash suggestions 上下/Tab
- ❌ 不做：
  - 不 render
  - 不直接调用 commandRegistry.dispatch（只操作 UI state / 调用 controller actions）

#### `transcript.tsx`
- ✅ 做：
  - 渲染：
    - `<Static key={transcriptSeq} items={[header, ...staticMessages]}>...`
    - transient messages（非 Static）
  - 保留“Header 作为 Static 第一个 item”的策略（避免 Static items 把消息刷到 header 上方）
- ❌ 不做：
  - 不做 suggestions
  - 不做 promptMode
  - 不做 overlay

#### `panels.tsx`
- ✅ 做：
  - `ExploreAgentsPanel`
  - `DetailedTranscriptPanel`
  - 以及相关 helper（`formatTaskPanelTitle/getTaskShortLabel/sumTokens/formatTokens/truncate`）
- ❌ 不做：
  - 不访问 controller refs
  - 不改动树状符号/文案（严格 copy）

#### `messageItems.ts`
- ✅ 做：
  - `deriveMessageItemDescriptors` 及 explore grouping helpers（纯函数）
- ❌ 不做：
  - 不 render

### controller/state 层（`src/features/repl/controller/*`）

#### `utils.ts`
- ✅ 做（纯函数集合）：
  - `isAbortLikeError`
  - `isExactSlashCommand` + `escapeRegex`
  - token/usage/duration 相关格式化：`sumInputTokens/formatTokens/formatDuration/parseBackgroundTaskId/parseTaskTranscript/...`
  - prompt 注入 helper：`buildModeInjectedBlocks/buildExitPlanInjectedBlocks/stripInjectedBlocksFromHistory/patchToolsForTurn`
- ❌ 不做：
  - 不使用 React hooks
  - 不读写 state/ref（由调用方传入数据）

#### `messages.ts`
- ✅ 做：
  - `isTransientMessage(m)` 判定逻辑（当前：running tool 或 isStreaming assistant）
  - `partitionMessages(messages)` → `{staticMessages, transientMessages}`
- ❌ 不做：
  - 不持有 React state

#### `overlays.ts`
- ✅ 做：
  - overlay manager (`createOverlayManager`) 与订阅
  - `closeAgentsDialog/closePermissionsDialog/closeHooksDialog`（append “dismissed” 文案保持一致）
  - agents wizard：`generateAgentDraft/saveAgentFromDialog`（包含 reloadSubagents、错误提示文案保持一致）
- ❌ 不做：
  - 不处理 streaming events
  - 不处理 send/LLM turn

#### `streaming.ts`
- ✅ 做：
  - `handleEvent` 的所有 event 分支（assistant_delta/thinking_delta/usage/tool_* /error/complete）
  - `flushAssistantBuffer`
  - tool 生命周期内容格式化（Task Done(...)、Skill summary hidden、Explore batch 完成提示）
- ❌ 不做：
  - 不直接调用 engine.runTurn
  - 不处理 /clear /compact（这些属于 send.ts）

#### `send.ts`
- ✅ 做：
  - `send(text, opts)` 的完整逻辑（保持行为）：
    - /clear（含 Static append-only 的 transcriptSeq remount + clear 顺序）
    - /compact（tools-free compact turn + rebuild history）
    - slash dispatch/consumed（ui effects：append/openOverlay/closeOverlay/toast；model effects 注入）
    - local_async 执行与 recordForNextTurn 注入
    - LLM turn 路径：system/user 构造、budget、prune、auto-compact、runTurn、historyRef 更新
- ❌ 不做：
  - 不定义 overlay UI
  - 不定义 Ink 渲染

## 边界规则（执行时当成守门员）

- `src/screens/repl/*`（纯 UI 子模块）不得 import `src/chat/*`/`src/core/*`/`src/adapters/*`；唯一例外是 `createReplCommandRegistry.ts`（wiring）。
- `src/features/repl/controller/*` 不得 import `ink`、`src/components/*`、`src/screens/*`（必要时只允许 `import type`）。
- REPL 渲染层与 controller 的唯一边界：`useReplController()` 返回的 `{state, actions}`；渲染层不读写 `historyRef/tool refs`，controller 不知道 Ink。

## Public API（拆分后必须保持不变）

- `src/screens/REPL.tsx` 仍对外导出 `MessageItemDescriptor` 与 `deriveMessageItemDescriptors`（测试依赖）。
- `src/features/repl/useReplController.ts` 仍对外导出 `useReplController(deps) -> {state, actions}`（外部调用不改）。

### 入口保持不变（对外 API 不变，摘录原文）

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

### 内部模块 API（供拆分使用，建议；不是硬要求）

#### `src/screens/repl/hotkeys.ts`

```ts
export function useReplHotkeys(args: {
  onExit?: () => void
  ensurePlanPath: () => string
  isPromptMode: boolean

  state: Pick<
    ReplControllerState,
    'isLoading' | 'thinkingText' | 'agentsDialogOpen' | 'permissionsDialogOpen'
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
  reloadSubagents?: () => Promise<Array<{ name: string; description: string }>>
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
    toolNameByIdRef: React.MutableRefObject<Map<string, string>>
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

### 按键序列速查（写回归测试时直接用）

- Up：`\u001B[A`
- Down：`\u001B[B`
- Left：`\u001B[D`
- Right：`\u001B[C`
- Tab：`\t`
- Enter：`\r`
- Esc：`\u001B`（注意：箭头序列也以 `\u001B` 开头，Esc 要单独发送）
- Backspace：测试里通常用 `\u007F`（或 `\b`，以现有测试基座为准）
- Delete：`\u001B[3~`

---

# Phase 0 — 测试先行：把“不可变行为”钉死

- [x] 0.1 扩展 input scope 导航键测试（30–45min）
  - 文件：`src/features/repl/inputScopeContext.test.tsx`
  - 内容：扩展现有 “routes navigation keys only to the active scope”，增加 `left/right/escape`；注意 Esc 与箭头序列都以 `\u001B` 开头，Esc 要单独发送。
  - 验收：`bun run test -- src/features/repl/inputScopeContext.test.tsx`
  - 回滚：仅测试文件，直接 revert。

- [x] 0.2 新增 TextInput 受控编辑回归测试（45–60min）
  - 文件：`src/components/ui/TextInput.test.tsx`（已存在，已补齐覆盖）
  - 覆盖：左右移动、backspace/delete、ctrl+u/ctrl+w、外部 value 变短 cursor clamp（避免闪屏/游标错位）。
  - 验收：`bun run test -- src/components/ui/TextInput.test.tsx`
  - 回滚：删新增文件。

- [x] 0.3 增强 controller：preferredSlashSpecId 透传（30–45min）
  - 文件：`src/features/repl/useReplController.test.tsx`
  - 内容：`send('/status', {preferredSlashSpecId})` → `commandRegistry.dispatch(_, { preferredSpecId })`；让 dispatch 返回 consumed effect，确保不走 `engine.runTurn`。
  - 验收：`bun run test -- src/features/repl/useReplController.test.tsx`
  - 回滚：回滚单个测试块。

- [x] 0.4 增强 controller：`/clear` 必须 bump `transcriptSeq`（30–45min）
  - 文件：`src/features/repl/useReplController.test.tsx`
  - 内容：`/clear` 前后断言 `transcriptSeq` 增加 1，且 `messages` 变为 `[]`。
  - 验收：同上
  - 回滚：回滚该断言即可。

- [x] 0.5 新增 REPL：slash suggestions 行为（45–60min）
  - 新增：`src/screens/REPL.slashSuggestions.test.tsx`
  - 目标（锁死交互）：
    - `/st` + Enter：补全到 `/status`，不 send
    - `/status` + ↓ + Enter：send 时携带 `preferredSlashSpecId`
    - `/st` + Tab：补全，不 send
  - 验收：`bun run test -- src/screens/REPL.slashSuggestions.test.tsx`
  - 回滚：删新增文件。

- [x] 0.6 增强 controller：running tool / streaming assistant 必须为 transient（30–45min）
  - 文件：`src/features/repl/useReplController.test.tsx`
  - 内容：模拟 `tool_start` 后该 Msg 必须在 `transientMessages`；`tool_end` 后进入 `staticMessages`（避免“running tool 塞进 Static 导致 tool_update 不刷新”的灾难性回归）。
  - 验收：`bun run test -- src/features/repl/useReplController.test.tsx`
  - 回滚：回滚单个测试块。

---

# Phase 1 — 拆 `src/screens/REPL.tsx`（先拆纯逻辑/纯 UI）

- [x] 1.1 新增 `src/screens/repl/messageItems.ts`，迁移 `deriveMessageItemDescriptors`（30–45min）
  - 文件：新增 `src/screens/repl/messageItems.ts`；修改 `src/screens/REPL.tsx`
  - 验收：`bun run test -- src/screens/REPL.deriveMessageItemDescriptors.test.ts`

- [x] 1.2 新增 `src/screens/repl/panels.tsx`，迁移 Explore/Detailed 面板（45–60min）
  - 文件：新增 `src/screens/repl/panels.tsx`；修改 `src/screens/REPL.tsx`
  - 约束：文案/树状符号/缩进严格 copy，不做“修文案”。
  - 验收：`bun run test -- src/screens/REPL.test.tsx`

- [x] 1.3 新增 `src/screens/repl/createReplCommandRegistry.ts`（30–60min）
  - 文件：新增 `src/screens/repl/createReplCommandRegistry.ts`；修改 `src/screens/REPL.tsx`
  - 内容：把 `useMemo(() => createSlashCommandRegistry({...}))` 原封不动搬出（只做 wiring，不 render）。
  - 验收：`bun run test -- src/screens/REPL.test.tsx`

- [x] 1.4 新增 `src/screens/repl/promptMode.ts`（30–45min）
  - 文件：新增 `src/screens/repl/promptMode.ts`；修改 `src/screens/REPL.tsx`
  - 内容：抽 `isPromptMode(state, userInput, toolRegistry)` 为纯函数（逻辑保持一致）。
  - 验收：`bun run test -- src/screens/REPL.test.tsx`

- [x] 1.5 新增 `src/screens/repl/hotkeys.ts`（45–60min）
  - 文件：新增 `src/screens/repl/hotkeys.ts`；修改 `src/screens/REPL.tsx`
  - 内容：逐行迁移现有键盘逻辑（ctrl+c、ctrl+o、esc、shift+tab、↑↓、Tab），不改行为。
  - 验收：全量 `bun run test` + 手动 smoke（见文末）

- [x] 1.6 新增 `src/screens/repl/transcript.tsx`（45–60min）
  - 文件：新增 `src/screens/repl/transcript.tsx`；修改 `src/screens/REPL.tsx`
  - 内容：抽 Static + transient 渲染；必须保留 “Header 作为 Static 第一个 item” 的策略（避免消息跑到 header 上方）。
  - 验收：`bun run test -- src/screens/REPL.test.tsx`

---

# Phase 2 — 拆 `src/features/repl/useReplController.ts`（先抽纯函数，再抽 hook 块）

- [x] 2.1 新建 `controller/utils.ts`，迁移纯 helper（30–60min）
  - 文件：新增 `src/features/repl/controller/utils.ts`；修改 `src/features/repl/useReplController.ts`
  - 内容：抽 `isAbortLikeError` / `isExactSlashCommand` / token&duration 格式化 / prompt 注入 helper 等；保持签名与行为。
  - 验收：`bun run test -- src/features/repl/useReplController.test.tsx`

- [x] 2.2 新建 `controller/messages.ts`，抽离 static/transient 分区（30–45min）
  - 文件：新增 `src/features/repl/controller/messages.ts`；修改 `src/features/repl/useReplController.ts`
  - 内容：`isTransientMessage` + `partitionMessages`（running tool/streaming assistant 必须在 transient，防止塞进 Static）。
  - 验收：`bun run test -- src/features/repl/useReplController.test.tsx`

- [x] 2.3 新建 `controller/overlays.ts`，抽 overlay manager + dialog actions（45–60min）
  - 文件：新增 `src/features/repl/controller/overlays.ts`；修改 `src/features/repl/useReplController.ts`
  - 内容：overlay manager 订阅、closeAgents/Permissions/Hooks、agents wizard（含 reloadSubagents）；文案保持一致。
  - 验收：`bun run test` + 手动打开/关闭 overlays 验证不抢键。

- [x] 2.4 新建 `controller/streaming.ts`，抽 `handleEvent` + `flushAssistantBuffer`（60min）
  - 文件：新增 `src/features/repl/controller/streaming.ts`；修改 `src/features/repl/useReplController.ts`
  - 内容：所有 streaming event 分支（assistant/thinking/tool/usage/error/complete）迁移；工具生命周期文案严格保持。
  - 验收：全量 controller tests + 手动触发一次 tool loop。

- [x] 2.5 抽离 send：先只搬 `/clear` 分支（45–60min）
  - 文件：新增/修改 `src/features/repl/controller/send.ts`、`src/features/repl/useReplController.ts`
  - 验收：`/clear` 相关 tests（含 transcriptSeq bump）+ 手动 `/clear` 不闪回。

- [x] 2.6 抽离 send：再搬 `/compact` 分支（60min）
  - 验收：controller tests + 手动 `/compact`。

- [x] 2.7 抽离 send：搬 slash consumed 分支（45–60min）
  - 目标：slash dispatch/consumed（ui effects、model effects）行为不变。
  - 验收：controller tests + REPL slash suggestion tests。

- [x] 2.8 抽离 send：搬 LLM turn（剩余主体）与 auto-compact（60min+，建议拆两条）
  - 风险：最大风险块（历史/上下文 meter/auto-compact）。
  - 验收：全量 controller tests + 全量 REPL tests + 手动多轮对话触发 auto-compact、/compact、/clear。
  - 回滚：一旦回归，优先 revert 最近拆分 commit（不要补丁式“修到过”为止）。

- [x] 2.9 `useReplController.ts` 收尾：变成“组合层”（30–45min）
  - 内容：只保留 state/refs 初始化 + 调用 overlays/streaming/send + abort + return `{state, actions}`；禁止顺手重命名/格式化。
  - 验收：`bun run test` + `bun run type-check`（原文写了 `bun run ui:boundaries`，需确认你项目里是否存在该脚本；没有就只跑 type-check/核心边界脚本）。

---

# 手动验收清单（每个 Phase 结束都要做）

1. 进入 REPL：header/Model/CWD 行是否一致
2. 输入普通文本 → Enter：assistant 输出样式 `⏺` 与前缀缩进是否一致
3. 输入 `/`：suggestions 是否出现；↑↓ 选择是否一致；Tab 补全是否一致
4. 输入 `/st` + Enter：是否补全到 `/status` 而非直接执行
5. `/agents` 打开 overlay 后：↑↓Tab 数字键 Esc 是否只作用于 overlay，不影响 REPL（REPL 不抢键）
6. tool 运行中（例如触发一个 Read/Task）：running tool 的 UI 是否能持续更新（说明它没被塞进 Static）
7. `/clear`：清屏后旧 transcript 不应闪回；新对话从干净 header 下开始

---

# 可选（不强制，但建议在 Phase 1/2 完成后做）

- [x] CODEMAP.md 增补“拆分后去哪改什么”（不改现有 heading/anchor）
  - REPL UI：`src/screens/repl/*`
  - controller：`src/features/repl/controller/*`

---

## 本 TODO 主动“降级/暂缓”的点（与原文一致，但在执行时要先确认）

- `bun run ui:boundaries`：原文提到该命令；如果你项目里没有这个 script，就不要硬加，改为跑 `bun run type-check` + 现有边界检查脚本。
