# Web New Thread Draft Surface Todo

## 0. Context and Boundary

### 0.1 Confirmed facts
- [x] 当前 `packages/web-reference-react` 的左侧 `新建线程` 会直接走真实 `thread/start`。
- [x] 当前 `ComposerDock` 与 `composerActions` 都要求存在真实 `activeThreadId` 才能提交。
- [x] 当前 `TranscriptFeed` / `TranscriptPane` 主要通过 `!activeThreadId` 表达 welcome/empty surface。
- [x] 当前 `useThreadSelection()` 会自动回填 `selectedCwd`，不适合直接承载“未选 path”的 draft 状态。
- [x] 这次需求已经对齐为显式 `newThreadDraft` 过程，而不是复用现有 welcome 态。
- [x] 新流程的主线语义是 `welcome -> newThreadDraft -> thread`，但 `newThreadDraft` 也可能从已有 thread 进入。
- [x] 真实 thread 仍然必须绑定 path，因此 draft 下 path 是必选项。

### 0.2 Goals
- [x] 点击左侧 `新建线程` 时进入显式 `newThreadDraft` surface，而不是立即创建真实 thread。
- [x] 在 `newThreadDraft` 下显示居中的 `ComposerDock` 与中间 path selector。
- [x] 未选 path 时禁止发送首条消息。
- [x] draft 首条发送时才真实调用 `thread/start`，随后再走 `turn/start` 或 `command/dispatch`。
- [x] 离开未发送的 draft 时不留下空 thread，不污染左侧 thread 列表。

### 0.3 Non-goals
- [x] 本任务不改 app-server 协议，不新增“原子创建 thread 并发送首条消息”的服务端接口。
- [x] 本任务不改变左侧普通 folder row 的现有职责；它仍是分组/导航语义，不承担 draft path 选择。
- [x] 本任务不做 draft 跨刷新恢复，不做未发送草稿持久化。
- [x] 本任务不顺手重构 terminal、diff、approval 等无关链路。
- [x] 本任务不把 `newThreadDraft` 塞回现有 `!activeThreadId` welcome 逻辑里。

## 1. Definitions First

### 1.1 Canonical docs
- [x] 先核对并在必要时更新 `docs/frontend/app-server-ui-spec.md`，把 `newThreadDraft` 作为显式 GUI surface 写清楚。
- [x] 评估是否需要同步更新 `docs/contracts/web-parity-adapter-contract.md`，特别是 active-thread canonical gating 与 web 端 transient draft surface 的边界。
- [x] 确认本次是否需要更新 `docs/contracts/app-server-interaction-contract.md`；当前预期是协议不变，仅 UI/runtime 调用时机变化。
- [x] 判断是否需要新增长期 canonical doc；当前预期先不新增，若实现后发现概念稳定再提升。

### 1.2 Data model
- [x] 定义 `newThreadDraft` 为唯一可写 draft 状态，最小形状至少包含 `status`、`cwd`、`source`。
- [x] 定义 `surfaceKind` / `visibleSurface` 为派生 view model，而不是第二个可写状态源：`newThreadDraft.status === 'active' -> 'newThreadDraft'`，否则 `activeThreadId ? 'thread' : 'welcome'`。
- [x] 明确 `selectedCwd` 与 `draftCwd` 的边界：`selectedCwd` 继续服务左侧分组/现有 thread，`draftCwd` 只服务新建线程草稿过程。
- [x] 禁止 UI 组件继续用 `!activeThreadId` 推断 draft；`TranscriptPane` 只消费派生后的 `surfaceKind` / `visibleSurface`。

### 1.3 Types / Interfaces
- [x] 更新 `AppShellProps` / `TranscriptPaneProps` / `ComposerDockProps`，显式表达 draft surface 与提交条件，不再把 `activeThreadId` 作为唯一 gate。
- [x] 为 runtime actions 定义 `enterNewThreadDraft`、`leaveNewThreadDraft`、`setNewThreadDraftCwd`、`createAndActivateThreadInCwd` 等接口边界。
- [x] 明确左侧入口 props 命名，避免继续使用会误导成“立即创建 thread”的 handler 名称。
- [x] 让 `ComposerDock` 的 Enter 与发送按钮共用同一套 `canSubmit` / `isInputDisabled` 逻辑，禁止一个入口继续隐式依赖 `activeThreadId`。

## 2. Runtime / Platform
- [x] 在 `useRuntimeViewState.ts` 增加 draft state 与 stable setter。
- [x] 在 `useAppRuntime.ts` / `useRuntimeActionsBundle.ts` 组装 draft actions，并把 `cwdOptions` 透传到 UI 层。
- [x] 不直接复用现有 `startThreadWithCwd` 作为 draft 首发路径。
- [x] 从 `threadActions.ts` 拆出更小的 server create helper，例如 `createThreadOnServerInCwd(cwd)`，只负责 `thread/start` 与响应解析。
- [x] 拆出 activation helper，例如 `activateCreatedThread(thread, meta)`，只负责激活真实 thread、清 active turn/pending/logs、同步真实 thread cwd。
- [x] 在 `composerActions.ts` 增加 draft 首发分支：校验 `draftCwd` 后先 `thread/start`，再 `turn/start` 或 `command/dispatch`；不得先跑旧的 replay/hydrate 回滚事务。
- [x] 明确 `thread/start` 成功但首发失败时的边界处理，接受留下真实空 thread 的协议现实，不做假回滚。
- [x] 审视 `useThreadUrlSync.ts`，保持 URL 只同步真实 thread，不为 draft 引入独立 query/route。
- [x] 把 `selectedCwd` / `draftCwd` 分离写成可执行不变量：
  - [x] `setNewThreadDraftCwd` 是唯一写入 `draftCwd` 的 action。
  - [x] `selectCwd` / folder row click 只允许写 `selectedCwd`，不得写 `draftCwd`。
  - [x] `useThreadSelection()` fallback 只能修正 `selectedCwd`，不得参与 draft path 初始化。
  - [x] draft 首发请求的 cwd 来自 `draftCwd` / created thread effective cwd，不得回退到普通 active-thread `resolveRequestCwd(activeThreadId)` 逻辑。
- [x] 补 draft 下 command routing 边界，至少覆盖：
  - [x] draft active + `/clear` 不得调用普通 `startThread()`。
  - [x] draft active + supported slash command：只有已选 `draftCwd` 时才先 `thread/start` 再 `command/dispatch`。
  - [x] draft active + unsupported slash command：只显示 unsupported 提示，不创建 thread。
- [x] 明确 draft 生命周期退出规则：
  - [x] `selectThread(threadId)` 必须退出 draft 并进入真实 thread。
  - [x] 再次点击左侧 `新建线程` 必须重置为 fresh draft，`draftCwd = null`。
  - [x] folder quick action 重新进入 draft，并预填该 folder 的 `draftCwd`。
  - [x] 一旦 `thread/start` 成功，draft 立即结束；即使后续首发失败，也已经进入真实 thread surface。
- [x] v1 中 `draftCwd` 不参与 right diff cwd 解析；选择 draft path 不自动刷新右栏 diff，只有真实 thread 激活后才刷新。

## 3. Frontend Boundary

### 3.1 Left rail
- [x] 左侧 `新建线程` 改为进入 draft，不立即创建 thread。
- [x] folder quick action 改为进入 draft 并预填该 folder 的 cwd。
- [x] 普通 folder row 点击保持现有分组/导航行为，不写入 `draftCwd`。

### 3.2 Draft surface
- [x] 在 `TranscriptPane` 层显式切换 `welcome | thread | newThreadDraft`，不要继续让 `TranscriptFeed` 从 `!activeThreadId` 推断 draft。
- [x] 新增或抽出 `NewThreadDraftSurface`，承载居中的 `ComposerDock`、path selector、必选提示与空态文案。
- [x] selector 数据源使用现有项目列表，并提供 `添加新项目` 入口。

### 3.3 Composer
- [x] 给 `ComposerDock` 增加显式 `canSubmit` / `isInputDisabled` / `layoutVariant` 等 props。
- [x] draft 下未选 path 时禁用输入或至少禁用提交；具体交互保持一处定义，不要在 Enter 和按钮层分叉出两套规则。
- [x] 普通真实 thread 下继续保持现有底部 composer 布局与行为。

### 3.4 Add project
- [x] v1 决策：左侧 `添加项目` 不再直接 native picker + `onStartThreadInCwd`。
- [x] 左侧 `添加项目` 只进入 `newThreadDraft`，`source = 'addProject'`，不预选 cwd，不创建 thread。
- [x] native picker 只挂在中间 draft selector 的 `添加新项目` 选项下。
- [x] picker 成功后只写 `draftCwd`，不写 `selectedCwd`，不创建 thread。

## 4. Tests
- [x] 更新 `LeftRail.test.tsx`：`新建线程` 与 folder quick action 进入 draft，而不是立即 start thread。
- [x] 更新 `composerActions.test.ts`：覆盖 draft 未选 path 禁止发送、draft 首发先 `thread/start` 再 `turn/start`/`command/dispatch`、失败恢复边界，以及 `/clear` / supported slash command / unsupported slash command 的 draft 分支。
- [x] 更新 `TranscriptPane.test.tsx`：覆盖 `surfaceKind` 分支、draft 居中 composer、welcome 与 draft 分离。
- [x] 更新 `app-composer.integration.test.tsx`：把旧的“点击新建线程立即创建”行为替换为“选择 path 后首发才创建”。
- [x] 视改动面补充 `useRuntimeViewState.test.tsx` 与 `useThreadUrlSync.test.tsx`，锁住 draft state 与 URL thread-only 语义。
- [x] 补 leaving-draft 相关覆盖：draft -> 选择真实 thread、draft -> 再点 `新建线程`、draft -> folder quick action 重进、draft 首发失败后进入真实 thread 边界。
- [x] 明确 right diff 不跟随 `draftCwd` 刷新的测试覆盖。
- [x] 只跑与本次改动直接相关的 targeted tests，不扩大到无关全量验证。

## 5. Recommended Execution Order

### Loop 1
- [x] 固化 runtime 语义：`newThreadDraft` 作为唯一可写 draft 状态，`surfaceKind` 作为派生 surface。
- [x] 拆分 draft 首发 helper：server create helper 与 activation helper，禁止直接复用旧的 `startThreadWithCwd` 事务。
- [x] 改 `composerActions`，补 draft 首发、slash command 与 `/clear` 分支。
- [x] 先补/改 runtime 单测：`composerActions.test.ts`、必要的 `useRuntimeViewState.test.tsx`、必要的 `useThreadUrlSync.test.tsx`。
- [x] 跑本 loop 的 targeted verification。
- [x] run `codex review` for this loop after targeted verification passes.

### Loop 2
- [x] 改左侧入口与主区切换：`新建线程`、folder quick action、`TranscriptPane` 的 surface 分流。
- [x] 落地 `NewThreadDraftSurface`、path selector 与居中的 `ComposerDock`。
- [x] 让 `ComposerDock` 的 Enter 与发送按钮只消费显式提交资格，而不是 `activeThreadId` gate。
- [x] 更新 `LeftRail.test.tsx`、`TranscriptPane.test.tsx`。
- [x] 跑本 loop 的 targeted verification。
- [x] run `codex review` for this loop after targeted verification passes.

### Loop 3
- [x] 落实 `添加项目` 的 v1 语义：左侧入口只进入 draft，picker 只挂在中间 selector。
- [x] 加固 integration tests，至少覆盖“未选 path 不创建 thread”“首发才创建 thread”“离开 draft 不留空 thread”“folder row 不参与 draft path 选择”。
- [x] 跑本 loop 的 targeted verification。
- [x] run `codex review` for this loop after targeted verification passes.

### Loop 4
- [x] 补 canonical docs：至少审视并在必要时更新 `docs/frontend/app-server-ui-spec.md`，必要时补 `docs/contracts/web-parity-adapter-contract.md`。
- [x] 如果新增 `NewThreadDraftSurface`、draft actions 或 create helper 成为稳定入口，更新 `packages/web-reference-react/CODEMAP.md`。
- [x] 完成 targeted verification 与手动 GUI spot-check，确认 welcome / draft / thread 三态没有重新混叠。
- [x] 跑本 loop 的 targeted verification。
- [x] run `codex review` for this loop after targeted verification passes.
