# Code Refactor TODO（/commands + skills + /agents，对标 Claude Code，`.formax` only）

本 TODO 基于两份 WebGPT 回复：

- **更推荐**：`plans/code-refactor/webgpt2.md`（更贴合当前仓库实现与真实坑位，细到函数级）
- 参考补充：`plans/code-refactor/webgpt2-other.md`（结构化更强，但部分内容更偏“理想目录树”）

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
- [ ] 新增 `src/shared/frontmatter.ts`
  - [ ] `parseMarkdownFrontmatter(raw): { attributes; body } | null`
  - [ ] `extractFirstMeaningfulLine(md): string`（用于 description fallback）
- [ ] 新增 `src/invokables/types.ts`
  - [ ] `InvokableKind = 'command' | 'skill'`
  - [ ] `InvokableScope = 'project' | 'user'`
  - [ ] `InvokableMeta = { kind, scope, name, description, argumentHint?, disableModelInvocation?, sourcePath? }`
- [ ] 新增 `src/invokables/charBudget.ts`
  - [ ] `truncateByCharBudget(lines: string[], limit: number): { kept; truncated }`
  - [ ] 约定默认 15000（与 Claude Code 逻辑对齐）
- [ ] 写单测（Vitest）
  - [ ] `src/shared/frontmatter.test.ts`
  - [ ] `src/invokables/charBudget.test.ts`

### DoD
- [ ] `bun run type-check` 通过
- [ ] `bun run test` 通过
- [ ] 不改现有 runtime 行为（仅新增/复用准备）

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
- [ ] 新增 `src/commands/CommandStore.ts`
  - [ ] 扫描 `.formax/commands` + `~/.formax/commands`（递归）
  - [ ] 解析 frontmatter（复用 PR0 的 parser）
  - [ ] 输出 `CommandMeta { id, scope, filePath, description, argumentHint, disableModelInvocation, hasDescriptionFrontmatter }`
  - [ ] `resolve(id)`：支持 `/user:...`（如你决定保留 user 命名空间）或 scope 参数（推荐显式 scope）
- [ ] 新增 `src/commands/render.ts`
  - [ ] 统一 file command 的 “expanded prompt blocks” 生成逻辑
  - [ ] 复用 `src/features/commands/registry.ts:325` 的 `buildFileCommandContent()`（或迁移后仅保留一份）
- [ ] 修改 `src/features/commands/registry.ts`
  - [ ] 移除 `loadClaudeCommandEntries()`，改为 `CommandStore` 注入与使用
  - [ ] built-in 命令仍保持（`BUILTIN_SPECS` 继续作为事实来源）
  - [ ] file command 的 dispatch 复用 `src/commands/render.ts`
- [ ] 修改 `src/tools/modules/slashCommand/index.ts`
  - [ ] 运行时生成 “Available Commands” 列表改为使用 `CommandStore`
  - [ ] 移除 `process.cwd()` 依赖：module factory 传入 `cwd`（与 tool execution ctx 对齐）
- [ ] 修改 `src/tools/modules/slashCommand/handler.ts`
  - [ ] 不再自己扫描/拼路径读文件；改为 `CommandStore.resolve()` + `render.ts`
- [ ] 全仓替换 `.claude/commands` → `.formax/commands`
  - [ ] `src/tools/modules/slashCommand/spec.ts` 文案
  - [ ] `src/features/commands/registry.test.ts` 等测试
- [ ] 新增/更新测试
  - [ ] `src/commands/CommandStore.test.ts`：
    - [ ] 命名空间 `/dir:cmd`
    - [ ] 覆盖规则 project > user
    - [ ] description/frontmatter 解析
  - [ ] `src/tools/modules/slashCommand/handler.test.ts`：确保 tool 执行走新路径

### DoD
- [ ] `rg -n "\\.claude/commands" src` 结果为 0（runtime + tests）
- [ ] `bun run type-check`
- [ ] `bun run test`
- [ ] 手动：
  - [ ] 在 `.formax/commands/hello.md` 写一个命令，REPL `/hello` 生效
  - [ ] `SlashCommand` tool 的 available 列表包含该命令

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
- [ ] 新增 `src/skills/SkillStore.ts`
  - [ ] 扫描：
    - project：`<cwd>/.formax/skills/**/SKILL.md`
    - user：`<globalConfigDir>/skills/**/SKILL.md`
  - [ ] 命名规则：建议 `dir/skill/SKILL.md` → `dir:skill`（与 commands 命名空间一致）
- [ ] 新增 `src/skills/SkillRegistry.ts`
  - [ ] project 覆盖 user
  - [ ] `list()` 输出排序稳定（scope + name）
- [ ] 新增 `src/invokables/registry.ts`
  - [ ] 合并 skills + commands，输出 `InvokableMeta[]`
  - [ ] 排除 built-ins（基于 `BUILTIN_SPECS`）
  - [ ] `disable-model-invocation` 过滤（skills 与 commands 都可支持）
- [ ] 修改 `src/tools/modules/skill/index.ts`
  - [ ] 运行时把 `<available_skills>` 注入 `spec.description`（仿照 SlashCommand module 的 dynamic spec）
- [ ] 修改 `src/tools/modules/skill/spec.ts`
  - [ ] 文案改为“programmatic invokables”（以 Claude Code 为对标），并包含 `<available_skills>`
- [ ] 修改 `src/tools/modules/skill/handler.ts`
  - [ ] 从 “not implemented” 改为真正 invoke
  - [ ] handler 输入先保持 `{ skill: string }`，内部解析 `name + argsText`
  - [ ] 分流：
    - [ ] 以 `/` 开头 → 当作 file command（走 PR1 的 CommandStore + render）
    - [ ] 否则 → 当作 skill（读取 SKILL.md body + 可选列目录文件清单）
  - [ ] 禁用检查：`disable-model-invocation` → 给明确错误
- [ ] 新增测试
  - [ ] `<available_skills>` 合并/排序/预算裁剪 deterministic
  - [ ] invoke command vs invoke skill 输出正确

### DoD
- [ ] `Skill` tool 可用且 `<available_skills>` 非空（当目录存在时）
- [ ] `<available_skills>` 预算裁剪稳定（同输入同输出）
- [ ] `bun run type-check`
- [ ] `bun run test`

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

