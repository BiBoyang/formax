下面这份分析**只以你给的抓包/repomix 为事实来源**（tools-copy.json 仅做参考），并把“控制面/模式系统”拆成：**控制面请求（/v1/messages 的元请求）** + **模式状态如何注入到主对话** + **Enter/ExitPlanMode 的实现路径** + **Formax（Ink+TS）可落地的模块/接口/落点**。

---

## 1) Claude Code 的“控制面请求”清单与作用（含 ROI）

> 我这里把“控制面请求”定义为：**独立的一次 /v1/messages**，但不直接面向用户对话产出内容（更多是路由/预热/元数据）。

### A. 已在抓包里明确出现的控制面请求

1. **Warmup（预热/缓存建档）**

   * 现象：存在“Warmup”请求，tools 为空；system 与 Warmup 文本都带 `cache_control: {type:"ephemeral"}`。
   * 作用：让长 system prompt / repo 上下文先进入**prompt cache**（后续主对话能触发 cache_read）。你们后续做 tokens 统计会直接看到 cache_read / cache_creation 的痕迹。

2. **Topic/Title Router（是否新话题 + 标题）**

   * 现象：Haiku 请求返回 JSON：`{"isNewTopic": true, "title": "活动创意"}`，tools 为空。
   * 作用：给 UI 的“会话标题/分段”服务；也可以作为“是否需要重新注入 claudeMd/plan”阈值信号。

3. **主对话请求（Sonnet）里携带的控制面信息（虽然不是“独立元请求”，但属于控制面注入）**

   * system 内包含 env、gitStatus 快照、模型信息，并带 `cache_control: ephemeral`。
   * 同一个 user message 里会塞多个 `<system-reminder>`（todo empty、claudeMd、plan mode）。

### B. 你提到但“本次材料里没看到独立请求形态”的项（先列 ROI，再说证据缺口）

* **bash-policy / bash allowlist**：我没看到“单独的 bash-policy /v1/messages”，但看到它被写进 tool 描述/系统策略里（Bash tool 的说明很长、强约束）。
* **filepaths-extract**：本次文件中没搜到明确的“filepaths-extract”字样或独立请求。

### ROI 排序（按“对你现在要做的 mode/plan/local stdout”最有用）

1. **Topic/Title Router（高 ROI）**：便宜模型、无 tools、失败可忽略，直接提升会话管理与“模式注入时机”。
2. **Warmup（中高 ROI，偏成本/延迟优化）**：你们已经要做 usage/tokens，warmup 能显著影响 cache_read/cost。
3. **bash-policy / filepaths-extract（中 ROI / 可后置）**：更偏“可靠性/安全/体验”，但不阻塞你要的 PlanMode 集成。

---

## 2) Mode 切换在抓包里是怎么“喂给模型”的？

### 2.1 `<system-reminder>` / “Plan mode active” 放在哪里？

在你抓到的主对话里，**Plan mode 是以 `<system-reminder>` 的形式塞在 user content 里**，而不是 system 数组里：

* 同一次请求的 messages 里，用户在正常对话后，又发了一个 user message，其中第一段就是 `<system-reminder>\nPlan mode is active...`，第二段才是用户真正的问题。
* 这说明：**模式切换是 CLI 本地状态 → 下一次 buildMessages 时注入 reminder**（更像“系统提示条”，但在协议上是 user content 的 text block）。

> 你在 Formax 里要复刻 Claude Code 的 PlanMode，“最像抓包事实”的做法就是：**把 mode reminder 当成“injected user prelude blocks”**。

### 2.2 `cache_control(ephemeral)` 的使用习惯与目的

你这份抓包里非常一致：

* system blocks 常带 `cache_control: ephemeral`（env/gitStatus/系统长提示）。
* Warmup 的 user “Warmup”文本也带 `cache_control: ephemeral`。
* 甚至 assistant 的最终 text 也可能带 ephemeral（表明他们在尽量让重复片段命中 cache）。

**工程化结论（可直接落地）**：

* **适合 ephemeral**：稳定、重复、长的块（base system、repo snapshot、模式说明模板、固定 caveat 模板）。
* **不适合 ephemeral**：一次性、体积大、用户特定内容（比如 local command stdout，除非你做“摘要 + 原文分离”）。

### 2.3 哪些内容进 LLM history / UI transcript / 不记录？

从抓包能推断 Claude Code 的“分层记录策略”：

* **必须进 LLM history（但不一定展示给用户）**

  * `<system-reminder>`（todo empty、claudeMd、plan mode）本质是“模型侧控制面”，应该进 messages。
  * 工具安全约束也会以 reminder 形式出现：例如 Read 的 tool_result 末尾追加“READ-ONLY task”提醒。

* **只进 UI transcript（不建议进 LLM history）**

  * “? for shortcuts”这种纯 UI hint（你们 REPL 里就是 UI 层渲染）。

* **完全不记录（或仅保留结构化元数据）**

  * 极长的原始 stdout/stderr（建议只保留：hash/长度/摘要 + 用户显式要求时再注入原文）。

---

## 3) EnterPlanMode / ExitPlanMode：Claude Code 里“LLM 实际调用的是什么”？

### 3.1 抓包能确认的事实

* Plan mode 的“生效信号”在这次抓包里是 `<system-reminder> Plan mode is active...` 注入。
* tools schema 里确实存在 Task.model / resume 等字段（说明他们允许“由模型选择子代理模型/续跑”）。

> 但：**我在你给的这些片段里没看到模型通过 tool_use 去调用 EnterPlanMode/ExitPlanMode 的证据**（比如 tool_use name=EnterPlanMode）。所以更像是：**用户/CLI 本地切换 → 注入 reminder 告知模型**。

### 3.2 给 Formax 最推荐的实现路径（并说明取舍）

**推荐：本地模式切换为主，工具暴露为辅（可后置）**

* **主路径（强推荐）**：

  * Shift+Tab 或 /plan 在本地改变 `ReplModeState`
  * 下一次发送前由 `PromptAugmentor` 注入 `<system-reminder>`
  * 好处：不依赖模型“正确地调用 Enter/Exit”，也不会出现“模型误触发切模式”的控制权问题。

* **辅路径（可选）**：把 EnterPlanMode/ExitPlanMode 暴露给模型，但**走“二次确认/权限门”**

  * 典型场景：模型建议“切到 plan mode 我给你一个方案”，然后 tool_use 触发 UI 弹出确认（accept/deny）。
  * 取舍：增加可玩性，但要做权限门与 transcript 标注，否则会让用户觉得“模式被偷改”。

---

## 4) 给 Formax 的集成设计（模块/接口/落点）

下面按“你现在 repo 里已经有的结构”来插（从 repomix 看到 entrypoints 已经组装了 REPL、ChatEngine、StreamClient、TaskSubAgentToolHandler 等）。

### 4.1 建议新增模块/类型

1. **src/controlPlane/replModeState.ts**

* `ReplModeState`：normal / plan / acceptEdits（你 statusline cycle 的三态）
* `ModePolicy`：每个 mode 对应“注入文本模板 + tool allow/deny + 是否记录到 history”

2. **src/controlPlane/promptAugmentor.ts**

* 只负责：把 mode、todo、claudeMd、localCommand 等“控制面块”转成 **injected user prelude blocks**（与抓包一致）。

3. **src/controlPlane/localCommandRecord.ts**

* `LocalCommandRecord { command, cwd, exitCode, stdout, stderr, startedAt, finishedAt }`
* `CaveatPolicy`：注入时附带“这是本地命令输出、可能不完整/截断、不要当成系统真相”的模板

4. **src/controlPlane/controlPlaneEvents.ts**

* 在你们 event bus（StreamEvent）之外，再补一层“非 LLM SSE 的事件”：`mode_changed` / `local_command_captured`，方便 UI 做 timeline/折叠。

### 4.2 关键 TS 接口签名（够你按图施工）

```ts
// 1) Mode 应用：产出 “注入块 + 执行策略”
export type ReplMode = 'normal' | 'plan' | 'acceptEdits';

export interface ReplModeState {
  mode: ReplMode;
  // plan mode 可选带 planFile 路径（抓包里 Plan File Info 有这个味道）
  plan?: { filePath?: string };
}

export interface ToolPolicy {
  allowTools?: string[];
  denyTools?: string[];
  // 是否允许创建 Task / 是否允许写入类工具等
  flags?: { allowTask?: boolean; allowWriteTools?: boolean };
}

export interface InjectionBlock {
  kind: 'system_reminder' | 'local_command_stdout';
  text: string;                 // 包含 <system-reminder>...</system-reminder> 或你自定义标签
  cacheControl?: 'ephemeral';
  visibility: 'model_only' | 'both'; // UI 是否展示
  ttlTurns?: number;            // local stdout 默认只注入 1-2 回合
}

export function applyMode(mode: ReplModeState): { injections: InjectionBlock[]; policy: ToolPolicy };

// 2) 拼消息：把注入块放进 user content 的最前面（与抓包一致）
export function buildMessages(args: {
  history: any[];               // 你现有的 conversation history 类型
  userText: string;
  baseSystem: any[];            // buildSystemPrompt 的产物
  injections: InjectionBlock[];
}): { system: any[]; messages: any[] };

// 3) 本地命令注入：记录 + 生成注入块
export function appendLocalCommand(rec: LocalCommandRecord): InjectionBlock[];
```

### 4.3 在现有文件中的建议落点（按你 repo 结构）

* **src/screens/REPL.tsx**：

  * 这里已经在渲染 status hint（`? for shortcuts`）
  * 把 Shift+Tab 的三态切换写成：`dispatch(mode_changed)`，并更新 `ReplModeState`

* **src/features/repl/useReplController.ts（或等价控制器）**：

  * 用户发送前：调用 `applyMode(modeState)` → 拿到 injections + policy
  * 再调用 `buildMessages(...)` 把 injections 塞进 user prelude
  * 同时把 `policy` 传给 ChatEngine（下一条）

* **src/chat/engine.ts**：

  * 你们已有 allow/deny 的执行面入口（类似 `allowTools/denyTools` 这种参数）
  * 在 `streamOnce` / `runTurn` 调用处把 `ToolPolicy` 落进去：plan mode 下 deny 写入/危险工具；acceptEdits 下允许 Edit/Write 且 presenter 自动 apply

* **src/prompts/system.ts**：

  * 你已经（或 Claude Code 已经）在 system prompt 上用 ephemeral 缓存
  * 保持 base system 在这里，mode reminder **不要塞 system**（按抓包放 user prelude）

* **src/tools/executor/handlers/taskSubAgent.ts**：

  * 你现在已经能动态渲染 nested tool progress，并且把 tool_result 统一成 `{content,is_error}` 风格
  * 下一步把 plan mode 的 policy（只读/禁写）向下传到 subagent runner，保证“主对话 plan mode”时 Explore 子代理也不会误用写工具（你抓包里 Read 的 tool_result 末尾也在强调 READ-ONLY）。

---

## 5) 最小可用分步落地计划（3–6 步）

### Step 1 — Mode 切换注入（PlanMode 先落地）

* 新增：`ReplModeState`、`applyMode()`、`PromptAugmentor`
* 行为：plan mode 开启后，下次发送前自动在 user content 最前面注入 `<system-reminder> Plan mode is active...`（与你抓包一致）。
* 同时：把 plan mode 的 `ToolPolicy`（deny Write/Edit/Bash 或至少 deny 写入类）传进 ChatEngine

### Step 2 — Local command 注入（带 Caveat + TTL）

* 新增：`LocalCommandRecord` + `appendLocalCommand()`
* 行为：用户在 CLI 里跑本地命令后，把 stdout/stderr 做成一个 injection block：

  * 默认 `visibility: both`（UI 展示）
  * 默认 `ttlTurns: 1`（只注入给模型 1 回合）
  * stdout 过长：注入摘要 + 截断提示（原文只保存在 UI store）

> 注意：本次抓包里没出现 `<local-command-stdout>` 的事实样例，所以 Caveat 文案我建议你按“可疑输入”原则设计；如果你补一条 Claude Code 的 stdout 注入抓包，我可以帮你把文案对齐到它的真实模板。

### Step 3 — EnterPlanMode/ExitPlanMode 的集成（可选，后置）

* 做法：把它实现成“本地切换工具”，但必须走 UI confirm
* tool_result：返回当前 mode（用于模型确认），同时在 UI transcript 标注“由模型请求切换、用户已确认/拒绝”

### Step 4 — 与 Task(subagent) UI 对齐（你已完成一半，补齐 policy + 统计）

* 你已有 running 动态行 + Done(N tool uses · duration)。
* 这一步补：

  * plan mode 下 subagent 默认 read-only policy（对齐抓包的 READ-ONLY reminder 语义）。
  * Done 行追加 tokens（你们下一步正在做）

### Step 5 — 控制面元请求（Topic/Title + Warmup）

* Topic/Title：Haiku、tools 为空、失败降级为“不改标题”。
* Warmup：启动/切换 repo/切换模式模板版本时触发一次；system 与 warmup 文本都 ephemeral。

---

## 需要你补充的证据（我才能把 local stdout / EnterPlanMode 做到“像 Claude Code”）

1. 一条**包含本地命令 stdout 注入**的请求样例（你提到的 `<local-command-stdout>` / Caveat 文本）。
2. 一条**模型实际 tool_use 调用 EnterPlanMode/ExitPlanMode**（如果 Claude Code 真的会这样做）。
3. 一条失败工具的 `tool_result.is_error` + content 形态（你们要做统一 envelope/Presenter 兼容时很关键）。

如果你把这三条补上，我可以把 Step2/Step3 的注入模板、TTL 策略、以及“记录/不记录”边界直接对齐到 Claude Code 的真实文本与字段。
