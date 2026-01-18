### 0) 结论摘要（10 行内）

* **MVP（最小可落地）**：

  1. 把 Formax 的 `TodoWrite` 彻底对齐 Claude Code：入参仍是 `{ todos: [{content,status,activeForm}] }`，但**校验规则 + tool_result 固定话术**对齐抓包；2) 抽一个 `ReminderService/InjectedBlocksService`，在每次请求前注入 `<system-reminder>`：**空 todo 提醒 + CLAUDE.md 注入**（先项目，后全局可选）；3) 工具执行器支持**同一轮 assistant message 内多个 tool_use 并行**（尤其 Task/Explore），并在 UI 输出 “N Explore agents finished …” 汇总。
* **Full（最终对齐）**：

  1. 引入 Kode 风格 “状态→事件→提醒” 的 todo 变更提醒（todo_empty / todo_updated）+ 去重/节流；2) todo/agentId 作用域与持久化（主会话共享、subagent 只读或受控写）；3) fileFreshness（读过的文件若外部变更则提醒）；4) 可选 `/compact` 对话压缩 pipeline（手动 + 自动阈值）。
* **Observed（可从抓包/代码确定）**：

  * `<system-reminder>` 注入发生在 **role=user 的 content blocks 里**，同一条请求里可同时注入空 todo + `# claudeMd`。
  * Claude Code/Plan 模式可在**同一条 assistant message 内并发多次 `Task`（Explore）tool_use**；tool_result 会被**集中放在同一条 user message**，并可在其后追加 `<system-reminder>`（如 “TodoWrite hasn’t been used recently”）。
  * `TodoWrite` 的 tool_result 有固定文案（非 todo 列表）。
* **Inferred（推断）**：UI “20 tool uses · 44.0k tokens · 3.4s” 很可能来自子任务的 tool_call 计数 + API usage + wall time（抓包里未直接给出 UI 计算方式）。
* **To-Verify（需要进一步抓包/验证）**：全局 `~/.claude/CLAUDE.md` 与项目 `CLAUDE.md` 的**拼接顺序/优先级**；todo 更新后是否会额外注入 todo 摘要；“TodoWrite 很久没用” 的触发阈值；Claude Code 是否自动 compaction（仅在公开文档里能确认功能存在）。

---

### 1) 事实还原（以抓包为主，辅以代码对照）

#### 1. Claude Code 如何使用项目内 `CLAUDE.md`？

**Observed（抓包）**

* 在 `proxy/traffic-logs/0097...messages.simple.json` 里，Claude Code 把“空 todo 提醒”和“CLAUDE.md 内容”都塞进了 `role: "user"` 的 `content` 数组中，且两段都用 `<system-reminder>...</system-reminder>` 包裹；CLAUDE.md 段落带 `# claudeMd` 标记，并明确写了 “Contents of .../CLAUDE.md (project instructions, checked into the codebase)”。
* 这两段 reminder **出现在用户真实输入之前**（同一条 user message 的 content 里，reminder blocks 在前，用户问题在后）。
* 抓包里这些注入 block 往往带 `cache_control: {"type":"ephemeral"}`（提示这类上下文可能不参与缓存/或用于 prompt caching 的分段），Claude Code 的 tool_use/tool_result 也大量使用 ephemeral。

**Observed（Formax 代码对照）**

* Formax 已经实现了同款 `# claudeMd` 注入：`buildClaudeMdInjectedBlocks({cwd})` 会读取 `cwd/CLAUDE.md`，并生成 `<system-reminder>\n# claudeMd\n...Contents of ...\n</system-reminder>` 的 text block（测试也断言了 `# claudeMd` 与 `Contents of`）。
* Formax 的 `STATUS.md` 明确写了：项目 CLAUDE.md 注入已做；**全局 `~/.claude/CLAUDE.md` 等价物还没做（TODO）**。

**Inferred + 公开资料支持（联网调研）**

* Anthropic 官方的 Claude Code best practices 明确提到：Claude Code 会从多个位置读取 `CLAUDE.md`（包括**项目根目录/父目录**以及**用户 home 下的 `~/.claude/CLAUDE.md`**）来作为“memory/instructions”。
* **优先级/拼接顺序**：官方文章强调“会自动拉取这些文件”，但没有在我打开的段落里给出严格顺序；因此顺序仍属 **To-Verify**（建议你用最小抓包清单验证，见第 5 节）。

---

#### 2. Claude Code 的 TodoWrite + system-reminder 行为

**2.1 todo 为空时提醒文案/触发条件**

**Observed（抓包）**

* 空 todo 的提醒文案是固定的（包含“Do not mention this reminder…”），并且在对话请求里以 `<system-reminder>` 注入：
  “This is a reminder that your todo list is currently empty. Use the TodoWrite tool to add tasks to your todo list. Do not mention this reminder to the user explicitly because they are already aware.”

**Observed（Formax 代码）**

* Formax 当前触发逻辑是“todos 文件不存在或 `readTodosCount()==0`”就注入；提醒文案与 Claude Code 抓包一致（含“already aware”）。
* todos 文件位置解析：`resolveTodosPath()` 优先用 `FORMAX_TODOS_PATH`；否则用 `FORMAX_LOGS_DIR`（默认 `proxy/logs`），最终文件名 `todos.json`。这也解释了你提到的“默认在 proxy/logs”。

**To-Verify**

* 抓包只证明“某次请求里注入了空 todo reminder”；无法仅凭当前材料断定“是否每轮都注入”或“是否有更细节的节流”。

---

**2.2 “近期未使用 TodoWrite”的提醒**

**Observed（抓包）**

* 在包含 3 个 Explore 子任务的那轮里，tool_result blocks 之后追加了一段 `<system-reminder>`：
  “The TodoWrite tool hasn't been used recently. If you are working on a task that would benefit from tracking progress, please use the TodoWrite tool to create a todo list. This is a reminder to ensure that the tool is used as much as necessary. Do not mention this reminder to the user explicitly because they are already aware.”

**Observed（Formax 状态）**

* Formax `STATUS.md` 明确把“TodoWrite hasn’t been used recently”列为 TODO（尚未按 session state 实现）。

**To-Verify**

* 触发阈值（多少 turns / 多久 / 多少 tool uses）当前材料无法确定。

---

**2.3 todo 变化后是否注入 todo 列表/摘要？**

**Observed（抓包）**

* `TodoWrite` tool_result 并不会回传 todo 列表，而是固定确认话术。
* 当前抓包样本里**没有出现**“todo_updated 后注入 todo 列表/摘要”的 `<system-reminder>`（因此不能声称 Claude Code 一定会注入）。

**Observed（Kode-cli 参考实现）**

* Kode 风格的 `SystemReminderService` 会根据 todo state 生成 `todo_empty_{agentKey}` 与 `todo_updated_{agentKey}_{len}_{hash}` 之类的 key，并用 cache/Set 做去重（说明它具备“todo 更新→提醒/摘要”的管线）。
* 这属于“参考项目能力”，不是 Claude Code 抓包直接证据。

**To-Verify**

* Claude Code 是否真的在 todo 更新时注入 todo 摘要：需要再抓包确认（见第 5 节抓包清单第 2 条）。

---

#### 3. 多 subagent Explore/Plan 的并发方式

**Observed（抓包）**

* 同一轮 assistant message 里出现了 3 次 `tool_use`，`name: "Task"`，且都是 `subagent_type: "Explore"`，这证明 Claude Code 允许“单轮并行多 Task 调用”。
* tool_results 被集中到下一条 `role:"user"` message 里（每个 tool_result 对应 tool_use_id），并且仍然可以在这些 tool_result blocks 后追加 `<system-reminder>`。
* 这与 Anthropic 官方 Messages API 的格式要求一致：tool_use/tool_result 采用 content blocks；并且官方文档支持并行 tool use（可通过参数禁用并行）。

**Observed（命令行记录/UI）**

* CLI 日志里有一行汇总：`3 Explore agents finished (ctrl+o to expand)`，并显示每个 agent 的 “tool uses / tokens / duration”。

**Inferred（推断 UI 统计来源）**

* `tool uses`：子 agent 内部 tool_call 次数计数。
* `tokens`：Anthropic API response 的 usage 字段累加（或代理层统计）。
* `duration`：每个 subagent start/end 的 wall-clock。
  这些在日志里“呈现出来了”，但抓包没直接给“它怎么计算”的字段，因此属于推断。

---

#### 4. 上下文压缩/compact

**Observed（抓包）**

* 当前提供的抓包片段里，我没有看到明显的“压缩/总结”专用 tool（或系统字段）被调用，也没看到 `compact` 字样（因此只能说：**此样本中未见直接证据**）。

**Inferred + 公开资料支持（联网调研）**

* 官方文档层面，Claude 生态确实有 `/compact`（“总结对话、保留关键信息、释放上下文空间”）的描述。
* 但 Claude Code 是否会“自动触发 compaction”、以及触发时在抓包里会出现哪些特征字段：仍需你补抓包确认（见第 5 节抓包清单）。

---

### 2) 对比分析（Claude Code vs Formax vs Kode-cli）

> 说明：Claude Code 一侧尽量只写“抓包能看到的”；看不到的用 Unknown/To-Verify 标注。

#### 2.1 数据模型对比

抓包能确认 Claude Code 的 TodoWrite schema 只有三个字段：`content/status/activeForm`，status 枚举 `pending|in_progress|completed`。

| 维度                | Claude Code                                           | Formax（当前）                  | Kode-cli（参考）                                                                                 |
| ----------------- | ----------------------------------------------------- | --------------------------- | -------------------------------------------------------------------------------------------- |
| TodoItem 字段       | `content`, `status`, `activeForm`                     | 同三字段；handler 写入 `{ todos }` | `id`, `content`, `status`, `priority`, `tags?`, `createdAt/updatedAt/previousStatus?` 等（更丰富） |
| 唯一 id             | **无**（抓包 schema 不含 id）                                | 无                           | 有，且校验重复 id                                                                                   |
| 只允许一个 in_progress | tool prompt 强约束（“Exactly ONE … in_progress”）可在系统提示中看到 | 当前 handler 未做该校验（只是写文件）     | 明确校验：`in_progress` > 1 返回错误                                                                  |
| maxTodos          | 抓包未见                                                  | 未见                          | 有（默认 100）并校验                                                                                 |

---

#### 2.2 存储策略对比

| 维度            | Claude Code                     | Formax（当前）                            | Kode-cli（参考）                                                        |
| ------------- | ------------------------------- | ------------------------------------- | ------------------------------------------------------------------- |
| 默认路径          | Unknown（抓包未暴露）                  | 默认 `proxy/logs/todos.json`（可被 env 覆盖） | 既有 sessionState 存储，也支持 agentId 文件隔离（`.kode` 风格）                     |
| agentId scope | Unknown/To-Verify               | 目前 todo 是单文件（未按 agentId 分离）           | todo 支持 agentId-scoped：`getTodos(agentId)`/`setTodos(..., agentId)` |
| 跨重启           | 取决于 todo 文件位置（Formax 默认写到 logs） | 取决于 logs 是否持久；是文件就可跨重启                | 可（文件/或 session 持久化）                                                 |
| 文件 watcher    | Unknown                         | 未见                                    | 有 `startWatchingTodoFile` 等（可用于外部变更提醒）                              |

---

#### 2.3 reminder 触发策略对比

| 触发点                  | Claude Code（抓包）            | Formax（当前） | Kode-cli（参考）                               |
| -------------------- | -------------------------- | ---------- | ------------------------------------------ |
| 空 todo               | 有固定 `<system-reminder>` 文案 | 已实现同文案     | 有 todo_empty_{agent} 去重                    |
| TodoWrite 很久没用       | 有固定提醒文案                    | TODO（未做）   | 可通过 sessionState lastTodoUpdate 等实现（结构已存在） |
| todo 更新摘要            | 抓包未见（To-Verify）            | 未实现        | 有 todo_updated_{agent}*{len}*{hash} 方案     |
| fileFreshness / 外部变更 | 抓包未见（To-Verify）            | 未见         | 有 file_changed 提醒生成器、提醒缓存/窗口               |

---

#### 2.4 子任务隔离 / 子 agent 工具权限

| 维度                | Claude Code                                           | Formax                       | Kode-cli                                                    |
| ----------------- | ----------------------------------------------------- | ---------------------------- | ----------------------------------------------------------- |
| subagent 是否可调用写工具 | To-Verify（抓包只看到 Explore 用 Read/Grep 等；未看到 Edit/Write） | 取决于你现有 tool policy（材料里没直接证据） | 参考实现里工具可标 `isReadOnly/isConcurrencySafe/needsPermissions` 等 |
| approvals/confirm | To-Verify                                             | 建议主会话统一审批（见第 3.E）            | 参考实现具备 permissions 语义（可落地）                                  |

---

#### 2.5 UI/交互

| 维度           | Claude Code                                                          | Formax（当前）                    | Kode-cli（参考）                             |
| ------------ | -------------------------------------------------------------------- | ----------------------------- | ---------------------------------------- |
| Explore 汇总   | 有 “3 Explore agents finished (ctrl+o…)” 且带 tool uses/tokens/duration | 未见同款 UI                       | 可按同样模式做（参考 subagent 框架）                  |
| TodoWrite 渲染 | 抓包未给 UI，但 tool_result 给固定确认话术                                        | presenter 会渲染 todo 列表、用符号区分状态 | presenter 更丰富（支持无 todo、统计等）              |
| 强提醒用户用 todo  | 有空 todo + stale todo 两类提醒                                            | 只有空 todo                      | Kode 有多种提醒类别（todo/security/perf/mention） |

---

### 3) 给 Formax 的可落地方案（按 PR/步骤拆分，越细越好）

下面我按 **MVP→Full** 的节奏拆成 7 个 PR。每个 PR 都给出【改哪些文件/新增哪些模块】【接口/数据结构签名】【验收方式】。
（路径用你 repo 里已出现的结构：`src/tools/modules/...`、`src/features/repl/...`、`src/tools/runtime/...` 等。）

---

## PR1：TodoWrite 工具契约对齐 Claude Code（spec/handler/presenter）

### 目标（MVP 必做）

* **入参 schema**：保持 Claude Code 抓包一致：`{ todos: Array<{content,status,activeForm}> }`
* **校验规则**：至少补齐

  1. `content/activeForm` 非空；2) status 枚举合法；3) `in_progress` ≤ 1（或严格=1，见下文策略）；4) maxTodos（建议 100）
* **tool_result 给模型**：改为 Claude Code 固定话术（不要返回 “Updated N todos”）
* **UI presenter**：渲染列表（保留你现有），但补齐 “next pending 高亮 / completed 划线” 这类 Claude 风格细节（只影响 UI，不影响模型）

---

### A) TodoWrite 工具契约：推荐 schema & 规则

#### A.1 推荐 TodoItem schema（MVP）

继续采用 Claude Code 的最小字段集（抓包已确认）：

```ts
export type TodoStatus = 'pending' | 'in_progress' | 'completed'

export interface TodoItem {
  content: string
  status: TodoStatus
  activeForm: string
}

export interface TodoWriteInput {
  todos: TodoItem[]
}
```

**为什么不在 MVP 引入 id/priority/tags？**

* Claude Code 抓包 schema 不含这些字段；引入后会让模型“以为可用”，但后端不一定全链路支持（尤其 subagent/提醒 hash）。
* 你后续要做 Full 时，可以内部派生 `id`（由 content hash 生成）用于 reminder hash，但不要暴露给模型（见 PR3/PR4）。

#### A.2 输入校验策略（MVP）

新增一个纯函数校验器（方便单测）：

```ts
export type TodoValidationError =
  | { code: 'EMPTY_CONTENT'; index: number }
  | { code: 'EMPTY_ACTIVE_FORM'; index: number }
  | { code: 'INVALID_STATUS'; index: number; status: string }
  | { code: 'TOO_MANY_IN_PROGRESS'; count: number }
  | { code: 'TOO_MANY_TODOS'; max: number; got: number }

export function validateTodoWriteInput(
  input: TodoWriteInput,
  opts?: { maxTodos?: number; requireExactlyOneInProgress?: boolean }
): { ok: true } | { ok: false; error: TodoValidationError }
```

**关于 “Exactly ONE in_progress”**

* Claude Code tool prompt 在系统提示里写的是 “Exactly ONE task must be in_progress at any time”。
* 但现实上：刚开始创建 todo 列表时，模型可能先给全 pending，再逐步推进。
* 我建议：

  * **MVP**：只校验 `in_progress <= 1`（允许 0）；
  * **Full**：当 `todos.length > 0` 且存在 pending 时，再强制 `in_progress==1`（更贴近“执行阶段”语义）。
  * 同时用 reminder 引导模型修正，而不是 hard fail（见 PR4）。

#### A.3 Handler 输出给 assistant 的 resultForAssistant（Claude Code 风格）

把你现在的：

* `resultForAssistant: Updated ${n} todos`

改成固定字符串（完全对齐抓包）：

> `Todos have been modified successfully. Ensure that you continue to use the todo list to track your progress. Please proceed with the current tasks if applicable`

抓包原文见。

**实现方式建议**

* `ToolHandler` 返回结构中继续带 `data`（供 presenter 渲染），但 `resultForAssistant` 固定。
* 这样不会破坏 UI，同时模型收到的是 Claude Code 风格。

---

### 需要改/新增的文件

1. `src/tools/modules/todoWrite/spec.ts`

* 更新 description/prompt：把 Claude Code 的关键规则（何时用 TodoWrite、activeForm 要求、in_progress 约束、避免提 reminder 等）写进去。
* 保持 `input_schema` 与抓包一致（content/status/activeForm）。

2. `src/tools/modules/todoWrite/handler.ts`（你已有）

* 在 `execute()` 开头调用 `validateTodoWriteInput()`（新建）。
* 写文件逻辑可保留：读取 `resolveTodosPath()` 并写 `{ todos }`。
* 把 `resultForAssistant` 改为固定话术；`data` 仍可回 `{ todos, stats }` 给 UI。

3. `src/tools/modules/todoWrite/presenter.tsx`（你已有）

* 在现有渲染基础上：

  * `in_progress` 用更醒目的符号/颜色（你已有 `▶`/黄色）；
  * `completed` 用 strikethrough（Ink 的 Text 不一定支持真正删除线，可用 dim + 前缀 `✓` + 将文字变灰；或自己渲染 `~text~`）。
  * “next pending 高亮”：如果有 `in_progress`，next pending 是第一个 pending；如果没有 in_progress，next pending 是第一个 pending 并提示用户把一个 pending 提升为 in_progress。

4. 新增 `src/tools/modules/todoWrite/validate.ts`（纯函数）

* 放 `validateTodoWriteInput()`。

---

### 验收方式（PR1）

* 单测：`src/tools/modules/todoWrite/validate.test.ts`

  * 空 content/activeForm → fail
  * status 非法 → fail
  * `in_progress`=2 → fail
  * todos>100 → fail
* 集成测：`src/tools/modules/todoWrite/handler.test.ts`

  * 执行后写入 `{todos:[...]}` 到 `resolveTodosPath()` 指向位置；`resultForAssistant` 必须等于固定话术。
* 手工：运行 REPL，执行一次 TodoWrite，确认 UI 列表仍渲染、模型侧 tool_result 变成固定话术。

---

## PR2：把注入逻辑从散落函数升级成 `ReminderService`（去重/节流 + 可扩展）

### 目标（MVP 必做）

* 让 `<system-reminder>` 注入不再是 `buildTodoInjectedBlocks/buildClaudeMdInjectedBlocks` 两个函数硬编码，而是一个可组合的服务：

  * `ReminderService.generateInjectedBlocks(ctx)` → `PromptBlock[]`
* 内置去重/节流，避免每轮重复注入导致 prompt 膨胀（你现在 `buildTodoInjectedBlocks` 每轮都会注入，只要 todo 为空）。

---

### B) system-reminder “状态→提醒→强引导”层（MVP 设计）

#### B.1 新增 Session State（内存态即可，Full 再持久化）

```ts
export interface ReminderSessionState {
  // todo
  lastTodoWriteAt?: number
  lastTodoHash?: string
  lastTodoCount?: number

  // claudeMd
  lastClaudeMdHash?: string

  // throttling
  remindersSent: Record<string, number> // key -> timestamp(ms)
  reminderCount: number
}
```

存放位置建议：

* 如果你已有 `ReplUiContext` / event bus（文档里提到）

  * 放 `ReminderSessionState` 到一个 `ReminderContext` 或放在 REPL 主循环的 session object。

#### B.2 Reminder key 设计（去重的核心）

参考 Kode 的做法：用 state hash 拼 key，然后 `remindersSent` Set/Map 去重。
Formax 建议 key：

* `todo_empty`
* `todo_stale_{bucket}`（bucket = floor((now-lastTodoWriteAt)/threshold)）
* `claude_md_{hash}`
* `todo_updated_{hash}`（Full 用）

#### B.3 生成 `<system-reminder>` block 的统一函数

```ts
export interface InjectedBlock {
  type: 'text'
  text: string
  cache_control?: { type: 'ephemeral' }
}

export function makeSystemReminder(text: string): InjectedBlock {
  return { type: 'text', text: `<system-reminder>\n${text}\n</system-reminder>`, cache_control: { type: 'ephemeral' } }
}
```

#### B.4 去重/节流策略（MVP）

* 每次请求前调用 `generateInjectedBlocks()`
* 对每个候选 reminder：

  * 计算 key；如果 `remindersSent[key]` 存在且 `now - sentAt < TTL` → 跳过
* 全局限制：每轮最多注入 2 条 reminder、每 session 最多 10 条（与 Kode 类似）。

---

### 需要改/新增的文件（PR2）

1. 新增 `src/features/repl/reminders/ReminderService.ts`

```ts
export class ReminderService {
  constructor(private store: ReminderStateStore, private deps: { todoRepo: TodoRepo; claudeMdRepo: ClaudeMdRepo }) {}
  generateInjectedBlocks(ctx: ReminderContext): InjectedBlock[]
}
```

2. 新增 `src/features/repl/reminders/ReminderStateStore.ts`

* 提供 `get()/set()` session state（先内存，后面 Full 可以落盘）。

3. 改 `src/features/repl/injectedBlocks.ts`

* 变成薄封装：`return reminderService.generateInjectedBlocks({cwd, ...})`
* 你原先的 `buildTodoInjectedBlocks/buildClaudeMdInjectedBlocks` 可以保留一版实现，但逐步迁移到 service。

---

### 验收方式（PR2）

* 单测：`src/features/repl/reminders/ReminderService.test.ts`

  * todo 为空 → 注入 todo_empty
  * 1 秒内重复调用 → 不重复注入（TTL 生效）
  * 超过 session max → 不再注入
* 集成：跑 `src/features/repl/injectedBlocks.test.ts` 现有用例应继续通过。

---

## PR3：CLAUDE.md 注入对齐“项目 + 全局 + 父目录”扫描（并做 hash 去重）

### 目标

* 对齐 Anthropic 建议：Claude Code 会从项目/父目录/用户 home `~/.claude/CLAUDE.md` 读取“memory”。
* 解决 Formax STATUS.md 的 TODO：全局 CLAUDE.md 支持
* 做内容 hash：文件没变就不重复注入

---

### 设计要点（Full 的一部分，但实现成本低，建议早做）

#### CLAUDE.md 发现策略

实现 `discoverClaudeMdFiles(cwd)`：

* 项目侧：从 `cwd` 向上遍历到 git root（或 filesystem root），收集每层目录里的 `CLAUDE.md`（可选也支持 `.claude/CLAUDE.md`，但官方明确的是 `CLAUDE.md`）
* 全局侧：如果存在 `~/.claude/CLAUDE.md`，也加入列表（默认开启或 env 开关 `FORMAX_ENABLE_GLOBAL_CLAUDE_MD=1`）

#### 拼接顺序（建议）

因为官方没明确顺序（To-Verify），我建议**确定性顺序**：

1. 全局 `~/.claude/CLAUDE.md`（最通用）
2. 从 root→cwd 的 CLAUDE.md（越靠近 cwd 越后，越优先）

并在注入文本里明确每段来源路径，便于调试。

#### 注入格式（与抓包一致）

沿用你现在的格式（抓包也一样）：

* `<system-reminder>\n# claudeMd\nCodebase and user instructions are shown below.\n\nContents of /path/CLAUDE.md ...\n...\n</system-reminder>`

---

### 需要改/新增的文件（PR3）

1. 新增 `src/features/repl/claudeMd/ClaudeMdRepo.ts`

```ts
export interface ClaudeMdDoc { path: string; content: string; sha256: string; mtimeMs: number }
export interface ClaudeMdRepo {
  discover(cwd: string): ClaudeMdDoc[]
}
```

2. 改 `ReminderService`（PR2）

* 新增 `claudeMd` provider：

  * 计算 concat hash（或按 doc hash 拼）
  * 若 hash 未变且 TTL 未到 → 不注入
  * 否则注入合并文本

3. 新增配置：

* env：`FORMAX_ENABLE_GLOBAL_CLAUDE_MD=1`（默认 0，避免惊扰）
* env：`FORMAX_CLAUDE_MD_MAX_CHARS=200000`（与你现有截断策略一致）

---

### 验收方式（PR3）

* 单测：`ClaudeMdRepo.test.ts`

  * 模拟目录层级：确保能找齐父目录 CLAUDE.md
  * 模拟 home 文件：开关打开才包含
* 手工：

  * 创建 `~/.claude/CLAUDE.md` 写一行标识；在项目跑 Formax；抓包确认 `# claudeMd` block 包含这段（见第 5 节）。

---

## PR4：todo “状态→事件→提醒”对齐 Claude Code 的两类提醒（空 todo + stale todo）并预留 todo_updated

### 目标

* 把抓包里出现的两类 todo 提醒做成可配置的 provider：

  * todo_empty（你已做）
  * todo_stale（你未做，但抓包出现）
* 为 Full 版本预留 todo_updated（参考 Kode 的 key/hash 去重）

---

### B) agentId 作用域：主会话与 subagent 的 todo 是否共享？

**我推荐的“一致性策略（MVP→Full 演进）”**

* **MVP**：todo 只属于“主会话”（主 agent），subagent 不允许调用 TodoWrite（见 PR7），因此无需 agentId 分离。
* **Full**：如果你确实想让 subagent 也能写 todo，则必须引入 agentId scope（像 Kode 的 `getTodos(agentId)`/`setTodos(..., agentId)`）；但这会引入 UI 合并、冲突、审批等复杂度。

---

### “TodoWrite 很久没用”提醒（可落地实现）

#### 触发条件（建议，MVP）

* `now - state.lastTodoWriteAt > STALE_MS`（比如 8 分钟）
  **或** `turnIndex - lastTodoWriteTurn > 6`（更稳定，不依赖时钟）
* 且当前 session 发生过 “工程活动”：

  * 发生过任何 file tool（Read/Grep/Glob/Edit/Write）
  * 或发生过 Task/Explore
    （避免用户只是闲聊也被提醒）

#### 文案（对齐抓包）

直接用抓包原文（保持一致性）。

#### 去扰策略

* TTL：15 分钟内最多提醒一次
* 若 todo 为空：优先 todo_empty，不再重复 stale
* 若用户明确说“不需要 todo”：允许 `/todo off` 或 env 关闭该提醒

---

### 需要改/新增的文件（PR4）

1. `ReminderService` 增加 `todoStaleProvider`
2. 在 `TodoWriteToolHandler.execute()` 成功后，发一个内部事件给 `ReminderStateStore`：

```ts
store.update(s => ({ ...s, lastTodoWriteAt: Date.now(), lastTodoHash: hashTodos(input.todos), lastTodoCount: input.todos.length }))
```

3. 新增 `hashTodos(todos)`

* 不要引入 id；直接用 `content|status|activeForm` 拼接 hash
* Full 版本再换成更稳定的规则（或内部派生 id）

---

### 验收方式（PR4）

* 单测：

  * `todo_stale`：模拟 lastTodoWriteAt 很久以前 + 发生过工程活动 → 注入提醒
  * TTL 生效：同一窗口内不重复
* 手工：开一个 session，持续 Read/Grep，不调用 TodoWrite，直到达到阈值，确认出现该提醒。

---

## PR5：多 tool_use 并行执行 + 多 Explore subagent 并发（Claude Code 风格）

### 目标（MVP 必做）

* 让 Formax 的 tool runner 支持 Claude Code 那样：**同一轮 assistant message 内多个 tool_use**（尤其多个 `Task`），并行执行后在下一条 `user` message 返回多个 tool_result。抓包证明 Claude Code 就是这么做的。
* 同时输出 UI 汇总行，像：`3 Explore agents finished (ctrl+o to expand)`。

---

### C) 在 Formax 内支持“一条消息内并发 N 个 Explore”

#### C.1 Tool 执行器：从 “单 tool_use” 改成 “批处理”

在处理 LLM response 时：

1. 收集该 assistant message 里的全部 `tool_use` blocks（顺序保留）。
2. `Promise.allSettled(toolUses.map(execOneToolUse))` 并行执行。
3. 聚合成一条 `role:"user"` message：

   * `content` 先放所有 `tool_result` blocks（按原 tool_use 顺序）
   * 然后再 append `<system-reminder>` blocks（因为 tool_result 与文本的混排要符合 Messages API 规则）。
     Anthropic 官方文档明确支持并行工具调用，并提供禁用并行的参数；你需要确保 **不要禁用并行**。

> 关键注意：并行 tool_use 的情况下，Claude Code 的做法是把多个 tool_result 放到同一条 user message content 里（抓包证明）。

#### C.2 Task/subagent 框架：并发运行 Explore

`Task` tool handler 内部做：

* `spawnSubagent({type:'Explore', prompt, parentSessionId, ...})`
* 返回 `tool_result` 内容（给主 agent 的摘要或文件列表），并把 metrics 回传给 UI（不进模型）

你抓包里 tool_result 内容就是子 agent 的“文本产出”（列出文件与要点）。

---

### UI 怎么做才像 Claude Code（摘要行 + ctrl+o 展开）

#### C.3 UI 数据结构

```ts
export interface SubagentRunMetrics {
  agentId: string
  subagentType: 'Explore' | 'Plan' | string
  toolUseCount: number
  inputTokens?: number
  outputTokens?: number
  durationMs: number
}

export interface SubagentGroupSummary {
  subagentType: 'Explore' | 'Plan'
  runs: SubagentRunMetrics[]
  totalToolUseCount: number
  totalTokens?: number
  totalDurationMs: number // wall time or sum; Claude Code UI更像 wall time
}
```

#### C.4 呈现行为（按 Claude Code）

* 当并发 Task 开始：显示 `Running 3 Explore agents…`
* 全部结束：显示 `3 Explore agents finished (ctrl+o to expand)`
* ctrl+o：展开每个 agent 一行：`Explore · 20 tool uses · 44.0k tokens · 3.4s`

**Inferred**：tokens 来自 API usage；tool uses 来自内部计数；duration 来自 timer。

---

### 需要改/新增的文件（PR5）

1. 工具执行器（你项目里负责“处理 tool_use/产出 tool_result”的核心文件）

* 新增 `executeToolUsesInBatch(toolUses, ctx)`
* 返回：`toolResults: ContentBlock[]` + `uiEvents`（subagent metrics）

2. `src/tools/modules/task/*`（或你现有 Task tool 实现处）

* 支持并发：Task handler 本身可能被多次并行调用
* metrics 统一上报给 UI 层

3. UI：新增 `src/screens/repl/SubagentGroupStatus.tsx`（示意）

* 监听 subagent events，支持 ctrl+o toggle

---

### 验收方式（PR5）

* 集成测（建议用 mock LLM response）：

  * 输入含 3 个 tool_use(Task) 的 assistant message → executor 必须并行执行，返回 3 个 tool_result blocks（顺序与 tool_use 顺序一致）。
* 手工：用 Plan 模式或让模型一次性发起 3 个 Explore Task，确认 UI 汇总与展开可用。

---

## PR6：context 压缩/compact（可选，但建议预留）

> 这一块抓包未直接证实 Claude Code 的自动行为，但官方文档确认 `/compact` 的能力存在。
> 所以我建议先做“轻量版”，再决定要不要做“完整 pipeline”。

### D) 轻量方案：仅做 summary 注入

* 增加一个本地命令 `/compact`：

  * 调用一次 summarizer（可以用同一个模型或更便宜的模型）
  * 生成 `conversationSummary`（200~500 tokens）
  * 存到 sessionState
* 每轮请求前，如果 summary 存在，注入一个 `<system-reminder>`（或 `<conversation-summary>`）块：

  * “Conversation summary (auto-generated): …”

**侵入点小**：不改历史 messages，仅额外注入一个 summary block。

### D) 完整方案：conversation compaction pipeline

* 触发条件：

  * 手动 `/compact`
  * 或 token 估算超过阈值（例如 60k）
* pipeline：

  1. 把“早期对话 + tool outputs”总结成一条 summary message
  2. 用 summary 替换掉早期 messages（保留最近 N 轮原文）
  3. 把被压缩的原始对话写到 `proxy/logs/compactions/{timestamp}.json` 方便回溯

**风险**：

* 可能丢失细节导致后续回答质量下降
* tool_use/tool_result 的结构化信息被压缩后，可能影响模型推理（尤其修 bug 时）

---

## PR7：安全/审批策略（结合 subagent）

### E) 是否让 subagent 调用 TodoWrite？

**建议（简单可执行、少分支）**

* **MVP**：subagent 禁止调用 `TodoWrite`（以及任何写工具：Write/Edit/Bash destructive/AskUserQuestion）。

  * subagent 只允许 read-only 类工具（Read/Grep/Glob/WebSearch/WebFetch）。
  * subagent 如果需要更新 todo：在其输出里给 “建议 todo diff”，由主 agent 统一调用 TodoWrite。
* **Full**：若你坚持 subagent 可写：

  * `TodoWrite` 标为 `isConcurrencySafe=false`（参考 Kode 的做法）
  * subagent 调用 TodoWrite 需要主会话 approval（类似 “proposal→approve→apply”）

### E) subagent 触发交互型工具如何不把 REPL 卡死？

* 策略：subagent 工具策略里直接禁用交互型工具；如果模型尝试调用：

  * 返回 tool_result：`Subagent tool policy forbids AskUserQuestion. Please ask in main session.`
  * 并把“需要问用户的问题”作为普通文本返回给主 agent，由主 agent 统一 AskUserQuestion（或直接在 UI 提示）

---

### 4) 验收与测试清单（必须可执行）

## 自动化测试（建议新增）

> 文件名给建议，你可以按现有 vitest/ink-testing 框架落地。

1. `src/tools/modules/todoWrite/validate.test.ts`

* 断言：

  * 2 个 in_progress → error code `TOO_MANY_IN_PROGRESS`
  * 空 content → `EMPTY_CONTENT`
  * 空 activeForm → `EMPTY_ACTIVE_FORM`
  * todos>100 → `TOO_MANY_TODOS`

2. `src/tools/modules/todoWrite/handler.test.ts`

* mock ctx.cwd/logsDir
* 执行后：

  * 写出的 json 形如 `{ todos: [...] }`
  * `resultForAssistant` 必须等于 Claude Code 固定话术

3. `src/features/repl/reminders/ReminderService.test.ts`

* 空 todo → 注入 todo_empty reminder（文本包含 “todo list is currently empty”）
* TTL 去重：连续两次调用只注入一次
* stale：模拟 lastTodoWriteAt 很久以前 + 工程活动标记 → 注入 “TodoWrite hasn’t been used recently” 文案

4. `src/tools/executor/toolBatchExecutor.test.ts`

* 输入含 3 个 tool_use(Task) 的 assistant message → 输出 3 个 tool_result blocks（顺序一致）
* 且同一条 user message 里 tool_result blocks 在前，reminder blocks 在后（对齐抓包结构）

5. `src/screens/repl/SubagentGroupStatus.test.tsx`（如果你有 ink 测试框架）

* 输入 3 个 subagent metrics → 渲染 `3 Explore agents finished (ctrl+o...)`
* 模拟 ctrl+o → 展开列表

---

## 手工验收脚本（5–10 条，复制可跑）

1. **todo 空 → 提示出现**

   * 删除/移动 `proxy/logs/todos.json`（或设置 `FORMAX_TODOS_PATH` 指向不存在文件）
   * 启动 Formax，随便问一句工程问题
   * 预期：请求里出现 `<system-reminder>` 空 todo 文案（可在代理抓包里看到）

2. **TodoWrite 更新 → tool_result 固定话术**

   * 在对话里让模型调用 TodoWrite 写入 3 条 todo
   * 预期：tool_result content 是固定句子，而不是 “Updated N todos”

3. **TodoWrite UI 列表渲染**

   * 同上
   * 预期：终端里看到 todo 列表，in_progress 高亮，completed 变灰/带 ✓（按你实现）

4. **CLAUDE.md 注入生效（项目）**

   * 在项目根写 `CLAUDE.md` 加一段明显标识
   * 启动 Formax，在抓包中看到 `<system-reminder># claudeMd ... Contents of .../CLAUDE.md ...`

5. **CLAUDE.md 注入生效（全局）**（PR3 后）

   * 写 `~/.claude/CLAUDE.md` 一句明显标识
   * 开启 `FORMAX_ENABLE_GLOBAL_CLAUDE_MD=1`
   * 预期：抓包里 `# claudeMd` block 同时包含 global + project 两段（顺序按实现）

6. **并发 3 Explore → 汇总 UI**（PR5 后）

   * 让模型在一次回复里同时调用 3 次 Task(subagent_type=Explore)（你可直接给 prompt：请并行开 3 个 Explore）
   * 预期：抓包里 assistant message 含 3 个 tool_use(Task)
   * UI：出现 `3 Explore agents finished (ctrl+o to expand)`

7. **tool_result 之后追加 system-reminder**

   * 让 Explore 执行一轮后继续对话
   * 预期：tool_result blocks 在同一条 user message 内，并且后面可以跟 `<system-reminder>`（对齐抓包结构）

8. **长会话触发 TodoWrite stale 提醒**（PR4 后）

   * 连续多轮 Read/Grep/Task，但不调用 TodoWrite
   * 预期：出现 “The TodoWrite tool hasn't been used recently …”

9. **subagent 工具边界**（PR7 后）

   * 诱导 Explore subagent 去调用 Write/Edit/TodoWrite
   * 预期：subagent 得到 tool_result 拒绝/提示，由主会话接管，不会卡住 REPL

10. **/compact（如果实现 PR6）**

* 输入 `/compact`
* 预期：生成 summary 并在后续请求中注入 summary block；历史消息不丢（轻量方案）

---

### 5) 需要我继续抓包/补充的最小信息（不超过 8 条）

> 每条都说明：怎么操作、期望看到什么、影响哪个设计决策。

1. **验证全局 `~/.claude/CLAUDE.md` 是否注入 + 顺序**

   * 操作：在 Claude Code 机器上创建 `~/.claude/CLAUDE.md`（写 “GLOBAL_MARKER”），项目 `CLAUDE.md` 写 “PROJECT_MARKER”，发起一次请求。
   * 期望：抓包里 `# claudeMd` block 同时出现两个 marker；观察拼接顺序。
   * 影响：PR3 的 discover/拼接顺序与“覆盖策略”。

2. **验证 todo 更新后是否注入 todo 摘要/列表**

   * 操作：先调用 TodoWrite 写入 5 条 todo，再立刻问一个无关问题（不要再 TodoWrite）。
   * 期望：下一次请求里是否出现新的 `<system-reminder>`（例如 “todo updated …” 或直接包含 todo 列表/摘要）。
   * 影响：PR4 是否要实现 todo_updated reminder（以及呈现格式）。

3. **验证 stale reminder 的阈值**

   * 操作：开一个 session，不用 TodoWrite，持续进行工程活动（Read/Grep/Task）并记录第几轮/多久后出现 “TodoWrite hasn’t been used recently”。
   * 期望：抓包出现该 reminder 文案并可推断阈值。
   * 影响：PR4 的触发条件（turn-based vs time-based）。

4. **验证空 todo reminder 是否每轮都注入还是节流**

   * 操作：保持 todo 为空，连续问 3 次问题。
   * 期望：每轮都出现空 todo reminder，还是只出现一次/偶尔出现。
   * 影响：PR2 的 TTL/去重默认值（“一次提醒”还是“持续提醒”）。

5. **验证 subagent 是否能调用 TodoWrite（Claude Code 行为）**

   * 操作：在 Plan/Explore 阶段明确让 Explore agent 更新 todo（提示它“please use TodoWrite in subagent”）。
   * 期望：抓包里 subagent 对应的 message 是否包含 tool_use(TodoWrite)。
   * 影响：PR7 的 subagent policy 是否要对齐 Claude Code（允许/禁止）。

6. **验证 tool_result 与系统 reminder 的排序硬约束**

   * 操作：观察任意一轮 tool_use 后，Claude Code 是否总把 tool_result blocks 放在 user message content 的最前面，然后才是文本/系统提醒。
   * 期望：始终遵守该顺序（与你当前抓包一致）。
   * 影响：PR5 的批处理组装逻辑（避免插入顺序导致 API 拒绝）。

7. **验证 compaction 的抓包特征**

   * 操作：在 Claude Code 里执行 `/compact`（或让对话变得很长），然后继续对话。
   * 期望：请求里出现“summary/compact”相关的 system 指令或特殊 block。
   * 影响：PR6 要不要做自动 compaction、以及该怎么与历史消息结构兼容。

8. **验证 `cache_control: ephemeral` 的使用规则**

   * 操作：抓 2~3 次请求，观察哪些块标了 ephemeral：system、system-reminder、tool_use、tool_result、用户输入。
   * 期望：能总结出 Claude Code 的标注规律。
   * 影响：Formax 是否也要在 injected blocks 上统一标 ephemeral（成本/收益权衡）。

---

## 联网调研引用（少而精）与引用原因

* Anthropic 官方 Claude Code best practices：用于确认 **CLAUDE.md 的推荐放置位置（含 `~/.claude/CLAUDE.md`、父目录扫描）**，这是“全局 + 项目”注入设计的依据。
* Anthropic 官方 Messages/Formatting 文档：用于确认 **并行 tool use 的能力、是否能禁用并行、以及 content blocks 的规范**，这是“单轮多 Task 并发 + tool_result 组装”的依据。
* Anthropic Slash commands 文档：用于确认 `/compact` 的语义（总结对话、释放上下文），是 PR6 的依据。
