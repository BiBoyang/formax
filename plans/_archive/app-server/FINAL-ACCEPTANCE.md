# Formax App Server MVP Final Acceptance（v2）

## 1. 范围与目标

本主线目标：把 Formax 从纯 TUI 扩展为可被 GUI 稳定驱动的本地 app-server（`stdio JSONL + JSON-RPC 2.0`），完成 thread/turn/input 闭环与可恢复语义，并交付可持续迭代的 React reference client。

对应主线：`plans/app-server/TODO-INDEX.md`

## 2. 结果摘要

### 2.1 协议与状态机

- `initialize/initialized`、`thread/*`、`turn/*`、`turn/input/submit` 均已落地。
- input 生命周期统一：`pending -> submitted/canceled/expired/failed`。
- stale input 恢复策略生效：`thread/resume` 返回 `staleInputs`，stale 提交不可成功。
- 通知 envelope 元字段统一：`replaySeq/traceId/seq/ts/eventId/source`。

### 2.2 Reference Client（React）

- 独立子项目：`apps/web-reference-react/`（不复用根 `package.json`）。
- 三栏稳定布局：左侧线程导航、中间 transcript + 输入区审批 dock、右侧 diff-only（workspace changes）。
- 关键交互：
  - turn 过滤（全部/当前 turn）
  - 日志级别过滤（all/info/warn/error）
  - 粘底模式（Stick/Manual）
  - command 快捷路径（`/init`、`/clear`、`/compact`、`/todos`）
  - 错误详情抽屉（code/message/data）
  - 输入区审批双形态（ask 分页 / approval 提交）与 submit 结果分级

### 2.3 UI 与测试

- `thinking_delta` 聚合为可折叠块，避免刷屏。
- tool 事件最小可追踪（start/update/end）。
- canonical transcript projection 已接入 Web 实时链路（notification + replay 增量）。
- Web 测试基线完善（Vitest + Testing Library）：
  - reducer 状态机
  - 左栏线程与连接操作
  - 中栏发送/中断/过滤/command 入口
  - 右栏 diff-only 与输入区审批提交流程

## 3. 发布门槛映射（PRODUCT-SPEC §7）

| 门槛 | 证据 |
|---|---|
| Handshake 稳定 | `src/app-server/server.test.ts`, `src/app-server/index.test.ts` |
| Thread/Turn 闭环 | `src/app-server/turnRunner.test.ts`, `src/app-server/server.test.ts` |
| Input 闭环 | `src/app-server/turn/inputStore.test.ts`, `src/app-server/server.test.ts` |
| 异常收敛 | `thread/resume` staleInputs + `INPUT_EXPIRED` 路径测试 |
| 文档一致 | `PRODUCT-SPEC` / `INTERACTION-CONTRACT` / `UI-SPEC` / `API-REFERENCE` + `plans/_archive/app-server/DOC-CONSISTENCY-CHECKLIST.md` |
| TUI 能力迁移 | approval 闭环、transcript 类型化、commander 子集入口与结果日志 |

## 4. 手工记录模板

- Thread/Turn/Input + Recovery/Stale：`plans/app-server/MANUAL-RUNBOOK.md`

## 5. 运行方式（开发验证）

```bash
# app-server
bun run dev -- app-server

# WebSocket bridge（开发调试）
bun run app-server:bridge -- --host 127.0.0.1 --port 3777

# React reference client
bun run app-server:web-reference -- --host 127.0.0.1 --bridge-port 3777 --ui-port 3781
```

## 6. 备注

- Web reference client 仅用于协议/交互验证，不作为生产 GUI。
- 生产客户端可在此基础上替换视觉层，但须遵守 `UI-SPEC` 和 `INTERACTION-CONTRACT`。
