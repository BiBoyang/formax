下面按你的 10 条追问逐条回答（尽量给到能直接开工的接口/伪代码）。我会把“事实约束”都落在你给的 `tools.json / tools-copy.json / manus-context.txt` 上：比如 `Task` 的 `run_in_background / resume`、`TaskOutput.block/timeout`、`AskUserQuestion` 的 schema/“Other”规则、以及当前 `ToolMessage` 的多行格式与 `ctrl+o` 展开约定等。    

---

## 1) P0：`Task/TaskOutput` 的 ToolPresenter 详细实现思路

> 目标：一个“任务型卡片（TaskCard）”Presenter，能表现 **running/completed/error**、进度/耗时、日志折叠/分页、以及取消/中止。

### 1.1 UI 状态模型（建议 UI 专用，不进模型上下文）

`TaskOutput` 工具定义里明确“返回 output + status 信息；block=true 默认等待完成；block=false 非阻塞检查；task_id 来自 /tasks” 
因此 Presenter 不应该只渲染 `content: string`，而要吃一个结构化 `ui`（来自 handler），否则你永远在做字符串解析。

建议 `TaskOutput` handler 返回：

* `assistantContent`：给模型的短串（<= 1~2KB）
* `ui`：给 Ink 的结构化 payload（可很大，但要分页/截断）

**TaskOutputUI（建议）**

```ts
type TaskState = 'queued' | 'running' | 'completed' | 'error' | 'cancelled';

export interface TaskOutputUI {
  kind: 'task_output';
  taskId: string;

  // 状态与时间
  state: TaskState;
  createdAt?: number;   // epoch ms
  startedAt?: number;
  finishedAt?: number;
  elapsedMs?: number;   // handler 也可直接算好

  // 可选：进度（没有就不显示）
  progress?: { current?: number; total?: number; percent?: number; label?: string };

  // 输出（分通道，便于高亮/折叠/复制）
  stdout?: { head?: string[]; tail?: string[]; totalLines?: number; truncated?: boolean };
  stderr?: { tail?: string[]; totalLines?: number; truncated?: boolean };

  // 结果
  exitCode?: number;
  errorMessage?: string;

  // 取消能力（TaskOutput 本身是“取结果”，取消的是底层 task）
  cancellable?: boolean;
  cancelHint?: 'KillShell' | 'AbortAgent' | 'Unknown';
}
```

### 1.2 running / completed / error 的展示（含进度与耗时）

卡片头（单行）建议固定骨架：

* 左：`⏺ TaskOutput` + `taskId`
* 中：状态 pill（running/completed/error）
* 右：耗时（`00:12`）+ 进度（`40%` 或 `3/10`）

**关键点：耗时最好由 UI 端用 `now - startedAt` 实时刷新**（每 200~500ms tick），不要等 tool 再跑一遍。`ToolMessage` 现在已经有“多行/展开提示”的风格约束（`⎿`、缩进、`ctrl+o`） ，你沿用即可，体验一致。

### 1.3 可展开/折叠日志（默认折叠策略 + 展开分页/截断）

你现在的通用规则是：首行 `⎿`，中间行缩进，超过阈值给 `… +N lines (ctrl+o to expand)`  

**默认折叠策略（建议）**

* running：默认折叠，只展示 **tail 最后 3~5 行**（用户最关心“在跑到哪”）
* completed：默认折叠，展示 **stdout head 1 行 + tail 2 行**，并给“展开看完整”
* error：默认展开一层（但仍可二级展开 stderr 全量），让错误可见

**展开后的分页/截断（建议）**

* 每页 30 行（或跟终端高度相关：`pageSize = rows - header - footer`）
* `j/k` 或 `↑/↓` 滚动行（如果你实现了 viewport）
* `n/p` 下一页/上一页（简单可靠，不依赖 viewport）
* 超过上限（比如 2000 行）只保留 tail，并显示：

  * `truncated: true`
  * `totalLines`
  * “仅展示末尾 2000 行；可导出/复制”

> 你的 Bash 工具定义也提示输出会被截断（例如超长会截断） ，TaskOutput 也要同样对“超长日志”做强约束，否则 UI 和上下文都会炸。

### 1.4 与 ToolRegistry 对接（按 tool name 路由 presenter）

Presenter 路由最简单：**按 `toolName === 'TaskOutput'` 精确匹配**。

* `ToolRegistry.resolvePresenter('TaskOutput') -> TaskOutputPresenter`
* 其他工具 fallback 到通用 `ToolMessagePresenter`（你现在已有通用展示行为与测试） 

### 1.5 支持取消/中止（AbortSignal 从哪里来，UI 怎么触发）

这里分两层取消：

**A) 取消“本次 tool call 等待”（stop waiting）**
你现有 `createToolExecutor` 会在 `ctx.signal.aborted` 时直接返回 aborted error 
所以你只要做到：每个 tool call 都有自己的 AbortController，并能在 UI 触发 `abort()`。

建议 Controller 保存：

```ts
toolRuns[toolUseId] = { abort: AbortController, ... }
```

UI 触发方式：

* 在 TaskOutput 卡片里：`[s] Stop waiting`（仅当 block=true 且 running）
* 全局：`Ctrl+C` 仍然中止整轮（你应该已有）

**B) 取消“底层 task”（真正停掉后台任务）**

* 对后台 bash：工具集里有 `KillShell(shell_id)`，且 shell_id 来自 `/tasks` 
* 对后台 agent：用 TaskManager 持有该任务的 AbortController（见第 5 条的 TaskManager 设计），执行 `abort()` 让 agent 收敛退出
* 对未知任务类型：只允许 stop-waiting，不承诺 cancel

卡片按钮建议：

* running 且 cancellable：`[c] Cancel task`
* running：`[s] Stop waiting`
* completed：`[y] Copy output`（可选）
* error：`[e] Expand stderr`

---

## 2) ToolRegistry（+ ToolSpecSource）的完整 TS 接口定义 + 机制说明

你当前的“工具执行器”是 `createToolExecutor(handlers)`，按 `handler.canHandle(name)` 找 handler，并且有 allow/deny、嵌套 deny、abort、not implemented fallback 等逻辑  —— 这一块非常值得保留：Registry 只负责“装配 handlers/presenters/spec”，不替换 executor 的防线。

### 2.1 接口定义（可直接落地）

```ts
// ===== 基础类型（与现有保持一致即可） =====
export type ToolName = string;
export type ToolVersion = string; // e.g. "1.0.0" (semver) or "v1"

export interface ToolDefinition {
  name: ToolName;
  description: string;
  input_schema: unknown; // JSONSchema7
}

export interface ToolCall {
  id: string;          // tool_use_id
  name: ToolName;
  input: Record<string, unknown>;
}

export interface ToolResult {
  tool_use_id: string;
  content: string;     // 回灌给模型的“短内容”
  is_error?: boolean;

  // UI 专用：不回灌给模型（由你自己的消息存储承载）
  ui?: unknown;
  meta?: {
    truncated?: boolean;
    bytes?: number;
    durationMs?: number;
  };
}

export interface ExecutionContext {
  cwd: string;
  signal?: AbortSignal;
  agentDepth: number;
  allowTools?: ToolName[];
  denyTools?: ToolName[];

  // 建议新增：用于工具发进度/事件（不进模型）
  emit?: (evt: ToolRuntimeEvent) => void;
  taskManager?: TaskManager;
}

// ===== Handler / Presenter =====
export interface ToolHandler {
  /** 一个 handler 可以处理多个 tool（如 file tools） */
  canHandle(toolName: ToolName): boolean;

  /** 执行：返回 ToolResult（或你扩展的交互中间态，见第 6 条） */
  execute(call: ToolCall, ctx: ExecutionContext): Promise<ToolResult>;
}

export interface ToolPresenterProps {
  call: ToolCall;              // 入参
  result?: ToolResult;         // 结果（running 时可能没有）
  status: 'pending' | 'running' | 'completed' | 'error';
  startedAt?: number;
  finishedAt?: number;

  // UI actions（比如 abort、cancel task、copy）
  actions: PresenterActions;
  isExpanded: boolean;
  setExpanded(next: boolean): void;
}

export interface ToolPresenter {
  /** 精确匹配 or pattern 匹配 */
  match(toolName: ToolName): boolean;

  /** Ink 渲染（返回 ReactNode） */
  render(props: ToolPresenterProps): React.ReactNode;
}

export interface PresenterActions {
  abortToolCall(toolUseId: string): void;     // stop waiting
  cancelTask(taskId: string): Promise<void>;  // best-effort
  copy(text: string): void;
  // 可继续加：openFile、paginate、setFocus...
}

// ===== ToolSpecSource：从 proxy/tools.json 加载 spec =====
export interface ToolSpecSource {
  id: string; // "proxy/tools.json" | "modules" | "runtime-patch"
  load(): Promise<ToolDefinition[]>;
}

// ===== Registry：统一合并 spec + 路由 handler/presenter =====
export interface ToolModule {
  name: ToolName;                 // canonical name
  version?: ToolVersion;          // 默认 "v1"
  aliases?: ToolName[];           // 同工具多名字
  priority?: number;              // 冲突时（同名同版本）谁覆盖谁

  // spec override：只允许 patch 某些字段
  specOverride?: Partial<ToolDefinition> | ((base: ToolDefinition) => ToolDefinition);

  handler?: ToolHandler;
  presenter?: ToolPresenter;
}

export interface ToolRegistry {
  // 注册模块
  register(module: ToolModule): void;

  // 加载 spec（工具列表给模型用）
  refresh(): Promise<void>;

  // 给 ChatEngine 的 tools 参数用
  getToolDefinitions(): ToolDefinition[];

  // 给 ToolExecutor 用：生成 handlers 列表（或直接 resolve）
  getHandlers(): ToolHandler[];

  // UI：路由 presenter
  resolvePresenter(toolName: ToolName): ToolPresenter;

  // 允许 runtime patch（例如根据 subagents 列表 patch Task schema）
  patch(patchFn: (defs: ToolDefinition[]) => ToolDefinition[]): void;
}
```

### 2.2 fallback presenter/handler 机制

* **handler fallback**：沿用你现有 executor 行为：找不到 handler 就返回 `Tool X not implemented` 
* **presenter fallback**：`resolvePresenter` 找不到就返回 `GenericToolPresenter`（内部复用现有 `ToolMessage` 逻辑与格式测试） 

### 2.3 alias 与 version 兼容策略（建议）

* alias：`aliasName -> canonicalName` 映射，UI/handler 都通过 canonicalName 找实现
* version：

  * 默认 active 版本 = **semver 最大**
  * 允许配置钉死（例如 env：`TOOL_TaskOutput_VERSION=1.1.0`）
  * 允许显式名称携带版本（可选）：`TaskOutput@1.1.0`（仅内部测试/灰度；不要暴露给模型）

### 2.4 `proxy/tools.json` + modules override + runtime patch 的合并优先级（明确规则）

你代码里确实有“运行时 patch Task schema”的案例：`patchTaskToolForSubagents` 会覆盖 Task description/schema，并把可用 subagents 写进 enum/required 

因此建议合并顺序（从低到高）：

1. **Base**：`proxy/tools.json`（或 config 指定路径）加载的原始 ToolDefinition（事实源）
2. **Modules override**：每个 tool module 的 `specOverride`（用于补全描述、加 ui-hints、修 schema bug）
3. **Runtime patch**：启动时或 refresh 时注入 patch（依赖运行时信息：subagents 列表、能力开关等）

冲突规则：

* 同名：后者覆盖前者
* 同名同字段但不兼容：必须 bump version（或显式允许“breakPatch: true”）

---

## 3) PPT 演示稿大纲（10~12 页）

1. **Title**

   * “Tool System 模块化：从 ToolMessage 巨石到 Per-tool 插件化”
2. **现状与痛点**

   * UI 与业务耦合、REPL “上帝组件”、工具分发僵化（plan 文档已有总结） 
3. **目标（Plan B）**

   * spec / handler / presenter 独立；registry 路由；fallback；可渐进迁移
4. **工具规模与类型（来自 tools.json/tools-copy.json）**

   * Task/TaskOutput、Bash、文件类（Read/Edit/Write/NotebookEdit）、搜索类（Glob/Grep）、交互类（AskUserQuestion）、网络类（WebSearch/WebFetch）等
5. **核心方案：ToolModule**

   * 每工具一个模块：specOverride + handler + presenter
6. **ToolRegistry 架构**

   * ToolSpecSource 合并优先级（base -> override -> runtime patch）
   * alias/version 策略
7. **执行流：ChatEngine Tool Loop**

   * 现有 loop：tool_use -> executeTool -> tool_result -> 继续迭代 
8. **状态机与事件（progress / await_user_input）**

   * 哪些在 Engine、哪些在 Controller、哪些在 UI
9. **UI Kit 统一外壳**

   * `⏺/⎿`、折叠（ctrl+o）、多行缩进规则与一致性测试 
10. **P0 深挖：Task/TaskOutput**

* running/completed/error、日志分页、取消策略、/tasks & KillShell 链路

11. **迁移计划（增量 + 回滚）**

* fallback 先行、逐工具替换、验收点

12. **风险 & 收益 & 里程碑**

* 循环依赖、上下文爆炸、交互冲突（+ 对策）；分阶段里程碑

---

## 4) 工具执行流：状态机 + 时序图（文字版）+ 分层归属

### 4.1 状态机（单个 tool call）

```
Idle
  -> ToolCallReceived (tool_use)
  -> Running
      -> Progress* (0..n)             // 可选
      -> AwaitUserInput? (0..1)       // 交互类工具
  -> Completed | Error | Aborted
  -> ToolResultSentToModel
  -> Idle
```

### 4.2 时序图（从 tool_use 到回灌 tool_result）

现有 ChatEngine 的主循环逻辑是：

* 收到 contentBlocks，抽 tool_use
* 若 stopReason 是 tool_use：把 tool_result 作为 user message push 回去继续下一轮 

文字时序：

1. **Model/StreamClient**：流式返回 content_blocks（含 `tool_use{id,name,input}`） 
2. **Engine**：把 tool_use 记录进 history，并触发执行
3. **ToolExecutor**：根据 name 找 handler，执行（带 ctx.signal / allow/deny / nested deny） 
4. **Handler**：

   * 可能 emit progress（UI用）
   * 可能返回 AwaitUserInput（见第 6 条）
   * 最终返回 ToolResult
5. **Engine**：把 ToolResult 注入为 `tool_result` message，再次调用 StreamClient 继续推理 

### 4.3 建议分层归属

* **Engine**：只管“对话 loop + tool_result 回灌”（保持你现在的清晰循环） 
* **Controller**：把 stream events / tool runtime events 变成 UI state（toolRuns、expanded、focus、abort controllers）
* **UI**：渲染 & 收集用户输入（AskUserQuestion 之类）
* **ToolModule**：handler/presenter/specOverride（不写 orchestrations）

---

## 5) 确认 `Task`/`TaskOutput` 语义与“是否必须”

### 5.1 TaskOutput 是否需要单独做？边界是什么？

从 spec 来看：`Task` 支持 `run_in_background`，并且明确“后台跑时用 TaskOutput 取结果；可用 block=true 等待或 block=false 轮询”  
所以 **只要你支持后台任务，TaskOutput 几乎是必须的**。

职责边界（建议）：

* `Task`：创建/启动任务（返回 `task_id` + 初始状态 +（可选）agent_id）
* `TaskOutput`：查询/等待任务输出（返回 status + stdout/stderr tail + exitCode + truncated）

### 5.2 task_id 的生成/持久化/查询方式

建议引入 `TaskManager`（Controller/Engine 层服务）：

* 内存表：`Map<taskId, TaskRecord>`
* 追加日志（可选）：`tasks.jsonl`（用于重启后“至少能列出历史/已完成结果”）
* `/tasks` 命令（UI 层）读取 TaskManager 快照

task_id：推荐 ULID（时间有序，便于列表）或 `t_YYYYMMDD_xxx`

### 5.3 是否支持后台运行与 resume？接口怎么设计？

* 后台运行：Task(tool call) 立刻返回 `task_id`；实际执行由 TaskManager 异步跑
* resume：spec 里有 `resume`（agent ID 继续上一份 transcript） 

  * 你可以持久化 agent transcript（messages）到磁盘：`agents/<agentId>.jsonl`
  * `Task(resume=agentId)` -> 从存档恢复上下文继续跑
* **注意**：进程重启后“继续跑一个正在运行的本地子进程任务”很难保证；建议承诺：

  * “可恢复历史输出/状态”
  * “可 resume agent（逻辑上继续对话）”
  * “不承诺恢复已中断的本地长进程（除非你做 daemon）”

---

## 6) `AskUserQuestion` 协议与 UI 交互（await_user_input）

`AskUserQuestion` 的工具定义里明确：

* 用户总能选 “Other” 自定义输入
* `multiSelect: true` 可多选
* 推荐项放第一个并加 `(Recommended)` 
  schema 也给了 question/header/options(label/description)/multiSelect 

### 6.1 handler 如何产出 await_user_input 事件（payload）

你需要把 ToolExecutor 的返回类型从单一 ToolResult 扩成 union：

```ts
export type ToolOutcome = ToolResult | AwaitUserInput;

export interface AwaitUserInput {
  kind: 'await_user_input';
  tool_use_id: string;
  tool_name: 'AskUserQuestion';
  ui: {
    questions: Array<{
      header: string;
      question: string;
      multiSelect?: boolean;
      options: Array<{ label: string; description?: string }>;
      allowOther?: boolean; // 固定 true（与 spec 一致）
    }>;
  };
}
```

handler 伪代码：

```ts
if (call.name === 'AskUserQuestion') {
  return {
    kind: 'await_user_input',
    tool_use_id: call.id,
    tool_name: 'AskUserQuestion',
    ui: normalizeQuestions(call.input),
  }
}
```

### 6.2 引擎如何暂停 / UI 如何收集 / 如何回填 tool_result

* **Engine**：遇到 `AwaitUserInput`，不要立刻 push tool_result；而是 `await controller.waitForUserInput(tool_use_id)`
* **Controller/UI**：渲染选择器，收集答案后 resolve

回填 ToolResult（建议 content 用 JSON，稳定）：

```ts
{
  tool_use_id,
  content: JSON.stringify({
    answers: [
      { header: 'Library', selected: ['date-fns'], other: null }
    ]
  })
}
```

### 6.3 键盘交互建议

* `↑/↓` 或 `j/k`：切换选项
* `space`：multiSelect 时 toggle
* `enter`：确认（单选直接确认；多选确认当前题）
* `o`：选择 Other 并进入 TextInput
* `esc`：取消（回填 `{"cancelled":true}`，是否 is_error 取决于你要不要让模型“意识到失败”）

---

## 7) 关键工具的 UI payload（ui）结构 + assistantContent 裁剪策略

你现在的 ChatEngine 会把 `tool_result.content` 回灌进下一轮 history 
所以必须硬控 `assistantContent`，否则“上下文爆炸”是必然。

### 7.1 裁剪总规则（建议）

* `assistantContent`：**summary-first**（统计 + topN + truncated 标记），建议上限 2KB
* `ui`：可以大，但必须可分页/可折叠；同时可以落盘（日志/大输出）
* `meta.truncated=true` 时，content 必须告诉模型“还有更多但未提供；可用 offset/head_limit/再次调用获取”

### 7.2 UI payload 建议结构（按你列的工具）

**Edit**

```ts
ui: {
  kind: 'edit',
  filePath: string,
  stats: { added: number; removed: number; hunks: number },
  hunks: Array<{ oldStart:number; oldLines:number; newStart:number; newLines:number; lines:string[] }>,
  applied: boolean,
  error?: string
}
assistantContent: "Edited <path> (+12 -3, 2 hunks)."
```

**Bash**

```ts
ui: {
  kind: 'bash',
  command: string,
  exitCode?: number,
  durationMs?: number,
  stdout: { tail: string[]; totalLines?: number; truncated?: boolean },
  stderr: { tail: string[]; totalLines?: number; truncated?: boolean }
}
assistantContent: "exit=0, last 10 lines: ... (truncated)"
```

**Glob / Grep**

```ts
ui: {
  kind: 'glob',
  pattern: string,
  basePath?: string,
  matches: string[],            // 限制条数
  total?: number,
  truncated?: boolean
}
assistantContent: "Found 128 files. Showing 20: ..."
```

**Read**

```ts
ui: {
  kind: 'read',
  path: string,
  offset?: number,
  limit?: number,
  language?: string,
  lines: Array<{ no:number; text:string }>, // 或 raw string[]
  hasMore?: boolean
}
assistantContent: "Read <path> lines 1-200 (hasMore=true)."
```

**WebSearch / WebFetch（推断/建议）**
`tools-copy.json` 里 WebSearch 强制要求“Sources”输出格式（那是模型侧的要求），UI 侧你用结构化 items 更好 

```ts
ui: {
  kind: 'web_search',
  query: string,
  items: Array<{ title:string; url:string; snippet?:string; source?:string }>,
  truncated?: boolean
}
assistantContent: "Top results: 1) ... 2) ..."
```

---

## 8) Presenter 通用外壳规范（UI Kit 约定）

你已经在测试里固化了多行规则与展开提示文案（`⎿`、缩进、`ctrl+o` 展开）  
建议把它“上移”为 UI Kit 组件，所有 tool presenter 复用：

### 8.1 统一骨架组件

* `<ToolCard header=... status=... right=...>`
* `<ToolBody lines=... collapsedLines=... expandHint=...>`
* `<ToolFooter hints=[...] />`

### 8.2 高亮策略（约定）

* 路径：dim + underline（或 cyan）
* 数字：yellow（counts/duration/exitCode）
* error：red + 保留原始错误文本（不要二次加工）

### 8.3 对齐与宽字符（实践）

* **不要靠拼空格对齐**（中文/emoji/全角会错位）
* 用 Ink `<Box flexDirection="row">` 分列布局
* 需要测宽时用 `string-width`（不要 `str.length`）

### 8.4 折叠交互统一（快捷键冲突）

* 默认沿用 `ctrl+o`（你测试/提示已使用） 
* 冲突管理：做一个 `Keymap`（集中定义：全局键/局部键/焦点组件可消费）
* 如果遇到 IME/输入框冲突：输入框聚焦时屏蔽全局快捷键（只留 esc/enter）

---

## 9) 增量迁移验收标准 + 回滚策略

### 9.1 分阶段验收点（可观测）

**阶段 0：Registry 引入但不改 UI**

* 所有 tool 仍走原 `ToolMessage` fallback
* 验收：回归截图/`ink-testing-library lastFrame` 不变（你已有类似测试） 

**阶段 1：P0 Presenter（TaskOutput / Edit / AskUserQuestion）**

* 仅这几个 tool 走新 presenter
* 验收：

  * running 状态显示耗时/进度
  * ctrl+o 展开/折叠生效
  * AskUserQuestion 可完整走通“暂停->选择->回填->继续”

**阶段 2：覆盖核心工具**

* Bash / Read / Grep / Glob / Web*
* 验收：大输出分页、truncated 标记、assistantContent 不超过阈值

### 9.2 不影响已有行为的方法

* “先 fallback，再替换”：Registry 默认返回 GenericPresenter
* handler 不动：继续使用现有 createToolExecutor 逻辑（含 abort/allow/deny/not implemented） 

### 9.3 回滚策略

* Feature flag：

  * `TOOL_UI_MODE=legacy|modular`
* 单工具开关：

  * `TOOL_UI_DISABLE=TaskOutput,AskUserQuestion`
* presenter 渲染异常：catch 后自动 fallback（并在 footer 提示 “Presenter crashed, fallback applied”）

---

## 10) 我认为最高的 3 个风险点 + 规避策略

### 风险 1：循环依赖/装配复杂度（Task/SubAgent 与 Executor/Engine）

你文档里已经点出 wiring 可能出现循环依赖（SubAgentRunner <-> ChatEngine <-> ToolExecutor/TaskHandler） 
**规避**：

* 用“延迟注入”（handler 里拿 `getRunner()` 而不是直接 import 实例）
* 或把 TaskManager/Runner 抽成独立 service，由 Engine/Executor 只依赖接口

### 风险 2：上下文爆炸（tool_result content 太长）

Engine 会把 tool_result.content 回灌进下一轮消息历史 
**规避**：

* 强制 `assistantContent` 上限（2KB）
* 大内容只进 `ui` / 落盘（并标注 truncated + 再次查询方式）

### 风险 3：交互快捷键冲突 + 输入法/宽字符导致 UI 崩坏

Ink 里输入框聚焦、中文宽字符、全局快捷键抢占都很容易翻车。
**规避**：

* Keymap + focus manager（输入框聚焦时屏蔽全局键）
* 列表/表格用 Box 布局 + string-width 测宽
* 为关键 presenter（TaskOutput/AskUserQuestion）写“交互快照测试”（模拟按键）

---

如果你愿意，我可以基于你现有的 `ToolMessage` 测试约束（`⎿`、缩进、expandInfo 文案）和现有 `createToolExecutor` 的防线逻辑，给你一份**“最小可落地改动清单”**：哪些类型要改、哪些类型不动、以及 P0 的文件级迁移顺序（不会让你推倒重来）。
