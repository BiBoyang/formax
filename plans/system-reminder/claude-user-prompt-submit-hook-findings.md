# Claude Code：`UserPromptSubmit` hook 触发时机（抓包验证）

目标：确认 Claude Code 的 `UserPromptSubmit` hook 是“用户按回车提交提示时触发一次”，还是“每次向 LLM 发请求都触发”（包括 tool loop 自动续请求）。

材料：

- 抓包：`proxy/traffic-logs-user-submit-hook/`（按文件前缀顺序）
- hook 日志：`.claude/hooks/user_prompt_submit_probe.log`（JSONL，每触发一次追加一行）

结论（本轮实验）：

- `UserPromptSubmit` 在本实验里表现为：**每次用户按回车提交 prompt 触发一次**。
- 不是“每次 LLM request 都触发”。在同一个用户 prompt 引发的后续请求（tool loop）中，抓包里会带历史 messages，因此你可能在某些请求文件里看到多个 `[[UPS_PROBE fired #N]]`；但判定“这一轮新增注入”应当只看 **本次 request 的最后一个 `role:"user"` message**（last-user）。

## 证据 1：hook 日志（严格递增，5 次提交 = 5 行）

`.claude/hooks/user_prompt_submit_probe.log` 目前 5 行，对应 5 次用户提交：

| count | prompt_preview |
|---:|---|
| 1 | 你好 |
| 2 | 你真帅 |
| 3 | Bash(echo hi) |
| 4 | 请用 Bash 执行三次：echo A; echo B; echo C（每次都单独调用 Bash） |
| 5 | 阅读下CODEMAP.md |

## 证据 2：抓包（last-user 里的 marker 与 log 对齐）

说明：下面的“evidence request (seq)”指 **last-user message** 中出现 `[[UPS_PROBE fired #N]]` 的请求（用于证明“当轮注入”）。

| marker | user prompt (from hook log) | evidence request (seq) | last-user prompt tail | notes |
|---:|---|---|---|---|
| 1 | 你好 | 0004 | 你好 | messages=1 |
| 2 | 你真帅 | 0006 | 你真帅 | messages=3 |
| 3 | Bash(echo hi) | 0008 | Bash(echo hi) | messages=5 |
| 4 | 请用 Bash 执行三次：echo A; echo B; echo C（每次都单独调用 Bash） | 0012 | 请用 Bash 执行三次：echo A; echo B; echo C（每次都单独调用 Bash） | messages=9 |
| 5 | 阅读下CODEMAP.md | 0018 | 阅读下CODEMAP.md | messages=13 |

## 判定口径（避免被“历史 messages”误导）

如果你在某个请求里 grep 到多个 marker（例如 `#1/#2/#3` 都出现），这通常只是因为该 request 的 `messages[]` 包含了之前的用户输入与其附带的 `<system-reminder>`。

为了判定“当轮新增注入”：

1. 解析 request 的 `messages[]`；
2. 找到最后一个 `role:"user"` message（last-user）；
3. 只在 last-user 的 `content` 里检查 marker。

## 仍可追加的对照实验（可选）

如果你还担心“同一次用户提交触发多轮 tool loop 时，`UserPromptSubmit` 会再次触发”，可以再做一个更极端的用例：

- 用户只发 1 条消息，但明确让模型连续触发多轮 tool loop（至少 2 次 `streamOnce`）；
- 预期：`.claude/hooks/user_prompt_submit_probe.log` **只增加 1 行**。

