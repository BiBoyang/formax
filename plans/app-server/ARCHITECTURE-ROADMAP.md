# Formax App-Server + Semantics Architecture Roadmap（v0.2 基线）

更新时间：2026-02-17  
状态：`draft`（用于对齐与路线图讨论，不替代 Contract）

## 0. 本文档的定位（避免重复）

`plans/app-server/` 已经有多份“规范/合同/手册/清单”，本文档做两件事：

1. **把跨端“语义单一来源”架构讲清楚**（TUI + app-server + Web reference client 如何共享同一套 semantics）。
2. **给出可执行的路线图**：下一阶段应该优先解决哪些“系统性”问题，避免 bug-driven 局部修补。

本文档不新增协议字段、不替代规范源；发生冲突时以以下优先级为准：

1. `PRODUCT-SPEC.md`
2. `INTERACTION-CONTRACT.md`
3. `UI-SPEC.md`
4. `API-REFERENCE.md`
5. `TODO.md`
6. 本文档

---

## 1. 已对齐的关键决策（本轮讨论结论）

### 1.1 Canonical 元信息权威：**按路径分层**

Canonical 事件的 envelope 元信息（至少 `threadId/turnId/replaySeq/eventId/ts/source`）按运行路径分层：

- **app-server 路径（network-visible）**：由 app-server 生成并保证单调与稳定（server-authoritative）。
- **local TUI 路径（no server hop）**：可由本地 runtime 生成（runtime-authoritative），但必须遵循同一 envelope contract，且语义结果不得与 server 路径分叉。

客户端（尤其 Web）不得在 app-server 路径下“补造”这些字段参与语义投影；最多只能生成 UI-only 本地日志（不进入 projector）。

### 1.2 跨端一致性的权威对象：**Canonical events 权威（events-authoritative）**

语义一致性的权威来源是 **canonical events 序列**。  
projection snapshot / segments 仅作为加速与恢复辅助，不是“真相来源”（允许丢弃并由 events 重建）。

### 1.3 Web reference client 定位：**偏产品化 demo**

Web 端允许更丰富的交互体验，但必须满足 Contract 的硬约束（排序、去重、input 终局、可恢复语义）。  
UI 可以有端内适配逻辑，但不得创造新的语义状态机分支（语义必须回到 shared semantics）。

---

## 2. 目标架构（高层）

```text
                    (stdio JSONL / JSON-RPC 2.0)
+----------------+         +--------------------+
| Web Client     | <-----> | WebSocket Bridge   |   (dev only)
| (reference)    |         +--------------------+
+--------+-------+                    |
         |                             v
         |                   +--------------------+
         |                   | formax app-server  |
         |                   | - protocol/router  |
         |                   | - thread store     |
         |                   | - turn runner      |
         |                   +---------+----------+
         |                             |
         |                             v
         |                   +--------------------+
         |                   | Shared Semantics   |
         |                   | - core (events)    |
         |                   | - adapters         |
         |                   | - projection       |
         |                   | - runtime (inputs) |
         |                   +--------------------+
         |
         | (local only)
         v
+----------------+
| TUI (Ink REPL) |
+----------------+
```

**单一核心原则**：TUI 与 Web 端的“对话语义”必须来自同一套 `src/features/semantics/*`，端内只保留 renderer/interaction 差异。

---

## 3. 语义层分层（Single Source of Truth）

对应目录：`src/features/semantics/`

### 3.1 core：事件与模式语义

- `core/canonicalEvents.ts`：CanonicalEvent（带 envelope）定义与校验辅助
- `core/commandRouting.ts` / `core/slashSemantics.ts`：命令解析语义（跨端一致）
- `core/replModeTransition.ts`：mode transition 语义（含 exit-plan reminder 规则）

### 3.2 adapters：把“不稳定输入”适配成 canonical events

目标：所有端只做一次 mapping，避免多端手写漂移。

- **Streaming → canonical**：`adapters/streamCanonicalAdapter.ts`
- **turn notification → canonical**：`adapters/turnNotificationCanonicalAdapter.ts`
- **history/messages → canonical（fallback）**：由端内入口统一调用 shared adapter（如 Web 的 history fallback）

### 3.3 projection：把 canonical events 投影成 transcript segments

核心 reducer：`projection/transcriptProjection.ts`（通过 `reduceTranscriptProjection`）  
要求：

- 幂等（重复 event 不改变结果）
- 不回写旧 segment（append-only 的语义投影）
- toolName sticky、open segment lifecycle 稳定

### 3.4 runtime：thread/turn/input 的运行态（与 UI 解耦）

例如：

- `runtime/threadRuntimeState.ts`：thread 维度 runtime state（pending inputs、cursor 等）
- `runtime/inputStateMachine.ts`：input 生命周期与幂等/冲突语义
- `runtime/threadArchiveSemantics.ts`：thread archive 语义

---

## 4. app-server 的职责边界（Contract-first）

对应目录：`src/app-server/*`

### 4.1 协议与 envelope 的硬约束

`INTERACTION-CONTRACT.md` 要求所有 turn 通知具备 envelope 字段：

- `replaySeq`：thread 内全序主键（排序与去重主键）
- `traceId`：诊断
- `seq`：turn 内序号
- `ts`：ISO 时间
- `eventId`：建议 `${turnId}:${seq}`
- `source`：`engine|tool|policy|system`

**路线图要求**：在 app-server 路径，这套 envelope 字段必须由 server 侧完整、稳定地产出；客户端不应在缺失时“补造”并参与语义投影。

### 4.2 事件流与恢复（replay-first）

目标：客户端断线/重启后，依靠 `thread/replay`（+ snapshot）稳定重建语义状态；`thread/messages` 仅作为明确的 fallback 模式。

Contract 对恢复的硬约束：

- `thread/resume` 返回 `staleInputs`，stale 提交不可成功
- `hasGap=true` 必须触发重建路径，不允许继续增量拼接

---

## 5. 客户端（Web reference）职责边界

对应目录：`apps/web-reference-react/src/*`

**允许**：

- transport（WebSocket/JSON-RPC）管理
- replay cursor / seen-event 去重（以 `replaySeq` 为主）
- UI 本地状态：布局、选择、滚动、dock 展开、输入草稿、错误抽屉等

**不允许**：

- 自行生成 canonical envelope 元信息用于投影
- 发明“端内语义状态机”替代 shared semantics（例如自定义 tool 生命周期合并规则）

---

## 6. 关键不变量（把“修一个问题”变成“修一类问题”）

建议把以下不变量做成跨端门禁（fixture/contract）：

1. **全序与幂等**：同一 `threadId` 下 canonical events 按 `replaySeq` 处理，重复 event 不改变投影
2. **toolUseId 唯一**：同一 turn 最终 transcript 中同一 `toolUseId` 不出现重复“完成行”
3. **终局无 running**：turn 结束后不得存在 `running` tool segment
4. **input 必终局**：每个 pending input 必须最终 `resolved`（submitted/canceled/expired/failed）
5. **gap 必重建**：`hasGap=true` 不允许继续增量拼接，必须走 replay baseline（必要时带 snapshot）

---

## 7. 路线图（下一阶段的系统性工作）

> 说明：`plans/app-server/TODO.md` 是唯一执行清单；这里给的是“架构层优先级与验收语义”，便于讨论与拆 slice。

### Milestone 1：Canonical meta 单写入源（按路径分层）彻底落地

目标：客户端不再合成 canonical envelope 元信息来补 thinking/footer/tool 事件；并明确 app-server 路径与 local TUI 路径的权威边界一致执行。

验收：

- Web 端不再对 `turn/completed|failed` 进行“本地补 canonical finalize events”以驱动 projector
- 所有进入 projector 的 canonical events 均来自：\n
  - server 发来的 notification（带 envelope）经 shared adapter 转换\n
  - 或 `thread/replay` 返回的 canonical events / snapshot

### Milestone 2：adapter 单点化（turn notification mapping 不再多端手写）

状态：`completed`（2026-02-17）

目标：turn notification → canonical events 的 mapping 规则只存在于 `src/features/semantics/adapters/*`。

验收：

- Web/TUI/app-server 不再各自维护“通知事件类型分支到 canonical”的平行实现
- 关键 fixture 在三端入口（stream/notification/replay）下投影一致

完成证据：

- app-server 通知入口统一走 `canonicalEventAdapter`：`src/app-server/server.ts`
- 跨入口 contract fixture（stream/notification/replay）与乱序重复归一化断言：
  - `src/features/semantics/adapters/canonicalEventAdapter.contract.test.ts`
  - `src/features/semantics/adapters/crossPathContractFixture.ts`
- replay 真路径一致性断言：
  - `apps/web-reference-react/src/app/runtime/replayThreadEvents.test.ts`

### Milestone 3：replay-first + snapshot 策略固化

状态：`completed`（2026-02-17）

目标：恢复路径与缺口路径可预测、可测试。

验收：

- `hasGap=true` 强制重建（baseline replay + snapshot hydrate）\n
- 不会退化到“history 拼接 + 本地修补”的隐式路径

完成证据：

- `hasGap` 分支显式保护（不消费当前页增量）：
  - `apps/web-reference-react/src/app/runtime/replayThreadEvents.ts`
- gap 反例测试（同页 data 禁止落地、rebuild 后 cursor/尾部不重复）：
  - `apps/web-reference-react/src/app/runtime/replayThreadEvents.test.ts`
- reconnect/gap/restart 与 realtime 一致性回归：
  - `src/features/semantics/__tests__/runtimeReplayParity.test.ts`

### Milestone 4：Tool Presentation IR 与语义层边界长期化

状态：`completed`（2026-02-17）

目标：新工具/新展示规则不再触发多端多处修改。

验收：

- 新工具的参数/标签/摘要规则只需改 presenter（IR），renderer 端只做展示\n
- 端内 UI 可以不同，但语义输入与投影不分叉

完成证据（Bash 样板）：

- 共享 Bash 展示参数模型（IR 片段）：
  - `src/features/tools/presentation/bashParams.ts`
  - `src/features/tools/presentation/bashParams.test.ts`
- TUI renderer 通过共享模型消费 command/params：
  - `src/tools/modules/bash/presenter.tsx`
- Web renderer 通过共享模型消费 command/params：
  - `apps/web-reference-react/src/components/tool/toolBlocksRegistry.ts`
  - `apps/web-reference-react/src/components/tool/toolBlocksRegistry.test.ts`

---

## 8. Open Questions（需要你补充，以便把路线图优先级落到现实痛点）

1. 你目前跨端最痛的 Top2 “不一致问题”是什么？（例如：tool 行重复/缺失、assistant/thinking finalize 时机、pending input 悬挂、replay gap 恢复等）  
2. 你更倾向把 Web reference client 的“产品化”做到什么程度？（仅调试可用 vs 体验更接近真实产品）  
3. 你是否希望 app-server 在 `turn/event` 上直接发送 canonical events（而不是 StreamEvent），还是继续沿用 StreamEvent 并在 client 侧 adapter？
