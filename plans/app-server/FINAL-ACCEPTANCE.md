# Formax App Server MVP Final Acceptance

## 1. 范围与目标

本主线目标是把 Formax 从纯 TUI 路径扩展为可被 GUI 驱动的本地 app-server（一期传输：`stdio JSONL + JSON-RPC 2.0`），并完成：

- thread/turn 基础闭环
- approval 与 ask_user_question 的 input 生命周期闭环
- sessionSave 复用与恢复语义
- 可用于开发验证的 Web reference client（非生产）

对应执行清单：`plans/app-server/TODO.md`（现已全量勾选完成）。

## 2. 最终结果

### 2.1 功能闭环

- `formax app-server` 可用，支持 `initialize/initialized`、`thread/*`、`turn/*`、`turn/input/submit`
- turn 流式通知具备统一元数据（`traceId/seq/ts/eventId/source`）
- input 状态机已收敛并可观测：
  - `turn/inputRequested`
  - `turn/inputResolved`（`submitted/canceled/expired/failed`）
- approval 与 ask_user_question 保持业务语义分离，但共享统一 input 协议生命周期
- stale input（重启后）统一 `expired` 语义，submit 可返回 typed `INPUT_EXPIRED`

### 2.2 边界与健壮性

- transport 请求/事件 payload 上限（`PAYLOAD_TOO_LARGE`）
- per-thread pending input 上限
- input TTL 自动过期回收（避免 pending 泄漏）
- interrupt/failed/completed 路径对 pending input 做一致收敛

### 2.3 开发验证能力

- WebSocket dev bridge（`app-server:bridge`）
- Web reference client（`app-server:web-reference`）：
  - 线程列表
  - 消息流
  - approval/ask_user_question 弹层回传
  - thread/start -> turn/start -> input submit -> turn/completed 验证链路

## 3. 关键提交（主线摘要）

- `1756b5c` runtime 抽取（共享装配）
- `bf99c63` app-server 握手骨架
- `a415e0f` thread API + sessionSave 映射
- `3139974` turn runner 与 turn 路由
- `f9aed6f` approval/ask_user_question 事件桥接
- `9b3d0a2` input 生命周期状态机
- `3e8b571` staleInputs 恢复与元事件持久化
- `29be411` payload/pending 输入上限
- `0911bf9` input TTL 自动过期
- `d38384a` websocket dev bridge
- `b57e022` web reference client
- `fd2a6ca` approval + ask 组合闭环集成测试

## 4. 验收证据（测试/检查）

主线期间已执行并通过（含多次回归）：

- `bun run test -- src/app-server/**/*.test.ts`
- `bun run test -- src/app-server/server.test.ts`
- `bun run test -- src/app-server/devBridge.test.ts src/app-server/web-reference/server.test.ts`
- `bun run test -- src/legacy/bootstrap/runtimeConfig.test.tsx src/screens/REPL.test.tsx`
- `bun run type-check`
- `codex review --uncommitted -c model="gpt-5.2" -c model_reasoning_effort="high"`（按批次执行）

此外，开发烟测已验证 bridge 与 web reference 可正常启动和关闭。

## 5. 运行方式（开发验证）

### 5.1 纯 app-server

```bash
bun run dev -- app-server
```

### 5.2 dev bridge

```bash
bun run app-server:bridge -- --host 127.0.0.1 --port 3777
```

### 5.3 web reference client

```bash
bun run app-server:web-reference -- --host 127.0.0.1 --bridge-port 3777 --ui-port 3780
```

## 6. 非目标与后续建议

一期明确非目标（当前保持不做）：

- 不做 Codex 协议兼容层
- 不做生产级 GUI 客户端
- 不做 WebSocket 作为正式传输

后续可选方向：

1. 增加 reference client 的端到端演示脚本（自动驱动一次完整流程）
2. 抽离 web reference 为独立 demo 包，进一步隔离核心 runtime
3. 在生产 GUI 客户端阶段补充协议版本协商与兼容策略文档
