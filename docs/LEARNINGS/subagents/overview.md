# Sub-agents 全链路：从 `/agents` 到 `Task` 再到 UI（Formax vs Claude Code）

目标：让一个“中等水平工程师”看完就能知道：
- sub-agent 是怎么被创建/落盘/加载的
- `Task` 工具如何启动 sub-agent 子会话
- 子会话工具权限如何被裁剪（allow/deny + 运行时硬限制）
- 子会话的工具调用进度如何回传并渲染（包含“向上审批”的最后防线）

> 本文以 **抓包事实 + 代码实现** 为准；Claude Code 的行为以终端输出与 `tools-copy.json` 仅作参考。

## 1) 你在命令行看见的是什么？

### 1.1 `/agents`：创建或管理 sub-agent 配置

- 这是一个交互式向导（UI），用于生成 `.md` 配置文件。
- Formax 约定把项目级 agent 写到：`.formax/agents/*.md`
  - Claude Code 对应目录是 `.claude/agents/*.md`

生成的文件是 Markdown + frontmatter，大致长这样：

```md
---
name: code-reviewer
description: Review code changes and find issues
model: sonnet
color: blue
tools: Read, Glob, Grep
---
You are a code reviewer...
```

关键点：
- `tools` 在文件里可能是“逗号分隔字符串”，也可能是 YAML list；**省略时视为 All tools（`['*']`）**。

### 1.2 `Task(subagent_type=...)`：启动 sub-agent

当主会话调用 `Task` 工具时，会启动一个 sub-agent 子会话来完成一段任务。
你在 UI 里看到的通常是：

```
⏺ Explore(Explore Formax architecture)
  ├ Glob(...)
  └ Read(...)
  +N more tool uses (ctrl+o to expand)
  ⎿ Done (...)
```

## 2) Formax sub-agent 系统怎么组成？

把它拆成 4 层：

1. **配置来源**：从磁盘读取 `.formax/agents/*.md` + 内置 builtins
2. **Registry（注册表）**：合并/覆盖/提供 `get(name)`
3. **Runner（执行器）**：创建隔离对话上下文，过滤可用 tools，执行 agent 的任务
4. **Task Tool Handler（工具入口）**：把 LLM 的 `Task` tool call 翻译成对 Runner 的一次 run，并把进度/结果映射回 UI

对应文件：
- 配置读取：`src/subagents/registry.ts`
- 内置 agents：`src/subagents/builtins.ts`
- 执行器：`src/subagents/runner.ts`
- Task 工具 handler：`src/tools/executor/handlers/taskSubAgent.ts`
- UI 展示（Task）：`src/tools/modules/task/presenter.tsx`

## 3) agent 配置如何加载（Registry）

入口：`src/subagents/registry.ts`

要点：
- 启动时会 seed builtins（可选）
- 然后按目录顺序加载 `.md`（后加载覆盖先加载）
- frontmatter 解析支持：
  - `tools: Read, Grep`（逗号分隔）
  - `tools:\n - Read\n - Grep`（YAML list）
  - `tools` 缺省：视为 `['*']`

所以“项目级覆盖用户级”的策略通常是：
- 先加载 `~/.formax/agents/`
- 再加载 `<repo>/.formax/agents/`

## 4) `Task` 如何启动 sub-agent（Task Tool Handler）

入口：`src/tools/executor/handlers/taskSubAgent.ts`

关键输入（来自 LLM）：
- `subagent_type`：选择哪个 agent
- `prompt`：发给 sub-agent 的唯一 user message
- `description`：用于 UI 展示
- `model` / `resume` / `run_in_background`：可选行为

流程（简化）：
1. 校验 input schema
2. `registry.get(subagent_type)` 找到 agent 配置
3. 调用 `runner.run({ agent, task: prompt, ... })`
4. 把 sub-agent 事件映射回主 UI：
   - 统计 tool uses / usage
   - 生成 `middleLines`（收起视图）和 `nestedTools`（展开视图）

## 5) 工具权限：allow/deny + 运行时硬限制（最关键）

### 5.1 为什么需要“硬限制”？

即便 agent 配置写了 `tools: *`：
- sub-agent 也不应该能递归再开 sub-agent（`Task`）
- sub-agent 也不应该直接触发会话模式切换（`EnterPlanMode/ExitPlanMode`）
- 以及某些交互工具/高风险工具需要主会话兜底（例如“向上审批”）

### 5.2 Formax 的 deny 规则在哪里？

- 通用 deny：`src/tools/executor/subagentDenyTools.ts`（例如 `Task/TaskOutput/...`）
- 针对 Explore/Plan 的额外 deny：`src/subagents/runner.ts`
  - `READONLY_SUBAGENT_DENY_TOOLS = ['Edit','Write','NotebookEdit']`

这对应你观察到的 Claude Code “软限制”逐步变得更细：即便工具列表里可能是 `*`，运行时仍会做 deny。

### 5.3 “向上审批”最后防线是什么？

我们把“sub-agent 不能直接向用户弹确认”作为目标，但为了防止模型偶发误用：
- 子会话触发交互/审批时，通过事件回传到主会话
- 主会话 UI 才负责真正的 AskUserQuestion/审批

（这部分属于“系统安全边界”，比 UI 对齐更优先。）

## 6) UI 如何展示 sub-agent 的工具调用进度（tool uses）

核心：子会话每发生一次 tool call，Task handler 会把摘要行塞回主会话的 tool message：

- `toolInfo.middleLines`：默认收起显示的几行（例如最近 2 条）
- `toolInfo.nestedTools`：用于展开显示的更完整列表

对应生成位置：
- `src/tools/executor/handlers/taskSubAgent.ts`
  - `renderNestedLines()`（中间摘要）

对应渲染位置：
- `src/tools/modules/task/presenter.tsx`

### 6.1（可选 UI 细节）ctrl+o 展开/收起 nested tool uses

> 这是为了对齐 Claude Code 的交互：`+N more tool uses (ctrl+o to expand)`。

实现要点（仅供维护用，不建议新人从这里开始读）：
- `src/screens/REPL.tsx`：`ctrl+o` 在非 thinking 场景切换最近一个 Task 的展开状态
- `src/tools/modules/task/presenter.tsx`：展开时优先渲染 `nestedTools`，收起时优先渲染 `middleLines`
- `src/components/tool/ToolMessage.tsx`：增加 UI-only 字段 `toolInfo.expanded`

## 7) 常见问题（FAQ）

### Q1：为什么 sub-agent 看起来只有 1 条 user message？

这是刻意的：sub-agent 子会话的 messages 一般就是：
- system：agent system prompt
- user：Task.prompt

这样能保证隔离与可控。

### Q2：为什么 Explore/Plan 工具列表是 `*`，但仍然“只读”？

工具列表是“候选集合”，运行时还会通过 deny 做硬限制（例如禁止写工具）。这是最稳的策略。

