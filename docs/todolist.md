# Web Draft Ownership Leakage Todo

## 0. Context and Boundary

### 0.1 Confirmed facts
- [x] 当前 `packages/web-reference-react` 已经把无 active thread 的默认主入口切到 `newThreadDraft`，中栏 composer 居中。
- [x] 当前问题已不再是 isolated right-rail bug，而是一组 `newThreadDraft` ownership 没切干净的问题。
- [x] `newThreadDraft` 下右栏仍可能显示旧 `diffSnapshot`，说明 right rail 仍按 workspace-like 生命周期存活。
- [x] `newThreadDraft` 下 header workspace label 会泄漏旧 `selectedCwd`，例如显示 `tmp`。
- [x] `newThreadDraft` 下 header 的 open-folder action 仍可能绑定旧 `selectedCwd`。
- [x] `useAppRuntime.ts` 当前仍可能把 `selectedCwdRef.current` 和 `diffSnapshot.cwd` 参与 draft fallback cwd 推断。
- [x] `selectedCwd` 不是 `draftCwd`，`diffSnapshot.cwd` 更不是 `draftCwd`。
- [x] 用户已经明确确认：右侧内容必须严格跟随真实 thread；当前没有选中 thread 时右栏必须是空白页。
- [x] 用户已经明确确认：`welcome` 先保留，但不再承担“无线程默认入口”的职责。

### 0.2 Goals
- [x] 把 `newThreadDraft` 从“只改对中栏”收敛成“整页 ownership 一致”的状态。
- [x] 让 right rail 成为严格的 thread-only surface：无真实 thread 时一律空白。
- [x] 让 header 在 draft 下改读 `draftCwd`，未选项目时不再显示旧 workspace label。
- [x] 让 header 的 open-folder action 在 draft 下与 `draftCwd` 保持一致，未选项目时不可用。
- [x] 切断 `selectedCwd` / `diffSnapshot.cwd` 对 draft fallback 的污染。
- [x] 用测试锁住 thread-owned / draft-owned / workspace-selection-only 三类 owner 边界。

### 0.3 Non-goals
- [x] 本任务不改 app-server 协议。
- [x] 本任务不新增 fake empty thread，也不允许“假装已有 thread”来维持右栏内容。
- [x] 本任务不顺手做 unrelated desktop、project management、terminal redesign。
- [x] 本任务不要求现在物理删除 `welcome` 状态定义；只要求它退出默认入口职责。
- [x] 本任务不把 `selectedCwd` 整体删除；它仍可作为 workspace selection only 状态存在。

## 1. Definitions First

### 1.1 Canonical docs
- [x] 更新 `docs/frontend/app-server-ui-spec.md`，把右栏从 “workspace diff” 收敛为 thread-only surface。
- [x] 在 `docs/frontend/app-server-ui-spec.md` 中补充 header 在 `newThreadDraft` 下的 workspace label / open-folder 语义。
- [x] 审视 `docs/contracts/web-parity-adapter-contract.md`，确认 `newThreadDraft` 作为 transient surface 不再泄漏旧 thread/workspace owner。
- [x] 判断是否需要为 `thread-owned / draft-owned / workspace selection only` 增补短的 canonical 说明；如不需要新文档，则在现有 docs 中落清边界。

### 1.2 Ownership model
- [x] 明确定义 `thread-owned` 状态集合：
  - [x] `activeThreadId`
  - [x] `activeThread.cwd`
  - [x] `diffSnapshot`
  - [x] `activeThreadLatestRequestCollapse`
  - [x] `activeThreadLatestCompactBoundary`
  - [x] `activeContextMeter` / visible context meter chrome
  - [x] `activeTurnId` / interrupt / active-turn header controls
  - [x] `selectedInput` / approval dock / `composerLocked`
  - [x] terminal pane visibility only as ownership leakage audit, not redesign
- [x] 明确定义 `draft-owned` 状态集合：
  - [x] `newThreadDraft.status`
  - [x] `newThreadDraft.source`
  - [x] `draftCwd`
  - [x] draft selector / draft send eligibility
- [x] 明确定义 `workspace selection only` 状态集合：
  - [x] `selectedCwd`
  - [x] 左栏 group selection / highlight
  - [x] 其他仅服务 workspace navigation 的状态
- [x] 把 “谁可以读 `selectedCwd`、谁绝对不能读 `selectedCwd`” 写成可执行规则。
- [x] 把 `selectedCwd` 的 allowed readers 写死：
  - [x] left rail group selection / highlight
  - [x] workspace navigation only
  - [x] not header label
  - [x] not header folder action
  - [x] not draft fallback
  - [x] not diff resolver
- [x] 把 “谁可以读 `draftCwd`、谁绝对不能从旧 `diffSnapshot` 派生 `draftCwd`” 写成可执行规则。

### 1.3 View-model boundaries
- [x] 在 `AppShell` 层定义明确的派生 gate：
  - [x] `isThreadSurface`
  - [x] `isDraftSurface`
  - [x] `headerWorkspaceCwd`
  - [x] `headerOpenFolderCwd`
  - [x] `showThreadRightRail`
- [x] 把 `isThreadSurface` 的公式写死：
  - [x] `visibleSurface === 'thread' && activeThreadId != null`
- [x] 把 `headerWorkspaceCwd` 的公式写死：
  - [x] `thread surface -> activeThread.cwd ?? null`
  - [x] `draft surface -> draftCwd`
  - [x] `otherwise -> null`
- [x] 决定 `activeWorkspaceLabel` 在 `newThreadDraft` 下的正确语义：
  - [x] 有 `draftCwd` 时显示 `folderNameFromCwd(draftCwd)`
  - [x] `draftCwd == null` 时为空，不显示旧 `selectedCwd`
- [x] 决定 header open-folder action 在 `newThreadDraft` 下的正确语义：
  - [x] 跟随 `draftCwd`
  - [x] `draftCwd == null` 时隐藏或 disabled
- [x] `AppShellHeader` MUST NOT 再接收名为 `selectedCwd` 的 prop。
- [x] 给 header 传入的 folder action target 改成显式命名：
  - [x] `headerOpenFolderCwd`
  - [x] 或 `openFolderCwd`
- [x] thread header chrome 在 `!isThreadSurface` 时必须隐藏：
  - [x] compact boundary
  - [x] context meter
  - [x] request collapse / active-turn 相关 chrome

## 2. Runtime / Platform

### 2.1 Thread-only state cleanup
- [ ] 在 `useAppRuntime.ts` 引入显式 `clearThreadOnlySurfaceState` helper。
- [ ] `enterNewThreadDraft(...)` 时清空 thread-only right-rail state，而不只是清 transcript / active thread。
- [ ] 当 `visibleSurface !== 'thread'` 时，保持 thread-only side state 为空的 runtime 不变量。
- [ ] 处理 archive 最后一个 thread、URL thread 无效、默认启动无 thread 等 no-thread 入口，让它们统一走 thread-only state cleanup。

### 2.2 Draft fallback boundary
- [ ] 把 `resolveWorkspaceDraftFallbackCwd` 改名并收窄为 `resolveDraftFallbackCwd`。
- [ ] 删除 `selectedCwdRef.current` 参与 draft fallback 的路径。
- [ ] 删除 `diffSnapshot.cwd` 参与 draft fallback 的路径。
- [ ] 明确 draft fallback 只允许来自：
  - [ ] 显式 requested cwd
  - [ ] folder quick action cwd
  - [ ] draft selector / add-project 结果
  - [ ] 其他已明确确认的 draft-owned 来源

### 2.3 Diff runtime ownership
- [ ] 检查 `createDiffDataOps` 的 cwd resolver，确保无 active thread 时不再 fallback 到 `selectedCwdRef.current`。
- [ ] 让 diff refresh / patch request 的 runtime 语义只在真实 thread 存在时生效。
- [ ] 对 late diff result 加 active-thread guard，避免 stale snapshot 在切回 draft 后重新写入。
- [ ] diff snapshot write MUST 校验：
  - [ ] 当前仍存在 active thread
  - [ ] 返回的 cwd 与当前 active thread cwd 匹配
  - [ ] 否则直接丢弃结果
- [ ] `clearThreadOnlySurfaceState` MUST 清理：
  - [ ] `diffSnapshot`
  - [ ] `isRefreshingDiff`
  - [ ] pending / stale diff writeback path
- [ ] no active thread => no diff refresh request and no patch request

## 3. Frontend Boundary

### 3.1 AppShell ownership
- [ ] 在 `AppShell.tsx` 集中派生 header 和 right rail 的 owner gate，不把 ownership 判断散落到各组件。
- [ ] 让 header label 在 `thread` / `newThreadDraft` / no-thread 三种 surface 下读对来源。
- [ ] 不再把裸 `selectedCwd` 直接作为 header folder action 的输入。
- [ ] right rail 在非 `thread` surface 下渲染空白态，而不是继续挂载 thread-only 内容。
- [ ] `activeThreadLatestRequestCollapse` 在 draft / no-thread 下不得残留显示。

### 3.2 Header
- [ ] 更新 `AppShellHeader.tsx` props，使 workspace label 可表达 “无值 / 不显示”。
- [ ] 更新 `AppShellHeader.tsx` props，使 folder action 可表达 “无合法 cwd / 不可点”。
- [ ] 确认 header 不会在 `newThreadDraft` 下再显示旧目录名，例如 `tmp`。

### 3.3 Right rail
- [ ] 保持 `WorktreeDiffPane` 作为 dumb renderer，不让它承担 draft/thread owner 判断。
- [ ] 在 `AppShell` 层决定是否挂载 `WorktreeDiffPane`。
- [ ] 非 thread surface 下不显示 right rail diff rows、changes count、refresh 按钮、collapse summary。

### 3.4 Left rail and workspace selection
- [ ] 核对左栏在 draft 下继续隐藏 `selectedCwd` 选中态是否仍符合当前 ownership 模型。
- [ ] 确认左栏 folder row / group selection 继续只影响 workspace selection，不反向污染 draft-owned header / right rail。

## 4. Tests

### 4.1 Runtime tests
- [ ] 扩展 `threadArchiving.test.ts`：
  - [ ] archive 最后一个 thread 后断言 `diffSnapshot === null`
  - [ ] 断言 thread-only chrome 不再残留
- [ ] 扩展 `urlSync.test.ts`：
  - [ ] invalid thread URL 回退到 draft 时断言 `diffSnapshot === null`
  - [ ] 断言 draft cwd 不来自旧 `diffSnapshot.cwd`
- [ ] 补从真实 thread 进入 draft 的 runtime 测试：
  - [ ] 旧 `selectedCwd` 不再泄漏为 draft label / draft cwd
  - [ ] 旧 `diffSnapshot` 被清空

### 4.2 UI tests
- [ ] 新增或扩展 `AppShell` / `AppShellHeader` render tests：
  - [ ] `visibleSurface='newThreadDraft'`、`activeThreadId=null`、`selectedCwd='/tmp'`、`draftCwd=null` 时 header 不显示 `tmp`
  - [ ] 同场景下 header open-folder action 不存在或 disabled
  - [ ] 同场景下 right rail 不挂载 `WorktreeDiffPane`
  - [ ] 同场景下不显示 `latestRequestCollapse`
  - [ ] 同场景下不显示 `activeThreadLatestCompactBoundary`
  - [ ] 同场景下不显示旧 `activeContextMeter`
- [ ] 增加 `draftCwd='/repo-draft'` 的 header 测试：
  - [ ] label 显示 `repo-draft`
  - [ ] open-folder action 使用 `/repo-draft`
  - [ ] 不再显示旧 `selectedCwd`
- [ ] 增加 “draft surface 优先于残留 thread state” 的 render 测试：
  - [ ] 即使存在 stale `activeThread` / `diffSnapshot` / thread chrome 数据，只要 `visibleSurface='newThreadDraft'`，整页仍表现为 draft-owned header + empty right rail

### 4.3 Integration / behavior tests
- [ ] 覆盖默认启动无 thread 的整页行为：
  - [ ] 中栏 draft
  - [ ] header 空或跟 `draftCwd`
  - [ ] right rail 空白
- [ ] 覆盖点击 `New Thread` 从真实 thread 进入 draft 的整页行为。
- [ ] 覆盖 draft 下已选项目 vs 未选项目两种状态的 header / right rail 差异。
- [ ] 覆盖 draft 下点击 open-folder：
  - [ ] `draftCwd=null` 时不调用 open
  - [ ] `draftCwd='/repo-draft'` 时只能打开 `/repo-draft`
- [ ] 覆盖 runtime 行为：
  - [ ] no active thread 不触发 diff refresh
  - [ ] 进入 draft 后晚返回的旧 diff 结果不得重新填充 `diffSnapshot`
- [ ] 覆盖 draft / no-thread 下 thread-only chrome 全部为空：
  - [ ] no compact boundary
  - [ ] no old context meter
  - [ ] no old approval dock
  - [ ] no old terminal pane leakage

## 5. Recommended Execution Order

### Loop 1
- [x] 收敛 ownership 定义：thread-owned / draft-owned / workspace selection only。
- [x] 更新 `docs/frontend/app-server-ui-spec.md` 中 right rail 与 header 语义，先把规范写对。
- [x] 在 todo 中固化 `headerWorkspaceCwd`、`headerOpenFolderCwd`、`showThreadRightRail` 的派生边界。
- [x] 跑本 loop 的 targeted verification（仅文档/类型相关检查如果需要）。
- [x] run `codex review` for this loop after targeted verification passes.

### Loop 2
- [ ] 先补/改 runtime ownership tests，而不是改完再补。
- [ ] 改 `useAppRuntime.ts`：
  - [ ] 清 thread-only side state
  - [ ] 切断 `selectedCwd` / `diffSnapshot.cwd` 对 draft fallback 的污染
  - [ ] 禁止 no-thread diff refresh
- [ ] 实现 late diff guard，确保 stale diff result 不会在 draft / no-thread 下重新写回。
- [ ] 补/改 runtime tests：`threadArchiving.test.ts`、`urlSync.test.ts`、必要的 runtime coverage。
- [ ] 跑本 loop 的 targeted verification。
- [ ] run `codex review` for this loop after targeted verification passes.

### Loop 3
- [ ] 改 `AppShell.tsx` / `AppShellHeader.tsx`：
  - [ ] header label 改读正确 owner
  - [ ] header folder action 改读正确 owner
  - [ ] right rail 改成 thread-only render gate
- [ ] 补 UI/render tests，锁住 `tmp` 泄漏、right rail 泄漏、collapse summary 泄漏。
- [ ] 跑本 loop 的 targeted verification。
- [ ] run `codex review` for this loop after targeted verification passes.

### Loop 4
- [ ] 做整页 integration 验证：
  - [ ] 默认启动无 thread
  - [ ] 点击 `New Thread`
  - [ ] URL thread 无效
  - [ ] archive 最后一个 thread
  - [ ] 从真实 thread 进入 draft
- [ ] 更新必要的 package-local docs / CODEMAP，如果 owner 边界或稳定入口已发生迁移。
- [ ] 跑本 loop 的 targeted verification。
- [ ] run `codex review` for this loop after targeted verification passes.
