# Deferred Tool Exposure × Prompt/Reminder Alignment Map (2026-03-06)

## 目标

在真正修改 Formax 的系统提示词和 user-side reminder 之前，先把以下三件事固定下来：

1. 旧版 Formax、接入 ToolSearch 的 Formax、新版 CC 的抓包差异。
2. 哪些差异属于 `body.system`，哪些属于 `body.messages[*].content` 注入块，哪些属于 `tools[]` 暴露方式。
3. 当 `FORMAX_DEFERRED_TOOL_EXPOSURE=1` 时，后续应该对齐到哪一套行为。

这份文档只做“对齐基线”和“改造目标”记录，不在这里拍实现细节。

## 术语澄清

| 术语 | 含义 | 抓包字段 |
| --- | --- | --- |
| core system prompt | 模型固定系统提示词 | `request.body.system` |
| user-side reminder | 每轮附加在用户消息前面的提醒块 | `request.body.messages[*].content[*].text` |
| deferred tool inventory | 延迟暴露工具清单 | `<available-deferred-tools>...</available-deferred-tools>` |
| tool exposure mode | 首轮到底是全量工具，还是只暴露 `ToolSearch` | `request.body.tools` |

一个容易混淆的点：

- `<system-reminder>...</system-reminder>` 通常在 `messages` 里，不在 `system` 里。
- `skills reminder` 是 user-side reminder，不是 core system prompt。
- `FORMAX_DEFERRED_TOOL_EXPOSURE=1` 当前主要改变的是工具暴露方式；历史抓包里并没有同步切换 core system prompt。

## 典型文件索引

| ID | 场景 | 代表文件 | 关键位置 | 说明 |
| --- | --- | --- | --- | --- |
| A | 旧版 Formax，未开启 deferred exposure | `proxy/traffic-log-2026-03-06T21-24-53/0001_2026-03-06T21-25-24,657_REQ__v1_messages.json` | `messages`: 37-53, `system`: 55-69, `tools`: 71+ | 旧的 Formax 基线 |
| B | 接入 ToolSearch 的 Formax，历史抓包 | `proxy/traffic-log-2026-03-06T05-07-47/0001_2026-03-06T05-08-00,816_REQ__v1_messages.json` | `messages`: 37-60, `system`: 62-76, `tools`: 78-97 | 只改了工具暴露方式，没有同步升级 prompt family |
| C | 新版 CC，多工具直出 | `proxy/traffic-log-2026-03-06T21-32-44/0001_2026-03-06T21-32-56,179_REQ__v1_messages.json` | `messages`: 33-53, `system`: 55-69, `tools`: 71+ | 新版 CC 的新 prompt family，但不是 ToolSearch-only 模式 |
| D | 新版 CC，ToolSearch-only / deferred 模式 | `proxy/traffic-log-2026-03-06T04-51-59/0002_2026-03-06T04-53-09,862_REQ__v1_messages.json` | `messages`: 33-80, `system`: 82-92, `tools`: 1 tool only | 新版 CC 的 deferred 暴露基准 |

## 抓包对比总表

| Case | 对应模式 | user-side 注入块 | core `system[0]` | core `system[1]` | `tools[]` 首轮暴露 | 结论 |
| --- | --- | --- | --- | --- | --- | --- |
| A. 旧版 Formax | `FORMAX_DEFERRED_TOOL_EXPOSURE=0` 基线 | `todo empty reminder` -> 用户文本 | `You are Claude Code, Anthropic's official CLI for Claude.` | 旧 Formax prompt family：`interactive CLI tool` + `Tone and style` + `Task management` + `Tool usage policy` + cwd/subagents/env | 全量工具 | 老模式：全量工具 + 旧 prompt family |
| B. ToolSearch Formax（历史抓包） | `FORMAX_DEFERRED_TOOL_EXPOSURE=1` 历史状态 | `<available-deferred-tools>` -> `todo empty reminder` -> 用户文本 | 和 A 完全相同 | 和 A 基本完全相同；只有日期不同 | 只有 `ToolSearch` | 这里只做了 exposure 切换，没有同步升级 prompt/reminder family |
| C. 新版 CC，多工具 | CC 新版但不是 ToolSearch-only | `skills reminder` -> `claudeMd/currentDate reminder` -> 用户文本 | `...running within the Claude Agent SDK.` | 新 CC prompt family：`interactive agent` + `# System` + `# Doing tasks` + `# Executing actions with care` + `# Using your tools` + `# auto memory` + `# Environment` + `# VSCode Extension Context` | 多工具直接暴露 | 新版 CC 的新 prompt family 基准 |
| D. 新版 CC，ToolSearch-only | CC 新版 deferred 模式 | `<available-deferred-tools>` -> `skills reminder` -> `claudeMd/currentDate reminder` -> 用户文本 | 同 C | 同 C（同一家族，只有 repo/env 内容不同） | 只有 `ToolSearch` | 新版 CC 中，“ToolSearch-only” 和“新 prompt/reminder family”是联动的 |

## 逐项确认

### A. 旧版 Formax（未开启 deferred exposure）

文件：`proxy/traffic-log-2026-03-06T21-24-53/0001_2026-03-06T21-25-24,657_REQ__v1_messages.json`

关键点：

- `messages[0]` 只有两段：
  - `todo empty reminder`
  - 用户文本
- `system[0]` 是旧 base line：
  - `You are Claude Code, Anthropic's official CLI for Claude.`
- `system[1]` 是旧 Formax 自己的 prompt family：
  - `interactive CLI tool`
  - `# Tone and style`
  - `# Professional objectivity`
  - `# Planning without timelines`
  - `# Task management`
  - `# Asking questions as you work`
  - `# Doing tasks`
  - `# Tool usage policy`
  - 最后拼 cwd/subagents/env/model
- `tools[]` 是全量工具直接暴露。

这份文件是“旧 Formax prompt/reminder/exposure 三件套”的完整基线。

### B. 接入 ToolSearch 的 Formax（历史抓包）

文件：`proxy/traffic-log-2026-03-06T05-07-47/0001_2026-03-06T05-08-00,816_REQ__v1_messages.json`

关键点：

- `messages[0]` 变成三段：
  - `<available-deferred-tools>`
  - `todo empty reminder`
  - 用户文本
- `system[0]` 仍然是旧 base line：
  - `You are Claude Code, Anthropic's official CLI for Claude.`
- `system[1]` 与 A 基本一致；对比后仅看到日期从 `2026-03-06` 变成 `2026-03-05`。
- `tools[]` 从全量工具变成只剩 `ToolSearch`。

这说明历史上的 Formax deferred mode 只做了两件事：

1. 在 user-side 注入 `<available-deferred-tools>`。
2. 把 `tools[]` 改成只暴露 `ToolSearch`。

没有做的事：

- 没有切换到新版 CC 的 core system prompt。
- 没有新增 skills reminder。
- 没有新增 `claudeMd/currentDate` reminder。

### C. 新版 CC，多工具直出

文件：`proxy/traffic-log-2026-03-06T21-32-44/0001_2026-03-06T21-32-56,179_REQ__v1_messages.json`

关键点：

- `messages[0]` 是：
  - `skills reminder`
  - `claudeMd/currentDate reminder`
  - 用户文本
- `system[0]` 升级成：
  - `You are Claude Code, Anthropic's official CLI for Claude, running within the Claude Agent SDK.`
- `system[1]` 已经是新版 CC family：
  - `interactive agent`
  - `# System`
  - `# Doing tasks`
  - `# Executing actions with care`
  - `# Using your tools`
  - `# Tone and style`
  - `# auto memory`
  - `# Environment`
  - `# VSCode Extension Context`
- `tools[]` 依然是多工具全量暴露。

这份文件说明：新版 CC 的 prompt/reminder family 已经明显和旧 Formax 分家了。

### D. 新版 CC，ToolSearch-only / deferred 模式

文件：`proxy/traffic-log-2026-03-06T04-51-59/0002_2026-03-06T04-53-09,862_REQ__v1_messages.json`

关键点：

- 第一条用户消息就是 `<available-deferred-tools>`。
- 第二条用户消息再放：
  - `skills reminder`
  - `claudeMd/currentDate reminder`
  - 用户文本
- `system[0]` / `system[1]` 和 C 属于同一新版 CC family。
- `tools[]` 首轮只有 `ToolSearch`。

这个 case 是后续 `FORMAX_DEFERRED_TOOL_EXPOSURE=1` 对齐时最重要的参考目标。

## 最关键的判断

### 1. 历史上的 Formax deferred mode 不是“新版 CC prompt family”

B 的历史抓包说明：

- `FORMAX_DEFERRED_TOOL_EXPOSURE=1` 当时只影响了 exposure。
- 它没有同时把 prompt/reminder 切换到新版 CC 风格。

也就是说，当时的 Formax 是：

- `旧 Formax system prompt`
- 加上 `ToolSearch-only exposure`

这是一个“半对齐”状态。

### 2. 新版 CC 里，deferred exposure 和 prompt/reminder family 是联动的

对比 C 和 D：

- C 是新版 CC 的多工具模式。
- D 是新版 CC 的 ToolSearch-only 模式。
- 两者的 core system prompt family 是同一套，只是工具暴露方式不同。
- D 在 user-side 多了 `<available-deferred-tools>`，同时依然保留 skills reminder 和 `claudeMd/currentDate` reminder。

因此，对于 Formax 来说，后续如果要把 `FORMAX_DEFERRED_TOOL_EXPOSURE=1` 真正对齐新版 CC，不应只改 `tools[]`，还应同步改 reminder/prompt framing。

### 3. skills reminder 属于 user-side reminder，不属于 core system prompt

这个点必须固定下来，不然后面会一直混。

- 新版 CC 中的 skills 内容在 `messages[*].content[*].text` 里。
- 它不是 `system[]` 的一部分。
- 所以后续要对齐 skills reminder，应改的是 user-side 注入链路，而不是 `buildSystemPrompt()` 里的正文段落。

### 4. `claudeMd/currentDate` 也是 user-side reminder，不属于 core system prompt

同样：

- `claudeMd/currentDate` 在新版 CC 抓包里也是 `<system-reminder>` 文本块。
- 它不应该被当成 core system prompt 的一部分。

## 当前源码现状（已更新到 2026-03-06 这轮改造后）

### 1. core system prompt 已支持按 deferred exposure 联动切换

文件：`packages/core/src/prompts/system.ts`

当前实现：

- 新增 `SystemPromptVariant`：
  - `legacy`
  - `deferred_aligned`
- 新增 `resolveSystemPromptVariant({ deferredToolExposureEnabled })`：
  - `false/缺省 -> legacy`
  - `true -> deferred_aligned`
- `deferred_aligned` 变体采用新版 CC 风格章节骨架：
  - `# System`
  - `# Doing tasks`
  - `# Executing actions with care`
  - `# Using your tools`
  - `# Tone and style`
  - `# Environment`

### 2. system prompt 的扩展能力已改成“代码级 capability 开关”，不依赖 env

文件：`packages/core/src/prompts/system.ts`

当前实现：

- 新增 `SystemPromptCapabilities`，并按 variant 提供默认值：
  - `includeAgentSdkIdentitySuffix`
  - `includeAutoMemorySection`
  - `includeVsCodeExtensionContextSection`
  - `includeFastModeInfoSection`
  - `includeModelFamilyHint`
- 这些 capability 明确写在代码里，并带注释说明“不是环境变量”。
- 后续某能力实现后，只需打开对应 capability 即可，不需要再改提示词拼接主流程。

### 3. 入口联动已覆盖 REPL + /compact 路径 + app-server + SDK

文件：

- `packages/core/src/features/repl/controller/send/sendMainTurn.ts`
- `packages/core/src/features/repl/controller/send/send.ts`
- `packages/core/src/features/repl/controller/send/sendPreMainRouting.ts`
- `packages/core/src/features/repl/controller/send/sendOrchestration.ts`
- `packages/core/src/app-server/turnRunner.ts`
- `packages/core/src/sdk/query/runner.ts`

当前实现：

- 以上入口都已根据 `deferredToolExposureEnabled` 选择 `buildSystemPrompt` variant。
- 结论：不只是主 REPL 首轮，`/compact`、app-server、SDK 也不会再走“旧 prompt + ToolSearch-only”混合态。

### 4. deferred mode 的 skills reminder 已改成 CC 风格 bullets

文件：`packages/core/src/tools/modules/skill/index.ts`

当前实现：

- `buildAvailableSkillsSystemReminderText` 现为：
  - `The following skills are available for use with the Skill tool:`
  - 后面接 `- name: description` 的 bullet 列表
- 不再使用 `<available_skills>` XML 块作为 reminder 文案。
- 同时保留了 `Skill` 工具 description 内部的 `<available_skills>` 结构，不影响工具规范与已有行为。
- reminder 文本会做轻量清洗（`<`/`>` 转义、换行折叠）以避免注入破坏 `<system-reminder>` 包裹结构。

### 5. deferred exposure 核心语义保持不变

文件：`packages/core/src/tools/runtime/deferredToolExposureResolver.ts`

当前实现：

- `FORMAX_DEFERRED_TOOL_EXPOSURE=1` 时：
  - 首轮 `tools[]` 仅暴露 `ToolSearch`
  - 注入 `<available-deferred-tools>`
  - 注入 skills reminder（若有可用 skills）
- `resolveToolsForCall` 仍负责在 `ToolSearch(select:...)` 之后动态返回 `ToolSearch + loaded tools`。

### 6. 已补齐并更新的测试覆盖

文件：

- `packages/core/src/prompts/system.test.ts`
- `packages/core/src/features/repl/controller/send/sendMainTurn.test.ts`
- `packages/core/src/tools/runtime/deferredToolExposureResolver.test.ts`
- `packages/core/src/tools/modules/skill/index.test.ts`

当前断言覆盖：

- deferred flag -> `SystemPromptVariant` 映射正确
- deferred mode 使用 `deferred_aligned` system prompt
- deferred mode 首轮 `tools[] == ['ToolSearch']`
- user-side 注入包含 `<available-deferred-tools>`
- user-side 注入包含 CC 风格 skills reminder 文案

## 仍保留的差异点（下一步候选）

### 1. `claudeMd/currentDate` 的结构化对齐

现状：

- Formax 已有 `claudeMd` reminder 与 todo reminder 注入链路。
- 新版 CC 抓包里常见 `# currentDate` 与 claudeMd context 同块出现。

差异：

- Formax 目前没有完全复刻该块结构（尤其是 `# currentDate` 表达方式）。

### 2. todo reminder 是否保留为 Formax 差异项

现状：

- Formax 保留了 todo empty reminder。
- 新版 CC 对比抓包中未看到同样块。

建议：

- 保留可行，但应在对齐文档和测试中持续标注为“Formax 产品差异”，避免后续再误判为对齐缺口。

## 本文档结论（更新版）

- 历史证据显示：Formax 一度是“旧 prompt + ToolSearch-only”半对齐状态。
- 当前代码已完成关键联动：
  - deferred exposure -> system variant
  - deferred exposure -> ToolSearch-only tools[]
  - deferred exposure -> skills reminder（CC 风格 bullets）
- 后续若继续追近新版 CC，主要剩余是 reminder 细节（`claudeMd/currentDate`）与产品差异边界（todo reminder）的策略选择。

## 关联 learning

- `docs/learnings/2026-03-06-deferred-prompt-variant-and-skills-reminder.md`
