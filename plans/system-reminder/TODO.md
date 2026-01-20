# system-reminder × 工具返回注入：对齐验证 TODO

目标：把我们“从抓包观察到的 `<system-reminder>...</system-reminder>` 出现在 `tool_result.content` 里”的现象，拆成可验证的规则集（每条规则都有：触发条件、适用工具、注入位置、去重/阈值），并据此决定 Formax 是否需要“结构对齐”（把 reminder 追加到 `tool_result.content`）或只做“效果对齐”（通过 `system` 注入）。

> 重要约束：在完成抓包验证前，不改 Formax 的核心注入逻辑（避免“猜测式对齐”导致行为漂移）。

## 0. 已有证据（输入材料）

- 统计脚本：`scripts/extract-system-reminder-map.mjs`
- 汇总结果：
  - `proxy/system-reminder-tool-map.json`
  - `proxy/system-reminder-tool-map.md`

该脚本当前只统计一种情况：
> `type=tool_result` 的 `content` 字符串里包含 `<system-reminder>...</system-reminder>`（即“工具返回被注入”的模式）。

## 1. 输出物（我们要产出的结论格式）

- [ ] 产出一份“规则表”Markdown（建议：`plans/system-reminder/RESULTS.md`）包含：
  - [ ] reminder 类型（文本去标签后的 normalized 内容）
  - [ ] 触发条件（必要且充分，至少给出可复现的近似条件）
  - [ ] 适用范围（主会话 / Task 子会话；哪些 subagent_type；哪些工具）
  - [ ] 注入位置（`tool_result` 末尾 / `system` / 其他）
  - [ ] 阈值/去重（recently 的定义；是否被 TodoWrite 重置；是否按 turn/tool_use 计数）
  - [ ] 反例（明确“不触发”的条件）

## 2. 验证环境准备（避免污染）

- [ ] 使用“干净目录”进行 Claude Code 抓包（不要在 Formax repo 根目录里做验证）
  - [ ] 新建目录：`~/Documents/github/var/catch-system-reminder/`
  - [ ] 在该目录运行 Claude Code（确保 `.claude/` 写在该目录内）
- [ ] 每轮实验前记录：
  - [ ] 当前工作目录 `pwd`
  - [ ] `.claude/settings.local.json` 中 permissions 相关片段（尤其 allow 列表）
  - [ ] 是否开启/进入过 plan mode、accept edits mode
- [ ] 抓包产物：
  - [ ] `proxy/traffic-logs-*`（或单独新目录如 `proxy/traffic-logs-reminders-*`）
  - [ ] 命令行复制：`plans/system-reminder/terminal-copy/*.txt`
  - [ ] 可选录像：`record/claude-code/*.cast`（如果你觉得必要）

## 3. 需要验证的 reminder 类型（从 map 抽取）

> 下列 reminder 文本以 `proxy/system-reminder-tool-map.json` 为准；最终要确认“是否确实由 Claude Code 应用层注入”，还是上游 harness 注入。

- [ ] **TodoWrite-stale 提醒**：`The TodoWrite tool hasn't been used recently... NEVER mention this reminder to the user`
- [ ] **Read-malware 提醒**：`Whenever you read a file, you should consider whether it would be considered malware...`
- [ ] **READ-ONLY 强提醒**：`CRITICAL: This is a READ-ONLY task. You CANNOT edit, write, or create files.`

## 4. 需要验证的工具集合（从 map 抽取）

- [ ] `Read`
- [ ] `Write`
- [ ] `Bash`
- [ ] `Grep`
- [ ] `Glob`
- [ ] `Skill`

## 5. 验证矩阵（每条都要抓到请求）

### 5.1 TodoWrite-stale 提醒：触发/阈值/重置

- [ ] A1：空会话，从未调用 TodoWrite，连续调用 `Read` 5 次（读不同文件）
  - 预期：确认是否在 `Read.tool_result` 末尾出现该 reminder
- [ ] A2：空会话，从未调用 TodoWrite，连续调用 `Grep` 5 次
  - 预期：确认是否在 `Grep.tool_result` 末尾出现该 reminder
- [ ] A3：空会话，从未调用 TodoWrite，连续调用 `Bash` 5 次（只读命令：`pwd`、`ls`、`cat` 等）
  - 预期：确认是否在 `Bash.tool_result` 末尾出现该 reminder
- [ ] A4：调用一次 `TodoWrite`（哪怕只写 1 条），然后立刻 `Read` 1 次
  - 预期：确认 reminder 是否消失（“recently” 是否被重置）
- [ ] A5：调用一次 `TodoWrite` 后，再进行 N 次非 TodoWrite 工具调用（N=1/3/5/10），找出阈值
  - [ ] N=1
  - [ ] N=3
  - [ ] N=5
  - [ ] N=10
- [ ] A6：多轮对话：隔一段时间（或插入大量普通文本对话）再触发工具，看“recently”是否是按时间窗口
  - 预期：判断 “recently” 是时间还是回合/工具数
- [ ] A7：同一个对话里、不同工具之间是否共享计数器（`Read` 触发后 `Write` 是否也触发）
- [ ] A8：在子会话（Task subagent）里触发工具，看该 reminder 是否更容易出现

### 5.2 Read-malware 提醒：仅 Read？仅在读“可疑内容”？

- [ ] B1：读一个正常文本/TS 文件（无可疑内容）
- [ ] B2：读一个包含“恶意样例”关键词的文件（例如包含 `eval(` / `base64` / `shellcode` 之类），看是否更容易触发
- [ ] B3：读同一个文件多次，确认是否每次都注入 or 有去重
- [ ] B4：Read 报错路径（文件不存在 / 无权限）时是否也注入

### 5.3 READ-ONLY 强提醒：只在子会话？只在工具不可用错误？

从 `proxy/system-reminder-tool-map.json` 的 example 前缀看，这类提醒经常出现在：
`<tool_use_error>Error: No such tool available: X</tool_use_error>`

- [ ] C1：主会话正常调用 `Bash/Glob/Read`，确认是否会出现该提醒
- [ ] C2：在 Task 子会话里触发一个“工具不可用”的场景（例如限制工具 allowlist），确认是否会出现该提醒
- [ ] C3：在 Explore/Plan 子会话里（只读/受限场景）触发工具，确认出现概率
- [ ] C4：该提醒是否只跟“只读任务提示词”绑定（例如某些 subagent prompt 写了 READ-ONLY）

## 6. 上下文维度（必须覆盖的差异）

- [ ] 主会话 vs Task 子会话（subagent）
- [ ] 不同 subagent_type：`Explore` / `Plan` / `general-purpose` / 自定义 agent
- [ ] 是否启用 “accept edits mode”
- [ ] 是否在 plan mode
- [ ] 是否在 session 内做过 `/todos` / `TodoWrite`
- [ ] 是否在会话内出现过工具失败（`tool_use_error`）

## 7. 数据整理（把抓包变成可用结论）

- [ ] 每次抓包后重新运行统计脚本，确认新增样本能被 map 捕获
  - [ ] 确认 `scanned_files` 增长
  - [ ] 确认 `reminder_events` 增长
  - [ ] 记录新出现的 reminder 文本（如果有）
- [ ] 为每一种 reminder 文本建立“最小复现步骤”
- [ ] 记录“反例”（明确做了什么但没有出现 reminder）

## 8. Formax 侧落地（在规则确认之后再做）

> 这一节只列“可能的实现方向”，不在当前阶段动代码。

- [ ] D1：决定“结构对齐”还是“效果对齐”
  - [ ] 结构对齐：把某些 reminder 追加到 `tool_result.content` 末尾
  - [ ] 效果对齐：通过 `system` 注入保证模型可见，但不污染 tool_result
- [ ] D2：如果需要结构对齐，建立工具白名单（仅对纯文本工具追加；禁止污染 JSON 输出）
- [ ] D3：如果需要结构对齐，明确追加策略：
  - [ ] 只在 `tool_result` 成功时追加？失败时也追加？
  - [ ] 追加到末尾还是单独一段？
  - [ ] 去重规则（同一轮/同一会话不重复注入）

