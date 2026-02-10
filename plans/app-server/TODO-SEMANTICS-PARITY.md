# TODO：TUI/GUI 语义一致性融合路线（v2）

更新时间：2026-02-10
来源：`plans/app-server/SEMANTICS-PARITY-ARCH.txt` + `plans/app-server/webgpt-response-2.txt` + 当前代码现状

## 目标与边界

- 目标：让 TUI 与 GUI 在同一用户意图下走同一语义路径，减少“看起来支持、实际不一致”。
- 方法：以共享语义层为核心（先最小抽象，后扩展），先统一输入/模式/事件，再统一展示映射。
- 非目标：本阶段不做大重写，不一次性改协议，不扩 commander 全功能。

## 现状基线（已完成）

- [x] app-server 支持 `turn/start.mode` 三态校验与透传（`normal | acceptEdits | plan`）
  - 证据：`src/app-server/protocol.ts`、`src/app-server/turnRunner.ts`
- [x] app-server 已接入 `/init` 的模型输入映射（临时实现）
  - 证据：`src/app-server/turnRunner.ts`
- [x] web 端事件幂等与顺序保护（`eventId + traceId + seq`）
  - 证据：`apps/web-reference-react/src/App.tsx`、`apps/web-reference-react/src/App.test.tsx`
- [x] web 端 `thread/resume` stale input 恢复链路
  - 证据：`apps/web-reference-react/src/App.tsx`、`apps/web-reference-react/src/components/PendingInputPane.tsx`
- [x] transcript 收敛（thinking 运行/完成态 + turn footer）
  - 证据：`apps/web-reference-react/src/types.ts`、`apps/web-reference-react/src/store.ts`、`apps/web-reference-react/src/components/TranscriptPane.tsx`
- [x] 中栏/右栏滚动边界治理与 E2E 覆盖
  - 证据：`apps/web-reference-react/src/components/scrollBoundary.ts`、`apps/web-reference-react/e2e/nested-scroll-boundary.spec.js`

## 主线待办（按优先级）

## Phase 1（P0）统一 Turn 输入构建与 mode 注入

- [x] 新建共享 `TurnInputBuilder`（建议：`src/features/semantics/turnInputBuilder.ts`）
  - 输入：`rawText`、`mode`、`planPath`、上下文
  - 输出：`displayText`、`modelUserText`、`injections`
- [x] 新建共享 `ModeSemantics`（建议：`src/features/semantics/modeSemantics.ts`）
  - 统一：mode prompt 注入、plan 相关约束决策接口
- [x] TUI 发送路径改为调用 `TurnInputBuilder`（替代本地拼接）
  - 目标文件：`src/features/repl/send.ts`（及其依赖）
- [x] app-server `TurnRunner` 改为调用 `TurnInputBuilder`
  - 目标文件：`src/app-server/turnRunner.ts`
- [x] `/init` 从“TurnRunner 内硬编码”迁移到 `TurnInputBuilder` 规则

验收标准：
- 同一输入在 TUI/app-server 产出的 `modelUserText` 一致。
- `mode=plan` 时两端都能体现一致的提示注入行为（不仅工具层）。

## Phase 2（P0/P1）统一 slash 语义（先最小闭环）

- [x] 定义 `SlashSemantics` 最小协议（建议与 TurnInputBuilder 同目录）
  - 至少明确：`/init`、普通 slash 透传、保留字策略
- [x] TUI 与 app-server 共用 `SlashSemantics` 的解析结果
- [x] 明确“仅本地命令”与“模型命令”的边界，避免双写

验收标准：
- `/init` 在 TUI/GUI 行为一致（展示文本与模型输入语义一致）。
- 新增一个 slash 时不需要在两端重复写判断分支。

## Phase 3（P1）统一 Input 生命周期状态机

- [x] 抽取 `InputStateMachine`（approval + ask_user_question）
  - 状态：pending/resolved/expired/canceled
  - 事件：requested/submitted/resolved/expired/cleared/interrupt
- [x] server 侧采用同一 transition table
  - 目标文件：`src/app-server/turn/inputStore.ts`（或其上层）
- [x] web reducer 侧采用同一 transition table（或共用纯函数）
  - 目标文件：`apps/web-reference-react/src/store.ts`

验收标准：
- 重复 submit、乱序 resolved/expired、interrupt 后 submit 都有确定结果。
- 刷新恢复后 pending 不丢、状态不抖动。

## Phase 4（P1）工具事件归一层（ToolEventNormalizer）

- [x] 抽取 `ToolEventNormalizer`，以 `turnId + toolUseId` 归并 start/update/end
- [x] 将 web 当前 transcript 的 tool 映射切到 normalizer 输出
  - 目标文件：`apps/web-reference-react/src/store.ts`
- [x] 线程历史映射 `mapThreadHistoryToLogs` 对齐 same-normalizer 结构
  - 目标文件：`apps/web-reference-react/src/App.tsx`

验收标准：
- 同一个工具调用在流式与刷新恢复后展示结构一致。
- 不出现重复 tool 卡片或状态回退。

## Phase 5（P1/P2）把事件光标做成共享模块（TurnEventCursor）

- [x] 抽取 `TurnEventCursor`（`eventId + traceId + seq`）
  - 从 `App.tsx` 内联逻辑迁出为可复用模块
- [x] web 侧改为调用共享 cursor API
- [x] 为“重连 replay / 跨线程切换 / 局部乱序”补测试

验收标准：
- 去重、乱序保护不依赖组件内部细节。
- 切线程期间不会把旧线程 delta 污染到当前线程。

## Phase 6（P2）契约测试门禁（防漂移）

- [x] 新增 `Semantics Contract` 测试目录（建议：`src/features/semantics/__tests__/`）
- [x] `TurnInputBuilder` 快照矩阵（mode + slash + /init）
- [x] `ModeSemantics` 矩阵（mode × planPath × action）
- [x] `InputStateMachine` transition table 测试（含乱序/重复）
- [x] `ToolEventNormalizer` 累积器测试
- [x] web reducer + cursor 集成测试（通知乱序/重复）

验收标准：
- 合并前能直接判定“语义是否漂移”，而不只看 UI 截图。

## Phase 7（P2）文档与索引收敛

- [x] 更新 `plans/app-server/DESIGN.md`：加入语义层边界与阶段结论
- [x] 更新 `CODEMAP.md`：新增 semantics 模块入口与调用点
- [x] 更新 `plans/TODO-INDEX.md`：登记本主线
- [x] 在 `plans/app-server/` 下保留一份“Parity Matrix（当前状态）”

验收标准：
- 新同学只看文档即可定位语义归属与测试门禁。

## 后续增强（非当前主线）

- [x] `ThreadStateReducer` 最小闭环（server 运行态归约 + replay 状态快照）
- [x] 协议扩展最小版：`thread/replay`（cursor + hasGap + latestCursor）
- [ ] `ThreadStateReducer` 全量抽象（server/web 统一线程状态归约）
- [x] 协议扩展：`command/dispatch`（当前接入 `/init` 闭环）
- [ ] commander 全量能力迁移（超出 `/init`）

## 执行顺序建议（最小风险）

1. Phase 1
2. Phase 2
3. Phase 6（先把门禁立起来）
4. Phase 3
5. Phase 4
6. Phase 5
7. Phase 7

## 本路线 Done 定义

- [x] P0 项（Phase 1/2）全部完成并有契约测试保护。
- [x] `TurnInputBuilder + ModeSemantics` 已成为 TUI/app-server 的单一来源。
- [x] Input 与 Tool 的状态转换逻辑不再散落在 adapter 层。
- [x] Web 的事件顺序/幂等逻辑有共享 cursor，不再写死在组件中。
