# 创建自定义子代理

> 在 Claude Code 中创建和使用专门的 AI 子代理，用于特定任务工作流和改进的上下文管理。

子代理是处理特定类型任务的专门 AI 助手。每个子代理在自己的上下文窗口中运行，具有自定义系统提示、特定的工具访问权限和独立的权限。当 Claude 遇到与子代理描述相匹配的任务时，它会委托给该子代理，该子代理独立工作并返回结果。

子代理可以帮助您：

* **保留上下文**，通过将探索和实现保持在主对话之外
* **强制执行约束**，通过限制子代理可以使用的工具
* **跨项目重用配置**，使用用户级子代理
* **专门化行为**，使用针对特定领域的聚焦系统提示
* **控制成本**，通过将任务路由到更快、更便宜的模型（如 Haiku）

Claude 使用每个子代理的描述来决定何时委托任务。创建子代理时，请写一个清晰的描述，以便 Claude 知道何时使用它。

Claude Code 包括几个内置子代理，如 **Explore**、**Plan** 和 **general-purpose**。您也可以创建自定义子代理来处理特定任务。本页涵盖 [内置子代理](#built-in-subagents)、[如何创建您自己的](#quickstart-create-your-first-subagent)、[完整配置选项](#configure-subagents)、[使用子代理的模式](#work-with-subagents) 和 [示例子代理](#example-subagents)。

## 内置子代理

Claude Code 包括内置子代理，Claude 在适当时会自动使用。每个子代理都继承父对话的权限，并有额外的工具限制。

<Tabs>
  <Tab title="Explore">
    一个快速的、只读的代理，针对搜索和分析代码库进行了优化。

    * **模型**：Haiku（快速、低延迟）
    * **工具**：只读工具（拒绝访问写入和编辑工具）
    * **目的**：文件发现、代码搜索、代码库探索

    当 Claude 需要搜索或理解代码库而不进行更改时，它会委托给 Explore。这样可以将探索结果保持在主对话上下文之外。

    调用 Explore 时，Claude 指定一个彻底程度：**quick** 用于有针对性的查找，**medium** 用于平衡的探索，或 **very thorough** 用于全面分析。
  </Tab>

  <Tab title="Plan">
    在 [计划模式](/zh-CN/common-workflows#use-plan-mode-for-safe-code-analysis) 期间用于在呈现计划之前收集上下文的研究代理。

    * **模型**：继承自主对话
    * **工具**：只读工具（拒绝访问写入和编辑工具）
    * **目的**：用于规划的代码库研究

    当您处于计划模式且 Claude 需要理解您的代码库时，它会将研究委托给 Plan 子代理。这样可以防止无限嵌套（子代理无法生成其他子代理），同时仍然收集必要的上下文。
  </Tab>

  <Tab title="General-purpose">
    一个能够处理复杂、多步骤任务的代理，这些任务需要探索和操作。

    * **模型**：继承自主对话
    * **工具**：所有工具
    * **目的**：复杂研究、多步骤操作、代码修改

    当任务需要探索和修改、复杂推理来解释结果或多个相关步骤时，Claude 会委托给 general-purpose。
  </Tab>

  <Tab title="Other">
    Claude Code 包括用于特定任务的其他辅助代理。这些通常会自动调用，因此您不需要直接使用它们。

    | 代理                | 模型     | Claude 何时使用它                 |
    | :---------------- | :----- | :--------------------------- |
    | Bash              | 继承     | 在单独的上下文中运行终端命令               |
    | statusline-setup  | Sonnet | 当您运行 `/statusline` 来配置您的状态行时 |
    | Claude Code Guide | Haiku  | 当您提出关于 Claude Code 功能的问题时    |
  </Tab>
</Tabs>

除了这些内置子代理之外，您可以创建自己的子代理，具有自定义提示、工具限制、权限模式、钩子和技能。以下部分展示了如何开始和自定义子代理。

## 快速入门：创建您的第一个子代理

子代理在带有 YAML frontmatter 的 Markdown 文件中定义。您可以 [手动创建它们](#write-subagent-files) 或使用 `/agents` 斜杠命令。

本演练指导您使用 `/agent` 命令创建用户级子代理。该子代理审查代码并为代码库提出改进建议。

<Steps>
  <Step title="打开子代理界面">
    在 Claude Code 中，运行：

    ```
    /agents
    ```
  </Step>

  <Step title="创建新的用户级代理">
    选择 **Create new agent**，然后选择 **User-level**。这会将子代理保存到 `~/.claude/agents/`，以便在所有项目中可用。
  </Step>

  <Step title="使用 Claude 生成">
    选择 **Generate with Claude**。出现提示时，描述子代理：

    ```
    一个代码改进代理，扫描文件并为可读性、性能和最佳实践提出改进建议。
    它应该解释每个问题、显示当前代码并提供改进版本。
    ```

    Claude 生成系统提示和配置。如果您想自定义它，请按 `e` 在编辑器中打开它。
  </Step>

  <Step title="选择工具">
    对于只读审查者，取消选择除 **Read-only tools** 之外的所有内容。如果您保持所有工具被选中，子代理将继承主对话可用的所有工具。
  </Step>

  <Step title="选择模型">
    选择子代理使用的模型。对于此示例代理，选择 **Sonnet**，它在分析代码模式的能力和速度之间取得平衡。
  </Step>

  <Step title="选择颜色">
    为子代理选择背景颜色。这可以帮助您在 UI 中识别哪个子代理正在运行。
  </Step>

  <Step title="保存并尝试">
    保存子代理。它立即可用（无需重启）。尝试它：

    ```
    使用 code-improver 代理为此项目提出改进建议
    ```

    Claude 委托给您的新子代理，该子代理扫描代码库并返回改进建议。
  </Step>
</Steps>

现在您有了一个子代理，可以在您机器上的任何项目中使用它来分析代码库并提出改进建议。

您也可以手动创建子代理作为 Markdown 文件、通过 CLI 标志定义它们，或通过插件分发它们。以下部分涵盖所有配置选项。

## 配置子代理

### 使用 /agents 命令

`/agents` 命令提供了一个交互式界面来管理子代理。运行 `/agents` 来：

* 查看所有可用的子代理（内置、用户、项目和插件）
* 使用引导式设置或 Claude 生成创建新子代理
* 编辑现有子代理配置和工具访问
* 删除自定义子代理
* 查看当存在重复项时哪些子代理处于活动状态

这是创建和管理子代理的推荐方式。对于手动创建或自动化，您也可以直接添加子代理文件。

### 选择子代理范围

子代理是带有 YAML frontmatter 的 Markdown 文件。根据范围将它们存储在不同位置。当多个子代理共享相同名称时，优先级较高的位置获胜。

| 位置                  | 范围      | 优先级   | 如何创建                        |
| :------------------ | :------ | :---- | :-------------------------- |
| `--agents` CLI 标志   | 当前会话    | 1（最高） | 启动 Claude Code 时传递 JSON     |
| `.claude/agents/`   | 当前项目    | 2     | 交互式或手动                      |
| `~/.claude/agents/` | 所有项目    | 3     | 交互式或手动                      |
| 插件的 `agents/` 目录    | 启用插件的位置 | 4（最低） | 与 [插件](/zh-CN/plugins) 一起安装 |

**项目子代理**（`.claude/agents/`）非常适合特定于代码库的子代理。将它们检查到版本控制中，以便您的团队可以协作使用和改进它们。

**用户子代理**（`~/.claude/agents/`）是在所有项目中可用的个人子代理。

**CLI 定义的子代理**在启动 Claude Code 时作为 JSON 传递。它们仅存在于该会话中，不会保存到磁盘，使其对快速测试或自动化脚本很有用：

```bash  theme={null}
claude --agents '{
  "code-reviewer": {
    "description": "Expert code reviewer. Use proactively after code changes.",
    "prompt": "You are a senior code reviewer. Focus on code quality, security, and best practices.",
    "tools": ["Read", "Grep", "Glob", "Bash"],
    "model": "sonnet"
  }
}'
```

`--agents` 标志接受与 [frontmatter](#supported-frontmatter-fields) 相同字段的 JSON。对系统提示使用 `prompt`（等同于基于文件的子代理中的 markdown 正文）。有关完整 JSON 格式，请参阅 [CLI 参考](/zh-CN/cli-reference#agents-flag-format)。

**插件子代理**来自您已安装的 [插件](/zh-CN/plugins)。它们与您的自定义子代理一起出现在 `/agents` 中。有关创建插件子代理的详细信息，请参阅 [插件组件参考](/zh-CN/plugins-reference#agents)。

### 编写子代理文件

子代理文件使用 YAML frontmatter 进行配置，然后是 Markdown 中的系统提示：

<Note>
  子代理在会话启动时加载。如果您通过手动添加文件来创建子代理，请重启会话或使用 `/agents` 立即加载它。
</Note>

```markdown  theme={null}
---
name: code-reviewer
description: Reviews code for quality and best practices
tools: Read, Glob, Grep
model: sonnet
---

You are a code reviewer. When invoked, analyze the code and provide
specific, actionable feedback on quality, security, and best practices.
```

frontmatter 定义子代理的元数据和配置。正文成为指导子代理行为的系统提示。子代理仅接收此系统提示（加上基本环境详细信息，如工作目录），而不是完整的 Claude Code 系统提示。

#### 支持的 frontmatter 字段

以下字段可用于 YAML frontmatter。只有 `name` 和 `description` 是必需的。

| 字段                | 必需 | 描述                                                                                       |
| :---------------- | :- | :--------------------------------------------------------------------------------------- |
| `name`            | 是  | 使用小写字母和连字符的唯一标识符                                                                         |
| `description`     | 是  | Claude 何时应委托给此子代理                                                                        |
| `tools`           | 否  | 子代理可以使用的 [工具](#available-tools)。如果省略，继承所有工具                                              |
| `disallowedTools` | 否  | 要拒绝的工具，从继承或指定的列表中删除                                                                      |
| `model`           | 否  | [模型](#choose-a-model) 使用：`sonnet`、`opus`、`haiku` 或 `inherit`。默认为 `sonnet`                |
| `permissionMode`  | 否  | [权限模式](#permission-modes)：`default`、`acceptEdits`、`dontAsk`、`bypassPermissions` 或 `plan` |
| `skills`          | 否  | 在启动时加载到子代理上下文中的 [技能](/zh-CN/skills)。注入完整技能内容，而不仅仅是使其可用于调用。子代理不继承父对话中的技能                  |
| `hooks`           | 否  | 限定于此子代理的 [生命周期钩子](#define-hooks-for-subagents)                                           |

### 选择模型

`model` 字段控制子代理使用的 [AI 模型](/zh-CN/model-config)：

* **模型别名**：使用可用别名之一：`sonnet`、`opus` 或 `haiku`
* **inherit**：使用与主对话相同的模型（对于一致性很有用）
* **省略**：如果未指定，使用为子代理配置的默认模型（`sonnet`）

### 控制子代理功能

您可以通过工具访问、权限模式和条件规则来控制子代理可以做什么。

#### 可用工具

子代理可以使用 Claude Code 的任何 [内部工具](/zh-CN/settings#tools-available-to-claude)。默认情况下，子代理继承主对话中的所有工具，包括 MCP 工具。

要限制工具，请使用 `tools` 字段（允许列表）或 `disallowedTools` 字段（拒绝列表）：

```yaml  theme={null}
---
name: safe-researcher
description: Research agent with restricted capabilities
tools: Read, Grep, Glob, Bash
disallowedTools: Write, Edit
---
```

#### 权限模式

`permissionMode` 字段控制子代理如何处理权限提示。子代理继承主对话的权限上下文，但可以覆盖模式。

| 模式                  | 行为                    |
| :------------------ | :-------------------- |
| `default`           | 带提示的标准权限检查            |
| `acceptEdits`       | 自动接受文件编辑              |
| `dontAsk`           | 自动拒绝权限提示（显式允许的工具仍然有效） |
| `bypassPermissions` | 跳过所有权限检查              |
| `plan`              | 计划模式（只读探索）            |

<Warning>
  谨慎使用 `bypassPermissions`。它跳过所有权限检查，允许子代理在没有批准的情况下执行任何操作。
</Warning>

如果父级使用 `bypassPermissions`，这将优先并且无法被覆盖。

#### 使用钩子的条件规则

为了更动态地控制工具使用，请使用 `PreToolUse` 钩子在执行前验证操作。当您需要允许工具的某些操作同时阻止其他操作时，这很有用。

此示例创建一个子代理，通过在执行前验证命令来仅允许只读数据库查询：

```yaml  theme={null}
---
name: db-reader
description: Execute read-only database queries
tools: Bash
hooks:
  PreToolUse:
    - matcher: "Bash"
      hooks:
        - type: command
          command: "./scripts/validate-readonly-query.sh"
---
```

验证脚本检查 `$TOOL_INPUT` 并以非零代码退出以阻止写入操作。有关更多钩子配置选项，请参阅 [为子代理定义钩子](#define-hooks-for-subagents)。

#### 禁用特定子代理

您可以通过将子代理添加到 [设置](/zh-CN/settings#permission-settings) 中的 `deny` 数组来防止 Claude 使用特定子代理。使用格式 `Task(subagent-name)`，其中 `subagent-name` 与子代理的 name 字段匹配。

```json  theme={null}
{
  "permissions": {
    "deny": ["Task(Explore)", "Task(my-custom-agent)"]
  }
}
```

这适用于内置和自定义子代理。您也可以使用 `--disallowedTools` CLI 标志：

```bash  theme={null}
claude --disallowedTools "Task(Explore)"
```

有关权限规则的更多详细信息，请参阅 [IAM 文档](/zh-CN/iam#tool-specific-permission-rules)。

### 为子代理定义钩子

子代理可以定义在子代理生命周期中运行的 [钩子](/zh-CN/hooks)。有两种方式配置钩子：

1. **在子代理的 frontmatter 中**：定义仅在该子代理处于活动状态时运行的钩子
2. **在 `settings.json` 中**：定义在子代理启动或停止时在主会话中运行的钩子

#### 子代理 frontmatter 中的钩子

直接在子代理的 markdown 文件中定义钩子。这些钩子仅在该特定子代理处于活动状态时运行，并在完成时清理。

| 事件            | 匹配器输入 | 何时触发      |
| :------------ | :---- | :-------- |
| `PreToolUse`  | 工具名称  | 子代理使用工具之前 |
| `PostToolUse` | 工具名称  | 子代理使用工具之后 |
| `Stop`        | （无）   | 子代理完成时    |

此示例使用 `PreToolUse` 钩子验证 Bash 命令，并在文件编辑后使用 `PostToolUse` 运行 linter：

```yaml  theme={null}
---
name: code-reviewer
description: Review code changes with automatic linting
hooks:
  PreToolUse:
    - matcher: "Bash"
      hooks:
        - type: command
          command: "./scripts/validate-command.sh $TOOL_INPUT"
  PostToolUse:
    - matcher: "Edit|Write"
      hooks:
        - type: command
          command: "./scripts/run-linter.sh"
---
```

frontmatter 中的 `Stop` 钩子会自动转换为 `SubagentStop` 事件。

#### 子代理事件的项目级钩子

在 `settings.json` 中配置钩子，以响应主会话中的子代理生命周期事件。使用 `matcher` 字段按名称针对特定代理类型。

| 事件              | 匹配器输入  | 何时触发     |
| :-------------- | :----- | :------- |
| `SubagentStart` | 代理类型名称 | 子代理开始执行时 |
| `SubagentStop`  | 代理类型名称 | 子代理完成时   |

此示例仅在 `db-agent` 子代理启动和停止时运行设置和清理脚本：

```json  theme={null}
{
  "hooks": {
    "SubagentStart": [
      {
        "matcher": "db-agent",
        "hooks": [
          { "type": "command", "command": "./scripts/setup-db-connection.sh" }
        ]
      }
    ],
    "SubagentStop": [
      {
        "matcher": "db-agent",
        "hooks": [
          { "type": "command", "command": "./scripts/cleanup-db-connection.sh" }
        ]
      }
    ]
  }
}
```

有关完整的钩子配置格式，请参阅 [钩子](/zh-CN/hooks)。

## 使用子代理

### 理解自动委托

Claude 根据您请求中的任务描述、子代理配置中的 `description` 字段和当前上下文自动委托任务。为了鼓励主动委托，在子代理的 description 字段中包含"use proactively"之类的短语。

您也可以显式请求特定子代理：

```
使用 test-runner 子代理来修复失败的测试
让 code-reviewer 子代理查看我最近的更改
```

### 在前台或后台运行子代理

子代理可以在前台（阻塞）或后台（并发）运行：

* **前台子代理**阻塞主对话直到完成。权限提示和澄清问题（如 [`AskUserQuestion`](/zh-CN/settings#tools-available-to-claude)）会传递给您。
* **后台子代理**在您继续工作时并发运行。它们继承父级的权限并自动拒绝任何未预先批准的内容。如果后台子代理需要它没有的权限或需要提出澄清问题，该工具调用失败但子代理继续。MCP 工具在后台子代理中不可用。

如果后台子代理由于缺少权限而失败，您可以 [恢复它](#resume-subagents) 在前台以使用交互式提示重试。

Claude 根据任务决定是否在前台或后台运行子代理。您也可以：

* 要求 Claude "在后台运行"
* 按 **Ctrl+B** 将运行中的任务放在后台

### 常见模式

#### 隔离高容量操作

子代理最有效的用途之一是隔离产生大量输出的操作。运行测试、获取文档或处理日志文件可能会消耗大量上下文。通过将这些委托给子代理，详细输出保留在子代理的上下文中，而只有相关摘要返回到主对话。

```
使用子代理运行测试套件，仅报告失败的测试及其错误消息
```

#### 并行运行研究

对于独立调查，生成多个子代理同时工作：

```
使用单独的子代理并行研究身份验证、数据库和 API 模块
```

每个子代理独立探索其区域，然后 Claude 综合这些发现。当研究路径彼此不依赖时，这效果最好。

<Warning>
  当子代理完成时，它们的结果返回到主对话。运行许多子代理，每个都返回详细结果，可能会消耗大量上下文。
</Warning>

#### 链接子代理

对于多步骤工作流，要求 Claude 按顺序使用子代理。每个子代理完成其任务并将结果返回给 Claude，然后 Claude 将相关上下文传递给下一个子代理。

```
使用 code-reviewer 子代理查找性能问题，然后使用 optimizer 子代理修复它们
```

### 在子代理和主对话之间选择

在以下情况下使用**主对话**：

* 任务需要频繁的来回或迭代改进
* 多个阶段共享重要上下文（规划 → 实现 → 测试）
* 您正在进行快速、有针对性的更改
* 延迟很重要。子代理从头开始，可能需要时间收集上下文

在以下情况下使用**子代理**：

* 任务产生您不需要在主上下文中的详细输出
* 您想强制执行特定的工具限制或权限
* 工作是自包含的，可以返回摘要

当您想要在主对话上下文中运行的可重用提示或工作流而不是隔离的子代理上下文时，请考虑改用 [技能](/zh-CN/skills)。

<Note>
  子代理无法生成其他子代理。如果您的工作流需要嵌套委托，请使用 [技能](/zh-CN/skills) 或从主对话 [链接子代理](#chain-subagents)。
</Note>

### 管理子代理上下文

#### 恢复子代理

每个子代理调用都会创建一个具有新鲜上下文的新实例。要继续现有子代理的工作而不是重新开始，请要求 Claude 恢复它。

恢复的子代理保留其完整的对话历史，包括所有以前的工具调用、结果和推理。子代理从停止的地方继续，而不是从头开始。

当子代理完成时，Claude 接收其代理 ID。要恢复子代理，请要求 Claude 继续之前的工作：

```
使用 code-reviewer 子代理审查身份验证模块
[代理完成]

继续该代码审查，现在分析授权逻辑
[Claude 使用来自先前对话的完整上下文恢复子代理]
```

您也可以要求 Claude 提供代理 ID（如果您想显式引用它），或在 `~/.claude/projects/{project}/{sessionId}/subagents/` 的成绩单文件中查找 ID。每个成绩单存储为 `agent-{agentId}.jsonl`。

对于编程使用，请参阅 [Agent SDK 中的子代理](/zh-CN/agent-sdk/subagents)。

子代理成绩单独立于主对话持久化：

* **主对话压缩**：当主对话压缩时，子代理成绩单不受影响。它们存储在单独的文件中。
* **会话持久性**：子代理成绩单在其会话中持久化。您可以通过恢复相同会话在重启 Claude Code 后 [恢复子代理](#resume-subagents)。
* **自动清理**：成绩单根据 `cleanupPeriodDays` 设置进行清理（默认：30 天）。

#### 自动压缩

子代理支持使用与主对话相同的逻辑进行自动压缩。当子代理的上下文接近其限制时，Claude Code 会总结较旧的消息以释放空间，同时保留重要上下文。

压缩事件记录在子代理成绩单文件中：

```json  theme={null}
{
  "type": "system",
  "subtype": "compact_boundary",
  "compactMetadata": {
    "trigger": "auto",
    "preTokens": 167189
  }
}
```

`preTokens` 值显示压缩发生前使用了多少令牌。

## 示例子代理

这些示例演示了构建子代理的有效模式。将它们用作起点，或使用 Claude 生成自定义版本。

<Tip>
  **最佳实践：**

  * **设计聚焦的子代理：** 每个子代理应该在一个特定任务中表现出色
  * **编写详细的描述：** Claude 使用描述来决定何时委托
  * **限制工具访问：** 仅授予必要的权限以确保安全和聚焦
  * **检查到版本控制：** 与您的团队共享项目子代理
</Tip>

### 代码审查者

一个只读子代理，审查代码而不修改它。此示例展示了如何设计一个具有有限工具访问权限（无编辑或写入）和详细提示的聚焦子代理，该提示精确指定要查找的内容以及如何格式化输出。

```markdown  theme={null}
---
name: code-reviewer
description: Expert code review specialist. Proactively reviews code for quality, security, and maintainability. Use immediately after writing or modifying code.
tools: Read, Grep, Glob, Bash
model: inherit
---

You are a senior code reviewer ensuring high standards of code quality and security.

When invoked:
1. Run git diff to see recent changes
2. Focus on modified files
3. Begin review immediately

Review checklist:
- Code is clear and readable
- Functions and variables are well-named
- No duplicated code
- Proper error handling
- No exposed secrets or API keys
- Input validation implemented
- Good test coverage
- Performance considerations addressed

Provide feedback organized by priority:
- Critical issues (must fix)
- Warnings (should fix)
- Suggestions (consider improving)

Include specific examples of how to fix issues.
```

### 调试器

一个可以分析和修复问题的子代理。与代码审查者不同，这个包括编辑，因为修复错误需要修改代码。提示提供了从诊断到验证的清晰工作流。

```markdown  theme={null}
---
name: debugger
description: Debugging specialist for errors, test failures, and unexpected behavior. Use proactively when encountering any issues.
tools: Read, Edit, Bash, Grep, Glob
---

You are an expert debugger specializing in root cause analysis.

When invoked:
1. Capture error message and stack trace
2. Identify reproduction steps
3. Isolate the failure location
4. Implement minimal fix
5. Verify solution works

Debugging process:
- Analyze error messages and logs
- Check recent code changes
- Form and test hypotheses
- Add strategic debug logging
- Inspect variable states

For each issue, provide:
- Root cause explanation
- Evidence supporting the diagnosis
- Specific code fix
- Testing approach
- Prevention recommendations

Focus on fixing the underlying issue, not the symptoms.
```

### 数据科学家

一个用于数据分析工作的特定领域子代理。此示例展示了如何为典型编码任务之外的专门工作流创建子代理。它显式设置 `model: sonnet` 以进行更强大的分析。

```markdown  theme={null}
---
name: data-scientist
description: Data analysis expert for SQL queries, BigQuery operations, and data insights. Use proactively for data analysis tasks and queries.
tools: Bash, Read, Write
model: sonnet
---

You are a data scientist specializing in SQL and BigQuery analysis.

When invoked:
1. Understand the data analysis requirement
2. Write efficient SQL queries
3. Use BigQuery command line tools (bq) when appropriate
4. Analyze and summarize results
5. Present findings clearly

Key practices:
- Write optimized SQL queries with proper filters
- Use appropriate aggregations and joins
- Include comments explaining complex logic
- Format results for readability
- Provide data-driven recommendations

For each analysis:
- Explain the query approach
- Document any assumptions
- Highlight key findings
- Suggest next steps based on data

Always ensure queries are efficient and cost-effective.
```

## 后续步骤

现在您了解了子代理，请探索这些相关功能：

* [使用插件分发子代理](/zh-CN/plugins) 在团队或项目中共享子代理
* [以编程方式运行 Claude Code](/zh-CN/headless) 使用 Agent SDK 进行 CI/CD 和自动化
* [使用 MCP 服务器](/zh-CN/mcp) 为子代理提供对外部工具和数据的访问


---

> To find navigation and other pages in this documentation, fetch the llms.txt file at: https://code.claude.com/docs/llms.txt

