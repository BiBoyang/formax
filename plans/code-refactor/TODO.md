# Code Refactor TODO（/commands + skills + /agents，对标 Claude Code，`.formax` only）

本 TODO 参考了多份 WebGPT 回复（优先顺序见下）：

- **更推荐**：`plans/code-refactor/webgpt2.md`（更贴合当前仓库实现与真实坑位，细到函数级）
- 参考补充：`plans/code-refactor/webgpt2-other.md`（结构化更强，但部分内容更偏“理想目录树”）
- 结构蓝图：`plans/code-refactor/webgpt1.md`（把“契约层/目录树/边界规则/回滚策略”讲得更完整，但与当前代码贴合度略弱）

目标：先做 **可落地的结构收口**（减少重复实现/路径漂移），再逐步补齐能力。  
硬约束：**只做 `.formax`**，禁止任何 `.claude` 兼容读取逻辑（可以在文档里提 Claude，但 runtime 不读）。

---

## 0. 先达成共识（范围与不做项）

### 0.1 必做范围（本 TODO 覆盖）
- `/commands`（自定义文件命令）统一发现/解析/渲染，并迁移到 `.formax/commands`
- `SlashCommand` tool 与 REPL 命令执行复用同一套命令发现与渲染逻辑
- `Skill` tool 由空壳变可用：`.formax/skills/**/SKILL.md` 发现 + `<available_skills>` 注入 + invoke
- `/agents` 走命令管线（不再在 controller 特判），同时移除 `.claude/agents` 兼容路径
- 固化边界：禁止 `.claude` 在 runtime 代码中出现（脚本/检查挂入 type-check）

### 0.2 明确不做（放到 Backlog，除非你确认）
- `allowed-tools` 强制 enforcement（需要改 tool executor/policy，成本高）
- `context: fork` / `agent:` / `model:` / hooks（需要更多抓包与清晰语义）
- custom command 的 `$1/$2...` positional args（先只做 `$ARGUMENTS`；positional 作为可选）
- 运行时兼容读取 `.claude/*`（你明确不要）

---

## 1. 现状“硬冲突清单”（必须清零）

这些是当前仓库里仍出现 `.claude` 的位置（示例，后续做 grep 必须归零）：

- `src/features/commands/registry.ts`：`loadClaudeCommandEntries(deps.cwd)`
- `src/tools/modules/slashCommand/spec.ts`：文案包含 `.claude/commands/foo.md`
- `src/legacy/runLegacyCli.tsx`：注释/兼容 `.claude/agents`
- 以及若干 tests/docs/prompt：`rg -n \"\\.claude/\" src`

---

## 2. 里程碑拆分（PR0–PR4）

> 原则：每个 PR 都能独立合并、可回滚；每个 PR 都有 DoD + 验证命令。

---

## PR0 — 基础设施：统一 frontmatter 解析 + invokable 基本结构（尽量不改行为）

### 目标
减少重复 parser 漂移；为 PR1/PR2 的命令/技能扫描与预算裁剪提供共用底座。

### Checklist
- [x] 新增 `src/shared/frontmatter.ts`
  - [x] `parseMarkdownFrontmatter(raw): { attributes; body } | null`
  - [x] `extractFirstMeaningfulLine(md): string`（用于 description fallback）
- [x] 新增 `src/invokables/types.ts`
  - [x] `InvokableKind = 'command' | 'skill'`
  - [x] `InvokableScope = 'project' | 'user'`
  - [x] `InvokableMeta = { kind, scope, name, description, argumentHint?, disableModelInvocation?, sourcePath? }`
- [x] 新增 `src/invokables/charBudget.ts`
  - [x] `truncateByCharBudget(lines: string[], limit: number): { kept; truncated }`
  - [x] 约定默认 15000（与 Claude Code 逻辑对齐）
- [x] 写单测（Vitest）
  - [x] `src/shared/frontmatter.test.ts`
  - [x] `src/invokables/charBudget.test.ts`

### DoD
- [x] `bun run type-check` 通过
- [x] `bun run test` 通过（PR0 新增测试）
- [x] 不改现有 runtime 行为（仅新增/复用准备）

---

## PR1 — `/commands` 对齐：CommandStore 统一发现/解析/渲染（只读 `.formax/commands`）

### 目标
让“文件型自定义 slash commands”的发现/执行只有一套实现，并同时被：
- REPL（用户输入 `/foo`）
- `SlashCommand` tool（模型 programmatic 调用）
复用。

### 关键设计点（先固定）
- 命令目录：
  - project：`<cwd>/.formax/commands/**.md`
  - user：`<globalConfigDir>/commands/**.md`（由 `getConfigPaths()` 得到 globalConfigDir）
- 命名空间：`dir/sub.md` → `/dir:sub`
- 覆盖：project 覆盖 user（同名同 id）
- description：允许 frontmatter `description`，缺省时 fallback 首行（但 **是否暴露给 tool** 在 PR2 决策）

### Checklist
- [x] 新增 `src/commands/CommandStore.ts`
  - [x] 扫描 `.formax/commands` + `~/.formax/commands`（递归）
  - [x] 解析 frontmatter（复用 PR0 的 parser）
  - [x] 输出 `CommandMeta { id, scope, filePath, description, argumentHint, disableModelInvocation, hasDescriptionFrontmatter }`
  - [x] `resolve(id)`：以 `/dir:cmd` 的 `id` 作为唯一 key（暂不做 scope namespace）
- [x] 新增 `src/commands/render.ts`
  - [x] 统一 file command 的 “expanded prompt blocks” 生成逻辑
  - [x] 复用 `src/features/commands/registry.ts` 里原有的 `buildFileCommandContent()`（迁移后只保留一份）
- [x] 修改 `src/features/commands/registry.ts`
  - [x] 移除 `loadClaudeCommandEntries()`，改为 `CommandStore` 注入与使用
  - [x] built-in 命令仍保持（`BUILTIN_SPECS` 继续作为事实来源）
  - [x] file command 的 dispatch 复用 `src/commands/render.ts`
- [x] 修改 `src/tools/modules/slashCommand/index.ts`
  - [x] 运行时生成 “Available Commands” 列表改为使用 `CommandStore`
  - [ ] 移除 `process.cwd()` 依赖：module factory 传入 `cwd`（与 tool execution ctx 对齐）
- [x] 修改 `src/tools/modules/slashCommand/handler.ts`
  - [x] 不再自己扫描/拼路径读文件；改为 `CommandStore.get()` + `render.ts`
- [x] 全仓替换 `.claude/commands` → `.formax/commands`
  - [x] `src/tools/modules/slashCommand/spec.ts` 文案
  - [x] `src/features/commands/registry.test.ts` 等测试
- [x] 新增/更新测试
  - [x] `src/commands/CommandStore.test.ts`：
    - [x] 命名空间 `/dir:cmd`
    - [x] 覆盖规则 project > user
    - [x] description/frontmatter 解析
  - [x] `src/tools/modules/slashCommand/handler.test.ts`：确保 tool 执行走新路径

### DoD
- [x] `rg -n "\\.claude/commands" src` 结果为 0（runtime + tests）
- [x] `bun run type-check`
- [x] `bun run test`（PR1 相关测试集）
- [ ] 手动：
  - [ ] 在 `.formax/commands/hello.md` 写一个命令，REPL `/hello` 生效
  - [ ] `SlashCommand` tool 的 available 列表包含该命令

---

## PR0b — 统一“命令契约层”（CommandResult / UiEffect / ModelEffect / OverlayManager）

> 这是 `webgpt1.md` 的 PR0 核心：把“命令执行结果”从“字符串拼接/副作用散落”升级为可组合契约。
> 这一步不要求立刻重排所有目录，但会显著降低后续 `/agents`、`/commands`、`/todos` 等的散乱特判。

### 目标
- 所有命令（built-in + file command）执行后，都返回一个**结构化结果**，由 REPL/controller 统一解释并落入：
  - UI（是否追加到 messages、是否打开 overlay、是否 toast）
  - Model（是否注入下一轮 system blocks / tool specs 等）
- Controller 不再靠“命令名特判 + UI 直写”来驱动复杂交互。

### 核心类型（建议先落在 `src/features/commands/contracts.ts`）
> 先按最小可用落地；后续再对齐 Claude Code 时再扩充字段。

```ts
export type CommandResult =
  | { consumed: false }
  | {
      consumed: true
      ui?: UiEffect[]
      model?: ModelEffect[]
      data?: unknown
    }

export type UiEffect =
  | { type: 'appendMessages'; messages: Array<{ role: 'assistant' | 'system'; content: string }> }
  | { type: 'openOverlay'; overlay: OverlaySpec }
  | { type: 'closeOverlay' }
  | { type: 'toast'; kind: 'info' | 'warning' | 'error'; message: string }

export type ModelEffect = { type: 'injectNextTurn'; blocks: Array<{ type: 'text'; text: string }> }

export type OverlaySpec =
  | { kind: 'agents' }
  | { kind: 'todos' }
  | { kind: 'help' }
  | { kind: 'custom'; id: string; props?: Record<string, unknown> }
```

### 关键接口签名（草案，先用于收口依赖）

```ts
export type CommandMatch = { id: string; argsText: string }

export interface CommandRegistry {
  refresh(): Promise<void>
  list(): Array<{ id: string; description: string; scope: 'project' | 'user' | 'builtin' }>
  match(input: string): CommandMatch | null
  execute(match: CommandMatch, ctx: CommandContext): Promise<CommandResult>
}

export interface OverlayManager {
  open(spec: OverlaySpec): void
  close(): void
  current(): OverlaySpec | null
}
```

### Checklist
- [ ] 新增 `src/features/commands/contracts.ts`（上面的类型）
- [ ] 新增 `src/features/repl/overlays/OverlayManager.ts`
  - [ ] `open(spec)` / `close()` / `current`
  - [ ] 作为 `useReplController` 的单一 overlay 状态来源
- [ ] 定义 `CommandContext`（建议 `src/features/commands/types.ts`）
  - [ ] `cwd` / `globalConfigDir` / `config`（最小）
  - [ ] `replUi` / `toolRegistry`（可选，按需要注入）
- [ ] `src/features/commands/registry.ts`：把 execute 返回值升级为 `CommandResult`
  - [ ] built-in：`/help` `/agents` `/todos` `/compact`（先挑最需要“非消息输出”的命令）
  - [ ] file command：默认走 `appendMessages`
- [ ] `src/features/repl/useReplController.ts`：统一解释 `CommandResult.ui/model`
  - [ ] `appendMessages` → 进入 messages/staticItems 的统一入口（避免重复逻辑）
  - [ ] `openOverlay/closeOverlay` → 走 `OverlayManager`
- [ ] 最小测试
  - [ ] 命令返回 `openOverlay(agents)` 时，controller 不再字符串特判
  - [ ] `appendMessages` 的 message 进入正确列表（static vs streaming 规则不变）

### DoD
- [ ] `/agents` 不再依赖 controller 特判（仅通过 `openOverlay`）
- [ ] `bun run type-check`
- [ ] `bun run test`（至少覆盖 commands + controller 的最小 happy path）

---

## PR2 — skills 对齐：SkillRegistry + SkillRuntime + Skill tool 变可用

### 目标
让 `Skill` tool 真正可执行，并在 tool spec 中注入 `<available_skills>`（包含 skills + custom file-commands，排除 built-ins）。

### 关键决策（需要你确认，默认按推荐）
- “可用 invokables”包含：
  - skills：`.formax/skills/**/SKILL.md`
  - custom file commands：`.formax/commands/**.md`
- **排除 built-in commands**（用 `BUILTIN_SPECS` 做排除集）
- char budget 默认 15000，env 名称先定：`FORMAX_SKILL_TOOL_CHAR_BUDGET`
- “command 进入 `<available_skills>`”的条件：
  - 推荐：必须有 description frontmatter（严格，贴近 Claude Code）
  - 如果你想放宽：也可用首行 fallback（但会扩大噪音）

### Checklist
- [x] 新增 `src/skills/SkillStore.ts`
  - [x] 扫描：
    - project：`<cwd>/.formax/skills/**/SKILL.md`
    - user：`<globalConfigDir>/skills/**/SKILL.md`
  - [x] 命名规则：`dir/skill/SKILL.md` → `dir:skill`（与 commands 命名空间一致）
- [ ] 新增 `src/skills/SkillRegistry.ts`
  - [ ] project 覆盖 user
  - [ ] `list()` 输出排序稳定（scope + name）
- [ ] 新增 `src/invokables/registry.ts`
  - [ ] 合并 skills + commands，输出 `InvokableMeta[]`
  - [ ] 排除 built-ins（基于 `BUILTIN_SPECS`）
  - [ ] `disable-model-invocation` 过滤（skills 与 commands 都可支持）
- [x] 修改 `src/tools/modules/skill/index.ts`
  - [x] 运行时把 `<available_skills>` 注入 `spec.description`（skills-only；不含 commands）
  - [x] budget：`FORMAX_SKILL_TOOL_CHAR_BUDGET`（默认 15000）
- [x] 修改 `src/tools/modules/skill/spec.ts`
  - [x] 保持与 `proxy/tools-copy.json` 一致（通过 parity tests 约束）
- [x] 修改 `src/tools/modules/skill/handler.ts`
  - [x] 从 “not implemented” 改为真正 invoke（skills-only）
  - [x] handler 输入保持 `{ skill: string }`
  - [x] 禁用检查：`disable-model-invocation` → 给明确错误
  - [x] body budget：`FORMAX_SKILL_BODY_CHAR_BUDGET`（默认 60000）
- [ ] （待补齐）Skill tool 里把 custom file commands 合并进 `<available_skills>`
  - [ ] strict 规则：仅有 description frontmatter 的 command 才进入列表（推荐）
  - [ ] invoke：以 `/` 开头 → 当作 file command（走 PR1 的 CommandStore + render）
- [x] 新增测试
  - [x] `SkillStore`：命名空间、覆盖规则、disable flag、description fallback
  - [x] `SkillToolHandler`：unknown/disabled/成功加载
  - [x] parity：忽略动态 `<available_skills>` 列表内容

### DoD
- [ ] `Skill` tool 可用且 `<available_skills>` 非空（当目录存在时）
- [ ] `<available_skills>` 预算裁剪稳定（同输入同输出）
- [x] `bun run type-check`
- [x] `bun run test`

---

## PR3 — `/agents` 收口：走命令管线 + 移除 `.claude/agents` 兼容

### 目标
- `/agents` 不再在 `useReplController` 里特判
- agents 只读写：
  - project：`.formax/agents`
  - user：`~/.formax/agents`
- 清除 `.claude/agents` 的兼容读取逻辑与文案

### Checklist
- [ ] 修改 `src/features/commands/registry.ts`
  - [ ] `/agents` 作为 builtin command：返回一个“打开 overlay/wizard”的 effect（不要在 controller 特判字符串）
- [ ] 修改 `src/features/repl/useReplController.ts`
  - [ ] 删除 `/agents` 特判
  - [ ] 统一处理 command result 的 UI effect（open/close overlay）
- [ ] 修改 `src/legacy/runLegacyCli.tsx`
  - [ ] 删除 `.claude/agents` backward-compat 分支
- [ ] 修改 `src/subagents/registry.ts` / `src/subagents/README.md`
  - [ ] 去掉“兼容 `.claude/agents`”描述与实现
- [ ] 更新 docs/prompt（仅与 runtime 规则相关的部分）
- [ ] 测试
  - [ ] `/agents` 走命令 registry（测试用例不依赖 UI）
  - [ ] subagents 不再读取 `.claude/agents`（可用临时目录断言）

### DoD
- [ ] `rg -n "\\.claude/agents" src` 结果为 0
- [ ] `bun run type-check`
- [ ] `bun run test`
- [ ] 手动：`/agents` 仍可打开 AgentsDialog/wizard（功能不退）

---

## PR4 — 边界固化：禁止 `.claude` 出现在 runtime + import 边界检查

### 目标
防止回潮：以后新增功能不会再悄悄把 `.claude/*` 引回来，commands/skills/agents 不会越界依赖 UI/tools/modules。

### Checklist
- [ ] 新增脚本 `scripts/check-no-claude.ts`
  - [ ] 扫描 `src/**`（只针对 runtime），发现 `.claude` 字符串直接失败
  - [ ] 允许 docs 中提 Claude（可选：只扫描 src）
- [ ] 把脚本挂进 `bun run type-check`（或 `core boundary checks` 的链路）
- [ ] 增加 import 边界规则（按你们现有 boundary checks 方式）
  - [ ] `src/commands/**` 禁止 import `src/ui/**`、`src/screens/**`
  - [ ] `src/skills/**` 同上
  - [ ] `src/commands/**` 禁止 import `src/tools/modules/**`

### DoD
- [ ] `bun run type-check` 会阻止 `.claude` 回潮
- [ ] 越界 import 能被自动检查拦截

---

## 3. 需要你决策的点（不决策就先按推荐做）

- [ ] command 命名空间语法：严格 `/dir:cmd`（推荐）还是支持别名 `/cmd`（需要消歧策略）
- [ ] `<available_skills>` 是否只包含 “有 description frontmatter 的命令”（推荐严格）还是允许首行 fallback
- [ ] Skill tool input schema：继续 `{ skill: string }`（先稳）还是升级 `{ name, args }`（更清晰但要改更多 plumbing）

---

## 4. Backlog（明确先不做）

- [ ] custom command positional args `$1/$2...`（只做 `$ARGUMENTS`）
- [ ] `allowed-tools` enforcement（需要 tool executor/policy 更深改动）
- [ ] `context: fork` / `agent:` / hooks（需要更多抓包确认语义）

---

## 5. 最小化抓包/采集建议（如果你还要补证据）

- [ ] Claude Code：Skill tool 的 `<available_skills>` 实际渲染样例（格式/排序/截断提示）
- [ ] Claude Code：是否“无 description”命令会完全不进入 Skill/SlashCommand 的可用列表
- [ ] Claude Code：user-level commands 的命名空间规则（是否类似 `/user:xxx`）

---

## 附录 A：目标目录结构（提案，来自 webgpt1.md，按需渐进迁移）

> 不要求一次迁完。建议“先落契约层 + 新增目录，再逐步迁移旧文件”，让“去哪改”更明确。

```text
src/
  features/
    commands/
      contracts.ts          # CommandResult / UiEffect / ModelEffect / OverlaySpec
      registry.ts           # 发现/匹配/执行（builtins + file commands）
      types.ts              # CommandContext 等
    repl/
      overlays/
        OverlayManager.ts   # open/close/current
      injectedBlocks/       # model 注入块（与 UI messages 解耦）
  commands/
    CommandStore.ts         # .formax/commands 扫描/解析
    render.ts               # file command 展开渲染
  skills/
    SkillStore.ts           # .formax/skills 扫描/解析
    runtime.ts              # invoke（把 SKILL.md/command 交给模型的最小实现）
  ui/
    agents/                 # /agents wizard（Ink flows + domain UI）
    todos/                  # /todos UI（如要做 overlay）
```

### 目录边界（要写进约束/检查）
- `src/commands/**`、`src/skills/**` 不 import `src/ui/**`、`src/screens/**`
- `src/features/**` 负责 orchestrate，但避免直接依赖 `src/tools/modules/**`（通过 store/runtime 接口）
- UI 只消费“契约层结果 + store 数据”，不直接做 IO 扫描/写文件

## 附录 B：分层规则（把“边界”写成可执行的约束）

> 目的：避免“交互/业务/IO 互相引用”导致长期难以维护。

- **UI 层**（`src/ui/**`, `src/components/**`, `src/screens/**`）
  - 只负责渲染与输入事件（Ink）
  - 不做 IO（不扫磁盘/不写文件/不读 env）
  - 不拼 system prompt（只消费已准备好的字符串/blocks）
- **领域层**（`src/features/**`）
  - 组织流程：命令→契约→UI/Model effect
  - 可调用 adapters/core，但不要 import tools/modules 的具体实现
- **核心/适配层**（`src/core/**`, `src/adapters/**`, `src/env/**`）
  - 只做可复用的 config/IO/边界检查/持久化
  - 不依赖 UI
- **工具层**（`src/tools/**`）
  - 只负责 Tool 接口（spec/handler/presenter/runtime）
  - “命令/技能”不应反向依赖 tools；如果需要共享逻辑，放到 `src/shared/**`

## 附录 C：风险点与回滚策略（把 webgpt1.md 的“工程化”补齐）

- **风险：契约层落地后，需要改动 controller 分发**  
  回滚：保留旧路径（开发期短暂 feature toggle），验证稳定后删除 toggle。
- **风险：commands/skills 扫描路径错位或污染真实 `~/.formax`**  
  回滚：所有 store 都支持注入 `cwd/globalConfigDir`；测试用临时目录，不读真实 HOME。
- **风险：overlay 与 messages/staticItems 交互导致渲染回归**  
  回滚：overlay 只作为“上层面板”，不改变历史消息渲染；任何“可逆折叠/分组”禁止进 Static append-only 区。
