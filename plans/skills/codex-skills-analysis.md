# Codex Skills 机制调研（可借鉴点）

本笔记基于本地 `codex` 仓库代码阅读（`/Users/david/Documents/github/codex`），重点回答：

1) Codex skills 的 **发现/加载/禁用/缓存** 是怎么做的？  
2) skills 如何进入“系统提示词/会话上下文”？  
3) 与 Claude Code / OpenCode / Formax 的路径差异是什么？  

> 备注：Codex 的 skills 是“系统能力的一部分”，并不是 Anthropic 的 `Tool: Skill(...)` 形态；它主要通过 `$skill-name` 触发，并建议客户端显式携带 skill input item。

## 1) Skills 从哪里来（Discovery & Roots）

核心实现：`codex-rs/core/src/skills/loader.rs`

Codex 的 skills roots 来自 config layer stack（按层级组织，而不是硬编码单一路径）：

- **Repo scope**：Project layer 的 `<project_config_folder>/skills`
- **User scope**：User layer 的 `$CODEX_HOME/skills`
- **System scope**：`$CODEX_HOME/skills/.system`（Codex 会把内置 skills 安装/缓存到这里）
- **Admin scope**：System config layer 的 `/etc/codex/skills`（在 Unix 上被视作 admin skills）

### 1.1 目录扫描规则（硬限制）

`discover_skills_under_root()` 的扫描策略很“工程化”，避免无限扫描：

- 最大深度：`MAX_SCAN_DEPTH = 6`
- 最大目录数：`MAX_SKILLS_DIRS_PER_ROOT = 2000`
- 跳过 dotfiles：`file_name.starts_with('.') => continue`
- symlink：
  - `Repo/User/Admin` scope 允许跟随 symlink
  - `System` scope 不跟随（因为它是 Codex 自己写入的缓存）

### 1.2 frontmatter 与 interface

Codex 解析两类文件：

1) `SKILL.md`
   - YAML frontmatter 必须含 `name` 与 `description`
   - 支持 `metadata.short-description`（可选）
   - 有长度限制：
     - `name` ≤ 64
     - `description` ≤ 1024

2) `SKILL.toml`（可选）
   - `interface` 字段可定义 UI/展示相关信息（如 display_name、icon、brand_color、default_prompt）

也就是说 Codex 把 skill “分成两层”：
- `SKILL.md`：模型要用的指令 + 语义描述
- `SKILL.toml`：更偏 UI/产品化的呈现层（可选）

## 2) SkillsManager：缓存 + 禁用列表

核心实现：`codex-rs/core/src/skills/manager.rs`

### 2.1 per-cwd 缓存

`SkillsManager` 维护一个 `cache_by_cwd: HashMap<PathBuf, SkillLoadOutcome>`：

- 默认会命中缓存（避免每轮都扫盘）
- `force_reload` 可以强制重新加载（绕过缓存）
- `skills_for_config()` 也会 seed 缓存（对已构建 Config 的快速路径）

### 2.2 disabled_paths（禁用某些 skill）

Codex 支持把某些 skill “禁用”，并把禁用状态放在 user layer 的 skills config（目前只读 user layer）：

- config key：`skills`
- `skills.config[]` 里每条有 `path` 与 `enabled`
- `enabled=false` 的路径会被归一化并加入 `disabled_paths: HashSet<PathBuf>`

这点很实用：不是所有 skill 都必须永远可用，用户可以“关掉”某个 skill（尤其是系统自带或组织下发的）。

## 3) Skills 如何进入提示词（Prompt injection）

核心实现：`codex-rs/core/src/project_doc.rs`

Codex 的 “User instructions” 聚合路径是：

1) `Config.user_instructions`（用户显式写的）
2) 发现的项目文档（默认 `AGENTS.md`，以及 `AGENTS.override.md` 等候选）
3) **Skills section（可选）**：把 skills 渲染成一段 “## Skills ...” 的文本追加进去

skills section 的渲染函数：`codex-rs/core/src/skills/render.rs`

其输出内容与你们当前 repo 的 `AGENTS.md` 里 “## Skills / How to use skills” 那段高度相似（同样强调 progressive disclosure / trigger rules）。

## 4) Skills 的触发方式：`$skill-name` + `skill` input item

这部分在 app-server README 与 core tests 中有明确证据：

- `codex-rs/app-server/README.md`：
  - 推荐把输入写成：
    - text：`"$skill-creator Add a new skill ..."`
    - 另附 `{ "type":"skill", "name":"skill-creator", "path": "..." }` 的 input item
  - 如果省略 `skill` item，模型也会尝试解析 `$skill-name` 并自己定位，但会增加延迟。

- `codex-rs/core/tests/suite/skills.rs`：
  - 测试明确在一次 `Op::UserTurn` 里同时发送：
    - `UserInput::Text { text: "please use $demo" }`
    - `UserInput::Skill { name:"demo", path:".../SKILL.md" }`
  - 并断言最终发给模型的 user text 包含一段 `<skill> ... <name> ... <path> ... <body>` 的注入块。

结论：Codex 不是通过 “Tool: Skill(...)” 来启动 skills；而是把 skill instructions 当作一种 **输入项** 注入到模型上下文。

## 5) TUI 交互：SkillPopup（仅供参考）

`codex-rs/tui/src/bottom_pane/skill_popup.rs` 显示：

- 技能选择 UI 采用 fuzzy match
- 显示字段优先级：
  - name：优先 `interface.display_name`，否则用 `skill.name`
  - description：优先 `interface.short_description`，否则 `skill.short_description`，再否则 `skill.description`

这体现了 Codex 的“产品化思路”：skill 可以有更友好的 UI 名称/描述，而不影响底层 name。

## 6) 对 Formax 的可借鉴点（结合你们现状）

### 6.1 “skills 列表”作为一段系统注入文本（而非一定做成 Tool description）

Codex 把 skills 列表渲染成固定文本块，并附带“如何使用 skills”的行为规则。

对 Formax 的启发：
- 你们当前是“对齐 Claude Code”，倾向把 `<available_skills>` 放进 `Skill` tool description；
- 但 Codex 的做法证明：也可以把 skills 列表当作“系统上下文的一部分”去注入（甚至更容易被模型稳定遵守）。

### 6.2 缓存与 forceReload

Codex 的 per-cwd 缓存 + forceReload 能显著减少 IO 和抖动（尤其是 skills 多的时候）。

Formax 如果后续出现“每次请求都扫盘导致延迟/闪动”，可以考虑引入类似策略：
- 默认缓存技能索引
- 只有在用户明确 refresh / 文件变更时才强制重扫

### 6.3 disabled_paths（软禁用）

与 Claude Code 的 allowList（“是否允许使用 skill”）不同，Codex 提供的是“技能本身是否启用”的开关。

Formax 若后续要产品化（给用户管理技能），disabled 很可能会比 allowList 更常用：
- allowList：偏“审批是否允许执行”
- disabled：偏“我不想让它出现在列表里/被触发”

### 6.4 UI 元信息（SKILL.toml）

Codex 把 UI/品牌信息放进 `SKILL.toml`，把指令放在 `SKILL.md`。

Formax 若未来要做“skills 市场/分享/主题色/图标”，可以考虑类似拆分；但这属于增量能力，不是 Claude Code 必须对齐项。

## 7) 与 Claude Code / OpenCode 的关键差异（总结）

- Claude Code：`Tool: Skill`，tool description 内 `<available_skills>`，执行后 `tool_result` 注入完整 instructions；本地有 allowList UI（不在抓包里）。
- OpenCode：同样 `Tool: skill` + `<available_skills>`，并将权限系统做成通用框架（pattern allow/deny/ask），还能按 agent 权限隐藏 skills。
- Codex：通过 `$skill-name` marker + `skill` input item 注入，不是 tool；并提供 `skills/list` 与 `skills/config/write` API（更偏“平台化”）。

> 因此：Formax 若坚持“对齐 Claude Code”，可以主路径继续走 Tool: Skill；同时借鉴 OpenCode 的权限设计与 Codex 的缓存/禁用/诊断接口。

