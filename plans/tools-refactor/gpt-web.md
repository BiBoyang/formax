下面这份方案按你给的 **Plan B（长期可插拔）** 目标来写：**spec / handler / presenter / registry** 四件套，并且尽量“保留/微调”你现在已经有的结构（而不是推倒重来）。

我会把 “工具清单/字段/用法提示” 以 `tools-copy.json` 为准（例如 Task/TaskOutput/Edit/Write/NotebookEdit 等的 schema 与说明）。 
执行流我会对齐你现在的 **ChatEngine tool loop + ToolExecutor + LocalToolHandler**（已经在跑的那套）。 

---

## 1) 总览表：tool → category → presenter → 交互 → 优先级

> P0 = 必须专门渲染（不然体验/正确性会崩）
> P1 = 建议尽快有更好 UI（但 fallback 还能用）
> P2 = 暂时用 fallback presenter 也能接受

| Tool            | Category    | 推荐 Presenter 类型（Ink）                                   | 交互                         | Priority |
| --------------- | ----------- | ------------------------------------------------------ | -------------------------- | -------- |
| Task            | 子代理/任务      | **TaskCard**（状态 + 元信息 + 可展开日志入口）                       | expand、resume、（可选）cancel   | P0       |
| TaskOutput      | 子代理/任务      | **TaskOutputViewer**（阻塞/非阻塞、刷新轮询、可展开输出）                | refresh/poll、expand、copy   | P0       |
| AskUserQuestion | 交互          | **Questionnaire**（单选/多选/输入）                            | 上下/空格/回车、cancel            | P0       |
| Edit            | 文件          | **Diff/Patch View**（old/new 对比 + 影响范围摘要）               | expand、copy old/new        | P0       |
| NotebookEdit    | 文件/Notebook | **Notebook Cell Diff**（按 cell 展示差异）                    | expand、cell 跳转（可选）         | P0       |
| TodoWrite       | 规划          | **Todo List**（checkbox 风格 + 统计）                        | expand、（可选）toggle          | P0       |
| EnterPlanMode   | 规划/模式       | **Mode Banner**（“Plan Mode ON”）                        | 无/轻交互                      | P0       |
| ExitPlanMode    | 规划/模式       | **Mode Banner + Confirm**（launchSwarm / teammateCount） | confirm/cancel             | P0       |
| WebSearch       | 网络          | **Search Results List**（列表 + rank + snippet）           | paging、copy URL            | P1       |
| WebFetch        | 网络          | **Fetched Doc Viewer**（URL + prompt + 抽取结果）            | expand、copy                | P1       |
| Bash            | 命令          | **Command Output**（一行摘要 + 可展开 stdout/stderr）           | expand、copy command/output | P1       |
| KillShell       | 进程/危险操作     | **Danger Confirm**（红色警告 + 二次确认）                        | confirm/cancel             | P1       |
| Read            | 文件          | **File Viewer**（代码块 + 分页/偏移）                           | paging、search-in-file（可选）  | P1       |
| Write           | 文件          | **Write Summary**（路径 + 字节/行数 + 可展开预览）                  | expand、copy path           | P1       |
| Glob            | 搜索          | **Path List**（列表/表格）                                   | paging、copy path           | P1       |
| Grep            | 搜索          | **Grouped Matches**（按文件分组 + 命中数）                       | expand group、paging        | P1       |
| SlashCommand    | 命令/元        | **Command Line**（解析结果 + fallback 输出）                   | （可选）补全/帮助                  | P2       |
| Skill           | 元能力         | **Simple Action**（单行状态 + 详情）                           | expand                     | P2       |

---

## 2) 工具盘点与分类（A+B 合并写：每个工具 5~10 行）

> 说明：tools 的“输出 schema”在定义里没有强约束，所以我对输出形态会标 **推断/建议**；你也可以在 registry 里为每个工具补一个 `outputHint` 或 `normalizeResult()`。

### 子代理 / 任务类

**Task（子代理任务）** 

* 简介：启动一个“专门子代理”做任务（可后台运行）。
* 场景：代码审查、跑测试、资料检索等长任务。
* 输入：`description`/`prompt`/`subagent_type`（必填），`model?` `resume?` `run_in_background?`。
* 输出（推断）：返回 `agent/task id` + 简短摘要；后台模式主要返回可查询 id。
* Presenter：**TaskCard**：突出 `subagent_type`、`run_in_background`、返回的 id；可展开显示（1）摘要（2）“如何用 TaskOutput 拉结果”的提示。
* 交互：expand；如果你支持 resume/cancel，可加快捷键。

**TaskOutput（任务输出）** 

* 简介：按 `task_id` 拉取运行中/完成后的输出，支持 `block`/`timeout`。
* 场景：后台 Bash / 后台 Task 的结果获取；定时轮询状态。
* 输入：`task_id`（必填），`block=true`（默认），`timeout`。
* 输出（推断）：`status` + `output`（可能很长）。
* Presenter：**TaskOutputViewer**：第一行显示 status（RUNNING/DONE/ERROR）+ 耗时；下面默认折叠长输出。
* 交互：refresh/poll（block=false）、expand、copy。

### 交互类

**AskUserQuestion（问答/选择器）** 

* 简介：模型请求“向用户提问”，支持多题、选项、单选/多选、也可能需要文本输入。
* 场景：危险操作确认、选文件、选分支、选策略、补齐缺失参数。
* 输入（建议按 schema）：`questions[]`（每题含 prompt/options/multiSelect/allowFreeText 等）。
* 输出（推断）：用户的 answers（结构化）。
* Presenter：**Questionnaire**：逐题渲染；选项列表支持键盘导航。
* 交互：↑↓/j k、空格勾选、回车提交、Esc 取消（回传 is_error 或 special result）。

### 文件类

**Read（读文件）**

* 简介：读取文件内容（工具定义强调支持 offset/limit、cat -n 风格）。
* 但你本地实现目前直接 `readFile()` 返回原文（没有 cat -n）。
* 场景：展示代码/配置/日志片段；给 Edit/NotebookEdit 提供上下文。
* 输入：`file_path`（必填），`offset?` `limit?`（建议支持）。
* 输出：纯文本（可能很长）。
* Presenter：**File Viewer**：支持分页（offset/limit）+ 默认折叠；高亮 path、offset/limit、行数统计。
* ✅迁移建议：尽早对齐“Read 输出格式”与 Edit 的约束（否则 old_string 匹配逻辑会很痛）。

**Edit（精确替换）** 

* 简介：对 `file_path` 做 `old_string -> new_string` 替换，可 `replace_all`。
* 场景：小范围修补/重命名；避免用 sed。
* 输入：`file_path/old_string/new_string`（必填），`replace_all?`。
* 输出（推断）：成功/失败文本 +（可选）替换次数。
* Presenter：**Diff/Patch View**：展示 old/new 对比（至少显示前后 2~3 行 context），并把 `replace_all` 高亮成“批量修改”。
* 交互：expand、copy old/new、（可选）二次确认。

**Write（写文件）** 

* 简介：覆盖写入；若是已有文件，要求先 Read。
* 输入：`file_path` + `content`（必填）。
* 输出（推断）：成功/失败文本（可含 bytes/lines）。
* Presenter：**Write Summary**：第一行 `WRITE path` + 行数/字节；内容默认折叠（最多预览 N 行）。
* 交互：expand、copy path。

**NotebookEdit（Jupyter cell 覆盖）** 

* 简介：替换 `.ipynb` 指定 cell 内容（0-index）。
* 场景：修 notebook 代码/markdown cell。
* 输入（推断）：`notebook_path`（绝对路径）、`cell_number`、`new_source`。
* 输出（推断）：成功/失败文本。
* Presenter：**Notebook Cell Diff**：显示 notebook 路径 + cell_number；diff new/old（需要你在 handler 里先读旧 cell）。
* 交互：expand；（可选）显示 cell 类型/metadata。

### 搜索类（本地）

**Glob（文件模式匹配）** 

* 简介：按 glob 找文件（通常返回路径列表）。
* 输入：`pattern`（必填），`path?`。
* 输出：路径列表（多行）。
* Presenter：**Path List**：按行渲染，支持分页；高亮匹配数量与根目录。
* 交互：paging、copy path。

**Grep（内容搜索）**

* 简介：在路径/文件集内按 pattern 搜索内容。
* 输入（从你的本地实现推断你已兼容部分字段）：`pattern`（必填），`path?`（以及可能的 include/exclude）。
* 输出（推断）：`file:line:match` 或按文件分组。
* Presenter：**Grouped Matches**：按文件聚合，默认只展开 Top N 文件，每个文件展示 Top K 命中行。
* 交互：expand group、paging。

### 命令 / 进程类

**Bash（命令执行）**

* 简介：执行命令，可后台运行并用 TaskOutput 拉结果（定义里有 run_in_background）。
* 但你本地实现目前已经能跑 Bash，并支持 timeout/cwd/env 等。
* 输入：`command`（必填），`timeout?` `cwd?` `env?` `run_in_background?` 等。
* 输出（推断）：stdout/stderr + exitCode（可能被拼成文本）。
* Presenter：**Command Output**：一行摘要（command + exit status），输出默认折叠；大输出用“中间折叠”策略。
* 交互：expand、copy command/output。

**KillShell（杀掉 shell/session）**

* 简介：结束指定 shell（危险操作）。
* 输入：`shell_id`（必填）。
* 输出（推断）：成功/失败。
* Presenter：**Danger Confirm**：强制二次确认（默认 focus 在 Cancel）。
* 交互：confirm/cancel。

### 网络类

**WebSearch（联网搜索）** 

* 简介：按 query 搜索；支持 allow/blocked domains。
* 输入：`query`（必填），`allowed_domains?` `blocked_domains?`。
* 输出（推断）：results[]（title/url/snippet）。
* Presenter：**Search Results List**：展示 rank、title、domain、snippet；URL 可 copy。
* 交互：paging、copy url。

**WebFetch（抓取网页并按 prompt 抽取）** 

* 输入：`url`（必填），`prompt`（必填）。
* 输出（推断）：抽取后的结构化文本/摘要（可能很长）。
* Presenter：**Fetched Doc Viewer**：顶部固定显示 url + prompt 摘要；正文折叠+可展开分段。
* 交互：expand、copy。

### 规划 / 模式类

**TodoWrite（写 todo 列表）** 

* 简介：更新 todo 列表（数组），通常用于“计划—执行—回写”。
* 输入：`todos[]`（必填；每项含 content/status 等）。
* 输出（推断）：确认 + 当前 todos。
* Presenter：**Todo List**：checkbox 风格；顶部显示 done/total 统计。
* 交互：（可选）本地 toggle 仅用于查看，不一定回写给模型。

**EnterPlanMode / ExitPlanMode（进入/退出计划模式）** 

* 简介：切换模式（Exit 可能包含 launchSwarm / teammateCount）。
* 输入：Enter 无；Exit：`launchSwarm?` `teammateCount?`（从 schema 看）。
* 输出（推断）：状态确认。
* Presenter：**Mode Banner**：在消息流里非常醒目（避免用户不知道当前是 plan 还是 act）。
* 交互：Exit 建议 confirm（尤其 launchSwarm=true 时）。

### 元指令

**SlashCommand（/xxx） / Skill**

* 简介：内部命令/技能路由。
* Presenter：默认用 **Simple Action** + fallback 文本即可。
* 优先级：P2（先跑通 registry + fallback）。

---

## 3) 推荐的工程组织结构（C）

你现在已经有这些“可保留的骨架”：

* **ChatEngine 的 tool loop**：streamOnce → 收集 tool_use → executor 执行 → push tool_result 回 history。
* **ToolExecutor / LocalToolHandler**：本地可执行工具集合（Read/Write/Edit/Bash/Glob/Grep）。
* **Task tool 的 runtime patch**（把 subagent 列表注入描述与 schema）。这说明你已经需要“运行态 spec patch”的能力。
* **ToolMessage 的 fallback 结构**（你计划继续保留它并逐步迁移到更合理的分层）。

在此基础上加一个 **ToolRegistry（执行路由 + presenter 路由）**，做到“每个 tool 一个模块”。

### 目录树（建议）

```txt
src/
  tools/
    types.ts                          # 你已有：ToolDefinition/ToolCall/ToolResult 等
    patches/
      taskSubagent.ts                 # 你已有：patchTaskToolForSubagents
    registry/
      ToolRegistry.ts                 # NEW: 注册、alias/version、spec patch、路由
      types.ts                        # NEW: ToolSpec/ToolModule/ToolPresenter 等接口
      createRegistryHandler.ts        # NEW: 把 registry 包装成一个 ToolHandler
    modules/                          # 每个 tool 一个文件夹
      Task/
        spec.ts
        handler.ts
        presenter.tsx
        index.ts
      TaskOutput/
      Read/
      Edit/
      Write/
      NotebookEdit/
      Glob/
      Grep/
      Bash/
      WebSearch/
      WebFetch/
      TodoWrite/
      AskUserQuestion/
      EnterPlanMode/
      ExitPlanMode/
      KillShell/
      SlashCommand/
      Skill/
    presenters/                       # 通用 presenter primitives（可复用）
      GenericToolPresenter.tsx
      Expandable.tsx
      CodeBlock.tsx
      DiffView.tsx
      ListView.tsx
      TableView.tsx
      ConfirmDialog.tsx
      ProgressLine.tsx
  components/
    tool/
      ToolRenderer.tsx                # NEW: registry 路由 presenter（fallback -> ToolMessage）
      ToolMessage.tsx                 # 你已有：通用 fallback（别删）
```

### 关键 TS 接口签名（够你直接开工）

> 尽量贴合你现有的 ToolExecutor/ToolHandler 体系（LocalToolHandler 就是实现了 ToolHandler）。

```ts
// src/tools/registry/types.ts
import type { ToolDefinition, ToolCall, ToolResult } from "../types";
import type { ExecutionContext } from "../executor"; // 你已有 executor ctx（cwd/allowTools/denyTools）

export type ToolName = string;

export interface ToolSpec extends ToolDefinition {
  version?: string;
  aliases?: ToolName[];
  // 给 UI 的提示（不影响暴露给模型的 schema）
  ui?: {
    presenter?: "generic" | "diff" | "task" | "list" | "table" | "confirm" | "mode" | "code";
    priority?: "P0" | "P1" | "P2";
  };
  // 运行态 patch（比如 Task subagent enum 注入）
  patch?: (spec: ToolDefinition, runtime: ToolRuntimeContext) => ToolDefinition;
}

export interface ToolRuntimeContext {
  cwd: string;
  allowedSubagents?: Array<{ name: string; description: string }>;
  // 你后续还可以加：capabilities、featureFlags、modelName 等
}

export interface ToolHandler {
  canHandle(name: ToolName): boolean;
  execute(call: ToolCall, ctx: ExecutionContext): Promise<ToolResult>;
}

export interface ToolPresenterProps {
  call: ToolCall;
  result?: ToolResult;
  status: "running" | "done" | "error";
  // 通用 UI 能力
  defaultCollapsed?: boolean;
  onCopy?: (text: string) => void;
  // 允许 presenter 自己保存状态（展开/分页/选中项等）
  state: unknown;
  setState: (next: unknown) => void;
}

export interface ToolPresenter {
  // Ink/React 组件
  Component: React.FC<ToolPresenterProps>;
  // 初始化 UI 状态（例如分页从第 1 页开始）
  initState?: (call: ToolCall) => unknown;
  // 可选：把 tool_input/tool_end 事件映射成 UI state（支持 streaming tool output）
  reduceEvent?: (state: unknown, ev: { type: string; payload?: any }) => unknown;
}

export interface ToolModule {
  spec: ToolSpec;
  handler?: ToolHandler;         // 没有 handler 则表示“只渲染/或走默认执行器”
  presenter?: ToolPresenter;     // 没有 presenter 就走 fallback
}

export interface ToolRegistry {
  register(mod: ToolModule): void;

  resolveName(name: ToolName): ToolName;      // alias/version
  getSpec(name: ToolName): ToolSpec | undefined;
  getPresenter(name: ToolName): ToolPresenter | undefined;
  getHandler(name: ToolName): ToolHandler | undefined;

  // 暴露给模型的 tool definitions（自动 patch）
  listToolDefinitions(runtime: ToolRuntimeContext): ToolDefinition[];
}
```

### 如何与现有 REPL / tool 执行流对接（一条流程示意）

你现在的核心 loop 是：`createChatEngine(...).runTurn()` 内部不断 streamOnce + executeTool + push tool_result。
因此最小改造点只有两个：

1. **执行侧**：把 registry 包装成一个 `ToolHandler`（或直接当成 ToolExecutor 的第一优先 handler），保持 LocalToolHandler/TaskSubAgentHandler 仍可共存。
2. **渲染侧**：在消息列表里把 `ToolMessage` 替换为 `ToolRenderer`（先查 registry presenter，没有就 fallback 到旧 `ToolMessage`）。

示意：

```txt
Model(tool_use: {name,input,id})
    ↓
ChatEngine.executeTool(call)  // 你已有
    ↓
ToolExecutor(call, ctx)       // 你已有
    ↓
RegistryHandler → per-tool handler (or fallback LocalToolHandler)
    ↓
ToolResult(tool_use_id, content, is_error?)
    ↓
UI: ToolRenderer picks per-tool presenter → else ToolMessage fallback
```

---

## 4) 增量迁移计划（Plan B）（D）

### Phase 0：先把“可插拔框架”搭起来（不改行为）

* 新增 `ToolRegistry` + `ToolRenderer`，但所有工具先都走旧 `ToolMessage` fallback。
* 新增 `RegistryHandler`，但默认不接管执行（或只接管 1~2 个试点工具）。
* ✅收益：你可以随时“按工具迁移”，不会爆炸式重构。

### Phase 1：先迁 P0（必须专门渲染）——理由是“交互/长任务/差异视图”

P0 清单（你也点名了）：

* **Edit / NotebookEdit**：需要 diff/patch 视图，否则用户无法理解修改内容；Notebook 更需要 cell 粒度。 
* **Task / TaskOutput**：长任务必须有 running 状态、task_id、轮询刷新等，否则看起来像“卡死/无响应”。
* **AskUserQuestion**：没有交互 UI 就无法完成工具调用（等于功能缺失）。
* **EnterPlanMode / ExitPlanMode**：模式切换必须“显眼且可追踪”，否则用户不知道当前是 plan 还是 act。
* **TodoWrite**：列表结构化展示的收益极大（比纯文本强很多）。

> 同时做一件“必要对齐”：**Read 输出格式 vs Edit 约束**。你当前本地 Read 返回原文。
> 如果你未来要支持 Claude Code 那套“cat -n + old_string 精确匹配”体验，就尽早统一 contract，避免 presenter/handler 双方各自适配。

### Phase 2：迁 P1（高频但可 fallback）

* **WebSearch / WebFetch**：列表/文档 viewer 做好后，体验会接近 Claude Code；否则 fallback 也能看，只是不爽。 
* **Bash**：输出折叠 + copy + exit status 高亮。
* **Read / Write / Glob / Grep**：统一用 “CodeBlock/List/Table + 分页” primitives，工具之间复用 80% UI。

### Phase 3：迁 P2（低频/内部）

* **SlashCommand / Skill**：先做到能路由、能 fallback；后面再做补全/帮助。

---

## 5) 你现有实现里值得“保留/微调”的点（不要推倒）

1. **ChatEngine 的 tool loop**（streamOnce → tool_use → executor → tool_result 回灌）已经是“最小正确闭环”，registry 只需要接上 executor 和 renderer。
2. **LocalToolHandler** 现在用集合控制本地工具子集（Read/Write/Edit/Bash/Glob/Grep），非常适合迁移为 “modules/* 的 handler 聚合”，不用改大逻辑。
3. **patchTaskToolForSubagents** 证明你已经需要“运行态 spec patch”；把它升级为 registry 的 `spec.patch()` 能力就行，不要散落在 UI 层。
4. **ToolMessage fallback** 别删：它是“所有未知工具/未迁移工具”的安全网，你的 plan 文档也明确了要保留它。

---

如果你愿意，我下一步可以按你现在的 `ToolInfo/Msg` 数据结构，把 **ToolRenderer 的 props 设计**和 **P0 工具的 UI state（分页/折叠/轮询/问答交互）** 拆成更具体的可落地清单（不写完整代码，但会细到你直接开工不会卡）。
