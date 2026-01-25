它不是“模型自己生成的提示词”，而是 **Claude Code 的编排层在组装下一次模型调用时，按规则额外注入的 `<system-reminder>` 块**。你这段 TodoWrite 提醒的**插入时机**可以用一句话概括：

> **在用户提交新一轮输入（UserPromptSubmit）时**，如果检测到 **最近一段对话里没有调用过 `TodoWrite`**，就会把这段提醒**追加到本次要发给模型的上下文尾部**，因此你在抓包里经常看到它“贴在 tool_result 或 user message 的末尾”。

下面是可核对的证据链。

---

## 1) 触发点：UserPromptSubmitHook（用户每次发消息时）

在 anthropics/claude-code 的 issue 里，有人明确描述了 Claude Code 的内置机制：

* **TodoWrite 会在 `UserPromptSubmitHook` 上挂载 system-reminder**
* 并且 **维护“距离上次 TodoWrite 调用过去了多少个 UserPromptSubmitHooks”的状态** ([GitHub][1])

这基本等价于：**每次用户发起新 prompt 时，先跑一遍 hook 逻辑，满足条件就注入提醒**。

---

## 2) “为什么看起来像插在工具结果里”：注入位置在消息尾部

多个抓包/拆解文章指出，这类提醒经常被 **“tack 到 tool response 或 user prompt 的末尾”**，属于一种“上下文尾部的 inline system prompt” ([blog.thepete.net][2])。

同时，在一个 Claude Code 的 API 报错 issue 里，能直接看到 payload 结构中出现了：

* `tool_result` 相关内容块
* 紧跟着一个 `text` 块，内容正是这段 “TodoWrite tool hasn't been used recently …” ([GitHub][3])

所以你观察到“工具调用结果里出现 `<system-reminder>`”，本质原因是：**编排层把提醒拼进了同一次 messages/content 列表的尾部**，在日志/抓包视角就像“插进 tool_result 后面”。

---

## 3) 触发频率：不是每次都插，有“节流”

官方没有公开常量，但社区对触发频率做过测量与描述：

* “当一段时间没调用 TodoWrite，会大约每 10 次 user prompts 注入一次（once every 10 user prompts or so）” ([Reddit][4])
* 另外也有人把它描述为“检查最近若干轮（例如 10 turns）里是否已有 TodoWrite 或同类 reminder，有则不再插入”，属于**去重 + 节流**的典型模式（同样是社区观察，不是官方文档）。([Reddit][5])

结合第 1 点（它维护“过去了多少个 UserPromptSubmitHooks”）来看，结论很稳：

* **触发条件**：超过某个阈值 N 次用户提交且没用 TodoWrite
* **节流**：避免每次都插，隔若干轮才插一次 ([GitHub][1])

---

## 4) 同类但不同的 Todo 提醒：会话开始也可能插“todo list is empty”

你问的是 “hasn't been used recently”，但实际 Claude Code 还有另一个常见 Todo 提醒：

* 在会话早期，如果 todo 列表为空，会注入 “your todo list is currently empty … use TodoWrite …” 这类块 ([Jannes’ Blog][6])

这解释了你可能在不同阶段看到不同版本的 Todo system-reminder。

---

## 5) 额外细节：子代理不一定带这个提醒

有拆解提到：`Task` 启动的子代理在某些情况下**不会带“提醒使用 TodoWrite”的 system-reminder**（也就是注入策略在主会话和子代理间不完全一致）。([Medium][7])

---

# 可操作结论

**插入时机 = “用户提交 prompt 时（UserPromptSubmitHook）”**。
**插入条件 = “最近一段对话未调用 TodoWrite，且节流窗口允许”**。
**插入位置 = “本次发给模型的 messages 尾部”，因此经常紧贴 tool_result 或 user 文本后面**。([GitHub][1])

[1]: https://github.com/anthropics/claude-code/issues/6981 "Request: allow hooks in MCP servers · Issue #6981 · anthropics/claude-code · GitHub"
[2]: https://blog.thepete.net/blog/2025/12/10/same-model-different-results-why-coding-agents-arent-interchangeable/ "
  Same Model, Different Results: Why Coding Agents Aren't Interchangeable | Pete Hodgson
"
[3]: https://github.com/anthropics/claude-code/issues/7673 "[Bug] Anthropic API Error: Invalid Content Block Type After MCP Tool Cancellation · Issue #7673 · anthropics/claude-code · GitHub"
[4]: https://www.reddit.com/r/ClaudeAI/comments/1nc83gt/claude_code_performance_degradation_technical/ "Claude Code Performance Degradation: Technical Analaysis : r/ClaudeAI"
[5]: https://www.reddit.com/r/ClaudeAI/comments/1nqpcef/a_hook_that_guarantees_claude_code_always_spawns/?utm_source=chatgpt.com "A hook that guarantees Claude Code always spawns a subagent"
[6]: https://jannesklaas.github.io/ai/2025/07/20/claude-code-agent-design.html "Agent design lessons from Claude Code | Jannes’ Blog"
[7]: https://medium.com/%40outsightai/peeking-under-the-hood-of-claude-code-70f5a94a9a62 "Peeking Under the Hood of Claude Code | by OutSight AI | Medium"
