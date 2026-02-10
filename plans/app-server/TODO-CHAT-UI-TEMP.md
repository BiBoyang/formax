# Chat UI 临时收敛 TODO（仅未完成项）

> 范围：`apps/web-reference-react` 聊天区与交互稳定性。  
> 原则：只保留未完成任务，已完成项从本文件移除（可从 commit 历史追溯）。

## A. 聊天体验完善

- [ ] 回合结束锚点样式（轻量 turn footer/badge）
  - 验收：每轮结束仅出现 1 条轻量状态锚点，不再出现冗余完成日志文本。

- [ ] thinking 组件化（运行中 shimmer + 结束后折叠摘要）
  - 验收：进行中可见“thinking”状态；完成后收敛为单条摘要，不占多行。

- [ ] nested scroll 边界手势治理
  - 验收：中栏/右栏滚动互不抢占，仅在边界时交给外层。

## B. 函数/组件级拆解

### B1. Turn Footer

- [ ] `apps/web-reference-react/src/types.ts`：补 `turn-end` 展示模型。
- [ ] `apps/web-reference-react/src/store.ts`：`turn/completed` 只写一次 turn footer 事件。
- [ ] `apps/web-reference-react/src/App.tsx`：移除冗余 completed/info 文本注入。
- [ ] `apps/web-reference-react/src/components/TranscriptPane.tsx`：渲染轻量 turn footer。
- [ ] `apps/web-reference-react/src/components/TranscriptPane.test.tsx`：断言“同一 turn 仅一个 footer”。

### B2. Thinking 收敛

- [ ] `apps/web-reference-react/src/store.ts`：聚合 `thinking_delta` 为 turn 级状态。
- [ ] `apps/web-reference-react/src/components/TranscriptPane.tsx`：thinking 可折叠并区分 running/finalized。
- [ ] `apps/web-reference-react/src/css/theme.css`：补 thinking 动效 token。
- [ ] `apps/web-reference-react/src/components/TranscriptPane.test.tsx`：覆盖 completed 后折叠行为。

### B3. Scroll 边界

- [ ] `apps/web-reference-react/src/components/TranscriptPane.tsx`：增加 wheel 边界处理。
- [ ] `apps/web-reference-react/src/components/PendingInputPane.tsx`：右栏同样的边界策略。
- [ ] `apps/web-reference-react/src/components/ui/scroll-area.tsx`（如需）：提取复用 hook。
- [ ] `apps/web-reference-react/src/components/TranscriptPane.test.tsx`：补 wheel 边界测试。
- [ ] Playwright 场景：中栏滚到底后继续滚轮，右栏/外层不异常抖动。

## C. WebGPT-response-1 无悔改动队列（P0）

- [ ] 客户端事件归一最小层：基于 `traceId + seq` 去重/乱序保护。
  - 验收：重复/回退通知不重复渲染。

- [ ] `delta` 小批量合并（节流写入）降低高频流式卡顿。
  - 验收：高频流下输入与滚动保持可操作。

- [ ] 接入 `thread/resume` 恢复链路（连接后/切线程时），回填 `staleInputs`。
  - 验收：刷新后不丢 approval/question 上下文。

- [ ] 统一 input submit 结果可见性（accepted/conflict/expired/not_pending）。
  - 验收：所有状态有明确 UI 文案与操作指引。

- [ ] 关键系统事件可观测性收敛（默认降噪、失败可追踪）。
  - 验收：默认不刷屏；排障链路可追踪。

## D. 等 Extended 评审后再做

- [ ] 语义抽象层最终拆分（TurnInputBuilder / ModeSemantics / InputStateMachine / ToolEventNormalizer）。
- [ ] 协议层新增方法/字段（如 replay、command/dispatch）。
- [ ] commander 全量能力扩展（超出 `/init` 的最终形态）。
