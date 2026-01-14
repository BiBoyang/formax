# TodoWrite：如何“写 todo”以及它如何影响后续对话

> TL;DR：TodoWrite 不只是“保存一个列表”，它还会影响后续模型行为（提醒/节奏），并且 `/todos` 会把当前列表以特定样式展示出来。

## 1) 你在命令行看到什么

当你运行 `/todos` 时（Claude Code 的样式）：

- 没有 todo：
  - `No todos currently tracked`
- 有 todo：
  - 顶部会显示数量（例如 `5 todos:`）
  - 每条前面有勾选框：
    - pending：`☐ content`
    - in_progress：`☐` + **加粗 content**
    - completed：`☒` + 灰色 + 删除线 content

并且：如果你用 `TodoWrite` **交换数组顺序**（比如把第 5 条放到第 1 条），`/todos` 会按新顺序展示。

## 2) 抓包/证据（✅）

### 2.1 TodoWrite 允许多个 `in_progress`

✅ 现象：Claude Code 允许你把第 1 条和第 2 条都设为 `in_progress`（并不会报错）。

这说明：`"Ideally only one"` 更像是“提示词建议”，不是硬性约束。

### 2.2 Todo 的存储是“会话级文件”

✅ 现象：Claude Code 会把 todo 存储成一个 JSON 文件，路径形如：

- `~/.claude/todos/<sessionId>-agent-<sessionId>.json`

### 2.3 `todo_stale` 会作为 `<system-reminder>` 追加到 tool_result

✅ 现象：当一段时间/若干次工具调用之后，Claude Code 会把一段 `<system-reminder>...</system-reminder>` 追加到某个 `tool_result.content` 的末尾，用于**下一轮**喂给模型（用户看不到）。

这会带来一个“工程后果”：Formax 在渲染 tool 输出时，要避免把这段内部提醒展示给用户。

## 3) 为什么重要

如果我们不对齐，会出现两类问题：

1) **模型行为跑偏**：模型以为 todo 只有一个 in_progress，实际你在 UI 里做了两个，它可能误判状态；
2) **UI/日志污染**：`<system-reminder>` 是内部信息，如果被当成 tool 输出展示，会让界面看起来很怪，也会影响用户理解。

## 4) Formax 如何实现（🛠）

对应 commit：`916cf1f`（`feat(todos): align TodoWrite and /todos with Claude Code`）

- **TodoWrite 的 handler**
  - `src/tools/modules/todoWrite/handler.ts`
  - 行为：允许多个 `in_progress`；按输入数组顺序写入文件
- **Todo 存储位置**
  - `src/tools/runtime/todosFile.ts`
  - 默认：`~/.formax/todos/<sessionId>-agent-<sessionId>.json`
  - 支持环境变量覆盖：`FORMAX_TODOS_PATH`、`FORMAX_TODOS_SESSION_ID` / `FORMAX_SESSION_ID`
- **/todos 命令**
  - `src/features/commands/registry.ts`
  - 行为：按 todo 数组顺序输出；完成态/进行态/待办态按 Claude Code 的样式渲染；
  - 同时把 stdout 注入到下一轮 prompt（`<local-command-stdout>`）
- **todo_stale 注入**
  - `src/chat/engine.ts`
  - 行为：把 `<system-reminder>` 追加到后续 `tool_result.content` 的末尾（Claude Code 风格）
- **避免 UI 展示 system-reminder**
  - `src/utils/toolFormatting.ts`
  - 行为：当 tool_result 末尾存在完整的 `<system-reminder>` 块时，在展示层剥离它

## 5) 怎么验证（建议用“无污染”方式）

1) 用临时目录跑 Formax（避免污染真实 `~/.formax`）：
   - `FORMAX_CONFIG_DIR=./tmp/formax-config FORMAX_TODOS_SESSION_ID=demo bun run dev`
2) 运行 `/todos`，确认空列表提示正确
3) 让模型调用 `TodoWrite` 创建 2 条 todo
4) 再运行 `/todos`，确认数量/样式/顺序正确
5) 让模型把两条都标成 `in_progress`，确认不会报错
6) 继续调用几个工具（例如 `Read`/`Glob`），观察 UI 不会把 `<system-reminder>` 展示出来

## 6) 未解决问题（❓）

- ❓ stale 的阈值/TTL/去重策略：不同版本可能不同，后续需要更多抓包确认后再做成可配置
- ❓ TodoWrite tool 自己的 presenter 是否要对齐到和 `/todos` 一致的“checkbox/加粗/删除线”样式
