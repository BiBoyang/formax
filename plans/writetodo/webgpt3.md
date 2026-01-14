下面内容**仅基于你提供的两份材料**：

* 抓包：`webgpt-todowrite-traffic.simple.bundle.txt`
* 命令行记录：`命令行复制.md`
  我会把每条结论都尽量落到可在日志中定位的证据上；凡是无法从日志里确定的，会明确标注 **“证据不足”** 并给出你需要补抓的最小样例。

---

## 1) TodoWrite 工具契约

### 1.1 工具用途与“强约束”规则（来自 tool 描述）

从抓包里的 TodoWrite 工具说明可以提炼出以下**行为规范**（这些是“模型被要求遵守”的规则，不代表后端一定会强校验）：

* **状态枚举只有三种**：`pending / in_progress / completed`

* **同一时刻只能有一个 in_progress**，并且是“严格等于 1”：

  * 文案是：`Exactly ONE task must be in_progress at any time (not less, not more)`
  * 这直接回答了你问的“是否允许 0 个 in_progress”：**按照该 tool 描述的规范，不允许 0 个（要求恰好 1 个）**
  * 但：是否有后端校验/报错样例？**证据不足**（见 1.4）

* **任务描述必须有两种形式**：`content`（完成态描述）与 `activeForm`（进行态描述）

* **更新节奏**：要求“实时维护”，完成就立刻标 completed、不要批量拖更（“Mark tasks complete IMMEDIATELY… don’t batch”）

> 这些规则属于“Claude Code 提示词层面的契约”。落地实现时，你可以选择在工具层做强校验，或只做最佳努力（best-effort）并记录告警。

---

### 1.2 Input schema：结构与字段语义（来自实际 tool_use / toolCalls）

#### 结构

抓包里实际出现的 TodoWrite 调用，输入是一个对象，包含 **必填**字段 `todos`，其值是数组。

示例（节选，证明字段形态）：

* 顶层：`input: { "todos": [...] }`
* item：`{ "content": "...", "status": "pending|in_progress|completed", "activeForm": "..." }`

在另一个 TodoWrite 调用里也能看到同样结构，并且出现了 `status: "in_progress"`。

#### 字段语义（可落地版本）

结合 tool 描述 + 调用样例，可以落成如下语义：

* `todos: TodoItem[]`
* `TodoItem.content: string`

  * “完成态”表述（例如 “Implement X”/“实现 Y”）。规范要求它代表任务完成后的状态
* `TodoItem.activeForm: string`

  * “进行态”表述（例如 “Implementing X”/“实现中 Y”）。规范要求该字段存在
  * 但样例里出现过 `activeForm` 与 `content` 相同的情况（中文场景很常见），因此**实现时不应强制两者必须不同**；只要字段存在即可（否则会与真实调用不兼容）
* `TodoItem.status: "pending" | "in_progress" | "completed"`

  * 由 tool 描述定义

---

### 1.3 允许的状态组合（重点：0 个 in_progress？）

**提示词规范（Claude Code 期望）**：

* 任何时刻 `in_progress` **必须恰好 1 个**（不多不少）

**调用样例观测**：

* 样例中确实存在一个 `in_progress` 并且只有一个（例如第 7 条）

**是否存在“0 个 in_progress”的成功/失败样例？**

* **证据不足**：抓包里没有看到 TodoWrite 被调用时出现 0 个 in_progress 的输入，也没有看到 TodoWrite 工具返回校验失败。

> 落地建议（不冒充 Claude Code 行为）：
>
> * 若要高度复刻提示词规范：在你的工具实现里**强校验 exactly-one-in_progress**，不满足就返回 tool_error（见 1.4 的错误封装格式）。
> * 若要更稳健：允许 0 个（例如用户让你只记录“完成清单”），但在模型提示词里仍建议保持 1 个，以接近 Claude Code 行为。

---

### 1.4 tool_result 固定文案 & 失败/边界情况

#### tool_result 固定文案

在抓包里，TodoWrite 的 `tool_result.content` 是固定英语句子（至少在你这份样本中是固定的）：

`Todos have been modified successfully. Ensure that you continue to use the todo list to track your progress. Please proceed with the current tasks if applicable`

同样文案在另一个 TodoWrite 返回里也出现（同一片段内可见多次）。

#### 失败/错误封装格式（TodoWrite 自身：证据不足；但“工具报错形式”有证据）

你提供的抓包里**没有** TodoWrite 报错的例子，所以：

* TodoWrite 的“失败/边界情况返回文案” **证据不足**

但是你提供的抓包里有其他工具（Write）报错的标准形态，体现了**Claude Code 工具层统一的错误封装**：

* `type: "tool_result"`, `is_error: true`
* `content` 内是 `<tool_use_error>...</tool_use_error>`

可落地结论：你在另一个项目里实现 TodoWrite 校验失败时，若要贴近该体系，可以复用同样封装：

* `is_error: true`
* `content: "<tool_use_error>...reason...</tool_use_error>"`

> TodoWrite 边界策略（证据不足，但实现必选的点）：
>
> * todos 为空数组时怎么办？（提示词里又要求 1 个 in_progress，会冲突）
> * content/activeForm 为空串是否允许？
> * status 非法值如何处理？

这些需要你补抓样例确认（见第 5 节）。

---

## 2) `/todos` 行为

### 2.1 结论：这份证据里没有 `/todos`

我在你提供的两份材料中**没有定位到**用户输入 `/todos` 或系统输出 `/todos` 的片段，因此以下问题均为 **证据不足**：

* `/todos` 输出文案是什么
* `/todos` 是否读取落盘
* 何时为空、为空提示是什么
* 排序规则/格式规则是否与提醒中的列表完全一致

### 2.2 但：存在“todo 列表的渲染格式”证据（来自 todo_stale reminder）

虽然没有 `/todos`，但抓包里 **todo_stale reminder** 附带了“existing contents”列表，这给了我们一个**可复用的展示格式**：

* 有固定引导句：`Here are the existing contents of your todo list:`
* 列表外层是 `[` 开头，条目是编号 + `[status]` + 文本；最后 `]` 结束（从片段可见）

因此，**如果你要在另一个项目实现 `/todos`**（但不声称等同 Claude Code），最稳妥的做法是：

* 复用 reminder 里已经出现过的渲染格式（编号 + `[status]` + content），作为 `/todos` 的输出格式。

---

## 3) reminders 规则表（最重要）

> 下面表格中，“注入位置”与“文案是否带 existing contents”是有直接证据的；
> “触发阈值（时间/轮次/工具次数）”“去重/TTL”在你当前样本里无法推断，因此标 **证据不足**。

| reminder     | 触发条件（可证据化）                                          | 注入位置（user block vs tool_result）                                                                                | 触发阈值（时间/轮次/工具次数）                                | 去重/TTL                                                                   | 是否附带 “Here are the existing contents…”                        |
| ------------ | --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------- |
| `todo_empty` | 文案明确写“todo list is currently empty”                 | **注入到 request 的 user 消息 content 里**：`<system-reminder>...</system-reminder>` 作为一个文本块（并且和其他 system-reminder 同级） | 证据不足（样本里看不到“空多久/多少轮触发”）                         | 证据不足                                                                     | 否（只提示为空，不附带列表）                                                |
| `todo_stale` | 文案明确写“The TodoWrite tool hasn't been used recently” | **注入到某个 tool_result.content 字符串尾部**（示例是在 Bash `--help` 输出后面拼接 `<system-reminder>...`）                          | 证据不足（只看到“hasn't been used recently”字样，无法反推具体阈值） | 证据不足（但该提醒会随着 tool_result 被带入后续上下文；样本中同一 tool_use_id 的 tool_result 被反复带上） | 是：包含 `Here are the existing contents of your todo list:` + 列表 |

### 3.1 两条 reminders 的固定“隐式约束”：不许明说

* `todo_empty` 提醒里明确要求：`DO NOT mention this to the user explicitly ... Again do not mention this message to the user.`
* `todo_stale` 提醒里也有类似“不要提及”的约束（片段中能看到开头与结构，但中间有省略号，文案不完整）

命令行记录也侧面印证了“系统提示不该提及”这一点（助手在回答里提到了这条系统提示）

> 注意：命令行这段是“助手自述”，不如抓包里的 system-reminder 直接；我把它当作旁证而不是主证据。

---

## 4) 按 PR 切分的“可落地”实现 checklist（不贴完整代码）

下面假设你要在另一个项目里复刻类似机制（不限定语言/框架），我用通用模块名描述；你可以按你项目结构映射到对应目录。

> 目标：让你的项目具备
>
> * TodoWrite 工具（契约/校验/固定 tool_result）
> * reminders（todo_empty + todo_stale，注入位置对齐）
> * /todos 命令（**证据不足**，但给出实现路径 + 待补抓验收点）

---

### PR1 — 数据模型与存储层（TodoStore）

**改哪些模块**

* `src/todos/todoTypes.ts`

  * 定义 `TodoStatus = 'pending' | 'in_progress' | 'completed'`
  * 定义 `TodoItem { content: string; activeForm: string; status: TodoStatus }`
* `src/todos/todoStore.ts`

  * `getTodos(): TodoItem[]`
  * `setTodos(next: TodoItem[]): void`
  * `clearTodos(): void`
  * （可选）`getLastUpdatedAt(): number` 用于 stale 计算（阈值证据不足，但实现会用到）

**要加哪些测试**

* 单测：`todoStore` 默认空数组、set/get round-trip
* 单测：序列化/反序列化保持顺序（因为列表展示似乎按写入顺序编号）

**如何验收**

* `npm test` / `pnpm test` / `pytest`：store 单测通过
* 手动：启动一次会话，写入 2 条 todos，重启后仍能读到（是否落盘：Claude Code 证据不足，但工程上推荐落盘）

---

### PR2 — TodoWrite 工具本体（契约 + 校验 + 固定 tool_result）

**改哪些模块**

* `src/tools/todoWriteTool.ts`

  * 定义工具元信息：`name: "TodoWrite"`, `input_schema` 至少包括 `todos` 数组必填
  * 实现 handler：接收 input，校验后写入 `todoStore.setTodos`
* `src/tools/toolRegistry.ts`：注册工具

**实现要点（对齐证据）**

* Input 必须支持形态：`{ todos: [{content, activeForm, status}, ...] }`
* 状态枚举必须严格限制为三种
* `in_progress` 数量：如果你要对齐提示词规范，强校验必须等于 1
* tool_result 固定返回文案（保持完全一致，便于回归测试）：
  `Todos have been modified successfully...`

**错误返回（建议按工具体系统一格式）**

* 若校验失败：返回 `{ is_error: true, content: "<tool_use_error>...</tool_use_error>" }`（错误封装形式有证据）
* TodoWrite 具体错误文案 **证据不足**：你可以先用你项目内部统一的错误信息，后续补抓样例再对齐。

**要加哪些测试**

* 单测：合法输入（exactly-one in_progress）能写入 store，返回固定 tool_result 文案
* 单测：`status` 非法值报错（is_error + tool_use_error tag）
* 单测：`in_progress` 数量为 0/2 的行为（如果你选择强校验）：应报错；如果选择宽松：应允许并记录 warning（但这就不再等同 Claude Code 提示词规范）

**如何验收**

* `typecheck` / `lint` / `test` 全通过
* 手动：用一个模拟会话调用 TodoWrite，确认返回文案完全匹配抓包

---

### PR3 — reminders 注入器（todo_empty / todo_stale）

**改哪些模块**

* `src/reminders/reminderInjector.ts`

  * `injectIntoUserMessage(messages, todoStore): messages`
  * `injectIntoToolResult(toolResultText, todoStore): toolResultText`
* `src/chat/requestBuilder.ts`（或你项目里构建发给模型的 messages 的地方）

  * 在组装 user 消息时，必要时插入 `<system-reminder>...</system-reminder>` 文本块（todo_empty）
* `src/tools/toolResultPostProcessor.ts`（或工具执行后包装输出的位置）

  * 在 tool_result.content 后拼接 stale reminder（todo_stale）

**实现要点（对齐证据）**

* todo_empty：

  * 注入位置：**user content block**（不是 tool_result）
  * 文案尽量字面一致（含 “DO NOT mention...” 与结尾 “Again do not mention...”）
* todo_stale：

  * 注入位置：**拼接到某个 tool_result.content 字符串尾部**
  * 同时附带 `Here are the existing contents...` + todo 列表渲染

**触发阈值/去重（证据不足，落地必须做决策）**

* 触发阈值（时间/轮次/工具次数）在样本里看不到；因此你需要：

  1. 先实现可配置：`staleAfterMs` / `staleAfterTurns` / `staleAfterToolCalls`
  2. 默认值先选一个你团队可接受的值（但不要声称等同 Claude Code）
* 去重/TTL：样本里看不到显式去重逻辑；但提醒一旦被拼进 tool_result，会随着历史上下文一直存在（这点从“同一 tool_use_id 的 tool_result 在后续请求里仍带 reminder”可以推断，但不一定代表去重机制存在）

  * 建议实现一个“已注入标记”，避免每次都追加同一段提醒导致无限增长（**实现建议，不是 Claude Code 证据**）

**要加哪些测试**

* 单测：todoStore 为空时，requestBuilder 在 user message 前插入 todo_empty reminder，文本包含关键句 “todo list is currently empty” 且在 `<system-reminder>` 内
* 单测：todo_stale 打开时，tool_result.content 末尾追加 reminder 且包含 “Here are the existing contents of your todo list”
* Snapshot 测试：确保提醒注入位置不会跑到 assistant 文本里（必须在 user/tool_result 中）

**如何验收**

* `test` 全通过
* 手动：

  1. 新会话 todos 为空 → 发起一次用户请求 → 在你本地 debug 日志/抓包里能看到 user content 含 todo_empty reminder
  2. 有 todos → 运行一次工具（任意 tool_result）→ tool_result content 尾部包含 todo_stale reminder + 列表格式

---

### PR4 — `/todos` 命令（证据不足，但给可落地实现）

**改哪些模块**

* `src/cli/commands/todos.ts`（或你的命令路由）
* `src/todos/renderTodos.ts`：把 TodoItem[] 渲染成文本

**实现建议（不冒充 Claude Code）**

* 渲染格式优先复用 stale reminder 中已出现的列表格式：

  * 前缀：`Here are the existing contents of your todo list:`（是否要用这一句取决于你产品风格；此句在 reminder 中出现，有证据）
  * 列表：`[1. [status] content ...]`
* 排序规则：**证据不足**。样本里看起来是按写入顺序编号（1..N），并未看到按状态排序。

**要加哪些测试**

* 单测：空列表输出（文案需你决定；Claude Code 证据不足）
* 单测：非空列表输出与渲染函数 snapshot 一致（编号 + status + content）

**如何验收**

* 手动：创建 todos 后执行 `/todos`（或你项目等价命令），输出格式与渲染预期一致

---

## 5) “证据不足”清单 & 需要补抓的最小样例

下面这些点在你当前两份材料里无法确定，我建议你补抓**最小样例**来快速定版：

1. `/todos` 的真实行为（强烈建议补）

   * **缺失点**：输出文案、是否读落盘、空列表提示、排序/格式
   * **最小补抓**：

     1. 新开一个全新会话（确保 todo 为空）→ 输入 `/todos` → 抓包 + CLI 输出
     2. 创建 2~3 条 todo（含 1 条 in_progress）→ 再输入 `/todos` → 抓包 + CLI 输出
     3. 再改一次 todo 状态 → 再 `/todos`（看排序是否变化）

2. TodoWrite 的“硬校验是否存在”（0 个 / 2 个 in_progress 会怎样）

   * **缺失点**：是否允许 0 个 in_progress、>1 个 in_progress；失败时 tool_result 文案是什么
   * **最小补抓**：

     * 通过某种方式让模型发出一个 TodoWrite 输入，其中：

       * Case A：全部 pending（0 个 in_progress）
       * Case B：2 个 in_progress
     * 看 tool_result 是否报错（is_error + `<tool_use_error>`？）还是仍返回成功固定文案

3. todo_stale 的触发阈值（时间/轮次/工具次数）与去重/TTL

   * **缺失点**：多久算 “hasn't been used recently”、是否每次都注入、是否有去重
   * **最小补抓**：

     1. 创建 todo 后，刻意**长时间不调用** TodoWrite（只做 Bash/Read 等）并记录每次请求时间戳
     2. 一旦出现 todo_stale reminder，继续多跑几轮工具，看是否重复追加还是只出现一次（注意抓包里 tool_result content 是否越来越长）

4. todo_stale 文案中间存在 “...” 省略

   * 你当前抓包里该段提醒中间被简化为 `...`（无法知道完整原文）
   * **最小补抓**：换一种抓包/导出方式，确保不做省略（例如导出原始 SSE chunk 或关闭日志简化选项），重新触发一次 todo_stale。

---

如果你愿意把上面第 5 节的 2~3 个“最小补抓样例”补上来，我可以把 `/todos`、TodoWrite 的错误分支、以及 stale 的阈值/去重规则补齐成一份**可直接写进你项目 README/Spec 的最终规范**（并把 PR checklist 中标 “证据不足” 的部分改成确定实现项）。
