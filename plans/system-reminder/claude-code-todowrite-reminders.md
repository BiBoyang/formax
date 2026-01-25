# Claude Code TodoWrite `<system-reminder>` 注入（抓包事实表）

数据来源：`proxy/traffic-logs-hooks-function/*_REQ__v1_messages.simple.json`

## 重要说明（避免被“历史 messages”误导）

同一轮请求的 `request.body.messages[]` 会包含大量历史内容；因此「某条 `<system-reminder>` 是否是 *这一轮* 新注入的」不能只看全文 grep。

本表使用的判定规则：

- 以 **该请求 `request.body.messages[]` 中最后一个 `role:"user"` message** 为“本轮输入”（Claude Code 会在这里塞入额外的 `text` 或把提醒拼到 `tool_result.content`）。
- **仅当 `<system-reminder>` 出现在这个 last-user message 中**，才记为“本轮注入点”。
- 另一张表会列出“任意位置出现过”的情况（用于排查历史污染，但不能当作本轮注入证据）。

## 表 1：本轮注入点（last `role=user` message）

字段说明：

- `last user blocks`：last-user 的 content block 类型序列（`text` / `tool_result`）
- `injected at`：提醒被注入到 `user.text` 还是 `user.tool_result`
- `reminder kind`：
  - `TODO_EMPTY`：`todo list is currently empty`
  - `TODO_UNUSED`：`TodoWrite tool hasn't been used recently`（不带 todo 列表）
  - `TODO_UNUSED_WITH_LIST`：`TodoWrite tool hasn't been used recently` + `Here are the existing contents...`
- `tool_result prefix`：tool_result.content 第一行（用于看 WORKING_STATE / STALE_STEP）

| seq | time | last user blocks | injected at | reminder kind | todo items | tool | user prompt（本轮用户输入） | tool_result prefix | also has `# claudeMd` reminder? |
|---:|---|---|---|---|---:|---|---|---|---|
| 0006 | 2026-01-25T04-37-08,638 | text, text, text | user.text | TODO_EMPTY |  |  | 请用 Bash 执行：pwd |  | yes |
| 0016 | 2026-01-25T04-38-02,207 | tool_result | user.tool_result | TODO_UNUSED |  | Bash |  | WORKING_STATE_A | yes |
| 0031 | 2026-01-25T04-41-30,278 | tool_result | user.tool_result | TODO_UNUSED_WITH_LIST | 3 | Bash |  | STALE_STEP_1 | yes |
| 0035 | 2026-01-25T04-41-40,603 | tool_result | user.tool_result | TODO_UNUSED_WITH_LIST | 3 | Bash |  | STALE_STEP_2 | yes |
| 0039 | 2026-01-25T04-41-48,085 | tool_result | user.tool_result | TODO_UNUSED_WITH_LIST | 3 | Bash |  | STALE_STEP_3 | yes |
| 0045 | 2026-01-25T04-43-28,348 | text, text | user.text | TODO_UNUSED_WITH_LIST | 3 |  | 我现在不想维护 todo，也不要建议我用 TodoWrite。请直接回答：下一步做什么？ |  | yes |

### 结论（只基于表 1 的“当轮注入”事实）

- Claude Code 至少存在两种 TodoWrite reminder 注入形态：
  1) **注入到 `user.text`**：作为 leading `<system-reminder>...</system-reminder>`（见 `0006`、`0045`）
  2) **拼接进 `user.tool_result.content`**：`<stdout>\n\n<system-reminder>...`（见 `0016`、`0031/0035/0039`）
- 当 todos 已存在时，提醒内容可能会附带 “现有 todo 列表” 的序列化快照（见 `0031/0035/0039`、`0045`）。
- 即便用户显式表示“不要建议我用 TodoWrite”，Claude Code 仍可能在 **同一轮** 注入 `TODO_UNUSED_WITH_LIST`（见 `0045`）。

## 表 2：任意位置出现过（包含历史；不能当作本轮注入证据）

| seq | time | TODO_EMPTY anywhere | TODO_UNUSED anywhere | TODO_UNUSED+LIST anywhere |
|---:|---|:---:|:---:|:---:|
| 0006 | 2026-01-25T04-37-08,638 | yes |  |  |
| 0008 | 2026-01-25T04-37-20,270 | yes |  |  |
| 0010 | 2026-01-25T04-37-29,560 | yes |  |  |
| 0012 | 2026-01-25T04-37-31,019 | yes |  |  |
| 0014 | 2026-01-25T04-37-58,302 | yes |  |  |
| 0016 | 2026-01-25T04-38-02,207 | yes | yes |  |
| 0018 | 2026-01-25T04-38-22,792 | yes | yes |  |
| 0020 | 2026-01-25T04-40-30,354 | yes | yes |  |
| 0021 | 2026-01-25T04-40-32,557 | yes | yes |  |
| 0023 | 2026-01-25T04-41-00,967 | yes | yes |  |
| 0025 | 2026-01-25T04-41-02,301 | yes | yes |  |
| 0027 | 2026-01-25T04-41-09,551 | yes | yes |  |
| 0029 | 2026-01-25T04-41-28,983 | yes | yes |  |
| 0031 | 2026-01-25T04-41-30,278 | yes | yes | yes |
| 0033 | 2026-01-25T04-41-39,200 | yes | yes | yes |
| 0035 | 2026-01-25T04-41-40,603 | yes | yes | yes |
| 0037 | 2026-01-25T04-41-46,760 | yes | yes | yes |
| 0039 | 2026-01-25T04-41-48,085 | yes | yes | yes |
| 0041 | 2026-01-25T04-41-56,100 | yes | yes | yes |
| 0043 | 2026-01-25T04-43-11,371 | yes | yes | yes |
| 0045 | 2026-01-25T04-43-28,348 | yes | yes | yes |
| 0047 | 2026-01-25T04-43-46,085 | yes | yes | yes |
| 0048 | 2026-01-25T04-43-55,316 | yes | yes | yes |
| 0050 | 2026-01-25T04-44-05,588 | yes | yes | yes |

