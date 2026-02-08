# Formax App Server Product Spec（MVP + 下一阶段）

更新时间：2026-02-09

## 1. 文档目的

这份文档定义 app-server 方向的产品级目标与边界，作为后续实现、评审、验收的唯一真相来源。

配套文档：

- 协议与状态机：`plans/app-server/INTERACTION-CONTRACT.md`
- UI 行为规范：`plans/app-server/UI-SPEC.md`
- 执行清单：`plans/app-server/TODO.md`
- 当前接口参考：`plans/app-server/API-REFERENCE.md`

## 2. 背景与问题

现状：

- Formax 核心能力主要通过 TUI（Ink REPL）提供。
- 已具备 `formax app-server` 与 Web 参考客户端，但迭代过程中存在“先改实现再补文档”的风险。

核心问题：

- 协议、状态机、UI 行为约束分散在代码和临时讨论中。
- 当需求新增（如 approval / ask_user_question 边界）时，容易在不同模块局部修补。

## 3. 产品目标

## 3.1 一句话目标

把 Formax 打造成“可由 GUI 稳定驱动”的本地 Agent Runtime，并在一期交付可验证、可恢复、可迭代的线程/回合/input 闭环。

## 3.2 具体目标

1. 稳定协议：GUI 可稳定驱动 `thread/*`、`turn/*`、`turn/input/submit`。
2. 稳定状态：approval / ask_user_question 统一 input 生命周期，但业务语义不混合。
3. 稳定恢复：进程重启、断连、超时场景下，客户端状态可收敛。
4. 稳定开发：所有后续实现必须可映射到 Product/Contract/UI 三份文档。

## 3.3 TUI 能力迁移优先级（GUI）

为避免“功能分散式修补”，GUI 迭代优先级固定为：

1. `approval` 语义对齐（P0）
2. transcript 统一展示（`tool/user/assistant/system`）（P0）
3. `commander`（slash command）可用子集（P1）

说明：

- P0 必须先达标，P1 才进入常规迭代。
- 一期 `commander` 不做 overlay 一致性，仅做可执行命令与可追踪输出。

## 4. 用户与使用场景

## 4.1 目标用户

- 第一类：Formax 内部开发者（构建 IDE/Web 客户端）。
- 第二类：高级用户（本地运行 app-server + 自建前端）。

## 4.2 核心场景

1. 启动 app-server，创建线程，发起 turn，实时查看模型与工具输出。
2. 收到审批请求，客户端提交 approval 答案后 turn 继续。
3. 收到 AskUserQuestion，客户端提交答案后 turn 继续。
4. 进程重启后通过 `thread/resume` 恢复线程，并清理 stale pending input。

## 5. 一期范围

## 5.1 In Scope

- 传输：`stdio + JSONL + JSON-RPC 2.0`
- 方法：`initialize`、`thread/start|resume|list|read`、`turn/start|interrupt`、`turn/input/submit`
- 通知：`turn/started`、`turn/event`、`turn/inputRequested`、`turn/inputResolved`、`turn/completed|failed`
- input 生命周期：`pending -> submitted/canceled/expired/failed`
- 会话持久化：复用 `sessionSave`，支持 stale input 恢复语义
- React Web reference client（开发验证用途）

## 5.2 Out of Scope

- 与 Codex 协议字段级兼容
- overlay/slash command 的 GUI 一致性改造
- 正式 WebSocket/HTTP 生产传输
- 面向终端用户的视觉设计系统

## 6. 产品原则

1. Spec First：先改文档再改代码（除紧急 bug）。
2. Small Surface：优先最小可用接口面，避免早期扩散。
3. Deterministic State：所有 pending input 必须有终局。
4. Recoverable Failure：错误必须带可恢复语义（至少可判断是否可重试）。
5. UI for Operations：一期 UI 以“可操作、可诊断”为目标，不追求品牌视觉。

## 7. 发布门槛（MVP 通过标准）

必须全部满足：

1. Handshake 稳定：`initialize -> initialized` 成功率 100%（本地开发链路）。
2. Thread/Turn 闭环：至少连续 20 次“start thread -> start turn -> completed|failed”无状态泄漏。
3. Input 闭环：approval 与 ask_user_question 各完成至少 10 次完整请求-回答-继续流程。
4. 异常收敛：
   - interrupt 后无 pending input 残留；
   - input 超时后状态变为 `expired`；
   - resume 后 stale input 不可再次成功提交。
5. 文档一致：
   - Product / Contract / UI / API Reference 互相无字段冲突；
   - TODO 的验收项可逐条映射到行为或测试。
6. TUI 关键能力迁移：
   - approval 在 GUI 端可完整闭环（含 remember scope）；
   - transcript 可稳定区分 user/assistant/tool/system 事件；
   - commander 子集命令可执行且输出可追踪。

## 8. 成功指标（开发阶段）

- 协议变更必须同步更新 `INTERACTION-CONTRACT.md` 与 `API-REFERENCE.md`。
- reference client 端到端冒烟路径（thread + turn + input）在每次关键变更后可重复演示。
- 新增功能 PR 必须附“受影响状态机路径”说明。

## 9. 风险与对策

1. 风险：文档与实现漂移
   - 对策：将文档更新列为每个阶段的验收条件。
2. 风险：input 相关竞态导致 UI 悬挂
   - 对策：强制 `turn/inputResolved` 终局通知 + stale input 策略。
3. 风险：Web reference client 演示代码反向污染核心
   - 对策：保持独立目录，核心逻辑只在 `src/app-server/*`。
4. 风险：后续 UI 重构打断协议迭代
   - 对策：UI 仅消费 contract，不定义协议。

## 10. 里程碑（下一阶段）

## Milestone A：规格固化

- Product / Contract / UI / TODO 完整落盘并互链。

## Milestone B：Contract 一致性

- 将现有实现逐项映射到 Contract，补齐缺口与冲突点。

## Milestone C：Reference Client 可用性

- React 客户端达到“无文档也可上手调试协议”的功能完成度。

## Milestone D：MVP 发布检查

- 完成最终验收清单（见 `plans/app-server/TODO.md`）。

## 11. 变更控制

以下变更视为“协议变更”，必须先更新 Contract 再实现：

- JSON-RPC 方法名、参数、返回结构变化
- `turn/*` 通知结构变化
- input 状态枚举或状态迁移变化
- 错误码、错误 `data` 结构变化

以下变更视为“UI 变更”，可先实现后补文档，但需在同一 PR 完成：

- 布局与样式
- 文案与交互提示
- reference client 的组件拆分与重构
