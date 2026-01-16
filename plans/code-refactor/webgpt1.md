下面这份方案**完全基于你提供的两份 repomix 导出文本**来对标 Claude Code 的“架构形态”，并且**严格遵守**你的约束：只做 **`.formax`**（不引入 `.claude` 兼容层、不建议改名为 `.claude`），并且把不确定要不要做的能力放到“可选项”里，而不是强塞进必做计划。

---

## 1) 现状结构诊断（对标视角）

### 1.1 主要分层/边界/耦合问题（按严重度排序，P0 最严重）

1. **P0：`.claude` 目录硬编码仍在关键路径里（与“只做 .formax”直接冲突）**

   * REPL 的 slash command registry 仍从 `cwd/.claude/commands` 加载自定义命令（pluginEntries）。
   * `SlashCommand` 工具（给模型用的 tool）也从 `cwd/.claude/commands` 扫描，并且还用 `process.cwd()` 直接取 cwd（更难测、更难多 workspace）。
   * 系统 prompt/子代理 prompt 里也明确提到 “`.claude/ directory`”。
   * subagents 文档/架构说明里还写了“也支持 `.claude/agents` 兼容”。
     这一条如果不先清掉，你的“对齐 /commands、skills、/agents 且只做 .formax”的目标会持续被打断。

2. **P0：同一概念（自定义 slash commands）存在两套“发现/注册/执行”实现，重复且会漂移**

   * 用户输入侧：`src/features/commands/registry.ts` 用 `loadClaudeCommandEntries` + `buildFileCommandContent` 实现文件命令。
   * 模型 tool 侧：`src/tools/modules/slashCommand/index.ts` 自己扫描目录、列出命令；`handler.ts` 又自己读取文件并渲染结果。
     这会导致：同一个 `.md` 命令，**在 UI 里表现/在 tool 里表现**可能逐步不一致（字段、过滤、命名规则、排序、去重等）。

3. **P0：`/agents` 目前并非纯“命令系统”驱动，而是 REPL controller 的特殊分支**
   `useReplController` 在提交输入时先检查是否是 `/agents`，然后直接 `setAgentsDialogOpen(true)` 并 return，绕过统一的命令执行管线。
   结果是：未来再加类似“打开 UI flow 的命令”时，很容易继续堆 if/else。

4. **P0：skills 系统目前是“接口存在、能力缺失”状态**

   * Skill tool spec 里有 `<available_skills>` 占位符（意味着需要运行时补全），但当前实现并未补全。
   * `SkillToolHandler` 直接返回 `Error: Skill tool not implemented`。
     所以“skills”现在对齐不了 Claude Code 的形态（尤其是“模型可程序化调用 skills/commands”这一点）。

5. **P1：命令结果的“是否进入 messages / 是否持久化进模型上下文 / 是否仅 UI-only”没有一套显式契约**
   目前是靠 `SlashCommandEffect` 的 kind + controller 的分支逻辑来隐式表达。
   并且 local command 的“下一轮注入”是靠 `recordForNextTurn` + `buildLocalCommandInjectedBlocks` 拼 prompt block 实现（思路对，但缺少统一抽象）。

6. **P1：Ink `Static` 的 append-only 特性已在 repo 内被明确记录，但 overlay/panel 仍是“各自为政”**
   你们自己在 `docs/LEARNINGS.md` 里写了：`Static` 是 append-only，做“可关闭的对话框/面板”需要用 key binding 切换显示等方式。
   但现在 overlay（AgentsDialog / transcript panel / explore panel）还是多个 boolean scattered state（后续扩展会越来越难收敛）。

7. **P1：SlashCommand tool 的“cwd 注入”与“命令发现结果”存在隐式全局性**
   例如 `SlashCommand` tool module 在创建时用 `process.cwd()` 去扫命令目录。
   这对测试、对多 workspace roots（你们 REPL 里确实维护了 `workspaceRoots`）都是隐患。

8. **P1：命令与 agents 的边界不清：UI flow（AgentsDialog）不属于命令层，但命令需要能触发它**
   当前做法是 controller 特判 `/agents`，而不是命令系统返回一个 “open overlay” 的结果。

9. **P1：`.formax` 在 agents 上已“基本可用”，但文档/实现仍混入 `.claude`**
   架构文档写 subagents 从 `.formax/agents` 和 `~/.formax/agents` 加载，但也写支持 `.claude/agents`。
   你明确要求不要 `.claude` 兼容层，因此需要在实现/文档/prompt 三处一起收口。

10. **P2：对标 Claude Code 的“Skill tool = 统一的程序化调用入口”形态，Formax 目前还有一个独立的 SlashCommand tool**
    Claude 文档明确：Skill tool 会把可用 command 的 metadata 注入上下文，且 built-in slash commands 不可用；同时它也可调用 skills。
    Formax 现在既有 `SlashCommand` tool，又有未完成的 `Skill` tool，职责重叠且不一致风险高。

11. **P2：命令/技能/agent 的发现路径、命名规则、元数据字段缺少一套“统一 registry contract”**

* commands：两套 loader（features + tool）且 `.claude` 路径
* skills：没有 loader
* agents：有 registry/runner，但还带 `.claude` 影子

12. **P2：Claude 文档里 custom command frontmatter 支持很多字段（allowed-tools / argument-hint / context / agent / model / disable-model-invocation / hooks 等），Formax 目前并未形成可扩展映射**
    Claude custom command frontmatter 字段非常明确。
    Formax 当前 loader 侧重点是“读文件 + description + build content”，缺一层 “meta -> runtime policy”。

13. **P2：系统 prompt（以及子代理 prompt）仍以“Claude Code CLI”为中心叙述，和 Formax 自身产品概念容易混淆**
    例如 system prompt 写 “You are Claude Code…”；并且明确让它参考 `.claude/ directory`。

14. **P3：命令体系（/commands）对外能力不完整：缺少“可发现 / 可列出 / 可被 tool 调用的统一索引”**
    目前 /help 之类存在，但“对标 Claude 的可列出 metadata + budget + tool 可调用”还没打通。

15. **P3：从工程组织看，`features/` 下混了“应用层编排”和“领域规则”，缺少明确分层约束**
    AGENTS.md 描述了目录结构，但并没有把 commands/skills/agents 作为一级领域模块固定下来。

16. **P3：测试与边界检查已有一些机制（type-check + core boundary checks），但针对 commands/skills/agents 的边界规则尚未落地**
    `bun run type-check` 被描述为包含 “core boundary checks”。
    但目前这些检查显然没有阻止 `.claude` 混入 commands/agents/prompt 等关键路径。

---

### 1.2 依赖方向图（文字版）

#### 当前实际依赖（简化）

```
src/entrypoints/cli.tsx
  -> core/app/createApp
  -> legacy/runLegacyCli.tsx (组装：cfg + tools + subagents + engine)
     -> screens/REPL.tsx (Ink UI)
        -> features/repl/useReplController.ts
           -> features/commands/registry.ts
              -> 直接读文件系统 + 加载 cwd/.claude/commands (文件命令)
           -> chat/engine.ts (回合编排 + tool 执行)
           -> subagents/* (Task runner/registry)
        -> ui/AgentsDialog 等 overlay 组件
tools/modules/slashCommand/*
  -> 自己再读一次 cwd/.claude/commands (并且用 process.cwd)
tools/modules/skill/*
  -> stub：未实现
```

证据：REPL 入口依赖 features/commands/registry、useReplController 等。
`.claude/commands` 被 commands registry 与 SlashCommand tool 双重使用。

#### 目前的分层违例点（对标视角）

* **命令发现/元数据生成**不应该分散在“用户输入链路”和“tool 链路”两套实现里（现在是）。
* **UI flow 打开**不应该通过 controller 特判命令字符串（现在 `/agents` 是）。
* **skills**作为能力域目前是空壳：spec 有、handler 无。
* **.claude 残留**同时存在于命令、agents、prompt，破坏 `.formax` 单一约定。

---

## 2) 目标目录结构（给一棵树）

这里的“目标结构”我分两层给你：

* **用户可配置目录（`.formax/` 与 `~/.formax/`）**：对标 Claude 的 `.claude/*`，但严格改成 `.formax/*`
* **源码目录（`src/`）**：把 commands/skills/agents 三块收敛成明确的“应用层模块”，并给 REPL 提供统一接口

### 2.1 用户可配置目录（只做 `.formax`）

```
# 项目级（repo 内）
.formax/
  agents/
    <agent>.md
  commands/
    <command>.md
    <namespace>/
      <command>.md
  skills/
    <skill-name>/
      SKILL.md
      (可选) resources/...
      (可选) templates/...

# 用户级（home）
~/.formax/
  agents/
    <agent>.md
  commands/
    <command>.md
    <namespace>/
      <command>.md
  skills/
    <skill-name>/
      SKILL.md
```

#### 职责边界（每个目录一句话）

* `.formax/commands/`：**存放可复用的“文件型 slash command”提示词**（markdown + frontmatter）；**不做**可执行脚本入口（脚本应通过工具/skills 间接运行）。
  对标来源：Claude custom commands 存在 `.claude/commands`，支持嵌套目录形成命名空间。

* `.formax/skills/<name>/SKILL.md`：**存放可复用的技能包（一个“如何做”的标准作业程序）**；**不做**运行时代码插件机制（skills 应是内容/约束，而不是 JS 扩展点）。
  对标来源：Claude skills 是目录 + `SKILL.md`。

* `.formax/agents/`：**存放 subagent 定义（markdown + YAML frontmatter）**，由 Task(subagent) 体系加载；**不做**命令与技能的混杂存储。
  你们现状：subagents registry 从 `.formax/agents` 与 `~/.formax/agents` 加载（但需去掉 `.claude` 兼容）。

---

### 2.2 源码目标目录树（围绕 commands / skills / agents）

> 目标：让 **“命令解析/注册/执行”**、**“skills 发现/注册/执行”**、**“agents 加载/注册/与 Task 对接”**各自成为清晰模块，并由 REPL/controller 统一调度。

```
src/
  commands/
    types.ts                 # Command/CommandResult/Invocation 等契约
    parser.ts                # '/foo bar' -> {name,args,...}
    registry.ts              # 组合 builtin + file-commands
    store.ts                 # 从 .formax/commands + ~/.formax/commands 发现/加载
    render.ts                # file-command -> PromptBlock[] / tool-result text
    builtin/
      help.ts
      agents.ts              # 只返回 UI overlay effect，不直接操作 UI
      init.ts
      ...                    # 其它 builtin command
    index.ts                 # public re-export（给 repl/tools 用）
  
  skills/
    types.ts                 # Skill/SkillMeta/Invokable(共用抽象)
    store.ts                 # 从 .formax/skills + ~/.formax/skills 发现/加载
    registry.ts              # Skills 注册表（只管 skills）
    runtime.ts               # 给 Skill tool 使用：列出可用项/预算裁剪/执行入口
    render.ts                # SKILL.md -> tool-result text
    index.ts

  agents/
    types.ts                 # AgentDefinition/AgentMeta
    store.ts                 # 从 .formax/agents + ~/.formax/agents 读写
    registry.ts              # 内存 registry：merge builtin + user/project agents
    taskBridge.ts            # 与 Task(subagent) 对接：patch tool spec / resolve subagent_type
    ui/
      AgentsDialog.tsx       # UI 仅在 ui 子目录
      createAgentWizard.ts   # wizard flow
    index.ts

  repl/
    controller.ts            # REPL controller：输入->(commands|chat)->输出
    overlays/
      types.ts               # OverlayState 契约（避免散落 boolean）
      manager.ts             # open/close/toggle 的纯状态机
    injectedBlocks/
      localCommand.ts        # 统一 local command 注入（替换散落逻辑）

  tools/
    modules/
      skill/
        spec.ts              # 只负责 tool spec 文本（调用 skills/runtime）
        handler.ts           # 只负责 tool 调用适配（调用 skills/runtime）
      slashCommand/
        spec.ts              # (可选) 兼容保留：也调用 commands/store
        handler.ts
```

#### 目录职责边界（“做什么/不做什么”）

* `src/commands/`：
  **做什么**：命令的解析、注册、执行决策（UI-only / 本地输出 / 触发 LLM turn / 注入下一轮）。
  **不做什么**：不直接 import Ink 组件；不直接操作 React state；不直接执行 tools executor（只能产出“让模型去调用工具”的 prompt blocks）。

* `src/skills/`：
  **做什么**：skills 发现、注册、对 Tool 的 runtime 适配（列出可用项、执行 Skill tool 请求）。
  **不做什么**：不承担 UI；不执行任意脚本；只提供“技能内容 + 结构化包装”。

* `src/agents/`：
  **做什么**：agents 的文件读写与 registry、以及与 Task(subagent) 的桥接（tool spec patch、resolve）。
  **不做什么**：不把 agent 的 UI flow 逻辑塞进 registry（UI 放 `agents/ui`）。

* `src/repl/`：
  **做什么**：把“用户输入”路由成 `CommandResult` 或 chat turn；维护 overlay 状态；控制 Ink Static 与 overlay 的渲染边界。
  **不做什么**：不在 controller 里硬编码某个命令字符串（例如 `/agents`），而是依赖 CommandRegistry 返回 overlay effect。

---

### 2.3（可选项）哪些 Claude Code 能力不确定要不要做？

以下能力 Claude 文档有，但是否要做取决于你产品路线，我先不放进必做计划：

* **custom command frontmatter 的 `allowed-tools` 强约束**（Claude 有）

  * 👍 优点：能限制某些命令/skill 只能用特定工具，降低“万能脚本入口”风险
  * 👎 成本：需要把“工具 allowlist”做成可按 command/skill 临时切换的运行时策略（会触及 tool executor/context）
  * 决策问题：你是否希望 **每个 command/skill** 都能声明工具白名单并强制？

* **`context: fork` / `agent:` / `model:` 这类运行时切换**（Claude 有）

  * 👍 优点：更像 Claude Code（不同命令切子线程/指定 agent/model）
  * 👎 成本：会把会话管理、子线程、模型选择策略拉进 command runtime
  * 决策问题：Formax 是否要提供“命令级别切 agent/model/上下文 fork”，还是先只做“内容型命令/技能包”？

* **hooks（pre/post）**（Claude 有）

  * 👍 优点：高度可扩展
  * 👎 成本：会引入全局事件系统、配置、安全边界
  * 决策问题：你是否真的需要 hooks，还是先把 commands/skills/agents 三块对齐后再说？

---

## 3) 关键接口与边界契约（TypeScript 签名级别）

下面只给 **签名+注释**，不贴整段实现；并且刻意把“UI-only vs message-persisted”做成显式字段。

> 参考你们现状：`SlashCommandEffect` 已有 kind 概念；local command 注入也已有 `LocalCommandRecord -> buildLocalCommandInjectedBlocks` 的模式。我是在其基础上“抽象成统一 CommandResult 契约”。

### 3.1 Command / CommandRegistry / CommandResult

```ts
// src/commands/types.ts
import type { PromptBlock } from '../prompts/types'
import type { Msg } from '../components/tool/ToolMessage'
import type { OverlayState } from '../repl/overlays/types'

export type CommandName = `/${string}` // 支持 /foo 以及 /ns:foo（解析时生成）
export type CommandScope = 'builtin' | 'project' | 'user'

export type CommandInvocation = {
  raw: string              // 原始输入（含 / 前缀）
  name: CommandName        // 规范化后的命令名（含命名空间）
  argsText: string         // 原始参数字符串
  argv: string[]           // 可选：tokenized（用于复杂参数）
  source: 'user' | 'tool'  // 为将来 Skill tool 复用做准备
}

export type CommandMeta = {
  name: CommandName
  description: string
  scope: CommandScope
  sourcePath?: string // file command 的真实路径（用于调试/跳转）
  argumentHint?: string
  disableModelInvocation?: boolean // 对标 Claude: disable-model-invocation
}

export type UiAppendTarget = 'static' | 'transient'

export type UiEffect =
  | { type: 'none' }
  | { type: 'appendMessages'; target: UiAppendTarget; messages: Msg[] }
  | { type: 'openOverlay'; overlay: OverlayState }
  | { type: 'closeOverlay'; overlayId?: OverlayState['id'] }
  | { type: 'toast'; message: string }

export type ModelEffect =
  | { type: 'none' }
  // 仅注入下一轮用户正常输入（对标你们 localCommandRef / recordForNextTurn）
  | { type: 'injectNextTurn'; blocks: PromptBlock[] }
  // 立刻触发一轮 LLM turn（对标 SlashCommandEffect.kind === 'llm'）
  | { type: 'runTurn'; blocks: PromptBlock[]; loadingText?: string }

export type CommandResult = {
  consumed: boolean            // true 表示输入被当作命令消费，不再作为普通聊天文本
  ui: UiEffect                 // UI-only 的副作用在这里
  model: ModelEffect           // 是否进入模型上下文/是否触发 turn 在这里
  // 可选：用于 telemetry/debug
  debug?: Record<string, unknown>
}

export type CommandContext = {
  cwd: string
  // domain services
  agents: import('../agents').AgentRegistry
  skills: import('../skills').SkillRegistry
  // repl hooks
  overlays: import('../repl/overlays/manager').OverlayManagerApi
  // 允许命令请求“下一轮注入”，但不让命令直接碰 historyRef
  injectNextTurn: (blocks: PromptBlock[]) => void
}

export interface Command {
  meta: CommandMeta
  execute(inv: CommandInvocation, ctx: CommandContext): Promise<CommandResult>
}

export interface CommandRegistry {
  refresh(): Promise<void>                 // 重新扫描 file commands
  list(): CommandMeta[]                    // 给输入提示/给 Skill tool runtime 用
  match(input: string): CommandInvocation | null
  execute(inv: CommandInvocation, ctx: CommandContext): Promise<CommandResult>
}
```

**关键点：**

* **UI-only vs message-persisted**：

  * UI-only：`ui=openOverlay`、`model=none`
  * 本地输出且不进模型：`ui.appendMessages(static)` + `model=none`
  * 本地输出但要影响下一轮模型：`model=injectNextTurn`（对标你们现状的 local command 注入）
  * 触发 LLM turn：`model=runTurn`（对标现有 `SlashCommandEffect.kind === 'llm'`）

---

### 3.2 Skill / SkillRegistry / SkillRuntime（以及与 SlashCommand 的最小共用抽象）

Claude 文档里，**Skill tool**用于“程序化调用 slash command 或 skill”，并且会把可用项 metadata 注入上下文（有字符预算），built-in slash commands 不可用。

我们做一个最小共用抽象：`Invokable`（可被 Skill tool 调用的东西）= file-based command + skill。

```ts
// src/skills/types.ts
export type InvokableKind = 'command' | 'skill'
export type InvokableScope = 'project' | 'user'

export type InvokableMeta = {
  kind: InvokableKind
  name: string              // command: '/ns:foo'  skill: 'code-review'
  description: string
  scope: InvokableScope
  argumentHint?: string
  disableModelInvocation?: boolean
  sourcePath?: string
}

export type InvokableInvokeArgs = {
  name: string
  arguments: string
}

export type InvokableResult = {
  // Tool result 一定得是字符串（最终变成 tool_result content）
  toolResultText: string
  // 可选：如果你也想支持“用户输入 /skill xxx”这种，能复用 PromptBlock
  promptBlocks?: import('../prompts/types').PromptBlock[]
}

export interface Skill {
  meta: InvokableMeta & { kind: 'skill' }
  // 读取 SKILL.md + 可选 resources，渲染成 toolResultText
  invoke(args: InvokableInvokeArgs, ctx: SkillRuntimeContext): Promise<InvokableResult>
}

export interface SkillRegistry {
  refresh(): Promise<void>
  list(): Array<Skill['meta']>
  get(name: string): Skill | null
}

export type SkillRuntimeContext = {
  cwd: string
  // 可选：用于限制读取资源大小/扩展名
  readFileText: (absPath: string) => Promise<string>
}

export interface SkillRuntime {
  // 供 tool spec patch 使用：替换 <available_skills>
  listInvokablesForTool(): InvokableMeta[]  // = skills + file-commands（排除 builtins）
  // 供 tool handler 使用
  invoke(args: InvokableInvokeArgs, ctx: SkillRuntimeContext): Promise<InvokableResult>
}
```

**最小共用抽象怎么落地？**

* `SkillRuntime.listInvokablesForTool()` =

  * `SkillRegistry.list()`（skills）
  * `CommandStore.listFileCommands()`（文件命令）
  * **明确排除 built-in commands**（对标 Claude 的限制）

---

### 3.3 AgentStore / AgentRegistry（从 `.formax/agents` 读取 + 运行时对齐 Task）

你们当前的 subagent 体系：registry/runner + Task tool presenter 等已经存在，且 `.formax/agents` 路径是主路径（但需要去掉 `.claude/agents` 的兼容影子）。

```ts
// src/agents/types.ts
export type AgentScope = 'builtin' | 'project' | 'user'

export type AgentDefinition = {
  name: string
  description?: string
  tools: string[]           // allow-list（你们已有概念）
  model?: string
  color?: string
  systemPrompt: string      // markdown body
  scope: AgentScope
  sourcePath?: string
}

export type AgentMeta = Pick<AgentDefinition, 'name' | 'description' | 'scope' | 'sourcePath'>

export interface AgentStore {
  refresh(): Promise<void>
  list(): AgentMeta[]
  get(name: string): AgentDefinition | null

  // 可选：由 AgentsDialog / wizard 调用
  save(def: Omit<AgentDefinition, 'scope'>, scope: Extract<AgentScope, 'project' | 'user'>): Promise<{ path: string }>
  remove(name: string, scope?: Extract<AgentScope, 'project' | 'user'>): Promise<void>
}

export interface AgentRegistry {
  refresh(): Promise<void>
  list(): AgentMeta[]
  get(name: string): AgentDefinition | null

  // 给 Task tool patch 用：生成 subagent_type enum + descriptions
  listAllowedSubagents(): Array<{ name: string; description: string }>
}
```

---

### 3.4 REPL/controller 与 UI overlay/panel 的契约（避免 Ink Static append-only 的坑）

你们 repo 明确记录了 Ink Static append-only 的坑。
因此“overlay/panel”必须是**独立于 Static 消息流**的一块可开关渲染区域。

```ts
// src/repl/overlays/types.ts
export type OverlayState =
  | { id: 'agentsDialog' }
  | { id: 'detailedTranscript'; messageId?: string }
  | { id: 'exploreAgents' }
  | { id: 'help' }
  // 未来扩展：settings、skills browser 等

// src/repl/overlays/manager.ts
export interface OverlayManagerApi {
  get(): OverlayState | null
  open(next: OverlayState): void
  close(id?: OverlayState['id']): void
  toggle(next: OverlayState): void
}

// src/repl/controller.ts
import type { Msg } from '../components/tool/ToolMessage'
import type { CommandRegistry } from '../commands/types'

export type ReplState = {
  // Ink Static 只渲染这些“已落盘/不会再变”的消息
  staticMessages: Msg[]
  // 可变消息（streaming、loading、临时提示）
  transientMessages: Msg[]
  overlay: OverlayState | null
  input: string
  mode: 'normal' | 'insert' | 'vim' // 你们已有 mode 概念
}

export interface ReplController {
  state: ReplState
  actions: {
    submit(text: string): Promise<void>
    abort(): void
    openOverlay(overlay: OverlayState): void
    closeOverlay(id?: OverlayState['id']): void
  }
}

export type ReplControllerDeps = {
  commands: CommandRegistry
  // chat engine/tool registry 等其它依赖...
}
```

**约束要点：**

* `Static` 只渲染 `staticMessages`；任何会变化的消息（streaming/临时）放 `transientMessages`。
* overlay 渲染区域只看 `state.overlay`，不把 overlay 塞进 Static。

---

## 4) 可执行迁移步骤（分阶段 PR / Checklist）

> 原则：每个 PR 都能单独合并；每步都以“先建新接口 → 加适配层 → 迁移调用点 → 删除旧代码”为主线。

下面的验证命令引用你们仓库已有指引：

* `bun run dev` / `npm run dev` 启动 REPL
* `bun run type-check` / `npm run type-check`
* `bun run test` / `npm test`

---

### PR0 — 建立“统一契约层”：CommandResult + OverlayManager（不改行为）

**目标（一句话）**
把“命令的输出语义（UI-only vs message-persisted）”和“overlay 状态”变成显式契约，但暂时仍走旧实现，确保无行为变化。

**改动范围（目录/文件）**

* 新增：`src/commands/types.ts`、`src/repl/overlays/{types,manager}.ts`、`src/repl/controller.ts`（或先放在 features/repl 下也可，后续再挪）
* 轻改：`src/features/repl/useReplController.ts`（仅接入契约/适配）

**迁移步骤（Checklist）**

* [ ] 新建 `src/commands/types.ts`：定义 `CommandResult / UiEffect / ModelEffect`（见第 3 节签名）。
* [ ] 新建 `src/repl/overlays/types.ts` 与 `manager.ts`：实现纯状态机（open/close/toggle）。
* [ ] 在 `useReplController` 内部引入 `OverlayManager`：

  * 初期仍使用现有 boolean state，但同时维护一个 `overlay`（双写），先不删旧 state。
* [ ] 写一个适配器：`legacySlashEffectToCommandResult(effect: SlashCommandEffect): CommandResult`

  * 将现有 `SlashCommandEffect.kind` 映射到 `ModelEffect`（`llm => runTurn`，`local => injectNextTurn/none`）。
* [ ] controller 里原本 switch `slashEffect.kind` 的地方，改为 switch `CommandResult.model`（但输出一致）。
* [ ] 保留原逻辑：`recordForNextTurn` 仍可用（先不动），只是通过 `injectNextTurn` 包一层转发（为后续统一注入做准备）。

**DoD（验收标准）**

* 现有 slash commands（builtin + file command + local commands）行为不变
* `/agents` 仍然能打开 AgentsDialog（暂时还可以保持 special-case）

**验证命令**

* `bun run type-check`（或 `npm run type-check`）
* `bun run test`（或 `npm test`）
* 手动：`bun run dev`（或 `npm run dev`）进入 REPL

**风险点 & 回滚策略**

* 风险：映射适配器漏掉某些 kind（如 debug/unimplemented）
* 回滚：只回滚 controller 的 switch 改动（PR0 的新增文件可以保留，不影响运行）

---

### PR1 — `/commands` 对齐：统一 CommandStore，迁移到 `.formax/commands`（同时给 Tool 复用）

**目标（一句话）**
让“文件型 slash commands”的发现/解析/元数据生成只有一套实现，并且目录从 `.claude/commands` 迁移为 `.formax/commands`（项目 + 用户）。

**改动范围**

* 新增：`src/commands/store.ts`、`src/commands/render.ts`、`src/commands/parser.ts`
* 修改：`src/features/commands/registry.ts`（或迁入 `src/commands/registry.ts`）
* 修改：`src/tools/modules/slashCommand/index.ts`、`handler.ts`
* 修改：所有提到 `.claude/commands` 的字符串/文档片段（至少 tool spec 示例要改）

**迁移步骤**

* [ ] 新建 `CommandStore`：

  * 输入：`cwd` + `getConfigPaths`（用于 globalConfigDir）
  * 搜索路径：

    * 项目级：`path.join(cwd, '.formax', 'commands')`
    * 用户级：`path.join(globalConfigDir, 'commands')`
  * 递归扫描 `.md` 文件：把嵌套目录转换成命名空间（`dir/sub.md` => `/dir:sub`），**复用你们现有 `loadClaudeCommandEntries` 的命名规则**（它就是这么做的）。
* [ ] 把 `loadClaudeCommandEntries` 重命名/替换为 `loadFormaxCommandEntries`（实现委托给 `CommandStore`）。
* [ ] 在 `createSlashCommandRegistry` 里：

  * 把 `loadClaudeCommandEntries(path.join(cwd, '.claude', 'commands'))` 改为 `.formax/commands` + user commands。
* [ ] 把 `SlashCommand` tool module 的发现逻辑改为使用同一个 `CommandStore`：

  * 移除 `process.cwd()`，改成从 tool 的 runtime ctx 传 `cwd`（或在 module factory 里接收 `cwd`）。
  * tool spec 里的示例路径从 `.claude/commands/foo.md` 改为 `.formax/commands/foo.md`。
* [ ] `SlashCommand` tool handler：不再自己直接读 `.claude/commands`，而是 `CommandStore.get(name)` + `render.ts` 生成 toolResult。
* [ ] 写“断言式”回归测试：

  * 给一个临时测试目录，放 `.formax/commands/a/b.md`，断言被发现为 `/a:b`，并且 description/frontmatter 可读。
* [ ] 全 repo grep `.claude/commands`：必须为 0（这是硬 DoD）。

**DoD**

* 自定义命令从 `.formax/commands` 生效（REPL 输入提示 + 执行）
* `SlashCommand` tool 的 Available Commands 列表来自 `.formax/commands`
* 代码里不再出现 `.claude/commands` 路径

**验证命令**

* `bun run type-check` / `npm run type-check`
* `bun run test` / `npm test`
* 手动用例：

  1. 新建 `.formax/commands/review.md`（带 description）
  2. `bun run dev` 进入 REPL
  3. 输入 `/review some-file` 观察是否进入 LLM turn 或输出提示（看你当前 file-command 的实现）

**风险点 & 回滚策略**

* 风险：用户原来放在 `.claude/commands` 的命令会失效（但这是你明确要的“只做 .formax”方向）
* 回滚：临时回滚到旧路径（不推荐）；更好的做法是提供一个一次性迁移脚本（复制 `.claude/commands -> .formax/commands`），但**不在运行时兼容读取**。

---

### PR2 — skills 对齐：实现 SkillRuntime + Skill tool（把 `<available_skills>` 真正补全）

**目标（一句话）**
把 skills 从“空壳”变为可发现/可注册/可被模型通过 Skill tool 程序化调用，并与 file-commands 共用 Invokable 抽象。

**改动范围**

* 新增：`src/skills/{store,registry,runtime,render,types}.ts`
* 修改：`src/tools/modules/skill/spec.ts`（替换 `<available_skills>`）
* 修改：`src/tools/modules/skill/handler.ts`（移除 not implemented）

**迁移步骤**

* [ ] 实现 `SkillStore`：

  * 扫描目录：`.formax/skills/*/SKILL.md` + `~/.formax/skills/*/SKILL.md`（对标 Claude 的结构，但换成 `.formax`）。
  * 提取 `name = skill folder name`，description 从 frontmatter 或首段摘要（你可选一种，先最简）。
* [ ] 实现 `SkillRegistry`：merge project + user，重名按 project 覆盖 user。
* [ ] 实现 `SkillRuntime`：

  * `listInvokablesForTool()` 返回：

    * skills
    * file-based commands（来自 `CommandStore`）
    * **不包含 built-in commands**（对标 Claude）。
  * 预算裁剪：先实现一个 `charBudget`（默认 15000，Claude 文档也提到了预算概念）。
* [ ] 修改 `Skill` tool spec：把 `<available_skills>` 替换成 runtime 输出的 metadata 列表。
* [ ] 修改 `SkillToolHandler.execute`：

  * 解析 input（你们 spec 当前是 `skill` 字段）。
  * `runtime.invoke({name,arguments})`
  * 返回 `toolResultText`（建议用类似 `<skill-name>` `<skill-message>` 标签，保持与 command 的 `<command-name>` `<command-message>` 风格一致）。
* [ ] 删除 `Error: Skill tool not implemented` 分支。
* [ ] 增加测试：

  * 给一个临时目录创建 `.formax/skills/code-review/SKILL.md`，断言被发现并出现在 tool metadata 中
  * handler 调用后返回不为 error

**DoD**

* Skill tool 不再返回 not implemented
* `<available_skills>` 会被替换为真实列表
* Skill tool 能调用：

  * 一个 skill
  * 一个 file-based command（可选，但推荐一起打通以减少工具碎片）

**验证命令**

* `bun run type-check` / `npm run type-check`
* `bun run test` / `npm test`
* 手动：创建 skill 后启动 REPL，问模型“请使用最相关的 skill 来做 X”，观察是否触发 Skill tool（需要你当前 system prompt 允许工具调用）

**风险点 & 回滚策略**

* 风险：tool description 变长导致 prompt 变重（预算裁剪可控）
* 回滚：保留 runtime，但 tool spec 暂时不注入（只影响模型调用的 discoverability）

---

### PR3 — `/agents` 收口：用 CommandResult 打开 AgentsDialog，去掉 controller 特判；同时清除 `.claude/agents`

**目标（一句话）**
让 `/agents` 成为一个真正的 command（返回 open overlay effect），并把 agents 路径彻底收敛到 `.formax/agents` + `~/.formax/agents`。

**改动范围**

* 修改：`src/features/repl/useReplController.ts`（移除 `/agents` 特判）
* 新增/修改：`src/commands/builtin/agents.ts`（返回 openOverlay）
* 修改：subagents registry/文档/legacy bootstrap 中任何 `.claude/agents` 提示
* 修改：prompt 中提到 `.claude/ directory` 的内容（至少与 commands/agents 相关的）

**迁移步骤**

* [ ] 新增 builtin command：`/agents`

  * `execute()` 返回：`ui=openOverlay({id:'agentsDialog'})`、`model=none`
* [ ] `useReplController.submit`：删除对 `/agents` 的字符串特判逻辑。
* [ ] REPL 层使用 `OverlayManager` 来渲染 AgentsDialog（overlay 统一口）
* [ ] subagents registry：移除 `.claude/agents` 兼容加载，并更新 CLAUDE.md/相关文档描述（当前还写着支持 `.claude/agents`）。
* [ ] 清理 prompt：把 “Reference ... `.claude/ directory`” 改为 `.formax/ directory`（至少对 commands/agents/skills 相关的 agent prompts）。

**DoD**

* `/agents` 输入不再被 controller 特判
* `/agents` 通过 CommandRegistry 执行，打开 AgentsDialog overlay
* 代码与 prompt/文档中不再出现 `.claude/agents`（或“支持 `.claude/agents`”之类描述）

**验证命令**

* `bun run type-check` / `npm run type-check`
* `bun run dev` / `npm run dev`
* 手动用例：

  1. 在 `.formax/agents/` 放一个 agent md
  2. REPL 输入 `/agents` 打开对话框，能看到该 agent
  3. 用 Task tool 运行该 agent（确保 `subagent_type` 可用）

**风险点 & 回滚策略**

* 风险：一些旧 prompt/文档仍指导用户用 `.claude/agents`
* 回滚：可先只改实现，文档/prompt 分 PR 跟进（但最好同 PR 或紧随其后）

---

### PR4 — 边界固化：去重工具入口 + 加上“硬规则”自动化检查

**目标（一句话）**
防止未来继续变乱：把 import 边界、`.claude` 残留、commands/skills 的权限边界做成可自动验证的规则。

**改动范围**

* 新增：`scripts/check-no-claude.ts`（或放到现有 boundary checks 体系里）
* （可选）新增：dependency-cruiser / eslint import 规则（看你们现有工具链）
* 修改：CI / type-check 脚本，把这些检查挂上去

**迁移步骤**

* [ ] 新增检查：**禁止任何 `.claude/` 字符串出现在 `src/` 与 docs/prompt 的关键区域**（至少 commands/skills/agents/prompt）。
* [ ] 新增检查：`src/commands/**`、`src/skills/**`、`src/agents/**` 不允许 import `src/ui/**`、`src/screens/**`。
* [ ] 新增检查：`src/commands/**` 不允许 import `src/tools/modules/**`（防止命令直接调用 tool 模块）。
* [ ] 把检查挂到 `bun run type-check`（你们已说明有 core boundary checks）。

**DoD**

* 合并后：新增命令/技能/agent 时，如果越界 import 会直接在 CI/本地 type-check 阶段失败
* `.claude` 目录约定在工程层面被“硬编码禁止”

**验证命令**

* `bun run type-check` / `npm run type-check`
* `bun run test` / `npm test`

**风险点 & 回滚策略**

* 风险：一次性加严格规则会导致大量既有越界被暴露
* 回滚：规则先以 warn 方式运行一段时间（可选）；或先只启用 `.claude` 禁止规则

---

## 5) 规则约束（防止未来继续变乱）

### 5.1 分层依赖硬规则（import 允许/禁止）

建议你把工程分成 5 层（从外到内）：

1. **UI 层**：`src/screens/**`, `src/components/**`, `src/ui/**`
2. **REPL/应用编排层**：`src/repl/**`, `src/features/**`
3. **领域模块层**：`src/commands/**`, `src/skills/**`, `src/agents/**`
4. **核心运行时层**：`src/chat/**`, `src/tools/executor/**`, `src/prompts/**`, `src/subagents/**`
5. **适配器/基础设施层**：`src/adapters/**`, `src/env/**`, `src/utils/**`

**硬规则：**

* 领域模块层（commands/skills/agents）**禁止** import UI 层（screens/components/ui）。
* commands/skills **禁止** import `src/tools/modules/**`（工具模块实现细节），只能依赖更稳定的 runtime/service 接口。
* `tools/modules/*` 作为“适配器层”，可以依赖 `skills/runtime`、`commands/store`，但要保持“薄”：**只做转换，不做业务决策**。
* `.formax` 路径只允许出现在 store/registry（commands/skills/agents 的存储层）与 configPaths 相关模块；禁止散落到 prompt/handler/组件里。

**最小成本落地方式（优先级从低到高）**

1. **脚本 grep 检查**：禁止 `.claude/` 字符串出现（超低成本，收益极大）。
2. **dependency-cruiser**（或你们现有 boundary checks 的配置扩展）：按目录模式限制 import。
3. ESLint `no-restricted-imports`（如果你们已有 eslint 再上）。

---

### 5.2 UI 组件分层规则（primitives vs domain UI vs flows）

* `src/components/ui/*`：纯 primitives（Text、Box、Input、Spinner 等），**不引入业务类型**（Command/Skill/Agent）。
* `src/components/*`：可复用展示组件（Message、ToolRouter…），可以依赖 `Msg` 等“中性类型”。
* `src/agents/ui/*`、`src/skills/ui/*`（如将来需要）：domain UI，允许依赖对应领域模块，但**不直接依赖 chat engine**。
* `src/repl/*`：flows（路由/状态机），可以把 command result 转成 UI 行为，但不要写 domain 规则。

---

### 5.3 `/commands` 与 tools 的边界（避免耦合）

**硬规则：命令不直接调用 tools executor。**

原因：一旦命令直接调 tools，就会出现两套权限/审批/审计链路（你们工具体系已经很复杂）。正确方式是：

* **LLM 型命令**（file command/builtin llm）：产出 `PromptBlock[]`，让模型通过 tool 调用去执行（这也是 Claude custom command 的方式）。
* **本地命令**（/help、/clear、/agents 等）：只产生 UI effect 或本地输出，不碰 tool。
* 如果确实需要“命令=一键执行 bash 并展示结果”，也应该走“模型调用 Bash tool”而不是命令直接 `child_process.exec`（除非你另开一个受控的本地执行能力，这属于新安全面）。

---

### 5.4 skills 的安全边界（防止 skills 变成“万能脚本入口”）

**推荐的硬边界（最小成本版）：**

1. skills 只允许从固定目录加载：`.formax/skills` 与 `~/.formax/skills`
2. Skill tool handler 只读取 `SKILL.md`（+ 可选 manifest），并对内容做大小限制（char budget）
3. skills 不执行任何 JS/TS/SH；skill 的作用是“把方法论/流程/模板提供给模型”，实际执行仍由模型调用工具完成（工具有你们现有的 policy/approval/audit 机制）

**可选加强（需要你决策）**

* 支持 `allowed-tools` 并在 skill 被调用后对“后续工具调用”做临时白名单约束（成本较高，需要动 tool executor 策略）。

---

### 5.5 建议增加哪些“边界测试/静态检查”（最少实现成本优先）

按性价比排序：

1. **`check-no-claude`**：

   * 检查 `src/`、`docs/`、`src/**/prompts` 中是否出现 `.claude/`
   * 一旦出现直接 fail（这能强力保证“只做 .formax”不会反复破功）

2. **`commands/skills/agents` 目录 import 边界检查**：

   * `src/commands/**` 不得 import `src/ui/**`、`src/screens/**`、`src/tools/modules/**`
   * `src/skills/**` 同理
   * `src/agents/**` 允许 import `agents/ui`（同域），但不得跨到全局 UI primitives 之外写业务逻辑

3. **store 扫描规则测试**（Vitest）：

   * commands：嵌套目录 => `/ns:cmd` 命名、重名覆盖、frontmatter parsing
   * skills：目录 => skill name，缺 SKILL.md 的处理
   * agents：frontmatter 失败时错误提示是否可定位（你们已有 frontmatter 相关测试经验）

---

### 最后：你当前的三个优先点，对齐结果会是什么样？

* **/commands**：一套 `CommandStore + CommandRegistry + CommandResult`，同时供 REPL 与 tools 使用，目录统一为 `.formax/commands`
* **skills**：一套 `SkillStore + SkillRuntime`，真正让 Skill tool 可用，并把 file-commands 作为 invokable 一并暴露（对标 Claude “programmatic invoke”形态）
* **/agents**：从“controller 特判”升级为“命令系统返回 overlay effect”，并与 Task(subagent) 的 enum patch 通过 `agents/taskBridge` 对齐

如果你照着 PR0→PR4 做，你会得到一个很清晰的可演进形态：
**REPL/controller 只做路由与状态机**；**commands/skills/agents 各自有 registry/store/runtime**；**tools/modules 退化为薄适配器**；并且 `.formax` 成为唯一配置约定。
