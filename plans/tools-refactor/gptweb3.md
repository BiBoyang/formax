## 1) 请求流水线复盘（按序）

下面我按你这次抓到的**同一条“你好 → 我来想想可以做点啥？ → Explore 子代理”链路**来复盘，并把“主对话 vs 元请求”拆开讲清楚。

### 1.1 这次链路里出现了哪些“请求类型”

1. **主对话（面向用户）**

* 对话记录里清楚显示：用户问“我来想想可以做点啥？”，主对话先回一句“我来帮你探索…”，随后启动 Explore 工具并完成（25 次工具调用）。

2. **元请求（topic/title 判定）**

* Claude Code 会在“真正回复用户”之前，先用一个**更便宜/更快的模型**做“是否新话题 + 标题”判定，并要求输出严格 JSON。你这次就返回了 `{"isNewTopic": true, "title": "活动创意"}`。

3. **子代理回路（Explore / 工具环）**

* Explore 子代理是**独立的 /v1/messages 会话**：模型用 Haiku，并且带一套“文件检索专家”的 system prompt；tools 也被缩到 9 个（Bash/Glob/Grep/Read/WebFetch/TodoWrite/WebSearch/Skill/SlashCommand）。
* 子代理通过 tool_use/tool_result 反复回合探索：先 `tool_use: Read(README.md)`，下一条 user message 回 `tool_result`，并在 tool_result 末尾再次强调“只读任务不能写文件”。

---

### 1.2 “主对话 vs 元请求 vs 子代理/工具环”调用链（画出来）

```
User: "我来想想可以做点啥？"
  │
  ├─ (Meta) topic/title 分类请求（Haiku，无 tools，JSON 输出）
  │      └─ {"isNewTopic": true, "title": "..."}  ← 用于 UI 标题/分段
  │
  └─ (Main) 主对话请求（Sonnet，有 tools）
         ├─ Assistant: 先给用户一句“我来帮你探索…”
         └─ tool_use: Task(subagent_type=Explore, prompt=Explore codebase...)
                │
                └─ (Subagent) Explore 会话（Haiku + 9 tools）
                       ├─ tool_use: Read/Glob/Grep...
                       ├─ tool_result: 回填（含 tool_use_id 串联）
                       └─ …重复 N 次（你这次是 25 次 tool uses）:contentReference[oaicite:4]{index=4}
                │
         └─ (Main) 把子代理最终结论“转述”为用户可见文本
```

> 你抓包里能直接看到：Explore 子代理的请求 body 里 tools 数量是 9、toolCount=9，且 response.sseSummary 里会列出 `toolUses/toolCalls/text`。

---

### 1.3 每类请求：目的、输入信号、输出形态

#### A) 元请求：topic/title 判定

* **目的**：给这条用户输入打标签（是否新话题、短标题），用于侧边栏标题、分段、回放导航。
* **输入信号**：单条用户 message（以及少量系统指令），要求“只输出 JSON”。
* **输出形态**：纯 text（JSON 字符串），无 tool_use/tool_result。

#### B) 主对话请求（面向用户）

* **目的**：给用户直接可见的回复 + 决策是否启动工具/子代理。
* **输入信号（你重点关心的几类）**

  * **system-reminder 注入**：例如把 `claudeMd` 等上下文塞进 `<system-reminder>`，提示“除非高度相关否则别回复这段”。
  * **plan mode**：你之前那次抓包里确实出现了 plan mode 的 reminder（你提到的“Plan mode is active…”），这类信号本质是“行为约束开关”（通常禁止写/改/执行，允许先探索/出方案）。
* **输出形态**：`text`（给用户） + 可能的 `tool_use`（比如 Task/Explore）。

#### C) 子代理/工具环（Explore）

* **目的**：把“多步探索”从主对话剥离，降低主模型负担，且用更便宜模型跑工具链。
* **输入信号**

  * 固定的“专家 system prompt”（file search specialist）
  * 限定 tools 列表（9 个）
  * 重复出现的 **READ-ONLY 强约束**（直接拼进 tool_result 内容尾部）
* **输出形态**

  * assistant content 里出现 `tool_use`（带 `id=call_xxx`）
  * 下一条 user content 回 `tool_result`（用 `tool_use_id` 串起来）
  * response.sseSummary 会把本次 response 中的 `toolUses/toolCalls/text` 摘出来，方便 UI/日志。

---

## 2) 可复用的设计模式清单（高价值优先）

> 格式：**模式名 → 触发条件 → 实现方式 → 预期收益 → 风险/注意事项**

1. **Meta Topic/Title Router（Haiku 分类器）**
   → 触发：每次用户新输入（或输入长度/语义变化达到阈值）
   → 实现：独立 /v1/messages；无 tools；强制 JSON 输出（isNewTopic/title）
   → 收益：UI 标题、会话分段、检索/回放体验立刻提升
   → 风险：额外一次请求带来延迟；需要“失败降级”（解析失败就用前 12 字当标题）

2. **主对话 + 子代理剥离（Task → Explore 会话）**
   → 触发：用户问题需要“多步探索/检索/归纳”（>3 次 Read/Grep/Glob 的概率高）
   → 实现：主对话只负责“解释要做什么 + 发起 Task”；子代理用更小模型 + 缩小工具集跑闭环
   → 收益：成本/延迟可控；主模型上下文更干净；UI 可以把子代理折叠成一个卡片
   → 风险：子代理总结可能偏；需要“结果可信度标注 + 可追溯证据”（引用文件路径/片段）

3. **工具集降权/白名单（Per-Agent Toolset）**
   → 触发：进入 Explore/Research 等子代理
   → 实现：请求 body 的 `tools` 只给 9 个读/搜类工具（你这次就是 9 个）
   → 收益：大幅减少“误写文件/误执行命令”面
   → 风险：工具不够用时会卡住；要有“升级到主对话/更强工具集”的回退策略

4. **READ-ONLY 约束“硬塞 tool_result”**
   → 触发：只读任务/plan mode 阶段
   → 实现：执行器在 tool_result 的 content 尾部拼 `<system-reminder> CRITICAL: READ-ONLY...`
   → 收益：约束在每一步都重申，不依赖模型记忆
   → 风险：污染展示内容；UI 需要“reminder-stripper”（渲染时折叠/隐藏这段，但发给模型仍保留）

5. **tool_use_id 贯穿（强一致协议）**
   → 触发：任何工具调用
   → 实现：assistant 发 `tool_use(id=call_xxx)`，下一条 user 回 `tool_result(tool_use_id=call_xxx)`
   → 收益：UI/日志/重放都能做强关联；并发多工具也不乱
   → 风险：你的执行器必须保证“每个 tool_use 都最终有 tool_result”（哪怕 error）

6. **Prompt Caching / Ephemeral 标记**
   → 触发：system prompt 很长且跨请求复用（CLI 的大系统提示词、专家提示）
   → 实现：把 system blocks 以及部分固定内容加 `cache_control: {type: "ephemeral"}`
   → 收益：首包/整体成本下降（尤其是多轮工具环）
   → 风险：不同供应商/代理层对缓存语义不一致；需要可开关、可观测（命中率/节省 token）

7. **sseSummary 抽象层（从 SSE 到 UI 的“事件总线”）**
   → 触发：stream=true
   → 实现：把 raw SSE 解析成统一事件（text_delta/tool_use/tool_result），并可额外生成 summary（toolUses/toolCalls/text）给 UI 快速渲染
   → 收益：Ink UI 不必理解供应商 SSE 细节
   → 风险：summary 会丢细粒度信息（例如逐 token/逐块），需要保留 raw 以便 Debug

8. **TodoWrite “软驱动”机制**
   → 触发：复杂任务、或系统检测到 todo 为空
   → 实现：system-reminder 提醒“todo empty / TodoWrite hasn’t been used”；模型按指令选择是否调用 TodoWrite（工具说明里也明确何时该用/不该用）
   → 收益：把“结构化进度条”变成默认能力
   → 风险：过度 Todo 化影响对话流畅；需要 UI 上可折叠、且只在复杂任务启用

---

## 3) 工具层面的事实约束

> 你要求“以抓包 tools schema 和请求序列作为事实来源”。你这次的 *simple.json 里 tools 只保留了名字（schema 被精简掉），所以 **schema 策略我主要从 tools-copy.json 里抽象**；同时用抓包里的 tool_use/tool_result 协议做校验。若你把“完整 tools schema 的请求 json”也贴出来，我可以把这一节对齐到“真实线上 schema”。

### 3.1 Claude Code 的 schema 关键策略（从 tools[].input_schema 可总结出的“强约束风格”）

1. **Task 是“子代理编排”的一等工具：支持 run_in_background + resume**

* tools-copy 里明确写了：后台运行需要再用 TaskOutput 拉结果、支持 resume 延续上下文。
* 这意味着：工具层不是“函数调用”，而是“作业系统（job system）”。

2. **每个工具 schema 都倾向于：required 明确 + additionalProperties=false（严防模型乱造字段）**

* 你能在多个工具段看到 `required: ["pattern"]`、`additionalProperties: false` 这种写法。

3. **字段命名统一 snake_case，并用 description 写“生成规范”**

* 例如 file_path、tool_use_id、run_in_background 这类一致的风格，在抓包与工具说明里是统一的。

4. **Plan Mode 被设计成“工具级流程”：EnterPlanMode / ExitPlanMode 有明确边界**

* ExitPlanMode 工具说明写得很清楚：它不接收 plan 内容参数，而是“读你写入的 plan file”，并且强调研究任务不要用 exit。
* EnterPlanMode 的说明也强调“先探索、再给用户批准”。

### 3.2 你实现 tools.json 的建议（避免模型生成错误字段）

建议你把“模型侧协议”与“UI/执行器侧协议”拆成两层：

#### (1) 模型侧：严格 schema + 强校验（Ajv）

* 每个工具：

  * `type: "object"`
  * `required` 最小集合
  * `additionalProperties: false`
  * 对 string 加 `minLength: 1`，对 number 加 `minimum/maximum`
* 执行前：`validate(input)`，失败就返回**结构化错误 tool_result**（并附带“期望字段/收到字段 diff”），让模型在下一轮自修复。

TS 结构建议：

```ts
export type ToolCall = {
  id: string;          // call_xxx
  name: string;        // "Read" | "Grep" | ...
  input: unknown;      // 先 unknown，过 Ajv 再变成具体类型
};

export type ToolResult = {
  tool_use_id: string;     // 必须与 ToolCall.id 对上
  ok: boolean;
  content: string;         // 发给模型的“文本版结果”
  // 下面这些不给模型看，给 UI/日志用
  meta?: { startedAt: number; endedAt: number; stderr?: string; exitCode?: number };
  data?: unknown;          // 结构化结果（给 presenter）
};
```

#### (2) UI/Presenter 侧：永远不要“直接渲染 content”

因为你抓包里 tool_result 的 content 可能混入系统提醒（READ-ONLY）。
所以 Presenter 建议做两件事：

* **Stripper**：识别并折叠 `<system-reminder> ... </system-reminder>`
* **Normalizer**：把常见工具输出（Read/Grep/Bash）转成统一的 `data` 结构（行号、文件路径、stdout/stderr、截断信息），UI 只渲染 `data`

### 3.3 tool_result 形态兼容（你关心“稳定渲染”）

从你这次抓包看，最少要兼容三类：

1. **纯文本**（Read 的文件内容 + 行号）
2. **带协议标记的摘要**（response.sseSummary.text 里出现 `[tool_use:Read]`）
3. **混入系统提醒**（READ-ONLY / todo 提醒等）

所以你最好在执行器侧统一产出：

* `result.content_for_model`：可读文本（必要时保留 reminder）
* `result.data_for_ui`：结构化对象
* `result.hints`：例如 `{ kind: "file_snippet", filePath, truncated }`

---

## 4) 对你项目的落地建议（最小可行版本，3–6 步）

我按“低成本高收益 → 需要重构”的顺序给你一个 MVP 路线图。

### Step 1（低成本高收益）：先把“事件模型”立起来（SSE → EventBus → Ink）

**新增模块/接口**

* `Event`: `text_delta | tool_use | tool_result | thinking | meta`
* `EventBus`: `emit(event)`, UI 订阅渲染

**改动点**

* 你现有 REPL 的流式渲染逻辑改成“消费事件”，不要直接消费原始 SSE。

**预期行为**

* 能稳定渲染 `[tool_use:Read]`、工具卡片、逐字输出。

---

### Step 2（低成本高收益）：加“Meta topic/title 请求”

**新增模块**

* `MetaRouter.runTopicTitle(userText) -> {isNewTopic,title}`（Haiku，无 tools）

**改动点**

* 每次用户发言：先跑 meta，再跑主对话；UI 把 title 写到 session header。

**预期行为**

* 你能复刻 Claude Code 那种“会话自动命名/分段”的体验。

---

### Step 3（中等成本）：ToolRegistry + Schema 校验 + Fallback Presenter

**新增模块**

* `ToolRegistry`: 读取 tools.json，生成 Ajv validator
* `ToolExecutor`: `exec(call)->ToolResult`
* `PresenterRegistry`: name → presenter，否则 fallback

**改动点**

* 所有工具调用都走统一 envelope（记录 callId/tool_use_id、耗时、错误码）

**预期行为**

* 模型乱填字段时，不会把 UI 弄炸；会返回可修复的 error tool_result。

---

### Step 4（较大重构，高收益）：Task 子代理系统（Explore/Planner/Reviewer）

**新增模块**

* `TaskManager.spawn({subagentType, model, prompt, runInBackground, resume})`
* 子代理独立 `ConversationStore` + 独立 tools 白名单（像你这次 Explore 只有 9 个工具）

**改动点**

* 主对话遇到“多步探索”时，输出一个 Task tool_use；UI 把 Task 折叠展示，并允许展开查看每一步工具调用。

**预期行为**

* 复刻你抓到的 “Explore(...)\n Done (25 tool uses …)” 这种体验。

---

### Step 5（中等成本）：System-Reminder 注入层（plan mode / todo / read-only）

**新增模块**

* `ReminderManager`: 根据状态（planMode、readOnly、todoEmpty）生成 `<system-reminder>` blocks
* `PolicyGate`: plan mode 下禁止 Edit/Write/Bash（或只允许 Read/Grep/Glob）

**预期行为**

* plan mode 能做到“先探索、后执行”，并且约束在每一轮 tool_result 都能重复提醒（像你抓包里那样）。

---

## 5) 需要你补充的证据（我建议你再抓这些字段/日志）

为了把你的 CLI 复刻到“参数级一致”，我建议你补齐这些（优先级从高到低）：

1. **至少 1 个“非 simple”的完整请求 JSON**（包含 tools[].input_schema，而不是只给 tools 名字）

* 你现在的 *simple.json* 把 tools schema 精简掉了（只剩名字），导致“事实 schema”只能参考 tools-copy。

2. **完整 SSE（逐事件）而不是 sseSummary**

* sseSummary 很适合 UI 快速渲染，但要做“Claude Code 那种顺滑逐块 + tool_use 即时出现”，必须要 `content_block_delta/tool_use/tool_result/message_delta` 的原始序列。

3. **工具错误回传形态**

* 抓一条失败的 Bash/Read/Write：是否有 `is_error`、exit_code、stderr 分离？这直接决定你 ToolResult 的 envelope 设计。

4. **Task 工具的返回结构**

* 你这次 UI 里显示了 “Done (25 tool uses · 66.6k tokens · 1m 30s)”
  但抓包里 Task 的 tool_result 是否包含这些统计字段？建议把 Task 的 tool_result 原文贴出来（或那条请求完整 JSON）。

5. **plan mode system-reminder 的完整内容**

* 你之前提到的 “Plan mode is active …” 很关键：它到底禁止哪些工具？是否允许 Read-only 探索？完整文本能决定你的 PolicyGate 规则。

---

如果你愿意，我可以在你补齐 **“一条完整 tools schema 请求 + 一段完整 SSE”** 后，把上面每个模块直接落成更具体的 TS 接口（包括：`ModelRouter`、`PromptAssembler`、`SubAgentRunner`、`ToolProtocol`、以及 Ink 侧的卡片组件协议），做到你能按图施工。
