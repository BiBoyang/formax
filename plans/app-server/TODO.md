# TODO：Formax App Server（仅未完成项）

更新时间：2026-02-10

> 已完成项已移除以降低噪音，历史可从 git 提交记录追溯。

## 当前主线（执行中）

- [ ] Web 客户端事件归一最小层（`traceId + seq` 去重/乱序保护）
  - 目标：避免重复通知与乱序通知污染 transcript。
  - 主要文件：`apps/web-reference-react/src/App.tsx`、`apps/web-reference-react/src/store.ts`。

- [ ] Web 客户端高频 delta 合并（节流写入）
  - 目标：降低 `assistant_delta/thinking_delta` 高频渲染卡顿。
  - 主要文件：`apps/web-reference-react/src/App.tsx`、`apps/web-reference-react/src/components/TranscriptPane.tsx`。

- [ ] `thread/resume` 恢复闭环（刷新/重连后 stale input 恢复）
  - 目标：approval / ask_user_question 不因刷新丢失上下文。
  - 主要文件：`apps/web-reference-react/src/App.tsx`、`src/app-server/server.ts`。

- [ ] input submit 全状态可见化（accepted/conflict/expired/not_pending）
  - 目标：用户能直接理解提交结果与下一步动作。
  - 主要文件：`apps/web-reference-react/src/components/PendingInputPane.tsx`、`apps/web-reference-react/src/App.tsx`。

- [ ] 聊天区 turn footer 与 thinking 收敛
  - 目标：减少冗余系统噪音，保留关键进度信息。
  - 主要文件：`apps/web-reference-react/src/types.ts`、`apps/web-reference-react/src/store.ts`、`apps/web-reference-react/src/components/TranscriptPane.tsx`。

- [ ] nested scroll 边界手势治理（中栏/右栏）
  - 目标：滚动稳定，不抢焦点。
  - 主要文件：`apps/web-reference-react/src/components/TranscriptPane.tsx`、`apps/web-reference-react/src/components/PendingInputPane.tsx`。

## 等 Extended 评审后再定（暂不实现）

- [ ] TUI/GUI 语义抽象层最终边界（TurnInputBuilder / ModeSemantics / InputStateMachine / ToolEventNormalizer）。
- [ ] 协议扩展项（如 replay、command/dispatch）。
- [ ] commander 全量能力扩展（超出 `/init` 的最终形态）。
