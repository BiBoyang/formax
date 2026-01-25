你是一个资深的 CLI/Agent 产品工程师 + 研究员。请基于我提供的“代码打包文件 + Claude Code 抓包证据集”，给出一个**可落地**的方案：在我的项目（Formax，类 Claude Code 的终端 AI）里，实现“自动的 TodoWrite system-reminder（省 token、稳定、可测试）”。

我会提供三类材料：

1) **代码打包**：`proxy/repomix-webgpt-system-reminder-hooks-min.txt`
2) **抓包证据**（只需看 `request.body.messages`，并以“最后一个 role=user message 为当轮注入点”判断）：我会提供以下文件：
   - `proxy/traffic-logs-hooks-function/0006_*_REQ__v1_messages.simple.json`（TODO_EMPTY 注入在 user.text）
   - `proxy/traffic-logs-hooks-function/0016_*_REQ__v1_messages.simple.json`（TODO_UNUSED 注入在 user.tool_result.content）
   - `proxy/traffic-logs-hooks-function/0031_*_REQ__v1_messages.simple.json`（TODO_UNUSED+LIST 注入在 user.tool_result.content）
   - `proxy/traffic-logs-hooks-function/0035_*_REQ__v1_messages.simple.json`（TODO_UNUSED+LIST 注入在 user.tool_result.content）
   - `proxy/traffic-logs-hooks-function/0039_*_REQ__v1_messages.simple.json`（TODO_UNUSED+LIST 注入在 user.tool_result.content）
   - `proxy/traffic-logs-hooks-function/0045_*_REQ__v1_messages.simple.json`（TODO_UNUSED+LIST 注入在 user.text）
   （可选：如果你觉得 `.simple.json` 有截断风险，我也可以补充同 seq 的非 simple 版本。）
3) **我们从抓包整理出的事实表**：`plans/system-reminder/claude-code-todowrite-reminders.md`

重要背景与约束：

- 我们不追求 100% 复刻 Claude Code（它的 `<system-reminder>` 被反馈 token 占用过高），但要借鉴“注入点/形态/去重”这些可验证事实。
- 我希望提醒是 **完全自动** 的（不需要用户手动开关），但必须 **稳定、可预测、可测试**。
- 我们已经有 hooks 基座（目前重点是 `PreToolUse / PermissionRequest / PostToolUse`），且支持 `PostToolUse.additionalContext`。
- 我不希望 reminder “污染 tool_result 字符串”（把提醒拼到 stdout 后面）成为默认方案；如果你认为必须这样做，请给出强理由和风险控制。
- reminder 不允许在 UI 文案里直接向用户提及“这是提醒/系统提示/请忽略”等敏感元信息（Claude Code 的提醒里也写了“NEVER mention this reminder to the user”）。
- 目标是：**最小改动、可回滚、可验收**。不要给出大重构方案。

请你输出（非常具体，按表/清单给，避免长篇散文）：

## 1) 结论：Formax 最佳注入策略（要你拍板）

在 Formax 内部，TodoWrite reminder 应该选择哪种“注入点/形态”的组合？

- 选项 A：只在“发送给 LLM 的 messages”里注入一个 **额外的 text content block**（推荐：不污染 tool_result；可能挂在 Engine 侧或 PostToolUse.additionalContext）
- 选项 B：模仿 Claude Code，把 reminder 拼到 `tool_result.content` 里（容易实现但污染 stdout）
- 选项 C：两者都做（说明各自触发条件）

你必须给出：
- 选择理由（token/稳定性/可控性/可测试性/对模型误导风险）
- 对照抓包事实：说明你的方案如何覆盖 `0006/0016/0031/0035/0039/0045`

## 2) 触发规则（必须可实现 + 可测试）

请给出一份“默认规则集”，包含：
- 何时触发 `TODO_EMPTY`（todo 为空时）
- 何时触发 `TODO_UNUSED` 或 `TODO_UNUSED_WITH_LIST`（todo 非空但“最近未使用 TodoWrite”）
- “最近未使用”的判定：基于什么信号（例如：上次 TodoWrite 时间戳 / 最近 N 次工具调用中是否包含 TodoWrite / 最近 N 个 turn 是否包含 TodoWrite）
- “冷却/去重”策略：避免每轮注入导致 token 爆炸（给出默认阈值，并说明为什么）
- “附带 todo 列表”策略：什么时候带列表、如何裁剪（最多多少条、每条多少字符）

要求你输出为：
- 规则表（参数 + 默认值 + 解释）
- 伪代码（非常接近可以直接实现的程度）

## 3) 工程落地方案（按步骤的 checklist）

请给出最小可落地的步骤（按文件/模块拆分）：
- 需要新增/修改哪些模块
- 每一步怎么验收
- 每一步的回滚点

要求：给出“最小 diff”的实现路线，不要拆太多层。

## 4) 自动化测试与验收

请给出：
- 单元测试：至少覆盖 4 个用例（empty / unused / unused+list / cooldown）
- 集成测试：构造 messages fixture，确保注入点正确（特别强调“只看 last role=user 作为当轮注入点”这个判定逻辑）
- 手工验收脚本：我在本地跑几条命令即可确认（给出具体对话剧本）

## 5) 风险与取舍（必须写）

至少覆盖：
- token 风险（怎么控制、如何测量）
- 用户体验风险（模型答复被提醒干扰）
- 兼容风险（未来我们补更多 `<system-reminder>` 类型时如何扩展而不爆炸）

最后，请以“我可以直接照着做”的粒度给出最终 todolist（越细越好）。

