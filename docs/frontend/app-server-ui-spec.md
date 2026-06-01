# Formax App Server UI Spec（功能型规范）

更新时间：2026-06-01

本文件规定 reference client 的功能行为规范，不定义品牌视觉。  
目标是：任何实现者都能做出“行为一致”的调试 UI。

相关文档：

- 项目语义边界：`docs/contracts/semantics-contract.md`
- 协议合同：`docs/contracts/app-server-interaction-contract.md`
- 交互输入唯一事实源：`docs/contracts/interactive-input-contract.md`
- Web adapter / reducer / cursor 唯一事实源：`docs/contracts/web-parity-adapter-contract.md`
- 接口参考：`docs/references/app-server-api-reference.md`
- 前端治理入口：`docs/FRONTEND.md`

本文件定义 reference client 的行为规范；执行计划与过程文档不是本规范的上游。

## 1. UI 目标

1. 可执行：可独立完成 thread/turn/input 的完整链路。
2. 可诊断：出现错误时能判断“协议错误、状态错误、连接错误”。
3. 可恢复：断连/重启后，用户可通过 UI 明确恢复流程。

## 2. 信息架构（三区域）

## 2.1 左栏（线程与连接）

必须包含：

- 连接状态（`connected/connecting/disconnected`）
- Bridge URL 输入
- `New Thread` 按钮
- `Refresh` 按钮
- 线程列表（`threadId`、标题）

行为：

1. 点击线程项切换 `activeThreadId`。
2. 点击 `New Thread` 时进入显式 `newThreadDraft` surface，不立即创建真实 thread。
3. 左侧 folder quick action 进入 `newThreadDraft`，并为该草稿预填 cwd。
4. 左侧 `Add project` 只进入 `newThreadDraft`；native picker 只允许从中栏 draft selector 打开。
5. 未连接时按钮可点击但应给出明确错误提示。

## 2.2 中栏（转录与发送）

必须包含：

- 当前 active thread 展示
- `Interrupt` 按钮
- Transcript 区（日志 + user/assistant 消息）
- Composer 输入框与 `Send` 按钮（有活动审批面板时可被审批面板占位）

行为：

1. 中栏 surface MUST 显式区分 `welcome`、`newThreadDraft`、`thread`；不得继续单靠 `!activeThreadId` 混推 welcome 与 draft。
2. 当 `activeThreadId == null` 时，默认主入口 MUST 回到 `newThreadDraft` surface，而不是底部 welcome composer。
3. `Send` 在真实 thread surface 下仅在已连接且存在 active thread 时可用。
4. `Send` 在 `newThreadDraft` 下仅在已连接、已选择 path 且输入非空时可用。
5. `newThreadDraft` 下 composer 居中显示；真实 thread 下保持底部 composer 布局。
6. 发送前将用户输入追加到 transcript；draft 首发前不得先创建伪 thread 占位。
7. `assistant_delta` 以流式方式增量更新同一 assistant 气泡。
8. `turn/completed` 与 `turn/failed` 必须写入可见日志。
9. `Interrupt` 仅在 active turn 存在时可用。
10. 有活动审批面板时隐藏普通 composer，审批 resolved 后恢复 composer。
11. Composer model/thinking controls MUST be controlled by runtime state. In a real thread surface, display values derive from `thread.preferences[field] ?? globalRuntimeDefaults[field]`. In `newThreadDraft` / no-thread surfaces, display values derive from global runtime defaults.
12. Composer thinking controls MUST preserve boolean `thinkingMode` while allowing Anthropic `thinkingEffort` values `low | medium | high | xhigh | max`. Turning thinking off MUST NOT clear the selected effort; it only suppresses request-time effort payloads.
13. Preference changes are runtime side state; they MUST NOT create transcript rows.

Transcript 类型要求（必须可区分）：

1. `user`
2. `assistant`
3. `tool`（至少 start/update/end 可追踪）
4. `system`（握手、错误、状态变更）

## 2.3 右栏（Thread-Only Diff）

必须包含：

- diff / tool timeline（`tool_start/tool_update/tool_end`）

行为：

1. 右栏主区域优先显示 diff/tool 时间线，保障调试链路可追踪。
2. 右栏不承载 pending input 表单。
3. 右栏是 thread-only inspection pane；只有 `visibleSurface === 'thread'` 且存在真实 `activeThreadId` 时才允许展示 diff / tool timeline。
4. `newThreadDraft`、welcome/no-thread fallback、invalid URL thread fallback、archive 最后一个 thread 后的无 active thread 状态下，右栏 MUST 为空白态。
5. `latestRequestCollapse`、`latestCompactBoundary` 以及其他 thread-only 诊断 chrome，不得在 draft / no-thread surface 下残留显示。

## 2.4 顶栏（Thread / Draft Chrome）

行为：

1. 顶栏的 thread 标题、workspace label、open-folder action 必须跟随当前 surface owner，而不是继续读旧的 workspace selection。
2. 真实 `thread` surface 下：
   - thread title MUST render `ThreadSummary.label` when present；
   - thread title MUST NOT fall back to `lastUserPrompt`；unlabeled threads render `New Thread`；
   - workspace label 显示 `activeThread.cwd` 的目录名；
   - open-folder action 只允许作用于 `activeThread.cwd`。
3. `newThreadDraft` surface 下：
   - workspace label 只允许读取 `draftCwd`；
   - 若 `draftCwd == null`，workspace label MUST 为空；
   - open-folder action 只允许作用于 `draftCwd`；
   - 若 `draftCwd == null`，open-folder action MUST 隐藏或 disabled。
4. welcome / no-thread fallback 下：
   - workspace label MUST 为空；
   - open-folder action MUST 隐藏或 disabled；
   - 不得继续保留旧 thread / old workspace 的 header chrome。
5. `selectedCwd` 属于 workspace selection only 状态；它 MUST NOT 驱动 draft 或 no-thread 下的 header label、header folder action、right rail 内容或 draft fallback cwd。

## 3. 关键交互规范

## 3.1 连接与握手

1. 建立连接后自动执行：
   - `initialize`
   - `initialized`
2. 握手失败必须在 transcript 中输出错误。
3. 切换 Bridge URL 必须触发重连。

## 3.2 Thread 工作流

1. `thread/list` 返回为空时展示空状态。
2. thread 切换不清空 transcript（保留当前客户端视图日志）。
3. thread 不存在或参数错误需展示服务端错误原文。

## 3.2.1 New thread draft 工作流

1. `newThreadDraft` 是显式 GUI transient surface，不是持久 thread。
2. `newThreadDraft` 至少持有 `status`、`cwd`、`source` 等本地状态。
3. draft path selector 数据源来自现有项目列表，并提供 `Add new project` 入口。
4. draft path 是首发前的必选项；未选 path 时不得发送首条消息。
5. draft 首发时客户端 MUST 先调用 `thread/start`，成功后再调用 `turn/start` 或 `command/dispatch`。
6. 一旦 `thread/start` 成功，draft 即结束并进入真实 thread surface；若随后的首发失败，允许留下真实空 thread。
7. 用户离开未发送的 draft时，不得额外创建空 thread，也不得污染左侧 thread 列表。
8. `draftCwd` 是 draft-owned cwd；`selectedCwd` 与 `diffSnapshot.cwd` 都不得再冒充 `draftCwd`。
9. Draft model/thinking changes update global runtime defaults and MUST NOT create thread runtime state before first send creates a real thread.

## 3.3 Turn 工作流

1. 一次 `Send` 对应一次 `turn/start`。
2. 收到 `turn/started` 后写入 `activeTurnId`。
3. 收到 `turn/completed|failed` 后清空 `activeTurnId`。
4. `turn/failed` 必须展示错误原因文本。

## 3.4 Input 工作流

本节为 UI 摘要；交互输入语义的唯一事实源为：`docs/contracts/interactive-input-contract.md`。

1. input 入口位于中栏输入区锚定审批面板（dock/popup 形态），不是右栏。
2. 表单提交必须带 `submissionId`（客户端生成）。
3. `turn/input/submit` 返回状态要可见：
   - `accepted`
   - `already_submitted_same`
   - `conflict_already_submitted`
   - `not_pending`
   - `expired`
   - `canceled`
4. ask_user_question 与 approval 为双形态：
   - ask_user_question：支持 `1 of N` 分页，`Dismiss/ESC`，最后一页 `Submit`。
   - approval：允许 renderer 差异化（单步或多步），但提交语义必须与 `interactive-input-contract` 保持一致。
5. ask 的 `1 of N` 表示单个 input 的 questions 分页，不是 pending 队列分页。
6. 对 `INPUT_EXPIRED` 错误要展示“该输入已失效，需重新发起流程”。

## 3.5 Commander（Slash Command）工作流（P1）

一期目标：提供“可执行 + 可追踪输出”的命令能力，不追求 TUI overlay 形态一致。

要求：

1. 一期 commander 子集固定为：`/init`、`/clear`、`/compact`、`/context`、`/todos`。
2. UI 需提供 command 输入路径：
   - composer 直接输入 `/...`
   - 快捷命令按钮（至少包含 3 个子集命令）
3. command 结果必须进入 transcript，且标记为 system/tool 输出。
4. command 失败时必须展示错误 message（建议附 code）。

## 3.6 Replay 与排序语义

1. notification 处理与 replay 回放均以 `replaySeq` 作为主排序键。
2. `traceId/seq` 仅用于诊断与同 turn 内定位，不能作为跨 turn 全序键。
3. `thread/replay` 返回 `hasGap=true` 时，客户端必须触发重建路径，不允许继续用增量拼接。
4. tool 展示的 `toolName` 采用 `toolUseId` 粘性规则；缺失 `toolUseId` 的历史记录按单条记录渲染，不做跨记录合并。

## 4. 必须保留的操作可见性

以下信息必须可见（至少日志级）：

1. handshake 成功/失败
2. thread 创建结果
3. turn 开始/结束状态
4. input 请求与解决状态
5. submit 返回状态或错误码

## 5. 禁用态规范

1. `Send` disabled 条件：
   - `connectionStatus !== connected`
   - `activeTurnId != null`
   - `activeThreadId == null` 且当前不是已选 path 的 `newThreadDraft`
   - 当前是 `newThreadDraft` 但 `draftCwd == null`
2. `Interrupt` disabled 条件：
   - `activeTurnId == null`
3. input 提交按钮 disabled 条件（推荐）：
   - 当前无 selected input
   - 当前 input 已在本地标记 resolved

## 6. 错误展示规范

错误文案分级：

- `info`: 正常状态变化（如 completed）
- `warn`: 可恢复但需要用户动作（如 input requested）
- `error`: 失败或异常（如 turn failed、invalid params）

要求：

1. 错误至少展示 message。
2. 若有 code/data（如 JSON-RPC error），建议同时展示 code/kind。

## 7. 响应式与滚动规范（功能优先）

1. 页面高度固定为视口高度，禁止出现“输入框被推到页面底部外”的布局。
2. Transcript 区必须独立滚动。
3. 左栏线程列表与右栏 diff 区都必须独立滚动。
4. 移动/窄屏可改为上下布局，但三区域信息不可缺失。

## 8. 与逻辑层的职责边界

1. UI 层只消费状态与 action，不直接管理 WebSocket 请求映射。
2. 协议请求/响应管理在 `rpcClient` 层。
3. `eventAdapters` / `store` / `turnEventCursor` 的共享边界以 `docs/contracts/web-parity-adapter-contract.md` 为准。
4. 语义状态迁移（mode/input/transcript segment）应集中在共享 semantics projector，UI reducer 仅承接投影结果与本地交互状态。
5. 组件只做展示与事件派发，不持有业务状态机。
6. `AppShell` 必须承担整页 ownership gate：
   - `thread-owned`
   - `draft-owned`
   - `workspace selection only`
   的派生与路由都应在 page shell / runtime 层收口，而不是散落在叶子组件自行推断。
7. Preference write routing MUST use explicit visible-surface ownership, not raw `!activeThreadId`: real thread surfaces patch `thread/runtimeState/patch`; draft/no-thread surfaces patch `config/runtimeDefaults/patch`.
8. Send/start/dispatch MUST wait for any pending preference mutation that affects the visible target, or rehydrate/revert after failure before sending.

## 9. 验收清单（UI）

以下全部通过，UI 视为达到“功能完整”：

1. 可创建线程并在左栏看到新线程。
2. 可发起 turn 并流式看到 assistant 文本。
3. 可中断 turn 并看到 `interrupted` 结果。
4. approval 请求可提交并推进 turn。
5. ask_user_question 请求可提交并推进 turn。
6. 过期输入提交会显示 `INPUT_EXPIRED` 或 `expired` 状态。
7. 在窄屏和宽屏下输入框始终可见。
8. transcript 中能区分 user/assistant/tool/system 四类输出。
9. commander 子集命令可提交并在 transcript 中看到结果或错误。
10. `/context` 必须以本地 transcript 输出返回 diagnostics 文本，且不得启动新的 active turn。

## 10. 样式约束（执行规则）

1. 业务组件必须优先组合 `shadcn/ui` 原子组件（`Card`、`Badge`、`Button`、`Input`、`ScrollArea` 等）。
2. 视觉 token 统一来自 `packages/web-reference-react/src/css/theme.css`，禁止在业务组件中引入第二套颜色/阴影变量。
3. 允许在 `styles.css` 定义布局骨架（grid/flex/scroll），但禁止在业务组件里叠加临时“补丁式”内联视觉规则。
4. 新增组件若不满足以上约束，视为 UI 规范不通过。
