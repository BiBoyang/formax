## 结论摘要（1 页内）

* **Observed（抓包/代码可确定）**

  1. Claude Code/参考实现会注入一个 `<system-reminder>`，当 **TodoWrite 很久没用** 时提示“考虑用 TodoWrite 跟踪进度”，并强调**绝对不要把 reminder 内容告诉用户**。
  2. TodoWrite 的 **tool_result 给模型是固定话术（不会回显 todo 列表）**，而 UI/终端展示可以从 storage 读取当前 todo 列表渲染（并可高亮 next）。
  3. “Exactly ONE in_progress” 在 prompt 里写得很硬，但校验器层面只硬性限制 **“最多 1 个 in_progress”**（>1 才报错），没有硬性要求必须 ≥1。
  4. 参考实现（Kode）里明确存在 `todo_updated` reminder：**todo 变化后注入“Here are the latest contents…”**，并且有 **key/hash 去重** + **每次请求最多 5 条** + **每 session 最多 10 条** 的节流逻辑。
  5. `CLAUDE.md` 的发现/拼接与优先级：官方 Claude Code 文档明确：User（`~/.claude/CLAUDE.md`）+ Project（`CLAUDE.md` 或 `.claude/CLAUDE.md`）+ Local（`CLAUDE.local.md`）等多层级，并且会**向父目录递归发现**；优先级/覆盖顺序也有清晰规则（Managed > CLI args > Local > Project > User）。
  6. `cache_control: {type:"ephemeral"}`：这是 Anthropic Prompt Caching 的“断点”标记；默认缓存 TTL 5 分钟，读写 tokens 的计费也不同（写 1.25x、读 0.1x 等），并可用 `cache_creation_input_tokens` / `cache_read_input_tokens` 观测命中情况。

* **Inferred（合理推断）**

  * “TodoWrite hasn’t been used recently” 的**触发阈值**（多少分钟/多少轮）在现有材料里看不到常量；更像是按 **“上次 TodoWrite tool_use 时间/轮次”** 计算 + 结合会话复杂度 gating。
  * 多 Explore 并发的 UI 汇总行（tool uses/tokens/duration）更可能来自本地统计（聚合子 agent usage/duration），而不是模型“自己猜”。

* **To-Verify（需要补抓包确认）**

  * stale reminder 的 **确切阈值与 gating 条件**（是否仅 plan/长任务/有 todo 才触发）。
  * Claude Code 的 todo 持久化**确切路径与作用域细节**（是否 `~/.claude/todos/…`、是否每个 subagent 独立文件、是否主会话聚合展示）。
  * Claude Code 是否也像 Kode 一样在 todo update 后注入 `todo_updated`（抓包未直接对齐，需要验证）。

> 我引用的公开资料只用官方两处：Claude Code 的 **configuration + memory management** 文档（用来回答 `CLAUDE.md` 的发现/优先级），以及 Anthropic 的 **Prompt Caching** 文档（用来回答 `cache_control: ephemeral`）。

---

# 1) “TodoWrite hasn’t been used recently” 的触发规则

### Observed

* 抓包/拼接日志里出现 `<system-reminder>`：
  “**The TodoWrite tool hasn’t been used recently…** only use it if relevant… **NEVER mention this reminder to the user**”
  这说明至少存在一条“TodoWrite 使用变陈旧（stale）”的提醒通道。

### Inferred

* **触发阈值**更可能是“距离上次 TodoWrite tool_use 的时间/轮数”而非“session 创建时间”：因为“hasn’t been used recently”语义更贴近“工具最后一次被调用”。
* **gating（是否注入）**更可能与“任务复杂度/当前是否在做 multi-step”相关：提醒文本本身就说“Only use it if it’s relevant… ignore if not applicable”。
* **模式相关**：它在 plan-mode 的上下文里出现过（至少在该段日志中），但不能证明“仅 plan 才注入”。

### To-Verify：最小抓包验证清单（≤5 步）

目标：确定 **阈值是按时间还是按轮数**，以及是否只在特定模式出现。

1. **新开一个 Claude Code 会话**（在任意 repo）。第一轮让 Claude 主动创建 todo（或你手动触发让它调用 TodoWrite）。

   * 期望在请求里看到：`"name":"TodoWrite"` 的 `tool_use`。
2. **连续给 8~12 次“继续/下一步”**（刻意不让它再调用 TodoWrite）。

   * 期望：某次请求里出现 `<system-reminder>` 且包含 “hasn't been used recently”。
3. **记录第 1 步 TodoWrite 出现的请求序号**与第 2 步 stale reminder 出现的请求序号。

   * 用于确认：按轮数阈值（如 8 turns）还是按时间。
4. **时间维度验证**：同样流程但把“连续提示”改为“等待 10~20 分钟后再发一句继续”。

   * 如果无需很多轮也会触发，则更偏时间阈值。
5. **模式 gating 验证**：对照两组实验：

   * A 组在普通对话；B 组进入 plan 模式（或做一个明显 multi-step 的实现任务）。
   * 看 stale reminder 是否只在 B 组出现。

### 落地步骤（Formax）

1. **新增 session 指标**（建议放 `SessionState.todo`）：

   * `lastTodoWriteAtMs: number | null`
   * `lastTodoWriteTurn: number | null`
   * `staleBucketSent: Set<string>` 或 `Map<string, number>`（key→sentAt）
2. **在 TodoWrite handler 成功后**更新 `lastTodoWriteAtMs/Turn`。
3. **ReminderService 里加入 todo_stale 规则**：

   * 触发：`now-lastTodoWriteAtMs > STALE_MS` **或** `turn-lastTodoWriteTurn > STALE_TURNS`
   * 建议默认：`STALE_MS=12min`、`STALE_TURNS=8`（先保守）；
   * bucket：`bucket=Math.floor((now-lastTodoWriteAtMs)/10min)`，key=`todo_stale_${agentId}_${bucket}`
   * 去重：同 bucket 只发一次；并且每 session 最多 2~3 次。
4. system-reminder 文案尽量贴近 Claude：

   * “The TodoWrite tool hasn’t been used recently… Only use if relevant… gentle reminder… NEVER mention…”.

### 验收方式（Formax）

* **自动化**：构造 SessionState：`lastTodoWriteAtMs` 超过阈值 + `pendingTodos>0`，断言 ReminderService 返回包含 `todo_stale_*` 的 reminder；重复调用不重复产出。
* **手工**：启动 Formax，对话 10 轮不调用 TodoWrite，观察 request 的 injected `<system-reminder>` 是否只出现 1 次/每 bucket 1 次。

---

# 2) “Exactly ONE in_progress” 是硬约束还是软引导？

### Observed

* TodoWrite prompt（你抓到的/参考实现）里写得很硬：
  “**Exactly ONE task must be in_progress at any time (not less, not more).**”
* 但校验器/实现层面只硬限制 **“最多 1 个 in_progress”**：
  `inProgressCount > 1` 才报错（并没有 `===0` 报错的逻辑）。
* Tool description 口吻也偏软：
  “**Ideally you should only have one todo as in_progress at a time** …”

### Inferred

* 在 Claude Code 里，“Exactly ONE”更像 **强提示（prompt-level policy）**，不是 **硬校验（tool-level schema reject）**。
  理由：如果真是硬约束，通常会在 validator/schema 层报错（像 Kode 的 `inProgressCount > 1` 那样）。

### To-Verify

* 需要抓到 Claude Code 里 **0 个 in_progress** 的 TodoWrite 调用仍成功（tool_result 不报错），才能把“软引导”变成 Observed。

### Formax 最小风险实现策略（建议你现在就这么做）

目标：**先对齐行为收益**，不引入“0 个 in_progress 就报错”导致的用户挫败。

**Phase 0（MVP，低风险）**

* validator：**允许 0 或 1 个 in_progress**；禁止 >1。
* reminder：如果 `pending>0 && in_progress===0`，在 `<system-reminder>` 里“建议挑一个设为 in_progress”，但不要阻断。

**Phase 1（更贴近 Claude prompt，但仍不硬拒绝）**

* tool_result 仍 success；但在 tool_result 给模型的固定话术里增加一句：
  “If there are pending tasks, consider keeping exactly one item in_progress.”（仍然不是 reject）

**Phase 2（可选收紧，只有在你确认 Claude 真硬约束后）**

* 才考虑把 `in_progress===0` 变成 tool-level reject（我不推荐默认这么做）。

### 落地步骤（Formax）

1. `validateTodos()`：

   * 现在只保留 `if inProgressCount>1 error`（对齐 Kode）。
   * 增加 warn 结构：当 `pending>0 && in_progress===0` 返回 `{warnings:[...]}`。
2. `TodoWrite handler`：把 warnings 写入 tool 的 `meta`（只给 UI / telemetry，不给模型）。
3. `ReminderService`：将 warnings 转化为可节流的提醒 key `todo_no_in_progress_${agentId}`，TTL 10 分钟。

### 验收方式（Formax）

* 单测：

  * 输入 0 个 in_progress → 通过（无 error）；
  * 输入 2 个 in_progress → error；
  * 输入 pending>0 且 0 in_progress → warnings 存在。
* 手工：让模型创建全 pending 的 todo；观察不报错但会被轻提示“选一个 in_progress”。

---

# 3) TodoWrite：模型侧 tool_result 与 UI 渲染的关系

### Observed

* Claude Code 抓包中，TodoWrite 的 `tool_result` 是固定话术，不包含 todo 列表本体：
  “Todos have been modified successfully… Ensure that you continue to use the todo list…”
* 参考实现（Kode）明确写了同样的策略：

  * `renderResultForAssistant()` 返回固定确认句（“Match official implementation”）
  * UI 渲染时 **从 storage 读 current todos**，而不是把列表塞进 tool_result 给模型。

### Inferred

* Claude Code 的 UI 高亮/分组（pending / in_progress / completed、next pending）很可能完全是 **本地渲染层**行为：

  * 模型只收到“成功更新”的确认，避免把长列表“当作上下文噪音”。
  * UI 再用 storage 的 authoritative state 来展示（不会被模型输出污染）。

### To-Verify

* Claude Code UI 是否渲染来自 `tool_use.input.todos` 还是来自本地存储（如 `~/.claude/todos`），需要进一步抓 CLI 内部或 debug。

### Formax 推荐实现：模型侧固定、UI 侧丰富（且避免模型误读 UI 文本）

核心原则：**模型只能看到 `tool_result_for_model`**；UI 展示走 **out-of-band channel**（不进入 messages）。

#### 推荐 `ToolResult` 结构（按表实现即可跑）

> 你内部可以用对象结构；发给 Anthropic 的 tool_result content 只发 `forModel.text`（string）。

```ts
type TodoWriteResult = {
  forModel: {
    // 发送到 LLM 的 tool_result content（固定话术）
    text: string;
  };
  forUI: {
    // 仅 UI 使用，不进 LLM 上下文
    kind: "todo_list";
    todos: TodoItem[];
    nextPendingId?: string;
    stats: { total: number; pending: number; in_progress: number; completed: number };
    updatedAtMs: number;
  };
  meta: {
    sessionId: string;
    agentId: string;
    todosHash: string;
    warnings?: string[];
  };
};
```

#### 关键防错点

* **禁止**把 UI 渲染文本（带颜色/符号/列表）拼进 tool_result content，否则模型会把 UI 当成“真实世界文本”，导致下一轮产生错误假设。
* tool_result content 固定一句，最多加一句“keep tracking”。

### 落地步骤（Formax）

1. `src/tools/modules/todoWrite/handler.ts`：返回 `TodoWriteResult`。
2. `src/core/llm/serializeToolResult.ts`：只序列化 `result.forModel.text` 进 `tool_result.content`。
3. `src/tools/modules/todoWrite/presenter.tsx`：从 `result.forUI` 渲染（分组/高亮）。
4. 如果你已有 Kode 风格实现：对齐它的 `renderToolResultMessage()` 从 storage 读 todos 的策略。

### 验收方式（Formax）

* 抓请求：确认 tool_result content 只有固定话术，不包含 todo 列表。
* UI：每次 TodoWrite 后终端展示 todo 列表，并正确高亮 next pending。
* 回归：让模型在下一轮复述 todo 列表，观察它不会“引用 UI 中的颜色/符号”，而只按真实 todo 说。

---

# 4) todo 更新后是否会注入 todo 内容摘要（todo_updated reminder）

### Observed

* 在参考实现（Kode）的 `SystemReminderService` 中，明确存在 todo update reminder：

  * key 设计：`todo_updated_${agentKey}_${todos.length}_${hash}`
  * 文案：
    “Your todo list has changed. Here are the latest contents of your todo list:” + 列表内容
* Kode 的 reminder 系统还有明显的节流：

  * 每次请求最多 5 条提醒
  * 每 session 最多 10 条提醒

### To-Verify（针对 Claude Code）

* 你当前给的 Claude Code 抓包片段里，我**没看到**“Here are the latest contents …”这种 todo_updated 注入，因此对 Claude Code 来说应标 To-Verify。
  但 Kode 的实现已经给了一个“可对齐的参考标准”。

### 我推荐 Formax 也实现 todo_updated（但要非常克制）

理由：

* **多 subagent 并发** / **用户手动改 todo 文件** / **长会话** 时，模型可能对“当前 todo 状态”漂移。
* todo_updated 让模型在关键时刻重新对齐状态。

#### 推荐去重 key/hash + TTL + 频率（默认值）

* `todosHash = sha1(JSON.stringify(normalizedTodos))`（normalized=按 id 排序、去掉 updatedAt 等波动字段）
* reminder key：`todo_updated_${agentId}_${todos.length}_${todosHash}`（对齐 Kode）
* TTL：**30 分钟**（同一个 hash 30 分钟内不重复注入）
* 最大频率：

  * “todo_updated” 每请求最多 1 条
  * 每 session 最多 3 条（避免膨胀）

#### 默认文案（Claude 风格）

```
<system-reminder>
Your todo list has changed. Here are the latest contents of your todo list:
[ ] ...
[x] ...
</system-reminder>
```

（若 todo 很长：只注入 top N + stats + “see UI for full list”——注意这句话不要让用户看到，只对模型。）

### 落地步骤（Formax）

1. 在 TodoWrite handler 成功后：

   * 计算 `todosHash` 写入 `SessionState.todo.lastHash`，并发出事件 `todo:changed({hash, count})`。
2. `ReminderService`：消费事件队列；若该 hash 未在 TTL 内注入过，则生成 todo_updated reminder。
3. **注入位置**：放在 `<system-reminder>` block（system 注入通道），不要混入 assistant 生成文本。
4. 控制长度：N>20 时只注入：in_progress + next 5 pending + stats。

### 验收方式（Formax）

* 自动化：

  * 相同 hash 重复 update → 只注入一次；
  * hash 变化 → 注入；
  * 超过 TTL → 可再次注入。
* 手工：

  * 更新 todo 后下一轮 prompt 中出现 todo_updated；再重复同样更新不会重复出现。

---

# 5) `CLAUDE.md` 发现与拼接顺序

### Observed（官方文档）

* Claude Code 的“memory / instructions”分层位置：

  * User：`~/.claude/CLAUDE.md`
  * Project：`CLAUDE.md` 或 `.claude/CLAUDE.md`
  * Local：`CLAUDE.local.md`（不提交）
  * 还有 Managed policy、CLI `--instructions` 等。
* **加载/覆盖顺序**：

  * “Files higher in the hierarchy take precedence and are loaded first, providing foundation that more specific memories build upon.”
  * 同时强调：User memory 是“基础规则”，Project memory 更具体（更高优先级）。
* **父目录递归发现**：Claude Code 会从当前目录向上递归查找 `CLAUDE.md`，因此 monorepo 下可以放在上层目录做共享。
* **整体优先级**（配置层面）：Managed > CLI args > Local > Project > User。

### Inferred（拼接策略）

* 拼接更像：先加载更“通用”的（User）再加载更“具体”的（Project/Local），让更具体规则覆盖更通用规则（同主题冲突时以更具体为准）。文档也暗示“foundation → specific build upon”。

### Formax 默认策略 + 配置开关（推荐）

默认对齐 Claude Code 文档：

1. **发现范围（默认开启）**

   * `User`: `~/.formax/CLAUDE.md`（类比 `~/.claude/CLAUDE.md`）
   * `Project`: 从 CWD 向上递归到 git root（或 filesystem root）寻找 `CLAUDE.md` / `.formax/CLAUDE.md`（类比 `.claude/CLAUDE.md`）
   * `Local`: `CLAUDE.local.md`（默认读取，但必须在 `.gitignore`）

2. **拼接顺序（默认）**

   * User → Project（从上到下：root->cwd 的顺序）→ Local
   * 然后再叠加 CLI args / Managed（如果你未来支持）

3. **配置开关**（建议 env + config file）

   * `formax.instructions.enableUserClaudeMd = true`
   * `formax.instructions.enableParentSearch = true`
   * `formax.instructions.enableLocalClaudeMd = true`
   * `formax.instructions.maxTotalChars = 20_000`（防膨胀）

### 验证方法（Formax）

* 在 repo root 放 `CLAUDE.md` 写 “ROOT_RULE=1”，在子目录放 `CLAUDE.md` 写 “CHILD_RULE=1”，在 `~/.formax/CLAUDE.md` 写 “USER_RULE=1”。
* 让模型输出“它看到了哪些规则”（通过你 debug log 打印实际注入内容，不要求用户可见）。
* 断言注入顺序与拼接结果符合策略。

### 落地步骤（Formax）

1. 新增 `InstructionLoader`：

   * `loadUserInstructions()`、`loadProjectInstructions(cwd)`、`loadLocalInstructions(cwd)`
2. 新增 `InstructionComposer.compose()`：返回注入 blocks（带 `# claudeMd`/source 标签）。
3. 在每轮请求前调用，写入 system blocks。

---

# 6) `cache_control: { type: "ephemeral" }` 的真实意义

### Observed（官方 Anthropic 文档）

* `cache_control` 是 Prompt Caching 的“断点”标记：你在某个 content block 上设置它，表示“缓存到这里为止的 prompt 前缀”。
* **ephemeral 是唯一支持的 cache type**；默认缓存寿命 **5 分钟**，也可设更长 TTL（例如 1 小时）。
* 计费：cache write 的 tokens 约 **1.25x**，cache read 的 tokens 约 **0.1x**（相比普通 input tokens）。
* 响应中会返回缓存相关的 token 使用字段（如 `cache_creation_input_tokens` / `cache_read_input_tokens`）用来观测命中。

### Inferred（对 Formax 的影响）

* **对模型输出语义基本无影响**：Prompt caching 是性能/成本优化，不改变模型“看到的内容”（命中缓存时仍等价）。
* **不是必须照抄**：如果 Formax 不打算做 caching（或请求前缀不稳定），照抄会带来：

  * 可能发生 cache write（额外成本）但命中率低
  * 工程复杂度上升（需要稳定 prefix、合理放断点）

### To-Verify（副作用最小验证）

* 做 A/B：

  * A：不加 cache_control
  * B：仅在“稳定大前缀”（system prompt + tools schema）处加一个 cache_control
* 连续发送 3 次相同前缀的请求（内容尽量一致），观察响应 usage：

  * B 组应出现 `cache_creation_input_tokens`（第一次）与 `cache_read_input_tokens`（后续）。
* 若 B 组完全无 cache_read，说明前缀不稳定或断点位置不对。

### 落地步骤（Formax）

1. 在 Anthropic request builder 增加 `enablePromptCaching` 配置（默认 false）。
2. 启用时：只在 “system prompt 最末尾的一个 block” 或 “tools 列表最后一个 block” 加 `cache_control: {type:'ephemeral'}`。
3. 记录 usage 并在 debug mode 输出：cache_read/cache_creation tokens。

### 验收方式（Formax）

* 观察 metrics：开启 caching 后重复请求应有 cache_read tokens；且总 input tokens 成本下降（或延迟下降）。

---

# 7) Reminder 去重/节流：推荐参数（给一套默认值）

### Observed（参考实现 Kode）

* `generateReminders()` 有明确上限：**每次请求最多 5 条 reminder**。
* **每 session 最多 10 条**（`maxRemindersPerSession=10`）。
* todo_updated 的 key/hash 去重策略已实现。

### 我给 Formax 的默认值（更保守，避免 prompt 膨胀）

* 每轮最多注入：**2 条**（优先级排序：安全类 > todo_empty/todo_updated > todo_stale）
* 每 session 最多：**8 条**（比 Kode 的 10 更保守）
* TTL（同 key）：

  * `todo_empty`: 10 分钟
  * `todo_stale_bucket`: bucket=10 分钟；同 bucket 只发一次
  * `todo_updated_hash`: 30 分钟
  * `claude_md_hash`: 1 小时（或直到文件 hash 变化）
* 推荐 reminder keys（你提的这组我赞成）

  * `todo_empty`
  * `todo_stale_bucket`
  * `claude_md_hash`
  * `todo_updated_hash`

### 为什么这样配（风险说明）

* **避免 prompt 膨胀**：system-reminder 是 system token，重复注入会线性放大上下文。
* **避免重复提醒影响模型策略**：模型会“过度 todo 化”或被 reminder 绑架，导致对用户输出变机械。
* **避免提醒噪音压过任务指令**：尤其在 plan/多 subagent 期间。

### 落地步骤（Formax）

1. `ReminderService` 维护：

   * `sent: Map<reminderKey, sentAtMs>`
   * `sessionCount: number`
2. `shouldSend(key, ttlMs)`：

   * 如果 `now - sentAt < ttlMs` → false
3. `limitPerTurn=2`：按 priority 排序后截断。
4. `limitPerSession=8`：超过后只保留安全类提醒。

### 验收方式（Formax）

* 1 个长对话跑 30 轮：统计 injected reminders 总数 ≤8；单轮 ≤2；相同 key 在 TTL 内不会重复。

---

# 8) Todo 存储路径策略（Claude vs Kode vs Formax）

### Observed

* **Formax 当前默认**：`proxy/logs/todos.json`（通过 `resolveTodosPath`）。
* **Kode 风格**：使用 home 目录下的 `.kode`，并用 `${sessionId}-agent-${agentId}.json` 这种命名管理 agent 数据。

### To-Verify（Claude Code）

* 公开文档没有写 todo 文件落盘位置；你之前口述/抓包提示“~/.claude/…”，但我这里没有看到官方来源。
  → 因此“Claude Code todo 文件在哪里”应标 To-Verify。

### Formax 三种方案利弊（含迁移）

**A) 继续 `proxy/logs/todos.json`（现状）**

* 👍 实现最简单
* 👎 session/agent 多开会互相覆盖；不利于多 subagent；不利于跨项目隔离

**B) 迁到 `~/.formax/todos/${sessionId}-agent-${agentId}.json`（推荐默认）**

* 👍 对齐 Kode/Claude 的“home + session + agent”范式，天然支持并发与恢复
* 👍 不污染项目目录、不怕误提交
* 👎 用户想“每个项目固定 todo”时不直观（需要 UI 辅助）

**C) 项目内 `.formax/todos.json` 或 `.todos.json`（可选开关）**

* 👍 项目语义强（与 repo 绑定）
* 👎 需要 `.gitignore`；不同机器同步麻烦；并发/多 agent 仍需 namespace

### 不丢数据的迁移策略（向后兼容）

1. **读取顺序**（只迁移一次）：

   * 优先读新路径 `~/.formax/todos/...`
   * 若不存在则读旧路径 `proxy/logs/todos.json`
2. **写入规则**：

   * 一旦读到旧文件并成功 parse：

     * 写到新路径
     * 旧文件保留但打一个 `migratedTo` 标记（或 rename 为 `.bak`）
3. **冲突处理**：

   * 若新旧都存在：以新为准；旧的只做备份可人工恢复

### 落地步骤（Formax）

* 新增 `TodoStorage`：

  * `getPath({scope:'user'|'project', sessionId, agentId})`
  * `load()`：按读取顺序
  * `save()`：只写新路径
* 增加 config：`formax.todo.storage = 'user' | 'project'`（默认 user）

### 验收方式（Formax）

* 旧文件存在、新文件不存在：启动后新文件生成且内容一致；旧文件保留或备份；todo 功能正常。

---

# 9) subagent 与 todo 的作用域

### Observed

* Kode/参考实现的持久化命名明确带 `agentId`：`${sessionId}-agent-${agentId}.json`。
* todo_updated reminder 的 key 也带 `agentKey`，暗示 reminder 作用域至少区分 agent。

### Inferred（Claude Code）

* Claude Code 很可能是 **agent 独立**（至少存储/状态层独立），主会话可能只展示 root agent 的 todo。
* 这样设计能避免：多个 subagent 并发写同一份 todo 导致竞态。

### Formax 推荐（我建议你先“隔离存储 + 主会话唯一写”）

**默认：隔离（per agent） + 主会话可读可写，subagent 默认只读/禁用写**

* 👍 最像 Claude/Kode 的组织方式
* 👍 并发安全（subagent 不会互相覆盖）
* 👍 UI 体验更稳定（用户只看主 todo）

**将来可扩展：允许 subagent 写，但要主会话仲裁**

* subagent 只能产出“todo patch 建议”（文本/结构化），主会话合并后再调用 TodoWrite。

### 落地步骤（Formax）

1. Storage 改成 `{sessionId, agentId}` namespace。
2. tool registry：给 subagent 的可用工具列表里 **默认移除 TodoWrite**。
3. 如果要让 subagent “提议 todo”：新增一个只读工具 `TodoSuggest`（输出 patch，不落盘）。

### 验收方式（Formax）

* 并发 3 个 Explore：不会写 todo 文件；主会话 todo 不被污染。
* subagent 输出中可以包含 todo 建议，但实际 todo 状态不变，除非主会话调用 TodoWrite。

---

# 10) 多 Explore 并发（同一轮并发多个 Task/Explore）

### Observed

* Claude/参考 prompt 对 Task 工具明确要求：**尽可能并发启动多个 agent**，方法是“同一条消息里多个 tool uses”。
* 你提供的 plan 记录里也展示了并发 Explore 的行为与 UI（Entered plan mode → 多个 Explore）。

### Inferred：UI 汇总行的数据来源

* `N Explore agents finished … tool uses/tokens/duration` 很像：

  * `duration`：本地 wall-clock（Promise.all 开始到全部结束）
  * `tokens`：聚合每个 subagent 的 API usage（input/output tokens）
  * `tool uses`：统计 subagent 侧的 tool_use 次数（或每个 agent 的 tool 调用计数）

### Formax 最小实现（先做到“看起来对齐”）

**必须做（MVP）**

* 并发执行：`Promise.all(exploreTasks)`
* 汇总行：`"{N} Explore agents finished in {durationMs}ms"`
* 可展开细节：每个 agent 的 title + 结束状态（OK/ERR）

**可以先不做**

* tokens 精确统计（如果你暂时拿不到 usage）
* tool_use 精确次数（可以先显示 “—” 或只显示子 agent 调用数）

### 事件流 / 数据结构建议

```ts
type TaskSummary = {
  agentId: string;
  subagentType: "Explore"|"Plan";
  description: string;
  startedAtMs: number;
  finishedAtMs: number;
  status: "ok"|"error";
  usage?: { inputTokens: number; outputTokens: number };
  toolUseCount?: number;
};

type TaskBatchSummary = {
  batchId: string;
  subagentType: "Explore";
  tasks: TaskSummary[];
  wallTimeMs: number; // max(finished)-min(started)
  totals: { agents: number; inputTokens?: number; outputTokens?: number; toolUseCount?: number };
};
```

### 落地步骤（Formax）

1. `TaskRunner.runBatch()`：接收 `TaskSpec[]`，并发执行并返回 `TaskBatchSummary`。
2. REPL UI：

   * 先渲染一行 “Explore(…)" x N（启动时）
   * 全部完成后渲染汇总行（可按键展开）
3. usage：如果 Anthropic SDK 返回 usage，塞进 `TaskSummary.usage`；否则为空。

### 验收方式（Formax）

* 人工：跑 3 个 Explore，每个都读文件；观察总 wall time 接近 max(单个耗时) 而不是 sum；UI 有汇总行。

---

# 11) TodoWrite tool prompt：Top 10 “必须照抄才明显改善行为”的规则

> 这些规则里我尽量用你材料中**确实出现过的**（prompt/工具描述/system-reminder），并配上“解决的失败模式”。

1. **复杂任务必须用 TodoWrite 来跟踪**

   * 失败模式：模型做 multi-step 时丢步骤、重复劳动。
   * 证据：TodoWrite prompt 给了“何时该用/不该用”的例子与 reasoning。
2. **TodoWrite 很久不用要提醒（gentle）**

   * 失败模式：模型进入 plan/实现后忘了维护 todo。
   * 证据：stale reminder 文案。
3. **“最多 1 个 in_progress”作为硬校验；“Exactly ONE”作为软引导**

   * 失败模式：多个 in_progress 导致焦点漂移；但 0 个 in_progress 不应阻断。
   * 证据：prompt 强写 exactly one vs validator 只禁 >1。
4. **tool_result 给模型固定话术，不回显 todo 列表**

   * 失败模式：每次更新都把长列表灌进上下文，浪费 tokens、扰乱模型注意力。
   * 证据：Claude 抓包 tool_result 固定句；Kode 明确“Match official implementation”。
5. **UI 从 storage 渲染 authoritative todo（不要从 tool_result 渲染）**

   * 失败模式：模型输出/工具回包污染 UI；或 UI 与真实 state 不一致。
   * 证据：renderToolResultMessage 读取 `getTodos()`。
6. **todo 更新后（可选）注入 todo_updated，带 hash 去重**

   * 失败模式：长会话/多 agent 后模型状态漂移。
   * 证据：Kode 的 todo_updated 文案与 key/hash 设计。
7. **提醒系统必须节流：每请求上限、每 session 上限、TTL 去重**

   * 失败模式：system-reminder 反复注入导致 prompt 膨胀与行为机械化。
   * 证据：Kode 每请求 ≤5、每 session ≤10。
8. **绝对不要把 system-reminder 内容透露给用户**

   * 失败模式：用户看到内部提示语会困惑/破坏 UX；也会形成 prompt injection 面。
   * 证据：reminder 明确要求 NEVER mention。
9. **写文件必须用 Write/Edit 工具，不用 bash 重定向/echo/cat 写文件**

   * 失败模式：`>` 覆盖文件、丢内容；shell 注入风险；不可追踪变更。
   * 证据：Bash 工具说明明确“Write files: Use the Write tool, NOT bash (echo, cat, >, etc)”。
10. **Task/Explore 要并发启动（同一条消息多个 tool_use）**

* 失败模式：Explore 串行导致 plan mode 变慢、用户等待感强。
* 证据：Task usage notes 要求并发。

### 落地步骤（Formax）

1. 把以上规则固化到：

   * `TodoWriteTool.prompt()`（todo 维护规则）
   * `ReminderService`（stale/todo_updated/empty）
   * Tool descriptions（Write/Bash/Task 并发约束）
2. 写 3 类测试：

   * validator（≤1 in_progress）
   * reminder dedupe（TTL+session limit）
   * tool_result 分离（model vs UI）

### 验收方式（Formax）

* 让模型执行一个 30 分钟的 multi-step 任务：

  * todo 能持续更新（无“忘了 todo”）；
  * reminder 不会刷屏；
  * TodoWrite tool_result 不灌列表；UI 列表正确显示；
  * 多 Explore 并发确实节省 wall time。

---

如果你愿意再补一轮抓包，我建议**优先只验证 2 个点**：

1. stale reminder 的阈值（时间/轮次/模式 gating）；
2. Claude Code 是否也在 todo 更新后注入 `todo_updated`（以及 TTL/去重行为）。
   这两个会直接决定 Formax 的默认参数与提醒策略“像不像 Claude Code”。
