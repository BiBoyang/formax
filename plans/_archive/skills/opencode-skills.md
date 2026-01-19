# OpenCode Skills 机制调研（可借鉴点）

本笔记基于本地 `opencode` 仓库代码阅读（`/Users/david/Documents/github/opencode`），目标是提炼 **OpenCode 的 skills 发现/暴露/权限/执行** 机制，并标出对 Formax 的可借鉴点（Formax 只做 `.formax`，不做 `.claude` 兼容读取）。

## 1) OpenCode 的 skills 从哪里来（Discovery）

核心实现：`packages/opencode/src/skill/skill.ts`

### 1.1 扫描位置（两条线）

OpenCode 会把 skills 收敛到 `Skill::state()` 里（有缓存，见下）。

1) **Claude Code 兼容路径（可关闭）**

- 项目级：从当前工作目录往上找 `.claude` 目录，直到 git worktree（`Filesystem.up({ targets:[".claude"], start: Instance.directory, stop: Instance.worktree })`）
- 全局：`~/.claude`（存在则加入扫描列表）
- glob：`skills/**/SKILL.md`
- 通过 `Flag.OPENCODE_DISABLE_CLAUDE_CODE_SKILLS` 可禁用这条扫描链路

2) **OpenCode 自己的路径**

- 对每个 `Config.directories()` 返回的目录扫描：
  - glob：`{skill,skills}/**/SKILL.md`
  - 也就是说兼容两种目录名：`skill/` 或 `skills/`

### 1.2 缓存策略

- `Skill::state = Instance.state(async () => ...)`：对当前 Instance（基本等同“当前项目上下文”）做缓存。
- 行为是“缓存技能索引（name/description/location）”，不是每次 tool 调用都全盘重扫。

### 1.3 frontmatter 解析与去重

- `ConfigMarkdown.parse(path)` 解析 `SKILL.md` frontmatter 与正文。
- 只 `pick` `name/description`：
  - 解析失败或 frontmatter 缺失则跳过。
- **同名 skill**：不会报错，只 `log.warn("duplicate skill name", ...)`，后写入的覆盖 `skills[name]`。

> 这意味着 OpenCode 在“发现阶段”比较宽松：不严格校验 name 格式，也不强制“目录名必须等于 name”（目录名校验写在 docs 里，但 loader 这里没有 enforce）。

## 2) skills 怎么暴露给模型（Tool description 注入）

核心实现：`packages/opencode/src/tool/skill.ts`

### 2.1 Tool 形态

- 工具名：`skill`（小写）
- 参数：`{ name: string }`（从 available_skills 里取）
- description 动态生成，包含：
  - `"<available_skills>" ... "</available_skills>"` XML-ish 列表
  - 每个 skill 输出 `name + description`

```xml
<available_skills>
  <skill>
    <name>git-release</name>
    <description>Create consistent releases and changelogs</description>
  </skill>
</available_skills>
```

### 2.2 与权限系统的关系（“看得见”也是权限的一部分）

- 如果 ctx 带 `agent`，会用 `PermissionNext.evaluate("skill", skill.name, agent.permission)` 过滤：
  - `deny` 的 skill 会 **从 tool description 中直接消失**（agent 根本“看不见”）。

这点很关键：OpenCode 的 permission 不只是“执行前阻断”，还会影响“模型可见能力集合”。

## 3) Skill 的执行流程（Execute）

仍在 `packages/opencode/src/tool/skill.ts`

执行步骤：

1) `ctx.ask({ permission:"skill", patterns:[name], always:[name] })`
   - 这是 OpenCode 通用 permission 框架：`allow/deny/ask` + pattern。
2) 读取 skill markdown：`ConfigMarkdown.parse(skill.location)`
3) `dir = path.dirname(skill.location)` 作为 base directory
4) 返回：
   - `title: "Loaded skill: <name>"`
   - `output` 是一段 markdown，包含：
     - `## Skill: <name>`
     - `**Base directory**: <dir>`
     - 完整 instructions（正文）

## 4) OpenCode 的“调试/测试”支撑

### 4.1 调试命令

`packages/opencode/src/cli/cmd/debug/skill.ts`

- `opencode debug skill`：输出 `Skill.all()` 的 JSON（非常利于定位“到底发现了哪些 skill，路径是什么”）。

### 4.2 测试覆盖

`packages/opencode/test/skill/skill.test.ts`

覆盖了：
- `.opencode/skill/...` 发现
- `.claude/skills/...` 发现
- `~/.claude/skills/...` 发现（通过 `OPENCODE_TEST_HOME` 注入 home）
- 缺 frontmatter 跳过
- 空技能返回空列表

## 5) 对 Formax 的可借鉴点（不等于照抄）

> Formax 不做 `.claude` 兼容读取，但可以借鉴“机制”。

### 5.1 Repo root 向上查找（提升“在子目录运行”的可用性）

OpenCode 会从 cwd 向上找 `.claude` 到 git worktree —— 这个模式很适合 monorepo/子目录开发。

Formax 可以借鉴为：
- 从 cwd 向上找 `.formax`（到 repo root 或 git root），以免在子目录启动时漏掉项目级 skills。

### 5.2 通用 permission 框架（pattern allow/deny/ask）

OpenCode 的 permission 具备：
- `allow/deny/ask` 三态
- pattern（如 `internal-*`）
- per-agent override
- tool 可禁用（例如对某些 agent 禁用 skill tool）

如果 Formax 后续要把“审批/记住/撤销/审计”统一（你们有 PR6 方向），OpenCode 的 permission 模型是一个很值得参考的“形态样本”。

### 5.3 “可见性”= 权限的一部分

OpenCode 会在 tool description 阶段就把 deny 的 skill 隐藏掉。

这能降低模型误触与重复触发（模型看不到就不会调用），也能减少“拒绝后重复调用”的概率。

### 5.4 Debug 能力（skills/list）

OpenCode 的 debug 命令很务实：**列出发现结果 + 路径**，比只在 UI 里猜更高效。

Formax 后续如果做 `/skills` 或 `formax skills list --json`，可以参考这种“诊断接口”优先级。

## 6) 与 Claude Code / Formax 的关键差异（提醒）

- Claude Code（抓包观察）是 **Tool: Skill** + `<available_skills>`，并且有本地 allowList UI（不在抓包里）。
- OpenCode 也是 **Tool: skill** + `<available_skills>`，并把权限系统做成通用框架。
- Codex（开源）走的是另一条路：`$skill-name` marker + 明确的 `skill` input item（见 `plans/skills/codex-skills-analysis.md`）。

因此 Formax “对齐 Claude Code”时：
- 可以借鉴 OpenCode 的 permission 设计与 repo root 发现逻辑；
- 但不需要引入 `$skill` marker 这套（除非你决定兼容 Codex 体验）。

