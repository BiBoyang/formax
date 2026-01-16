我看了 `对话.md` 里你最新这段需求：要我按 **PR0–PR4 分阶段**给出超细的 TODO（含真实路径 + 函数级 changeset），并补齐 **slash command frontmatter 字段对比表**、**Skill tool 的 <available_skills> 生成规则**、**可复用模块**、以及 **后续高价值信息采集点**；同时约束是 **只支持 `.formax`，不做 `.claude` 兼容读取**，不确定点要标成 optional 且不要塞进第一阶段 DoD。

下面按你要的 5 项输出。

---

## 1) PR0–PR4 分阶段实施 TODO（真实路径 + 函数级 changeset）

> 目标对齐：
>
> - 统一 “文件型自定义 slash command” 的发现/元数据/渲染，现状有多处重复且路径还是 `.claude/commands`。例如 registry 里用 `loadClaudeCommandEntries` 读 `.claude/commands`；SlashCommand tool 也在 `.claude/commands` 下找文件。
> - Skill tool 目前 handler 直接报 “not implemented”；spec 也还是占位/偏 “OpenAI skills” 风格，需要改成 Claude Code 的 “programmatic invokables”。
> - `/agents` 目前 UI 层硬编码特判：`useReplController` 看到 `/agents` 就 `setAgentsDialogOpen(true)` 然后 return；但命令 registry 里 `/agents` 又被当作 built-in spec 存在——这就是“没有走统一命令管道”的典型。
> - subagents 读取逻辑还带 `.claude/agents` 兼容分支（你要求删除）。

---

### PR0 — 基础设施：统一 Frontmatter 解析 + “可调用项(invokables)” 数据结构（无行为变更）

**目标**
先把后续 PR1/PR2 会反复用到的底座抽出来：frontmatter 解析、提取首行描述、以及 invokable 的统一数据结构。PR0 尽量做到 “只新增，不改行为”。

**新增文件**

1. `src/shared/frontmatter.ts`

- `parseMarkdownFrontmatter(raw: string): { attributes: Record<string, unknown>; body: string } | null`
  - 实现可直接复用 `src/subagents/registry.ts` 的 `parseFrontmatter` + `parseSimpleYaml` 思路（它已能解析 YAML frontmatter）。

- `extractFirstMeaningfulLine(md: string): string`
  - 用于 “description 缺省时从正文第一行推导”。

2. `src/invokables/types.ts`

- `export type InvokableKind = 'command' | 'skill'`
- `export type InvokableScope = 'project' | 'user'`
- `export type InvokableMeta = { kind; scope; name; description; argumentHint?; disableModelInvocation?; sourcePath }`

3. `src/invokables/charBudget.ts`

- `truncateByCharBudget(items: string[], limit: number): { kept: string[]; truncated: boolean }`
  - 用于 PR2 的 `<available_skills>` 拼接，符合 Claude Code 的 “char budget 截断”机制（默认 15000）。

**修改文件（尽量不动行为）**

- （可选）不改现有调用点，只在 PR0 加单测，确保 parser 和 budget helper 稳。

**测试**

- `src/shared/frontmatter.test.ts`：覆盖
  - 无 frontmatter
  - 有 frontmatter（字符串、boolean、列表）

- `src/invokables/charBudget.test.ts`

**PR0 DoD**

- 新模块可用且有测试；不改现有 `.claude`/`.formax` 读取行为（真正切换放 PR1）。

---

### PR1 — 统一自定义命令 CommandStore：只读 `.formax/commands`（替换所有 `.claude/commands`）

**目标**

- 把 “自定义 slash command（文件命令）” 的发现逻辑收敛成一个 `CommandStore`，同时被：
  1. REPL 命令 registry（用于 `/foo` 触发）
  2. SlashCommand tool 的 `<available_commands>` + 具体执行
     共同复用。

- **强制只支持 `.formax/commands`**，移除 `.claude/commands` 读取与文案（你要求）。

#### PR1.1 新增 CommandStore

**新增文件**

1. `src/commands/store.ts`

- `export type CommandMeta = { name: string; scope: 'project'|'user'; filePath: string; description?: string; argumentHint?: string; disableModelInvocation?: boolean; hasDescriptionFrontmatter: boolean }`

- `export function createCommandStore(deps: { cwd: string; env: NodeJS.ProcessEnv; platform: NodeJS.Platform; homedir: () => string })`
  - 依赖 `getConfigPaths` 获取 `globalConfigDir`（避免硬编码 homedir；代码里已有 `getConfigPaths` 的使用范例）。

- `listAll(): CommandMeta[]`
  - 扫描：
    - `${cwd}/.formax/commands/**/*.md`
    - `${globalConfigDir}/commands/**/*.md`

  - **递归扫描**（修复 registry 目前只读顶层 `.md` 的短板；现 `loadClaudeCommandEntries` 是 `readdir` 非递归）。
  - 命名规则：与 SlashCommand tool 当前逻辑对齐（支持子目录，用户级用 `user:` 前缀）。
    - 这点你现在的 SlashCommand tool 已经在 `listCustomCommands` 做了（prefix 机制 + relative path）。

- `resolve(name: string): CommandMeta | null`
  - 支持 `/user:xxx` -> global commands dir 查找（修复现 SlashCommandToolHandler “列得出 user 命令但执行不到”的隐性 bug：它执行时直接 `path.join(cwd,'.claude','commands', cmdName+'.md')`）。

- `readRaw(meta: CommandMeta): Promise<string>`

- `readBodyAndFrontmatter(meta): { attributes; body }` 复用 PR0 的 parser。

2. `src/commands/render.ts`

- `renderFileCommandPrompt(args: { commandName: string; commandText: string; argsText?: string }): string`
  - 把现有 `buildFileCommandContent` 抽出来复用（它已经提供 `<command-message>` + `<command-args>` 的标准格式）。

#### PR1.2 改 REPL 命令 registry 读 `.formax/commands`

**修改文件**

1. `src/features/commands/registry.ts`
   当前：`const pluginEntries = loadClaudeCommandEntries(deps.cwd)`
   改为：

- `const store = createCommandStore({cwd: deps.cwd, env: process.env, platform: process.platform, homedir: os.homedir})`
- 替换 `loadClaudeCommandEntries` -> `loadFormaxCommandEntriesFromStore(store)`
- `loadFormaxCommandEntriesFromStore`：对 `store.listAll()` 的每个命令生成 `SlashCommandSpec` 与 dispatch
  - spec.command：`/${meta.name}`（注意 meta.name 是否含 `user:`，保持一致）
  - spec.description：优先 frontmatter `description`；否则 fallback `extractFirstMeaningfulLine(body)`
  - spec.placeholder：来自 `argument-hint`（现 registry 已支持）。
  - dispatch：`kind: 'llm'`，blocks 用 `renderFileCommandPrompt`（替换原 `buildFileCommandContent`，或 registry 里直接 re-export 该函数）。

2. （可选重命名）把 `loadClaudeCommandEntries` 改名 `loadFormaxCommandEntries`，并移除 `.claude` 字面量。

#### PR1.3 改 SlashCommand tool：只读 `.formax/commands` 且复用 CommandStore

**修改文件**

1. `src/tools/modules/slashCommand/spec.ts`

- 把描述文案中 `.claude/commands` 与 `~/.claude/commands` 改为 `.formax/commands` 与 `~/.formax/commands`（或 `globalConfigDir/commands` 的表达）。目前 spec 明确写 `.claude/commands`。

2. `src/tools/modules/slashCommand/index.ts`

- 替换 `buildAvailableCommandsSection(process.cwd())` 里的硬编码 `.claude/commands` 逻辑为：
  - `const store = createCommandStore(...)`
  - `store.listAll()` -> 格式化为 markdown 列表

- 用 PR0 `extractFirstMeaningfulLine` 或 meta.description，不再自带 parseFrontmatter（减少重复）。

3. `src/tools/modules/slashCommand/handler.ts`

- `listCustomCommands`：替换 `.claude/commands` 路径为 `.formax/commands` + `globalConfigDir/commands`（用 `getConfigPaths`）
- `execute`：不再手工 `path.join(cwd,'.claude','commands',...)`
  - 改为：
    - `const meta = store.resolve(cmdName)`
    - `const raw = await store.readRaw(meta)`
    - `const { body } = parseMarkdownFrontmatter(raw) ?? { body: raw }`
    - `return { content: renderFileCommandPrompt({commandName: cmdName, commandText: body, argsText}) }`

**测试**

- `src/commands/store.test.ts`
  - project/user 两级目录
  - 子目录命名（如 `git/commit.md`）
  - `user:` 前缀可解析到 global dir

- `src/tools/modules/slashCommand/handler.test.ts`（最小覆盖：能执行 user 命令）

**PR1 DoD**

- 所有自定义命令**只从 `.formax`** 读取；代码/文案不再出现 `.claude/commands`。
- REPL `/foo` 与工具 `SlashCommand` 对同一文件产出一致 prompt（同一渲染函数）。

---

### PR2 — SkillRegistry + Skill tool：生成 `<available_skills>` + 可 invoke（命令 + skills）

Claude Code 的 Skill tool 要点（你要我落到规则与实现）：

- Tool 会把 “可用的 commands + skills 的 metadata” 注入上下文（name / arguments / description），并有默认 15000 字符预算，可用 `SLASH_COMMAND_TOOL_CHAR_BUDGET` 调整。
- Skill tool 只能调用：
  - 自定义命令（且需要 `description` frontmatter）
  - Agent Skills（禁用则用 `disable-model-invocation: true`）
  - **不包含内置 commands**。

- 技能的结构：**目录 + `SKILL.md` + 资源文件**。

#### PR2.1 新增 SkillRegistry（扫描 `.formax/skills/*/SKILL.md`）

**新增文件**

1. `src/skills/registry.ts`

- `export type SkillMeta = { name: string; scope: 'project'|'user'; dirPath: string; skillMdPath: string; description: string; disableModelInvocation: boolean; argumentHint?: string }`
- `createSkillRegistry(deps: { cwd; env; platform; homedir })`
  - 扫描：
    - `${cwd}/.formax/skills/*/SKILL.md`
    - `${globalConfigDir}/skills/*/SKILL.md`

  - 读取 `SKILL.md`：
    - frontmatter `disable-model-invocation`（默认 false）
    - `description`（优先 frontmatter；否则正文首行）

- `list(): SkillMeta[]`
  - **去重/覆盖策略**：同名 skill project 优先覆盖 user（建议；这块 Claude 文档没明确写覆盖规则，属于我们设计——但可 deterministic）。

- `get(name, scope?): SkillMeta | null`

#### PR2.2 新增 “Invokables 汇总器”（commands + skills）

**新增文件** 2) `src/invokables/registry.ts`

- `createInvokableRegistry({ commandStore, skillRegistry })`

- `listAvailableForSkillTool(): InvokableMeta[]`
  - 过滤规则（与 Claude doc 对齐）：
    - **命令**：必须 `hasDescriptionFrontmatter===true`（不要用“首行 fallback”冒充），并且 `disable-model-invocation !== true`。
    - **技能**：`disable-model-invocation !== true`。
    - built-in commands：天然不在文件系统扫描范围，因此自动排除（符合 doc）。

  - 排序建议（deterministic，便于测试与 diff）：
    1. kind：command 在前，skill 在后
    2. scope：project 在前，user 在后
    3. name：localeCompare

- `formatAvailableSkillsSection({ metas, charBudget }): string`
  - 用 PR0 的 `truncateByCharBudget`
  - char budget 默认 15000，env 用 `SLASH_COMMAND_TOOL_CHAR_BUDGET`。

#### PR2.3 Skill tool spec：注入 `<available_skills>`

**修改文件**

1. `src/tools/modules/skill/spec.ts`

- 当前 spec/文案是 “OpenAI skills” 风格，且 input_schema 只有 `skill` 字段；需要改为 Claude Code 的语义：
  - “Invoke a custom slash command or Agent Skill programmatically.”
  - 在 description 中包含 `<available_skills> ... </available_skills>`，内容来自 invokableRegistry（命令与技能合并）。

> **input_schema 设计建议（第一阶段最稳）**：保持 `{ skill: string }` 这个字段名不动，避免改动 tool plumbing；但语义上允许传入 **“列表里展示的 name + 可选参数”**。
>
> - 例：`skill: "/review-pr 123"` 或 `skill: "deploy staging"`
> - Handler 内部再解析成 `name` + `argsText`。
>   这块 Claude 文档没有给出确切 JSON schema（属于不确定点），因此你要求 “不确定的点标 optional、不进第一阶段 DoD”，我们可以把 “未来 schema 改成 `{name, args}`”列为 optional。

2. `src/tools/modules/skill/index.ts`（如果当前没有就新增）

- 仿照 `src/tools/modules/slashCommand/index.ts` 的做法：把 baseSpec.description 里的 `<available_skills>` 替换成运行时生成的列表。
  - SlashCommand tool 已经这么做（buildAvailableCommandsSection）。

#### PR2.4 Skill tool handler：真正实现 invoke

**修改文件**

1. `src/tools/modules/skill/handler.ts`
   当前是直接返回 “Skill tool not implemented”
   改为实现：

- `execute(ctx, input)`：
  1. `strictInput` 取出 `skill` 字符串（仍用 `requirePlainObject/assertNoExtraKeys` 这一套）。
  2. parse：
     - `raw = input.skill.trim()`
     - `const [firstToken, ...rest] = splitOnWhitespacePreservingQuotes(raw)`（可选简单版：以第一个空格切分）
     - `name = firstToken`，`argsText = rest.join(' ').trim()`

  3. 分发：
     - `name.startsWith('/')` → 当作 file command：走 `CommandStore.resolve(nameWithoutSlash)` + `renderFileCommandPrompt`
     - 否则 → 当作 skill：走 `SkillRegistry.get(name)`，读取 `SKILL.md` body，拼接 `<skill-message>` 头 + args

  4. 禁用检查：
     - meta.disableModelInvocation 为 true → 返回可读 error（或空列表）

  5. 返回纯文本 `ToolResult`（内容内最好包含与 SlashCommand tool 一致的 `<command-message>` 风格提示，以便模型稳定理解；这是实现细节，不影响外部 API）

**测试**

- `src/tools/modules/skill/handler.test.ts`
  - invoke `/cmd args` 会读 command file 并渲染 prompt
  - invoke `skillName args` 会读 `SKILL.md` 并渲染 prompt
  - `disable-model-invocation: true` 会被过滤且 invoke 时拒绝

- `src/tools/modules/skill/index.test.ts`
  - `<available_skills>` 拼接、排序、预算截断（小 budget 下 deterministic）

**PR2 DoD**

- Skill tool `<available_skills>` 里同时出现 “file commands + skills”，过滤/预算符合 doc；并且 invoke 可工作。
- **不包含** optional：复杂参数解析、allowed-tools enforcement、context:fork/agent/hook/model 等高级 frontmatter 行为（这些都放后续 PR4+）。

---

### PR3 — `/agents` 走命令管道 + 删除 `.claude/agents` 兼容读取

**目标**

- `/agents` 不再由 UI 层硬编码特判（目前 `useReplController` 直接打开 dialog）。
- subagent registry 删除 `.claude/agents` fallback（你要求只支持 `.formax`）。

#### PR3.1 `/agents` 变成 built-in dispatcher（UI effect）

**修改文件**

1. `src/features/commands/registry.ts`

- 目前 built-in 里已经有 `/agents` spec，但没有 dispatcher（所以 UI 才特判）。
- 新增：
  - `byCommand.set('/agents', { spec: ..., dispatch: () => ({ kind: 'ui', effect: { type:'openOverlay', overlay:'agents' } }) })`
  - 或者如果你不想扩 `SlashCommandEffect`，也可以把 `/agents` dispatch 成 `kind:'local'` 输出一个 “打开 Agents 面板” 的指令，让 UI 层识别；但我更建议显式加一个 `kind:'ui'`（清晰、可测）。

2. `src/features/repl/useReplController.ts`

- 删除 `/agents` 的 hardcode 分支（`isExactSlashCommand(text,'/agents') ... setAgentsDialogOpen(true)`）。
- 改成统一处理 `slashEffect.kind === 'ui'`：
  - `openAgentsDialog()`（或 `overlayManager.open('agents')`）

  3)（可能需要）`src/features/repl/replUiContext.ts` / AgentsDialog 组件

- 把 open/close 状态从局部 boolean 迁移到统一 effect/overlay manager。

#### PR3.2 subagents registry 删除 `.claude` 兼容读取

**修改文件**

1. `src/subagents/registry.ts`

- 当前明确写了：`.formax/agents`、`~/.formax/agents`，还会兼容读取 `.claude/agents`
- 删除 `.claude/agents` 那段路径与扫描分支
- 同步更新相关注释/日志/错误提示

**测试**

- `src/subagents/registry.test.ts`：确保不会去读 `.claude/agents`（可用临时目录断言不访问）
- `src/features/commands/registry.test.ts`：dispatch `/agents` 返回 `kind:'ui'`
- `src/features/repl/useReplController.test.ts`：输入 `/agents` 触发 overlay，而不是字符串特判

**PR3 DoD**

- `/agents` 完全由命令系统驱动，UI 不再 hardcode。
- 不再读取 `.claude/agents`。

---

### PR4 — 清理/固化边界：移除 feature flags + 全仓禁止 `.claude` 读取 + 文档对齐

**目标**

- 把 “只支持 `.formax`”固化成 CI/脚本级 guardrail
- 把 PR0/PR2 里标记 optional 的能力分门别类推进（但不强制全做完）

#### PR4.1 禁止 `.claude` 目录读取（代码层面）

**新增文件**

- `scripts/check-no-claude-paths.ts`
  - 扫描 `src/**`：禁止出现 `'.claude'` / `'~/.claude'` / `path.join(...,'.claude',...)` 等字面量
  - 允许在 docs 或 “Claude Code guide” agent 文档中出现（若你们确实要保留 Claude Code 说明），但 **runtime 代码禁止**。

**修改文件**

- `package.json` scripts：在 `test` 或 `type-check` 前加 `node scripts/check-no-claude-paths.ts`
  - repo 里已经强调 “type-check + core boundary checks”，这里顺手加一条是合理的。

#### PR4.2 移除临时 feature flags（如果 PR0/PR2 引入过）

- 列出并删除：
  - `FORMAX_ENABLE_SKILL_TOOL_V2`（假如你为了灰度引入）
  - `FORMAX_ENABLE_COMMAND_STORE`（假如你为了灰度引入）

- 简化分支：只保留 `.formax` 路径

#### PR4.3 文档与提示文案对齐

**修改文件（视你们想保留 Claude Code guide 的程度）**

- `CLAUDE.md`、或任何 “如何放 commands/skills” 的说明：把 `.claude/commands`/`.claude/skills` 改为 `.formax/commands`/`.formax/skills`（至少在 Formax 用户文档里必须对齐）。
- Tool spec 文案里出现的 `.claude/*` 已在 PR1/PR2 改；PR4 做全面 grep 收尾。

#### PR4.4 optional 高级能力（明确标记为可选项，不进 PR1/PR2 DoD）

- **allowed-tools enforcement**：把 frontmatter `allowed-tools` 透传到 tool policy（需要对齐 policy 引擎，成本高）
- **context: fork + agent**：涉及子上下文/子 agent 执行语义（必须有 Claude Code 实测样本再做）
- **hooks**：需要生命周期事件系统（建议最后做）

**PR4 DoD**

- CI 能阻止 `.claude` 目录读取回归
- 文档/提示不误导用户
- optional 事项有清晰 backlog 与开关策略

---

## 2) Claude Code 自定义 slash command frontmatter 字段对比表（含最小子集）

> 你点名的字段：name / description / argument-hint / allowed-tools / model / temperature / disable-model-invocation…
> 我在你给的 Claude Code 文档切片里，明确看到的 frontmatter 字段是：`allowed-tools`、`argument-hint`、`context`、`agent`、`description`、`model`、`disable-model-invocation`、`hooks`。没有看到 `temperature` 字段；`name` 也不是 frontmatter 字段（命令名来自文件路径）。

| 字段                       | 类型（文档）            | 默认/缺省行为                                | 作用语义                                  | 对 Skill tool 的影响                                        | 第一阶段最小实现建议                                            |
| -------------------------- | ----------------------- | -------------------------------------------- | ----------------------------------------- | ----------------------------------------------------------- | --------------------------------------------------------------- |
| **(name)**                 | _不是 frontmatter 字段_ | 通常由文件路径决定（例如 `foo.md` → `/foo`） | 命令名/调用名                             | Skill tool 会引用这个名字                                   | ✅ 由文件路径派生即可                                           |
| `description`              | string                  | 文档写明是描述字段                           | 用于说明此命令做什么                      | **Skill tool 要求自定义命令必须有 description frontmatter** | ✅ **必须做**（否则无法进入 `<available_skills>`）              |
| `argument-hint`            | string                  | 可缺省                                       | 主要用于提示参数形态（autocomplete/展示） | 进入 `<available_skills>` 的 “arguments” 字段               | 🟡 建议做（成本低、提升体验）                                   |
| `allowed-tools`            | string                  | 可缺省                                       | 限制此命令执行期间可用的 tools            | 可能影响 “允许模型调用哪些工具”                             | ❌ 第一阶段不做（需要打通 policy/工具路由）                     |
| `model`                    | string                  | 可缺省                                       | 指定命令执行用的模型                      | 影响执行环境                                                | ❌ 第一阶段不做（不确定你们 engine 是否支持 per-command model） |
| `disable-model-invocation` | boolean                 | 默认 false                                   | 禁止模型通过 Skill tool 调用              | **Skill tool 需要过滤/拒绝**                                | ✅ **必须做**（至少对 skills 做；对 commands 也建议支持）       |
| `context`                  | string                  | 可缺省                                       | `fork` / 其它（文档提到 fork）            | 影响调用的上下文隔离                                        | ❌ optional（需要实测 Claude Code 语义）                        |
| `agent`                    | string                  | 与 `context: fork` 配合                      | 指定 fork 用哪个 agent                    | 影响执行 agent                                              | ❌ optional（同上）                                             |
| `hooks`                    | object                  | 可缺省                                       | 生命周期 hooks                            | 高扩展但引入全局事件系统                                    | ❌ optional（建议最后做）                                       |
| **(temperature)**          | _文档切片未出现_        | —                                            | —                                         | —                                                           | ❌ 标记为 optional（先不实现）                                  |

表格依据：Claude Code 文档切片中的 frontmatter 字段表。

---

## 3) Skill tool 的 `<available_skills>` 生成规则（排序/去重/merge/排除/budget）+ invoke 输出差异

### 3.1 数据来源与结构（按 `.formax` 映射）

Claude Code 文档定义：

- 自定义命令：单个 `.md` 文件，放在 `.claude/commands/` 或 `~/.claude/commands/`
- skills：目录 + `SKILL.md` + 资源

按你“只支持 `.formax`”的约束，Formax 映射为：

- commands：
  - project：`${cwd}/.formax/commands/**/*.md`
  - user：`${globalConfigDir}/commands/**/*.md`

- skills：
  - project：`${cwd}/.formax/skills/*/SKILL.md`
  - user：`${globalConfigDir}/skills/*/SKILL.md`

### 3.2 过滤规则（与 Claude Code 文档对齐）

在 Skill tool 的 `<available_skills>` 中只列入：

1. **自定义 commands**（文件命令）

- 必须存在 `description` frontmatter
- `disable-model-invocation !== true`（如你也支持对 command 禁用）

2. **Agent skills**

- `disable-model-invocation !== true`

3. **排除 built-in commands**

- 文档明确：built-in commands 不会出现在 Skill tool 可用项里
- 实现上：我们只扫 `.formax` 文件系统，因此天然不包含 built-in。

### 3.3 merge + 去重策略（建议 deterministic）

> 这块 Claude 文档没规定“同名覆盖规则”，因此属于我们实现策略。为了可预测和可测，我建议：

- **skills**：同名 skill 出现在 project 与 user 时，保留 project，丢弃 user（project 优先）。
- **commands**：
  - 如果你保留 `user:` 命名空间（你当前 SlashCommand tool 就是这么列 user 命令的），则不会同名冲突，无需覆盖；
  - 若未来想取消 `user:` 前缀，则同样可采用 “project 覆盖 user”。

### 3.4 排序规则（建议）

为了稳定 diff、稳定预算截断与可读性：

1. kind：commands 在前、skills 在后
2. scope：project 在前、user 在后
3. name：`localeCompare` 升序

### 3.5 字符预算（char budget）策略

Claude Code 文档给了明确机制：

- 默认预算 15000 字符
- 环境变量 `SLASH_COMMAND_TOOL_CHAR_BUDGET` 可改
- 预算计算包括：name / arguments / description

实现建议（deterministic）：

- 先把每条格式化成单行字符串（含 name、arg hint、description），再按顺序累加长度直到超过预算；超过则截断。
- 截断后可以在 section 末尾加一行提示（不一定要，但有助调试）：
  - `… (truncated: N items omitted due to char budget)`

- 预算计算以 JS `string.length` 为准即可（符合 doc 的 “character budget”）。

### 3.6 `<available_skills>` 的格式建议

文档没强制具体格式（只说 metadata 会被放进上下文），所以这里是实现建议：

```text
<available_skills>
/commit — Create a commit message (args: [scope])
/review-pr — Review a PR (args: [pr-number])
deploy — Deploy service (args: [env])
</available_skills>
```

- 规则：
  - commands 名字带 `/` 前缀
  - skills 名字不带 `/`
  - args hint 来自 `argument-hint`（没有则省略）

### 3.7 invoke 输出差异（调 custom slash command vs 调 skill）

这是你点名要我“澄清”的点（文档没写死，因此我们定义清晰的契约）：

#### A) 通过 Skill tool 调 **custom slash command（文件命令）**

**输出 = “等价于 SlashCommand tool 执行结果”**

- 返回 `<command-message>` + 渲染后的 command prompt（最好复用 `renderFileCommandPrompt/buildFileCommandContent`）
- 包含 `<command-args>`（如果传了 args），让模型理解参数

#### B) 通过 Skill tool 调 **skill（.formax/skills/\*/SKILL.md）**

**输出 = “skill 指令体 + 可选 args wrapper”**

- 返回类似：
  - `<skill-message>Executing skill: deploy</skill-message>`
  - `<skill-args>staging</skill-args>`（若有）
  - 然后拼接 `SKILL.md` 正文（去掉 frontmatter）

> 为什么要区分？
>
> - file command 的“语义单位”是 `/xxx` 的 prompt 模板；
> - skill 的“语义单位”是一个更长期/更系统的能力定义（目录 + SKILL.md + 资源）。

---

## 4) 可复用的现有模块/函数/逻辑（避免重写）

这里按“能直接复用/小改复用/建议抽到 shared”分级：

### 4.1 直接复用（几乎不改）

- `buildFileCommandContent(commandName, args, commandText)`
  - 已经把 “执行 header + args wrapper + 原始内容”做成统一格式，非常适合同时供：
    - REPL `/foo`（registry dispatch）
    - SlashCommand tool execute
    - Skill tool invoke(file command)

- `parseSlashCommand(input)`（命令 registry 里）
  - 已有 `/cmd args` 切分逻辑，可用于 Skill tool 的 `skill: "/cmd args"` 解析（至少第一阶段够用）。

### 4.2 小改复用（路径/依赖注入改一改就能用）

- SlashCommand tool 的 `listCustomCommands/findCommandFile` 思路
  - 递归扫描 + `user:` prefix 的命名策略都已有
  - 但需要：
    - `.claude` → `.formax`
    - `os.homedir()` → `getConfigPaths().globalConfigDir`
    - 执行路径从 `path.join(cwd,'.claude','commands',...)`改为 `findCommandFile/CommandStore.resolve`

### 4.3 建议抽到 shared（减少 parseFrontmatter 重复）

- `src/subagents/registry.ts` 的 frontmatter 解析与 YAML parser
  - 这套已经能 parse YAML frontmatter 并返回 body
  - 建议抽成 `src/shared/frontmatter.ts`，供 commands 与 skills 共同使用，避免你现在 slashCommand/index.ts、slashCommand/handler.ts 各自一份 parser。

### 4.4 现有架构缺口（PR1/PR2 需要补齐）

- Skill tool handler 目前是 stub（必须实现）。
- Skill tool spec 目前语义与 Claude Code Skill tool 不一致（需要改）。

---

## 5) 后续 3–8 个“高价值采集建议”（降低不确定性）

这些是我建议你们在后续（PR2–PR4）做的“证据采集/行为对齐”，能显著减少返工：

1. **抓一份 Claude Code `--debug` 下 Skill tool 的实际 `<available_skills>` 展示文本**
   - 特别关注：条目格式（是否有分组/是否含 scope）、排序、args 展示、截断提示文案。

2. **抓 Skill tool 的真实 tool-call JSON schema**（Claude Code 实际发给模型的 input 结构）
   - 文档只描述了语义和 tool rule pattern（`Skill(commit)` / `Skill(review-pr:*)`）但没给 JSON schema；这决定你们是保留 `{skill: string}` 还是做 `{name, args}`。

3. **确认 user-level commands 的命名空间规则**
   - Claude Code 对 `~/.claude/commands` 的命令，是不是像你们现在这样用 `/user:xxx`？文档没写死，靠实测。
   - 这会影响去重/覆盖策略和用户体验。

4. **确认 skills 的命名规则是否允许子目录/命名空间**
   - 文档说 skills 是目录 + SKILL.md，但没写是否支持嵌套目录。实测决定你们 registry 的扫描深度。

5. **确认 `disable-model-invocation` 对 commands 与 skills 的一致性**
   - 文档说可通过 frontmatter 禁用；实测是否：
     - 仅影响 Skill tool（programmatic）
     - 是否也影响 `/help` 列表或 SlashCommand tool 列表

6. **确认 `allowed-tools` 的真实语义与 enforcement 层级**
   - 它到底是：
     - 仅影响模型在该命令执行期间“倾向使用工具”
     - 还是硬性 policy 限制（禁止 tool router）

   - 这决定 PR4 的实现成本与安全边界。

7. **确认 `context: fork` + `agent` 的行为**（optional 高级能力）
   - 是否创建新的子会话？是否共享上下文？
   - 如果要对齐 Claude Code，最好先有最小复现样本，再实现。

8. **测 char budget 截断边界**
   - 例如 budget=1000 时，Claude Code 是“整条截断”还是“部分截断”？是否加 warning？文档只说会截断并提示可用 env 调整。

---

如果你愿意，我也可以基于你们 repo 现状再补一份“`.claude` 字符串全仓 grep 的清单 + 每处迁移归属 PR（PR1/PR3/PR4）”，用来保证 PR4 的 guardrail 不会遗漏。
