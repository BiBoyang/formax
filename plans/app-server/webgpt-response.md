According to a document from 2026-02-08（基于你提供的 repomix 代码包 + DESIGN/TODO 静态分析），下面给出“先决策、后细节”的补强结论与增量设计/执行清单。

---

## 1. Root Cause Model

> 目标导向结论：当前方案的“核心短板”不在 JSON-RPC/stdio 选型本身，而在 **可恢复/可调试元数据缺失 + input/approval 没有落到“可持久化状态机”**，导致 GUI 端在重复提交、超时、interrupt、重启恢复等场景下无法稳定收敛。

### 1) 协议层缺少可调试/可恢复的“统一元数据”

* **主因**：协议只定义了“能跑通”的方法集合，但缺少跨方法一致的 `traceId / timestamps / seq / source` 等元数据，导致事件乱序、重复、丢失时难以定位与恢复。
* **次因**：`turn/event` 事件体目前只是 `StreamEvent` 的透传，而 `StreamEvent` 自身没有序列号/时间戳/事件 id；同时 `turn/*` 也缺少明确 status 枚举（running/waiting_input/interrupted 等）来让 GUI 可靠实现状态机。
* **证据**：握手只要求 initialize/initialized，并规定非握手请求返回 Not initialized，但没有任何“协议版本/limits/实例 id/seq”类信息；流式事件 `StreamEvent` 是简单 union（assistant_delta/tool_start/tool_result/usage/error/complete…），没有 eventId/seq/ts；turn API 当前设计里也没有明确的 turn status 枚举字段。

### 2) Approval + AskUserQuestion 被当成“就地 await”，缺少服务端可持久化状态机

* **主因**：设计里 `turn/inputRequested` 与 `turn/input/submit` 只是“事件 + 回填”，没有把“input 的生命周期（pending/submitted/canceled/expired）”变成服务端权威状态。
* **次因**：现有 `userInputManager` 是纯内存 pending promise + 小型 buffer（用于提前到达的答案），**没有 input 级别 deadline、没有持久化、没有 inputId**；因此 server 重启/turn interrupt/客户端重复提交 等都缺少可判定的权威状态。
* **证据**：`turn/input/submit` 现设计只回 `accepted:boolean`，语义不足以表达“重复提交/冲突/过期/已取消”等；`turn/inputRequested` 现设计只有 `toolUseId/type/questions`（approval/ask_user_question），缺少 inputId/seq/ts/status 等关键字段；`userInputManager` 只有 `pending` map + `answersBuffer`（maxBuffered=50，TTL=60s），无 timeout/无持久化/无上限 pending。

### 3) AskUserQuestion 的“键空间”与类型约束不稳定，放大 GUI 侧幂等与渲染复杂度

* **主因**：AskUserQuestion 的回答是 `Record<string,string>`，且示例/测试用 `header` 作为 key（如 `Choice`），这对 GUI 来说不是稳定、可机器校验的 field id。
* **次因**：存在 `multiSelect` 但回答值仍是 string，**没有明确编码（CSV? JSON string?）**；也没有字段级 validation（必填、options 集合、允许空值等）。
* **证据**：AskUserQuestion 的 question 结构含 `header`、`multiSelect`，但答案类型仍是 `Record<string,string>`；测试直接 `submitAnswers('ask-1', { Choice: 'A' })`，即 header 被当成 key。

### 4) “UI pending 但 server 已结束”的竞态在现设计中没有收敛机制

* **主因**：没有服务端发出的 **inputResolved / turnStatusChanged** 这类“终局事件”，GUI 很难稳定清理 pending UI。
* **次因**：中断与不可交互场景在现有 executor 里会直接返回 error（Approval required），而不是以 inputRequested 的形式进入统一链路；这会造成 GUI 既要处理 inputRequested，又要处理“突然 tool error”，竞态边界更复杂。
* **证据**：policyPreflight 明确：sub-agent 禁止 prompt、interactive=false 也不等待输入，直接返回稳定错误（Approval required …）；并且 SUBAGENT_DENY_TOOLS 列表包含 AskUserQuestion。设计里对 interrupt/终局时 pending input 的处理没有明确协议级字段/事件。

### 5) sessionSave 复用的关键缺口：现 reader 忽略 event，无法靠现有 reader 恢复 app-server 必需信息

* **主因**：设计希望复用 sessionSave 并写入 event，但现有 `readSessionFile` 只消费 session_meta/ui_msg/history_state，**直接忽略 event**，因此 app-server 若要恢复 turn 状态/事件序列/pending input，必须实现自己的 event 读取或扩展 reader。
* **次因**：如果不补充 app-server 自己的“元事件（turn_started/input_requested/input_resolved/turn_ended）”，thread/resume 在 server 重启后只能恢复消息历史，无法恢复“交互进行中”的状态。
* **证据**：reader switch 里只处理 session_meta/ui_msg/history_state，event 被标注 ignore；设计提出 sessionSave 映射与 `findSessionFileBySessionId` 等能力，但目前仅停留在设计层。

### 6) 资源边界与恶意客户端防护需要“协议级 + 实现级”一致化

* **主因**：stdio JSONL 下若没有统一的 size limit、队列上限、pending 上限、TTL 策略，会出现无限 pending / 无界队列 / 超长 payload 等资源泄漏。
* **次因**：现有系统里“局部有上限、全局没对齐”——例如 session writer 有 maxLineBytes 与队列上限，但 userInput pending 无上限；transport 侧未定义。
* **证据**：SessionWriter encodeRecord 有 `maxLineBytes` 截断策略；队列超过 1000 会 drop 并递增 dropped；但 userInputManager 的 pending map 没有上限控制。

---

## 2. 方案增强版（Design v2 Addendum）

> 设计策略（先决策）：**不推翻 DESIGN.md 的方法集合与一期 stdio+JSON-RPC 约束**，只做“增量补丁”：
>
> 1. 补齐统一元数据（seq/ts/traceId/source/status），让 GUI 能实现稳定状态机；
> 2. 把 approval/ask_user_question 收敛到一个统一 `InputRequest` schema + 服务端权威状态机；
> 3. 引入 typed error codes + recoverability；
> 4. sessionSave 增补最小“app-server 元事件”，确保重启后能判定 pending input 的失效/恢复策略。

下面按“只新增/修改点”描述（不重写整份 DESIGN）。

### 2.1 协议字段补充（跨所有方法的统一元数据）

#### 2.1.1 JSON-RPC 顶层扩展 `meta`（允许额外字段）

在所有 request/notification/response 对象顶层增加可选字段（不破坏 JSON-RPC 2.0）：

```ts
type RpcMeta = {
  traceId?: string;        // 客户端或服务端生成，贯穿一个 turn
  requestId?: string;      // 客户端生成，用于诊断与幂等（可选）
  sentAt?: string;         // ISO timestamp（客户端发送时间）
  serverInstanceId?: string; // 响应/通知里填，重启后变化
}
```

**落地规则**：

* `initialize` 响应必须返回 `serverInstanceId` 和 `limits`（见 2.1.2）。
* 所有 `turn/*` 通知必须携带 `traceId`（若缺省则 server 生成并固定到 turn）。

#### 2.1.2 `initialize`/`initialized` 稳健化

基于现设计握手要求，新增/修改：

**initialize.params 增补：**

* `protocolVersion`: `"0.1"`（字符串，便于未来演进）
* `capabilities`: 客户端能力声明（至少包含 `turnEventSeq`, `inputSubmissionId`, `resumeMode`）
* `clientLimits`: 客户端可接受的 `maxEventBytes`（可选，用于 server 降级）

**initialize.result 增补：**

* `serverInstanceId`: string（每次 server 启动生成）
* `protocolVersion`: `"0.1"`
* `limits`:

  * `maxRequestBytes`（例如 1MB）
  * `maxEventBytes`（例如 512KB）
  * `maxPendingInputsPerThread`（例如 8）
  * `defaultInputTtlMs`（例如 10min）
  * `maxInFlightTurnsPerThread`（固定 1）
* `time`: `{ now: ISO }`（用于 client 校时）

**握手判定：**

* `initialize` **必须幂等**：同一连接重复调用返回同一 capability/limits（或返回 ALREADY_INITIALIZED 但带 data 指引）。
* 在收到 `initialized` 前允许/不允许哪些通知：建议保守——**服务端在 initialize 完成后即可发 turn 相关通知**，但 client 只有在发 `initialized` 后才可以发 turn/start（避免 client 还没准备好 UI）。

---

### 2.2 turn/thread 方法关键字段补充

#### 2.2.1 TurnStatus 枚举与时间戳

对 turn 相关结构补充：

```ts
type TurnStatus =
  | "queued"
  | "running"
  | "waiting_input"
  | "completed"
  | "failed"
  | "interrupted"
  | "canceled";

type Turn = {
  id: string;
  threadId: string;
  status: TurnStatus;
  createdAt: string;
  startedAt?: string;
  endedAt?: string;

  traceId: string;
  lastSeq?: number; // 最后一条事件 seq（见 2.3）
}
```

#### 2.2.2 thread/* 与 turn/* 增补 trace 与时间字段

* `thread/create` 返回的 thread 结构补齐 `createdAt/updatedAt`（设计里 thread/list 依赖 updatedAt 排序）。
* `turn/start` 入参/返回补齐 `traceId`（允许 client 传入，否则 server 生成）。

---

### 2.3 `turn/event` 与事件序列（seq / eventId / source）

#### 2.3.1 统一事件 envelope

在不改变现有 `StreamEvent` union（代码已有）的前提下，**在协议层包装 envelope**：

```ts
type TurnEventEnvelope = {
  threadId: string;
  turnId: string;

  seq: number;        // 单调递增（per turn）
  ts: string;         // server time
  source: "engine" | "tool" | "policy" | "server";

  eventId: string;    // UUID，方便 client 去重
  event: StreamEvent; // 现有 union
}
```

> 决策：**seq 是 per-turn**，不跨 thread。这样 client 的实现成本最低，也符合“一线程单 in-flight”的一期约束。

#### 2.3.2 turn/event “可恢复”最低要求

* server 必须保证：同一 turn 内，`seq` 严格递增；如果 server 重启导致无法保证连续性，必须在 `thread/resume` 返回 `resumeInfo: { seqReset: true }`，并把未完成输入标记为 expired（见 2.5.4）。

---

### 2.4 `turn/inputRequested` 统一 schema（approval / ask_user_question）

> 关键决策：把 `turn/inputRequested` 从“工具级事件”升级为 **服务端权威的 InputRequest**。
> 输入链路统一：approval 与 ask_user_question 都产生 `InputRequest`，都走 `turn/input/submit`，都能发出 `turn/inputResolved` 终局通知。

#### 2.4.1 新增 `InputRequest`

```ts
type InputKind = "approval" | "ask_user_question";

type InputStatus = "pending" | "submitted" | "canceled" | "expired" | "failed";

type InputRequest = {
  inputId: string;        // 关键：稳定 id（见 2.4.3）
  kind: InputKind;
  toolUseId: string;      // 仍保留（与现 design 一致）:contentReference[oaicite:20]{index=20}

  threadId: string;
  turnId: string;
  traceId: string;

  createdAt: string;
  expiresAt?: string;     // server 给出 deadline，GUI 用于展示/超时处理
  status: InputStatus;    // 在 inputRequested 时恒为 pending

  title: string;
  description?: string;

  fields: InputField[];   // ask_user_question / approval 都用 fields 表达
  defaults?: Record<string, string>;

  // 供 GUI 做幂等/去重
  seq: number;            // 与 turn/event 同一序列域（或独立 inputSeq 也可，但一期建议复用 turn seq）
}

type InputField =
  | {
      fieldId: string;           // 稳定 id（不要用 header 直接裸奔）
      label: string;             // UI 显示
      type: "enum";
      options: Array<{ value: string; label: string; description?: string }>;
      multiSelect?: boolean;
      required?: boolean;
    }
  | {
      fieldId: string;
      label: string;
      type: "text";
      required?: boolean;
      maxLength?: number;
    };
```

#### 2.4.2 approval 的字段定义（最小可用）

把 approval 收敛成固定字段（一期最小可用闭环）：

* `decision`（enum）：`approve | approve_remember | reject | feedback`
* `scope`（enum）：`session | project`（如果你们后续要 global，再加）
* `feedback`（text，可选）：当 decision=feedback 时 required

并在 `InputRequest.description` 放入 policy explain lines（现 approvalService 已有 explainPolicy 的信息源，且 preflight 会产出 `explained/effectiveDecision/workspaceRequest` 等）。

#### 2.4.3 `inputId` 生成规则（用于幂等与恢复）

> 决策：`inputId` 必须由 server 生成且稳定，可由 client 计算但以 server 为准。

一期推荐：

* `inputId = "${turnId}:${toolUseId}:${kind}"`

  * 好处：自然唯一；重复触发同一 toolUseId 时可去重；恢复时好定位。
  * 风险：若同一 toolUseId 在 turn 内会重复出现（理论上不应该），再加一个序号 `:n`。

#### 2.4.4 新增 `turn/inputResolved`（终局通知，解决 UI pending 竞态）

```ts
type TurnInputResolved = {
  threadId: string;
  turnId: string;
  inputId: string;

  seq: number;
  ts: string;

  status: "submitted" | "canceled" | "expired" | "failed";
  resolvedAt: string;

  // submitted 时可回显（可选）
  submissionId?: string;
  answersHash?: string;
}
```

> 这条通知是你们提出的“避免 UI pending 但 server 已结束”最直接的协议层抓手：
> UI 只要看到 resolved，就必须把该 inputId 的 UI 收起（哪怕 turn 后面失败/中断）。

---

### 2.5 `turn/input/submit` 幂等、超时、interrupt、重启恢复策略

#### 2.5.1 修改 `turn/input/submit` 入参（保留兼容字段）

现设计：`submit(toolUseId, answers) -> accepted:boolean`
v2 增补（兼容：toolUseId 仍可传，但必须同时提供 inputId 或可由 server 推导）：

```ts
params: {
  threadId: string;
  turnId: string;

  inputId: string;
  toolUseId?: string; // 兼容/诊断

  answers: Record<string, string>;

  submissionId?: string; // 客户端生成：用于“重复提交”幂等
  submittedAt?: string;  // 客户端时间（可选）
}
```

#### 2.5.2 submit 的返回值要表达“状态”，不能只给 accepted

```ts
result: {
  accepted: boolean;
  status:
    | "accepted"
    | "already_submitted_same"
    | "conflict_already_submitted"
    | "not_pending"
    | "expired"
    | "canceled";

  input: { inputId: string; status: InputStatus; resolvedAt?: string };
}
```

#### 2.5.3 客户端重复提交答案（幂等）

规则（服务端权威）：

* 若 `inputId` 仍 pending：第一次提交 -> accepted=true,status=accepted，并触发 `turn/inputResolved(submitted)`。
* 若 `inputId` 已 submitted：

  * answers 等价（可用 hash 比较）：accepted=true,status=already_submitted_same
  * answers 不等价：accepted=false,status=conflict_already_submitted，并返回 **typed error INPUT_CONFLICT**（见 2.6）

#### 2.5.4 客户端超时未答复（TTL）

* `expiresAt` 到期后，服务端将 input 标记为 expired，并发 `turn/inputResolved(expired)`。
* 同时 turn 的状态策略必须明确（两种可选，一期建议固定一种）：

  1. **approval 超时 = 自动 reject + turn failed（可恢复）**
  2. **ask_user_question 超时 = turn interrupted/canceled（可恢复）**
* 一期推荐：**统一为 “expired -> turn interrupted”**，因为最少惊讶且不会把潜在危险操作默认放行。

#### 2.5.5 turn 被 interrupt 时仍有 pending input

* `turn/interrupt` 触发后：

  * 服务端先把所有 pending input 标记为 canceled（逐个发 `turn/inputResolved(canceled)`）
  * 再发 `turn/failed`（status=interrupted）或 `turn/completed`（如果你们希望 interrupt 是正常终止则 completed+reason，但一期更直观是 interrupted）
* 这样 GUI 的清理顺序确定，竞态最小。

#### 2.5.6 服务端重启后的 pending input 恢复/失效

> 一期建议：**不尝试恢复“继续等待输入”的 in-flight turn**；只恢复 thread 的历史与“未解决 input 的失效结果”。

策略：

* `thread/resume` 时，若发现上一轮存在 pending input（通过 sessionSave app-server 元事件判定），统一标记为 **expired(reason=server_restart)**，返回给客户端做 UI 清理，并在服务端追加 `turn/inputResolved(expired)` 元事件（用于后续审计）。

---

### 2.6 错误码与恢复策略（typed + recoverability）

#### 2.6.1 统一错误结构（JSON-RPC error.data）

```ts
error: {
  code: number;          // -32000 ~ -32099（应用保留段）
  message: string;
  data?: {
    kind: string;        // 机器可读
    recoverable: boolean;
    retryable: boolean;
    traceId?: string;
    details?: any;
  }
}
```

#### 2.6.2 建议错误码表（一期最少集）

* `-32001 NOT_INITIALIZED`（recoverable=true：先 initialize）
* `-32002 ALREADY_INITIALIZED`（recoverable=true：忽略或重连）
* `-32010 THREAD_NOT_FOUND`
* `-32011 TURN_NOT_FOUND`
* `-32012 TURN_ALREADY_RUNNING`（recoverable=true：等 turn 状态变化/turn/read）
* `-32020 INPUT_NOT_FOUND`
* `-32021 INPUT_NOT_PENDING`
* `-32022 INPUT_EXPIRED`
* `-32023 INPUT_CANCELED`
* `-32024 INPUT_CONFLICT`（重复提交但答案不一致）
* `-32030 PAYLOAD_TOO_LARGE`
* `-32031 INVALID_PARAMS`
* `-32040 RATE_LIMITED`
* `-32050 INTERNAL_ERROR`（recoverable=maybe）

---

### 2.7 持久化补充建议（sessionSave 元事件最小闭环）

现状：sessionSave 支持 `event` record（writer 已有 appendEvent）但 reader 忽略 event。
**增量策略**：不改现 reader 行为；app-server 自己实现 event reader（或扩展一个新函数），只服务于 thread/resume。

#### 2.7.1 新增 app-server 元事件（不会破坏既有 reader/writer）

写入如下 event（全部是 `type:"event"`）：

* `app.turn_started`：{threadId, turnId, traceId, startedAt}
* `app.turn_status`：{turnId, status, ts}（可选：如果你不想每次状态变更都写，就只写最终状态）
* `app.input_requested`：{inputId, kind, toolUseId, expiresAt, fields摘要, seq}
* `app.input_resolved`：{inputId, status, resolvedAt, submissionId?, answersHash?}
* `app.turn_ended`：{turnId, status, endedAt, errorKind?, usage?}

#### 2.7.2 thread/resume 的恢复输出（最小）

* 返回最近一次 turn 的 `status/endedAt/lastSeq`（如果你们决定提供）。
* 返回 `staleInputs[]`（所有在重启/中断后被判定为 expired/canceled 的 input），用于 GUI 清理。

#### 2.7.3 大规模 thread/list/read/resume 的可扩展性（一期保守）

设计里 thread/list 已考虑 cursor/limit。补强点：

* thread/list 默认只返回 summary，不读取完整 session 文件（避免 O(N*size)）
* 对 session summary 的 updatedAt 采用文件 mtime（你们设计也提到）
* 若后续规模上来，再加 index（属于“稍高改动版”，见第 4 部分）

---

### 2.8 安全/边界（stdio JSONL）

增量要求（协议 + 实现一致）：

* `maxRequestBytes`：超限直接返回 `PAYLOAD_TOO_LARGE`，并丢弃该请求但保持连接可用。
* 限制 `maxPendingInputsPerThread`：超过则拒绝新的 inputRequested（返回 INTERNAL/或 INPUT_QUEUE_FULL）。
* 限制每个 turn 的最大事件数（防止无限 stream）。
* 对 `turn/input/submit` 做 schema 校验：未知字段忽略还是报错建议报错（INVALID_PARAMS），避免 silent failure。
* 对 `answers` 做 size 校验（总长度/单字段长度），避免超长 payload。

---

## 3. TODO 增强版（TODO v2，可打勾清单）

> 说明：严格保留原 Phase 0..8 结构，在原任务上补充；并对我判断已完成的项标 `[x]` + 证据一句。
> 另外：每个 Phase 都补了“验收标准（可观察断言）”；最后单独增加 **Approval Hardening（≥12 子项）**。

### Phase 0 — 目录与文档基线

* [x] 新增 `plans/app-server/DESIGN.md` 与 TODO（文档基线已存在）。
  证据：目录结构包含 `plans/app-server/DESIGN.md` 与 `plans/app-server/TODO.md`。
* [ ] 在 `CODEMAP.md` 预留 app-server 入口索引（先标注 WIP）。
* [ ] **补丁式更新** `plans/app-server/DESIGN.md`：加入本回复的 Design v2 Addendum（只加增量章节，不重写全文）。

**验收标准（可观察断言）**

* `DESIGN.md` 中能找到：InputRequest schema、InputStatus/TurnStatus、error codes、sessionSave 元事件列表。
* `CODEMAP.md` 中能找到 app-server 模块入口（WIP 也可，但必须有路径与职责描述）。

---

### Phase 1 — 抽取共享 runtime（让 app-server 与 legacy CLI 复用）

* [ ] 抽取 `src/runtime/createRuntime.ts`（cfg -> engine + tools + toolRegistry + taskManager + userInputManager）。
* [ ] `src/legacy/runLegacyCli.tsx` 改用 `createRuntime()`（保持行为一致）。
* [ ] **补充**：createRuntime 的返回值必须允许注入/透传 `onEvent`（用于 app-server turnRunner 捕获 stream events）。

**验收标准**

* legacy CLI 路径仍能创建 runtime（不要求你在此处运行验证，但代码上不应出现 legacy 专用拼装残留）。
* runtime 结构体中包含 userInputManager（后续 app-server 复用）。

---

### Phase 2 — Transport（stdio JSONL）

* [ ] 新建 `src/app-server/transport/stdio.ts`：JSONL 读写、逐行解析、写回 JSON-RPC response/notification。
* [ ] **补充**：实现 `maxRequestBytes/maxLineBytes` 校验与错误返回（PAYLOAD_TOO_LARGE / PARSE_ERROR）。
* [ ] **补充**：实现发送队列 + backpressure（避免 client 不读导致无限堆积）。

**验收标准**

* 对非法 JSON 行：返回可诊断错误（含 error.kind），且不会阻塞后续合法请求。
* 对超长 payload：返回 PAYLOAD_TOO_LARGE，连接保持可用。
* 通知发送有队列上限（可配置），超过时有可观测的 drop/错误策略。

---

### Phase 3 — JSON-RPC Router + initialize/initialized

* [ ] 新建 `src/app-server/rpc/router.ts`（method 分发、参数校验）。
* [ ] 实现 `initialize/initialized`；非握手请求在 initialized 前返回 NOT_INITIALIZED（对齐设计）。
* [ ] **补充**：initialize 幂等；返回 `serverInstanceId + limits + protocolVersion`。
* [ ] **补充**：统一错误码与 error.data（recoverable/retryable/traceId）。

**验收标准**

* initialize 返回 capabilities + limits；重复调用行为稳定（幂等或 ALREADY_INITIALIZED）。
* 任一非握手方法在未初始化时都返回 NOT_INITIALIZED（含 recoverable=true）。

---

### Phase 4 — threadStore（线程映射到 sessionSave）

* [ ] 新建 `src/app-server/store/threadStore.ts`：thread/create/list/read/resume。
* [ ] session id ⇄ threadId 映射（继续沿用 sessionSave 的 sessionId 字段）。
* [ ] thread/list 支持 cursor/limit/sort=updatedAt desc（对齐设计）。
* [ ] **补充**：thread summary 读取策略（不读取全量 messages，避免 O(N*size)）。

**验收标准**

* thread/list 在数据量大时仍是“按 session 文件元信息”工作，不强制全量解析每个会话。
* thread/read 能返回 messages 与必要元数据（threadId/updatedAt）。

---

### Phase 5 — turnRunner + stream->protocol bridge（核心）

（原 TODO 的方向保持：扩展 StreamEvent + turnRunner 捕获 + turn/inputRequested）

* [x] 基础 `userInputManager` 已具备：提前提交答案 buffer（TTL 60s、最多 50）+ 对同 toolUseId 的重复 requestAnswers 会复用 pending promise。
  证据：`maxBufferedAnswers=50`、`bufferTTL=60*1000`、`requestAnswers` 若已 pending 则直接返回既有 promise。
* [x] AskUserQuestion handler 已通过 `userInput.requestAnswers(call.id, questions, signal)` 获取答案，并支持 prefilledAnswers 快速返回。
  证据：handler 在有 `prefilledAnswers` 时直接返回；否则调用 `requestAnswers({toolUseId: call.id, questions, signal: ctx.signal})`。
* [ ] 扩展 `src/streaming/types.ts`：新增 `approval_request`、`ask_user_question`（按设计建议）。
* [ ] 在 `approvalService.ensureApproved()` 里，当即将 `requestAnswers` 前，通过 `ctx.onEvent` 发 `approval_request`（包含 action/explained/effectiveDecision/workspaceRequest/决策选项）。
* [ ] 在 AskUserQuestion handler 里，通过 `ctx.onEvent` 发 `ask_user_question`（包含 questions，稳定 fieldId）。
* [ ] `turnRunner` 捕获 `ctx.onEvent` 的 StreamEvent：

  * [ ] 为每个 turn 生成 `traceId`、维护 `seq`
  * [ ] 将事件包装成 `turn/event`（带 seq/ts/source/eventId）
  * [ ] 将 `approval_request/ask_user_question` 转换为 `turn/inputRequested(InputRequest)`
* [ ] 新增 `turn/inputResolved` 通知：submit/cancel/expire 都必须发，解决 UI pending 竞态。
* [ ] 实现 `turn/input/submit` 幂等语义（submissionId + answersHash + conflict 规则）。

**验收标准**

* 任一 turn 中出现 approval 或 ask_user_question：GUI 至少能收到一条 inputRequested（含 inputId/expiresAt/fields）。
* 对同一 inputId 重复 submit：返回 already_submitted_same 或 conflict（且 conflict 有 INPUT_CONFLICT 错误码）。
* turn 结束/interrupt 时：所有 pending input 必须先收到 inputResolved（canceled/expired），GUI 不会永远 pending。

---

### Phase 6 — sessionSave mapping（持久化与恢复闭环）

* [x] sessionSave 已支持写入 `event` record（writer 侧），但 readSessionFile 目前忽略 event。
  证据：records 定义包含 EventRecord 且 writer 有 appendEvent；reader 明确忽略 event。
* [ ] 新增 `src/app-server/store/sessionEventReader.ts`：只读取 event 记录（不影响现有 reader）。
* [ ] turnRunner 在关键点写入 app-server 元事件：turn_started / input_requested / input_resolved / turn_ended。
* [ ] `thread/resume` 使用 eventReader 计算：

  * [ ] lastTurn 状态
  * [ ] staleInputs（重启后 pending 的统一 expired）
* [ ] 实现 `findSessionFileBySessionId(sessionId)`（对齐设计建议）。

**验收标准**

* server 重启后（新 serverInstanceId）：thread/resume 能返回 staleInputs，并且 staleInputs 与后续输入提交的错误码一致（INPUT_EXPIRED）。
* sessionSave 的既有 UI 回放（只看 messages/history_state）不受影响。

---

### Phase 7 — Web client MVP（reference client）

* [ ] turn/inputRequested 渲染：支持 approval + ask_user_question 两种 UI。
* [ ] 提交时必须带 `submissionId`（幂等），并在收到 inputResolved 后立即清理 UI。
* [ ] 支持 input 过期/取消显示（expired/canceled）。
* [ ] 支持断线重连：重新 initialize 后调用 thread/resume，清理 staleInputs。

**验收标准**

* 断线后重连：不会出现“旧 input 还挂在 UI 上但 server 已拒绝”的状态；resume 后能清理。
* 重复点击提交：不会造成 server 多次执行或状态紊乱（幂等收敛）。

---

### Phase 8 — Docs + CODEMAP + examples

* [ ] 更新 `CODEMAP.md`：添加 app-server 模块索引（路径、职责、入口）。
* [ ] 在 DESIGN.md 增补“GUI 实现指南”：inputRequested / inputResolved / retry 策略 / 错误码对照表。
* [ ] 增加协议 examples（initialize/turn/start/inputRequested/submit/resolved/interrupt 的 JSON 样例）。

**验收标准**

* 文档中存在：完整 input 生命周期样例（含重复 submit、超时、interrupt、重启 resume 四类）。
* CODEMAP 中能直接定位到协议类型定义与 turnRunner。

---

### Approval Hardening（至少 12 个可执行子项）

> 这些是“必须补齐边界与失败模式”的硬化条目（多数落在 Phase 5/6/7，但这里单列便于打勾）。

1. [ ] 定义 `InputRequest/InputField/InputStatus/TurnStatus` TypeScript 类型（`src/app-server/protocol/types.ts`）。
2. [ ] 定义统一 `RpcError` 工具与 error code 枚举（`src/app-server/protocol/errors.ts`）。
3. [ ] 生成稳定 `inputId`（推荐 `${turnId}:${toolUseId}:${kind}`）并在所有 input 通知/submit 中使用。
4. [ ] `turn/input/submit` 增加 `submissionId`，并实现“同 submissionId 幂等返回”。
5. [ ] 对已 resolved 的 input：比较 `answersHash`，实现 `already_submitted_same` vs `INPUT_CONFLICT`。
6. [ ] 为每个 InputRequest 生成 `expiresAt`（默认 TTL），到期触发 inputResolved(expired)。
7. [ ] turn/interrupt 时：先 cancel pending inputs（逐个 inputResolved(canceled)），再结束 turn。
8. [ ] turn 正常结束/失败结束时：保证没有 pending input 残留（否则强制 cancel）。
9. [ ] server 重启恢复：thread/resume 发现未 resolved input -> 统一标记 expired(reason=server_restart) 并返回 staleInputs。
10. [ ] `maxPendingInputsPerThread` 上限与拒绝策略（避免恶意无限 pending）。
11. [ ] `answers` payload size 限制（字段长度/总大小），超限返回 INVALID_PARAMS 或 PAYLOAD_TOO_LARGE。
12. [ ] inputRequested 必须携带 `seq/ts/traceId/source`，GUI 用 seq 去重与排序。
13. [ ] approval_request 事件中补齐“可展示内容”：action.kind、toolName/toolInput 摘要、policy explain lines、workspaceRequest。
14. [ ] AskUserQuestion 的 fieldId 不直接用 header：新增 `fieldId`（稳定且可机器校验），header 只做 label。
15. [ ] 明确 multiSelect 编码：一期约定 answers[fieldId] 为 JSON string array（例如 `["A","B"]`）。
16. [ ] 为上述关键路径补充单元测试：duplicate submit、timeout expiry、interrupt cancel、restart resume stale。

---

## 4. Option Comparison

### 方案 A：最小改动版（优先推荐）

**核心做法**

* 不改变 DESIGN 的方法集合，只新增字段与少量通知（inputResolved）。
* turnRunner 维护 per-turn `seq/traceId`，把现有 StreamEvent 包一层 `turn/event` envelope。
* approval/ask_user_question 通过新增 StreamEvent（approval_request/ask_user_question）进入统一 inputRequested。
* sessionSave 只追加 app-server 元事件；thread/resume 用独立 reader 读 event（不改现有 readSessionFile）。

**优点**

* 改动面可控、迭代快；不需要“全量事件回放/补发”机制。
* 对现有 TUI 影响小：新增 StreamEvent 默认会被忽略（现 streaming 处理 default return）。
* 能把你们关心的四大场景（重复提交/超时/interrupt/重启）落到“服务端权威状态 + 终局通知”。

**缺点**

* 断线期间丢失的 turn/event 不做补发；GUI 只能靠 thread/resume 获取最终状态与 staleInputs（足够 MVP，但不是最强一致性）。

---

### 方案 B：稍高改动版（结构更优）

**核心做法**

* 把 `turn/inputRequested` 也统一纳入 `turn/event`（一切皆 event），并提供 `turn/events` 拉取接口：`sinceSeq` 获取缺失事件。
* sessionSave 事件日志成为事实来源：turnRunner 每条事件都落盘（或至少关键事件落盘），client 重连可请求补齐。

**优点**

* 更强一致性：断线重连后可恢复事件流，不依赖 UI 猜测。
* 更易做调试与审计：seq 对齐 + event log 可回放。

**缺点**

* 复杂度/风险更高：要处理 event 拉取、去重、截断、存储增长、版本迁移。
* 一期可能超出“最小可用闭环”的投入边界。

---

## 5. 最终推荐与实施顺序（按 PR 粒度）

### 推荐结论

**选方案 A（最小改动版）**，并强制纳入以下“必须项”：

* `InputRequest + InputStatus + inputId`
* `turn/inputResolved`
* `turn/input/submit` 幂等（submissionId + conflict）
* sessionSave app-server 元事件（至少 input_requested/input_resolved/turn_ended）

这样才能把 GUI 稳定性做出来，而不扩大到事件回放系统。

---

### 建议 PR 顺序（每个 PR：目标 / 改动面 / 风险点）

#### PR-1：协议类型与错误码骨架

* **目标**：落地 `TurnStatus/InputRequest/RpcError` 类型与 error code 表（不接 runtime）。
* **改动面**：`src/app-server/protocol/*` 新文件 + DESIGN.md Addendum 小节同步。
* **风险点**：低（纯新增）。

#### PR-2：StreamEvent 扩展 + 工具侧发出 input 信号

* **目标**：新增 `approval_request/ask_user_question` StreamEvent，并在 approvalService / askUserQuestion handler 中 `ctx.onEvent` 发出。
* **改动面**：`src/streaming/types.ts`、`src/tools/executor/approvalService.ts`、`src/tools/modules/askUserQuestion/handler.ts`。
* **风险点**：中（要确保不破坏现有 TUI；但当前 streaming handler 对未知事件 default return，风险可控）。

#### PR-3：turnRunner 事件封装（seq/ts/traceId）+ turn/event 通知

* **目标**：turnRunner 捕获 StreamEvent，包装成带 seq/ts/source/eventId 的 `turn/event`。
* **改动面**：新增 `src/app-server/turnRunner/*` 与 rpc 通知发送通路。
* **风险点**：中（序列号正确性、并发下线程隔离）。

#### PR-4：InputRequest 状态机 + inputRequested + inputResolved

* **目标**：实现 InputRequest 生命周期、`turn/inputRequested` 与 `turn/inputResolved`。
* **改动面**：turnRunner + rpc router + 内存 store（per-turn）。
* **风险点**：中高（竞态：turn 结束/interrupt/timeout 与 submit 的并发）。

#### PR-5：turn/input/submit 幂等与冲突策略

* **目标**：submissionId/answersHash/重复提交收敛；补齐 typed errors（INPUT_CONFLICT/EXPIRED/CANCELED）。
* **改动面**：rpc router + input store。
* **风险点**：中（幂等细节必须一致，否则 GUI 难写）。

#### PR-6：sessionSave 元事件写入 + thread/resume 的 staleInputs

* **目标**：把 inputRequested/resolved/turn_ended 落盘为 event；thread/resume 读 event 并返回 staleInputs。
* **改动面**：`src/features/repl/sessionSave/records.ts`（若需复用类型）、新增 app-server eventReader，threadStore。
* **风险点**：中（解析兼容性；但现 reader 忽略 event，回归风险小）。

#### PR-7：transport size limit + pending 上限（安全硬化）

* **目标**：maxRequestBytes/maxEventBytes、maxPendingInputsPerThread、队列上限策略。
* **改动面**：stdio transport + input store。
* **风险点**：中（限流策略要可观测、错误码要稳定）。

#### PR-8：web client 的 input UI + 重连 resume

* **目标**：实现 inputRequested 渲染、submit 幂等、inputResolved 清理、thread/resume 清理 staleInputs。
* **改动面**：web client。
* **风险点**：中（UI 状态机与错误码契约要对齐）。

---

如果你希望我在下一步直接把 **InputRequest schema + error code 表 + 状态机转移表** 写成可以复制进 DESIGN.md 的“规范化片段”（含 JSON 示例与状态转移表），我可以基于上面的 v2 addendum 进一步格式化成更接近 RFC 的文本。
