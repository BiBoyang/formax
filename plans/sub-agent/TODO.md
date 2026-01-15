# Sub-agent /agents 对齐 TODO（以 Claude Code 抓包为准）

目标：在不纠结历史遗留的前提下，尽量对齐 Claude Code 的 sub-agent（Task）与 `/agents` 体验，并在 **运行时做硬限制**（避免 subagent 误用交互/会话型工具）。

## 事实约束 / 不变量（已确认）

- subagent 的入口是主会话调用 `Task`，通过 `input.subagent_type` 选择 agent（抓包：`proxy/traffic-logs/0026_2026-01-16T00-07-44,252_REQ__v1_messages.simple.json:621`）。
- subagent 是一条独立 `/v1/messages` 会话：messages 只有 1 条 user（Task.prompt），system 换成 agent system prompt，tools 列表会被裁剪（抓包：`proxy/traffic-logs/0027_2026-01-16T00-07-48,829_REQ__v1_messages.simple.json:11`、`:45`）。
- `/agents` 是交互式向导，会落盘 `.claude/agents/*.md`（终端复制：`plans/sub-agent/terminal-copy/5.txt:12`）。
- agent 文件为 Markdown + YAML frontmatter，**`tools:` 在文件里是“逗号分隔字符串”，且当选择 All tools 时可能省略该字段**（示例文件：`/Users/david/Documents/github/bilibili2str/.claude/agents/edit-tool-demo.md:4`、`/Users/david/Documents/github/bilibili2str/.claude/agents/code-reviewer.md:1`）。
- Claude Code 的内置 Explore/Plan 近期把“软限制”写得更明确：`Tools: All tools except Task, ExitPlanMode, Edit, Write, NotebookEdit`（我们需要做到：**运行时硬限制**）。

## P0 — SubAgent 文件解析对齐（最关键）

- [x] **支持 Claude Code frontmatter 的 `tools` 写法**
  - [x] `tools` 缺省：视为 All tools（内部表示为 `['*']`）
  - [x] `tools: Read, Glob, Grep`：按逗号拆分成数组（trim + 去空）
  - [x] 继续兼容 YAML list（`tools:\n - Read`）以避免回归
- [x] **把 `model`/`color` 读进 SubAgentConfig**
  - [x] `model: sonnet|opus|haiku|inherit`（先存下来，后续再接“按 agent 选 model”）
  - [x] `color: blue|red|...`（用于 UI 区分）
- [ ] **目录扫描与优先级（按官方文档）**
  - [x] `.claude/agents/`（项目级，优先）
  - [x] `~/.claude/agents/`（用户级）
  - [ ] 先不做 plugins/`--agents`，但预留接口与 TODO（见 P2/P3）
- [x] 单测：新增 fixtures 覆盖 3 种 `tools` 写法 + tools 缺省 + model/color

## P1 — 运行时硬限制（subagent tool allow/deny）

> 目标：即使 agent 配置写了 `tools: *`，也不能越权。

- [x] **统一 NESTED_DENY_TOOLS（与抓包一致）**
  - [x] `Task`（防止嵌套）
  - [x] `TaskOutput`（仅主会话取后台结果）
  - [x] `EnterPlanMode` / `ExitPlanMode`（会话模式控制仅主会话）
  - [x] `KillShell`（影响主会话进程）
  - [x] `AskUserQuestion`（主会话交互，结果再回传）
  - [x] 删除不该 deny 的：`SlashCommand`（抓包里 subagent tools 允许它）
- [x] **按 subagent 类型加硬 deny（对齐 Claude Code 最新描述）**
  - [x] Explore / Plan：deny `Edit`, `Write`, `NotebookEdit`（且仍然 deny 上面的会话型工具）
  - [x] general-purpose：允许写工具（但依旧 obey 审批/Policy 与“向上审批”最后防线）
- [x] 单测：Explore/Plan tools 生成后不包含上述 deny 工具；general-purpose 包含

## P2 — `/agents` 命令（先对齐最小闭环）

> 先做“能生成同格式文件 + 能被 Task 使用”，UI 细节再逐步对齐。

- [ ] `/agents` 作为 **local_async** 命令接入命令注册系统
- [ ] Ink 向导（与终端复制对齐）
  - [ ] 选择 scope：Project-level（`.claude/agents/`）/ User-level（`~/.claude/agents/`）
  - [ ] 选择 tools preset：All tools / Read-only / Edit / Execution / Other
  - [ ] 选择 model：Sonnet/Opus/Haiku/Inherit
  - [ ] 选择 color：Automatic/Red/Blue/Green/Yellow/Purple/Orange/Pink/Cyan
  - [ ] Confirm & Save：展示 Name/Location/Tools/Model/Description/System prompt preview
- [ ] 文件写入格式对齐
  - [ ] frontmatter：`name/description/model/color` 必须对齐字段名
  - [ ] `tools`：除非是子集，否则省略（All tools）
  - [ ] body：system prompt（先做手动输入；Generate with Claude 放到 P3）
- [ ] 最小验收：创建 agent → `Task(subagent_type=...)` 能加载并运行

## P3 — `/agents` 的 “Generate with Claude”（可选但体验关键）

- [ ] 实现 “agent architect” 小请求（无 tools，返回 JSON）
  - [ ] 输入：用户描述（“这个 agent 什么时候用/做什么”）
  - [ ] 输出：`name/description/systemPrompt`（以及可选 `whenToUse` 文本）
  - [ ] 失败兜底：回到手动输入
- [ ] 把生成结果写入 agent 文件（与 P2 写入规则一致）
- [ ] 单测：JSON 解析健壮性（缺字段/多字段/非 JSON）

## P4 — Task UI 对齐（锦上添花）

- [ ] Task 摘要行与展开提示（`ctrl+o` / `ctrl+b`）对齐 Claude Code
- [ ] 多个 Explore 并发的展示（`3 Explore agents finished (ctrl+o to expand)`）
- [ ] 文档沉淀：在 `docs/LEARNINGS/subagents/` 写一篇“抓包事实 → Formax 映射”

## 待确认（建议后续再抓包补齐）

- [ ] Explore/Plan 子会话里 tools 列表的“精确集合”是否与 docs 完全一致（尤其是 SlashCommand/Skill/TodoWrite）
- [ ] `--agents` CLI flag 的 JSON 格式细节（与文件 frontmatter 的字段映射）
