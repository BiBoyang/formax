# TODO：Formax App Server（单一清单）

更新时间：2026-02-12

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
  - `command/dispatch`（当前覆盖 `/init`、`/compact`、`/todos`）
- [x] Web 命令侧当前闭环：
  - `/init`：走 `command/dispatch`
  - `/clear`：本地处理（新建线程）
  - `/compact`：走 `command/dispatch`，后端执行 compact 语义并持久化压缩后的 history
  - `/todos`：走 `command/dispatch` 本地输出（非模型提问）
- [x] 4 命令闭环回归用例已覆盖（web + app-server）
  - 证据：`apps/web-reference-react/src/App.test.tsx`、`src/app-server/server.test.ts`、`apps/web-reference-react/e2e/slash-command-routing.spec.js`

## 当前待办（唯一主线）

- [ ] commander 能力增量扩展（超出 `/init`、`/clear`、`/compact`、`/todos`）
  - 只接入非配置类且产品确认要上 Web 的命令
  - 每接入一个命令：语义层 + app-server + Web + 测试同 PR 落地
- [ ] Web 启动链路标准化（network + security + serve）
  - [x] Phase A：抽离共享 `network/security` 运行时模块（host/port、origin/cors、token、URL 校验）
  - [ ] Phase B：新增 `formax serve`（后端服务标准入口，支持可观测日志与稳定退出）
  - [ ] Phase C：`formax web` 复用 `serve` 能力（`web` 仅负责启动 UI + 连接 URL）
  - [ ] 文档与测试同步：README、CLI help、关键集成测试（成功启动/鉴权失败/非法参数）

## 暂不推进（保持边界）

- [ ] 配置类命令（如 `/agents`、`/hooks`、`/permissions`）默认不接入 Web
