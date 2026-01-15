# Claude Code Sub-Agent (Task) 逆向分析报告

**生成时间**：2026-01-16  
**材料来源**：
- `plans/sub-agent/terminal-copy/*.txt`（命令行复制）
- `proxy/traffic-logs/*_REQ__v1_messages.simple.json`（抓包数据）
- `record/claude-code/sub-agent.cast`（asciinema 录像）
- `/Users/david/Documents/github/bilibili2str/.claude/agents/code-reviewer.md`（agent 文件样例）

---

## A. 事实清单（必须逐条"证据指针"）

### 1. `/agents` 的交互流程、保存路径、保存文件的格式（frontmatter 字段）

**证据：**
- **终端 UI 流程**：`plans/sub-agent/terminal-copy/1.txt:6-33` 显示 `/agents` 命令启动创建向导
- **保存路径**：`plans/sub-agent/terminal-copy/5.txt:12` 显示 `Location: .claude/agents/code-reviewer.md`
- **文件格式（frontmatter）**：`/Users/david/Documents/github/bilibili2str/.claude/agents/code-reviewer.md:1-6` 显示：
  ```yaml
  ---
  name: code-reviewer
  description: Use this agent when...
  model: sonnet
  color: blue
  ---
  ```
- **创建流程步骤**：
  - `1.txt:6-33`：选择工具（All tools / Read-only / Edit / Execution / Other）
  - `3.txt:11-14`：选择模型（Sonnet/Opus/Haiku/Inherit）
  - `4.txt:13-22`：选择背景颜色（Automatic/Red/Blue/Green/Yellow/Purple/Orange/Pink/Cyan）
  - `5.txt:11-30`：确认并保存（显示 Name, Location, Tools, Model, Description, System prompt 预览）

### 2. Task 工具调用的 input 结构（description/prompt/subagent_type/model/resume/run_in_background…）

**证据：**
- **完整 input 结构**：`proxy/traffic-logs/0026_2026-01-16T00-07-44,252_REQ__v1_messages.simple.json:618-622` 显示：
  ```json
  {
    "description": "Review bilibili2str codebase",
    "prompt": "Please review the current codebase...",
    "subagent_type": "code-reviewer"
  }
  ```
- **Task 工具 schema**：`proxy/traffic-logs/0026_2026-01-16T00-07-44,252_REQ__v1_messages.simple.json:141-180` 显示完整 input_schema：
  - `description` (required, string): 3-5 词简短描述
  - `prompt` (required, string): 任务描述
  - `subagent_type` (required, string): agent 类型
  - `model` (optional, enum: ["sonnet", "opus", "haiku"]): 可选模型覆盖
  - `resume` (optional, string): agent ID 用于恢复
  - `run_in_background` (optional, boolean): 后台运行标志

### 3. Subagent 的 `/v1/messages` 请求形态：messages 数量、system 注入、tools 列表（哪些被排除）

**证据：**
- **Messages 数量**：`proxy/traffic-logs/0027_2026-01-16T00-07-48,829_REQ__v1_messages.simple.json:11-26` 显示 subagent 请求仅包含 1 条 user message（Task 的 `prompt` 字段内容）
- **System prompt 注入**：`proxy/traffic-logs/0027_2026-01-16T00-07-48,829_REQ__v1_messages.simple.json:29-43` 显示：
  - 第一条：`"You are Claude Code, Anthropic's official CLI for Claude."`（标准系统提示）
  - 第二条：agent 的 system prompt（从 `.claude/agents/code-reviewer.md` 的 body 部分加载）
- **Tools 列表（排除项）**：`proxy/traffic-logs/0027_2026-01-16T00-07-48,829_REQ__v1_messages.simple.json:45-57` 显示 code-reviewer 的 tools 为：
  ```
  ["Bash", "Glob", "Grep", "Read", "Edit", "Write", "NotebookEdit", 
   "WebFetch", "TodoWrite", "WebSearch", "Skill", "SlashCommand"]
  ```
  **排除的工具**（对比主会话的 18 个工具）：
  - `Task`（防止嵌套）
  - `TaskOutput`（仅主会话使用）
  - `ExitPlanMode`（仅主会话使用）
  - `EnterPlanMode`（仅主会话使用）
  - `KillShell`（仅主会话使用）
  - `AskUserQuestion`（仅主会话使用）

### 4. Claude Code 是否存在"额外的 meta 请求"（例如 new topic 判定、bash filepaths 提取），它们的 system prompt 长什么样、输入输出格式是什么

**证据：**
- **New Topic 判定请求**：`proxy/traffic-logs/0025_2026-01-16T00-07-44,232_REQ__v1_messages.simple.json:31-40` 显示：
  - Model: `claude-haiku-4-5-20251001`（轻量模型）
  - System prompt: `"Analyze if this message indicates a new conversation topic. If it does, extract a 2-3 word title that captures the new topic. Format your response as a JSON object with two fields: 'isNewTopic' (boolean) and 'title' (string, or null if isNewTopic is false). Only include these fields, no other text. ONLY generate the JSON object, no other text (eg. no markdown)."`
  - Tools: `[]`（无工具）
  - 响应：`{"isNewTopic": true, "title": "Code Review"}`

**待验证**：是否存在"bash filepaths 提取"的 meta 请求（材料中未发现，需进一步抓包验证）

### 5. 终端 UI 行为：Task 的一行摘要、ctrl+o 展开、ctrl+b 后台、Thinking/Considering/Working 等状态展示

**证据：**
- **Task 一行摘要**：`plans/sub-agent/terminal-copy/9.txt:27` 显示：
  ```
  ⏺ code-reviewer(Review bilibili2str codebase)
  ```
- **ctrl+o 展开**：`plans/sub-agent/terminal-copy/9.txt:30` 显示 `+3 more tool uses (ctrl+o to expand)`
- **ctrl+b 后台**：`plans/sub-agent/terminal-copy/9.txt:31` 显示 `ctrl+b to run in background`
- **Thinking/Considering/Working 状态**：
  - `plans/sub-agent/terminal-copy/9.txt:33` 显示 `∴ Thought for 1s (ctrl+o to show thinking)`
  - `plans/sub-agent/terminal-copy/9.txt:35` 显示 `✻ Considering… (esc to interrupt)`
  - `record/claude-code/sub-agent.cast:4164` 显示 `✻ Considering…` 状态
  - `record/claude-code/sub-agent.cast:4033` 显示 `✻ Accomplishing…` 状态

---

## B. "Claude Code 子代理运行时约束"推断（必须区分：证据 / 推断）

### 证据（硬事实）

1. **code-reviewer 工具排除**：`proxy/traffic-logs/0027_2026-01-16T00-07-48,829_REQ__v1_messages.simple.json:45-57` 显示明确排除了 `Task`, `TaskOutput`, `ExitPlanMode`, `EnterPlanMode`, `KillShell`, `AskUserQuestion`
2. **agent.md 无 tools 字段**：`/Users/david/Documents/github/bilibili2str/.claude/agents/code-reviewer.md` 的 frontmatter 中**没有 `tools` 字段**，但 subagent 仍然有工具限制

### 推断（需验证）

1. **工具权限边界推断**：
   - **code-reviewer**（Tools: All tools）：实际运行时排除了 6 个"会话型工具"，但保留了 `Edit`, `Write`, `NotebookEdit`（可写入）
   - **Explore/Plan**：材料中未直接观察到，但根据 `proxy/traffic-logs/0027...simple.json:45-57` 的模式，推断它们也可能排除相同的 6 个工具
   - **general-purpose**：材料中未直接观察到，推断可能保留所有工具（包括 `Task`，但需验证是否允许嵌套调用）

2. **工具排除规则推断**：
   - 排除规则可能基于工具类型（"会话型工具"）而非 agent 配置
   - 即使 agent.md 声明 `tools: ["*"]`，运行时仍会排除 `NESTED_DENY_TOOLS` 集合

### 最小实验方案（补齐证据）

**实验 1：Read-only tools agent 的工具列表**
- 创建 agent，仅选择 "Read-only tools"
- 抓包观察 subagent 的 `/v1/messages` 请求中的 `tools` 数组
- 验证点：是否只包含 `Read`, `Glob`, `Grep`, `WebFetch`, `WebSearch` 等只读工具

**实验 2：agent.md 的 tools 字段影响**
- 创建 agent，选择 "All tools"，但手动编辑 agent.md 添加 `tools: ["Read", "Grep"]`
- 抓包观察 subagent 的 tools 列表
- 验证点：agent.md 的 `tools` 字段是否覆盖 UI 选择

**实验 3：general-purpose agent 的嵌套 Task 调用**
- 在主会话调用 `Task(subagent_type: "general-purpose", prompt: "请使用 Task 工具调用另一个 agent")`
- 抓包观察 general-purpose subagent 的 `/v1/messages` 请求
- 验证点：general-purpose 的 tools 列表是否包含 `Task`，以及是否允许嵌套调用

---

## C. 对比 Formax：差距清单 + 可落地 TODO（P0/P1/P2）

### 差距清单

| 功能点 | Claude Code | Formax 现状 | 优先级 |
|--------|-------------|-------------|--------|
| `/agents` 命令 UI | 完整向导（工具选择、模型、颜色、预览） | 待实现 | P0 |
| Agent 文件格式 | `.claude/agents/<name>.md`，frontmatter: `name`, `description`, `model`, `color` | 支持 `.formax/subagents/*.md`，frontmatter 字段不同 | P1 |
| Task input 结构 | `description`, `prompt`, `subagent_type`, `model?`, `resume?`, `run_in_background?` | 基本对齐，但 `description` 字段用途待确认 | P1 |
| Subagent tools 过滤 | 运行时硬排除 6 个"会话型工具" | `NESTED_DENY_TOOLS` 已实现，但列表可能不完整 | P0 |
| Subagent system prompt | 注入 agent.md 的 body 作为第二条 system message | 已实现 | ✅ |
| Subagent messages | 仅 1 条 user message（Task 的 prompt） | 已实现 | ✅ |
| 终端 UI：Task 摘要 | `agent-name(task-description)` 格式 | 待实现 | P1 |
| 终端 UI：ctrl+o 展开 | 显示 `+N more tool uses (ctrl+o to expand)` | 待实现 | P2 |
| 终端 UI：ctrl+b 后台 | 显示 `ctrl+b to run in background` | 待实现 | P2 |
| 终端 UI：状态显示 | `Thinking…`, `Considering…`, `Working…`, `Accomplishing…` | 待实现 | P1 |
| New Topic 判定 | 独立的 haiku 模型请求 | 未实现 | P2 |

### 可落地 TODO（P0/P1/P2）

#### P0：运行时硬限制/防护

**TODO-P0-1：完善 `NESTED_DENY_TOOLS` 列表**
- **影响范围**：`src/subagents/runner.ts`, `src/tools/executor/handlers/taskSubAgent.ts`
- **具体实现**：
  - 确认当前 `NESTED_DENY_TOOLS` 包含：`Task`, `TaskOutput`, `ExitPlanMode`, `EnterPlanMode`, `KillShell`, `AskUserQuestion`
  - 验证是否还需排除 `SlashCommand`（根据 `src/subagents/README.md:63` 已包含）
- **DoD**：
  - 单元测试：subagent 调用 `Task` 返回 "not allowed in subagent" 错误
  - 手动验证：创建 subagent，尝试调用 `Task`，确认被拒绝

**TODO-P0-2：运行时工具过滤（硬约束）**
- **影响范围**：`src/subagents/runner.ts:82-86`
- **具体实现**：
  - 在 `createSubAgentRunner` 中，无论 `agent.tools` 是否为 `["*"]`，都强制过滤 `NESTED_DENY_TOOLS`
  - 确保即使 agent.md 声明 `tools: ["*", "Task"]`，运行时仍排除 `Task`
- **DoD**：
  - 单元测试：`agent.tools = ["*"]` 时，subagent 的 tools 列表不包含 `NESTED_DENY_TOOLS`
  - 抓包验证：subagent 的 `/v1/messages` 请求的 `tools` 数组不包含被排除的工具

#### P1：核心功能对齐

**TODO-P1-1：实现 `/agents` 命令 UI**
- **影响范围**：`src/cli/commands/agents.ts`（新建）, `src/ui/agents/`（新建目录）
- **具体实现**：
  - 使用 Ink 实现向导流程：
    1. 工具选择（All tools / Read-only / Edit / Execution / Other，支持高级选项展开）
    2. 模型选择（Sonnet/Opus/Haiku/Inherit）
    3. 颜色选择（Automatic/Red/Blue/Green/Yellow/Purple/Orange/Pink/Cyan）
    4. 确认预览（显示 Name, Location, Tools, Model, Description, System prompt 预览）
  - 保存到 `.formax/agents/<name>.md`（或 `~/.formax/agents/<name>.md`）
- **DoD**：
  - 手动验证：运行 `/agents`，完成创建流程，确认文件保存正确
  - 单元测试：测试工具选择逻辑、文件保存格式

**TODO-P1-2：对齐 Agent 文件格式**
- **影响范围**：`src/subagents/registry.ts`, `src/adapters/agents.ts`（新建）
- **具体实现**：
  - Frontmatter 字段：`name`, `description`, `model?`, `color?`, `tools?`（可选，默认 `["*"]`）
  - 支持从 `.formax/agents/` 和 `~/.formax/agents/` 加载
  - `color` 字段用于终端 UI 显示（待 P1-4 实现）
- **DoD**：
  - 单元测试：解析包含 `model`, `color` 的 agent.md，确认字段正确加载
  - 手动验证：创建带 `color: blue` 的 agent，确认颜色生效

**TODO-P1-3：Task 工具调用的 `description` 字段用途**
- **影响范围**：`src/tools/modules/task/`, `src/screens/REPL.tsx`
- **具体实现**：
  - `description` 用于终端 UI 显示：`agent-name(description)` 格式
  - 在 `REPL.tsx` 的 `ToolMessage` 组件中，Task 工具调用显示为：`⏺ code-reviewer(Review bilibili2str codebase)`
- **DoD**：
  - 手动验证：调用 Task 工具，终端显示 `agent-name(description)` 格式
  - 单元测试：Task 工具 handler 正确提取 `description` 字段

**TODO-P1-4：终端 UI 状态显示**
- **影响范围**：`src/screens/REPL.tsx`, `src/components/ToolMessage.tsx`
- **具体实现**：
  - 显示状态：`Thinking…`, `Considering…`, `Working…`, `Accomplishing…`
  - 状态来源：从 streaming 响应的 `thinking` 或 `tool_use` 事件推断
  - 格式：`✻ Considering… (esc to interrupt)`
- **DoD**：
  - 手动验证：运行 subagent，观察终端显示状态变化
  - 单元测试：测试状态文本渲染逻辑

#### P2：增强功能

**TODO-P2-1：ctrl+o 展开工具调用**
- **影响范围**：`src/screens/REPL.tsx`, `src/components/ToolMessage.tsx`
- **具体实现**：
  - 当工具调用数量 > 3 时，显示 `+N more tool uses (ctrl+o to expand)`
  - 监听 `ctrl+o` 快捷键，展开显示所有工具调用
- **DoD**：
  - 手动验证：调用包含多个工具的 Task，按 `ctrl+o` 展开
  - 单元测试：测试展开/折叠逻辑

**TODO-P2-2：ctrl+b 后台运行提示**
- **影响范围**：`src/screens/REPL.tsx`, `src/components/ToolMessage.tsx`
- **具体实现**：
  - 在 Task 工具调用显示时，如果 `run_in_background` 为 `false`，显示 `ctrl+b to run in background`
  - 监听 `ctrl+b` 快捷键，将当前 Task 转为后台运行
- **DoD**：
  - 手动验证：调用 Task，按 `ctrl+b` 转为后台，使用 `TaskOutput` 获取结果
  - 单元测试：测试后台转换逻辑

**TODO-P2-3：New Topic 判定（可选）**
- **影响范围**：`src/core/topicDetector.ts`（新建）, `src/streaming/client.ts`
- **具体实现**：
  - 在用户输入后，使用轻量模型（haiku）判定是否为新话题
  - System prompt：`"Analyze if this message indicates a new conversation topic..."`
  - 返回 JSON：`{"isNewTopic": boolean, "title": string | null}`
  - 用于会话标题自动生成
- **DoD**：
  - 抓包验证：用户输入后，观察到独立的 haiku 模型请求
  - 单元测试：测试 topic 判定逻辑

---

## D. 自动化建议（可选但加分）

### 数据流设计

```
输入：
├── proxy/traffic-logs/*_REQ__v1_messages.simple.json（按 sequence 排序）
├── plans/sub-agent/terminal-copy/*.txt（按文件名排序）
└── record/claude-code/sub-agent.cast（可选，用于 UI 行为提取）

处理流程：
1. 解析 traffic-logs，提取：
   - Task 工具调用的 input（description, prompt, subagent_type, model, resume, run_in_background）
   - Subagent 的 /v1/messages 请求（messages 数量、system prompts、tools 列表）
   - Meta 请求（new topic 判定等）

2. 解析 terminal-copy，提取：
   - /agents 命令的 UI 流程步骤
   - Task 的终端显示格式（agent-name(description)）
   - 快捷键提示（ctrl+o, ctrl+b）
   - 状态显示（Thinking, Considering, Working）

3. 解析 sub-agent.cast（可选）：
   - 使用 asciinema-json 解析，提取 UI 渲染序列
   - 匹配 terminal-copy 的时间戳，关联 UI 行为

输出格式（JSON）：
{
  "agents_flow": {
    "steps": [...],
    "save_path": "...",
    "file_format": {...}
  },
  "task_input": {
    "schema": {...},
    "examples": [...]
  },
  "subagent_requests": [
    {
      "sequence": 27,
      "messages_count": 1,
      "system_prompts": [...],
      "tools": [...],
      "excluded_tools": [...]
    }
  ],
  "meta_requests": [...],
  "terminal_ui": {
    "task_display": "...",
    "shortcuts": {...},
    "states": [...]
  }
}
```

### 最小脚本结构

```python
# analyze_subagent.py
import json
import re
from pathlib import Path
from typing import Dict, List

def parse_traffic_logs(log_dir: Path) -> List[Dict]:
    """解析 traffic-logs，提取 Task 调用和 subagent 请求"""
    # 1. 按 sequence 排序
    # 2. 识别 Task 工具调用（tool name == "Task"）
    # 3. 识别 subagent 请求（下一个 sequence，messages 数量 == 1）
    # 4. 提取 tools 列表，计算 excluded_tools
    pass

def parse_terminal_copy(txt_dir: Path) -> Dict:
    """解析 terminal-copy，提取 UI 行为"""
    # 1. 识别 /agents 命令流程
    # 2. 提取 Task 显示格式（正则：agent-name\(description\)）
    # 3. 提取快捷键提示（ctrl+o, ctrl+b）
    # 4. 提取状态显示（Thinking, Considering）
    pass

def generate_report(traffic_data: List, terminal_data: Dict) -> str:
    """生成 Markdown 报告"""
    # 按照 A/B/C/D 章节格式输出
    pass

if __name__ == "__main__":
    traffic_logs = parse_traffic_logs(Path("proxy/traffic-logs"))
    terminal_copy = parse_terminal_copy(Path("plans/sub-agent/terminal-copy"))
    report = generate_report(traffic_logs, terminal_copy)
    print(report)
```

### 输出格式建议

报告应包含：
1. **事实清单**：每条事实带 `证据文件路径:行号` 或 `JSON path`
2. **推断部分**：明确标注"证据"vs"推断"，推断部分给出实验方案
3. **TODO 清单**：按 P0/P1/P2 分类，每条包含影响范围、具体实现、DoD
4. **自动化脚本**：可复用的 Python/TypeScript 脚本，支持增量分析

---

**报告完成时间**：2026-01-16  
**材料来源**：`plans/sub-agent/terminal-copy/`, `proxy/traffic-logs/`, `record/claude-code/sub-agent.cast`, `/Users/david/Documents/github/bilibili2str/.claude/agents/code-reviewer.md`
