# 测试覆盖率提升 TODO（Vitest）

> 基线（2026-01-27，本机 `npm test -- --coverage`）：
> - Statements: 73.01% (8041 / 11013)
> - Branches: 59.76% (5433 / 9091)
> - Functions: 78.81% (1395 / 1770)

## 环境/配置（可选，但建议）

- [ ] 添加覆盖率门槛：先从 **关键模块** 做 file-level threshold（例如 approvals/policy/handlers），避免“一刀切”导致 CI 噪音
- [ ] 补充 `coverage` include/exclude：确保把纯 demo/示例屏幕与脚手架产物排除在门槛之外（例如 ToolExamplesScreen 这类）

## P0（安全/权限/交互：高优先级）

### 2) 审批主逻辑：`src/tools/executor/approvalService.ts`

- [ ] 扩展 `src/tools/executor/approvalService.test.ts`
  - [ ] signal aborted：返回 “Request aborted”
  - [ ] decision=approve：直接放行（并验证 audit 事件写入：prompt/result）
  - [ ] decision=approve_remember：
    - [ ] `fs.write`：进入 `acceptEdits`（不持久化 policy rules）
    - [ ] `bash.exec` + tool `Bash`：写入 repo-local allow（`persistProjectPermissionAllow`）
    - [ ] scope=session：写入 sessionRules（并确保后续 `getSessionRules` 可读到）
    - [ ] scope=project/global：调用 `savePolicyRules`，且去重逻辑（按 match+decision）
  - [ ] decision=feedback：空 feedback => cancel；非空 => 返回带 user message 的 reject 内容
  - [ ] decision=cancel/unknown：返回默认 reject 内容
  - [ ] persist 失败：返回 “Failed to save …” 的 error result

### 3) 交互提示组件：`src/tools/presenters/skillApprovalPrompt.tsx`

- [ ] 新增 `src/tools/presenters/skillApprovalPrompt.test.tsx`（`ink-testing-library`）
  - [ ] 选择 Yes / Remember / Feedback / Esc 时 `onDecision` 映射正确
  - [ ] Feedback：输入内容会 trim；空输入不应该提交（或按现状锁定）

## P1（Plan Mode：交互链路 + presenter/handler）

### 4) EnterPlanMode handler：`src/tools/modules/enterPlanMode/handler.ts`

- [ ] 新增 `src/tools/modules/enterPlanMode/handler.test.ts`
  - [ ] `agentDepth > 0`：返回交互禁用错误
  - [ ] 已在 plan 模式：返回 “Already in plan mode.”
  - [ ] choice=enter：`ctx.setReplMode('plan')` + 文案包含 “Entered plan mode”
  - [ ] choice=skip/其它：返回 “User declined …”
  - [ ] requestAnswers 抛错：返回 `Error: <msg>`

### 5) EnterPlanMode presenter：`src/tools/modules/enterPlanMode/presenter.tsx`

- [ ] 新增 `src/tools/modules/enterPlanMode/presenter.test.tsx`
  - [ ] status=running 且无 userInput：显示 “Preparing…”
  - [ ] status=running：↑↓/1/2/Enter 选择；Esc => skip；提交后不再响应二次输入
  - [ ] status=error 且 result 包含 “Request aborted”：返回 null（不渲染）
  - [ ] status=completed：entered/skip 两种渲染分支

### 6) Plan session 文件管理：`src/features/repl/planSession.ts`

- [ ] 新增 `src/features/repl/planSession.test.ts`
  - [ ] `startNewPlan()` 会创建文件（空文件也可）并更新 `getPlanPath()`
  - [ ] slug 冲突：模拟 `fileExists` 返回 true，最终走 fallback `plan-${Date.now()}.md`
  - [ ] 目录不可写/创建失败：确保不会 throw（按当前实现“忽略错误”锁定）

## P2（REPL 交互：快捷键/面板/覆盖 UI 分支）

### 7) Hotkeys：`src/screens/repl/hotkeys.ts`

- [ ] 扩展 `src/screens/repl/hotkeys.test.tsx`（建议用现有 REPL 测试模式/上下文）
  - [ ] `ctrl+o`：
    - [ ] promptMode/overlay 打开时应被拦截
    - [ ] loading + thinkingText 时 toggle thinking
    - [ ] 已打开 detailed transcript / explore panel 时关闭
    - [ ] 满足 Explore finished 末条消息 + contiguous group 条件时打开 explore panel
    - [ ] 否则：找到最近 Task transcript 并打开 detailed transcript
  - [ ] `escape`：调用 `actions.abort()`（promptMode/overlay 打开时应被拦截）
  - [ ] `shift+tab`：切换 mode；进入 plan 时触发 `ensurePlanPath()`

### 8) Panels：`src/screens/repl/panels.tsx`

- [ ] 新增 `src/screens/repl/panels.test.tsx`
  - [ ] `ExploreAgentsPanel`：tasks=null/空 => “No Explore details…”
  - [ ] map 渲染：最后一项/非最后一项 branch/pipe 字符正确
  - [ ] toolUses/tokens 组合文案（0 tokens 不显示 tokens）
  - [ ] `getTaskShortLabel`：优先 description，其次 prompt，否则 “Task”
  - [ ] `formatTaskPanelTitle`：非 Task/非 tool => “Task”；subagent_type=code-reviewer => “Reviewer”
  - [ ] `DetailedTranscriptPanel`：title 有无；空行渲染；无 lines 时 “No detailed transcript…”

### 9) Mode 相关：`src/features/repl/mode.ts` + `src/components/chat/ModeIndicator.tsx`

- [ ] `src/features/repl/mode.test.ts`：`nextReplMode()` 循环与默认分支
- [ ] `src/components/chat/ModeIndicator.test.tsx`：三种 mode 的 icon/label/颜色（至少锁定 icon+label+“shift+tab to cycle”）

## P3（网络/执行器：稳定性与复杂分支）

### 10) Streaming client：`src/streaming/anthropic/StreamClient.ts`

- [ ] 新增 `src/streaming/anthropic/StreamClient.test.ts`
  - [ ] `sortToolResultsByCallOrder()`：缺失 tool_use_id => 注入 error；extras 追加在末尾
  - [ ] `streamOnce()`：
    - [ ] response 非 ok / 无 body => throw
    - [ ] tool 执行成功/抛错 => tool_end 正确发出
    - [ ] aborted => 返回 “Request aborted” toolResult
    - [ ] usage 事件透传；pending tool promise 都会 await
  - 实现建议：mock `fetch()` + mock `parseAnthropicSSEStream()`（直接驱动 callbacks，不必真的构造 SSE）

### 12) Diagnostics 打包：`src/adapters/diagnostics/nodeArchive.ts`

- [ ] 新增 `src/adapters/diagnostics/nodeArchive.test.ts`
  - [ ] 参数缺失：抛 “Missing …”
  - [ ] spawn error / exit code != 0 / signal：reject 错误信息包含 code/signal
  - [ ] 成功：resolve
  - 实现建议：mock `node:child_process` 的 `spawn`

## P4（AgentsDialog：补齐未覆盖分支，保持 UI 文案/键位不变）

> 现状：`src/ui/agents/AgentsDialog.tsx` 仍有大量未覆盖分支（特别是 create flow、advanced tools、磁盘 agents 合并/去重、失败分支）。

- [ ] 扩展 `src/ui/agents/AgentsDialog.test.tsx` / 新增分文件测试：
  - [ ] disk user/project agents 读取后：分组、优先级、去重（project 覆盖 user）、builtin model 显示
  - [ ] create flow：Generate with Claude / Manual 两条路径都覆盖
  - [ ] advanced tools：toggle、group 全选/取消、NON_SELECTABLE_TOOLS 不出现
  - [ ] 保存失败/生成失败：错误提示与返回路径（Esc/Back）稳定
  - [ ] openInEditor 行为与 createdAgents 记录

## P5（CLI：补齐长尾分支）

- [ ] 扩展 `src/cli/main.test.ts`：
  - [ ] `setup` 子命令（成功/失败/usage）
  - [ ] `config migrate`（不同文件存在/缺失、json/human 输出）
  - [ ] `auth`/`config` 未知子命令走 usage
  - [ ] policy disable/delete 的更多边界：ruleId 不存在/仅存在于 project 或 global

## 验收（建议）

- [ ] P0 完成后：至少保证 approvals/policy/plan mode 相关文件达到 **>90% statements** 且分支覆盖有明显提升
- [ ] 每做完一个模块：跑一次单文件 coverage + 全量 coverage，确认没有把 UI 文案/交互键位改掉

## 常用命令（备忘）

- 全量覆盖率：`npm run test:coverage`（或 `bun run test:coverage`）
- 单文件覆盖率：`npx vitest run --coverage src/ui/permissions/PermissionsDialog.test.tsx`
- HTML 报告：`coverage/index.html`
