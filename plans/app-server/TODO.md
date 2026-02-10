# TODO：Formax App Server（单一清单）

更新时间：2026-02-11

> 本文件是 `plans/app-server/` 下唯一 TODO。  
> 原 `TODO-SEMANTICS-PARITY.md` 与 `TODO-CHAT-UI-TEMP.md` 已合并到这里。

## 当前基线（已完成）

- [x] TUI/GUI 语义一致性主线（Phase 1-7）已落地：
  - 统一 turn 输入构建与 mode 注入（`TurnInputBuilder`）
  - 统一 slash 路由语义（共享 `commandRouting`）
  - 统一 input 生命周期状态机（approval + ask_user_question）
  - 工具事件归一与事件光标治理
  - 契约测试与文档索引补齐
- [x] app-server 协议扩展：
  - `thread/replay`
  - `command/dispatch`（当前覆盖 `/init`、`/todos`）
- [x] Web 命令侧当前闭环：
  - `/init`：走 `command/dispatch`
  - `/clear`：本地处理（新建线程）
  - `/compact`：Web 侧明确提示暂不支持（不落模型）
  - `/todos`：走 `command/dispatch` 本地输出（非模型提问）
- [x] 4 命令闭环回归用例已覆盖（web + app-server）
  - 证据：`apps/web-reference-react/src/App.test.tsx`、`src/app-server/server.test.ts`

## 当前待办（唯一主线）

- [ ] commander 能力增量扩展（超出 `/init`、`/clear`、`/compact`、`/todos`）
  - 只接入非配置类且产品确认要上 Web 的命令
  - 每接入一个命令：语义层 + app-server + Web + 测试同 PR 落地

## 暂不推进（保持边界）

- [ ] 配置类命令（如 `/agents`、`/hooks`、`/permissions`）默认不接入 Web
- [ ] `/compact` 真正语义执行（目前仅提示不支持）
