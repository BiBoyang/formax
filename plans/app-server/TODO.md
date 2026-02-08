# TODO：Formax App Server（Spec-Driven v2）

更新时间：2026-02-09  
主线目标：从“功能已可用”升级到“规格稳定、实现可验证、UI 可持续迭代”。

文档真相源（必须保持一致）：

- 产品规格：`plans/app-server/PRODUCT-SPEC.md`
- 交互合同：`plans/app-server/INTERACTION-CONTRACT.md`
- UI 规格：`plans/app-server/UI-SPEC.md`
- 接口参考：`plans/app-server/API-REFERENCE.md`

---

## Baseline（已完成）

说明：以下代表此前主线交付已完成，作为 v2 起点，不再重复拆分实现任务。

- [x] 共享 runtime 抽取，TUI 与 app-server 共用运行时装配。
- [x] app-server 骨架（JSON-RPC + stdio JSONL）与握手上线。
- [x] `thread/start|resume|list|read` 完成并映射 sessionSave。
- [x] `turn/start|interrupt` 与流式事件桥接完成。
- [x] approval + ask_user_question 已接入统一 input 生命周期。
- [x] `turn/input/submit` 幂等与冲突状态已落地。
- [x] stale input 恢复策略（resume 返回 + submit 过期错误）已落地。
- [x] CLI、README、CODEMAP、Design Addendum 已同步。

---

## Phase 0 — 规格固化（本轮优先）

目标：建立可执行的“产品/合同/UI”三层规范，停止无目标修补。

- [x] 新增 `plans/app-server/PRODUCT-SPEC.md`。
- [x] 新增 `plans/app-server/INTERACTION-CONTRACT.md`。
- [x] 新增 `plans/app-server/UI-SPEC.md`。
- [x] 将 `plans/app-server/DESIGN.md` 增加“以 Product/Contract/UI 为上位规范”的指引段。
- [x] 在 `plans/app-server/API-REFERENCE.md` 增加“合同优先级说明”（参考性质，非决策源）。

验收标准（可观察断言）：

- [ ] 新成员只阅读 4 份文档（Product/Contract/UI/API）即可完整描述 thread/turn/input 闭环。
- [ ] 文档中不存在互相冲突的字段命名与状态枚举。

---

## Phase 1 — Contract Conformance（协议一致性收敛）

目标：把当前实现和合同逐项对齐，显式处理不一致。

- [x] 建立“合同条目 -> 代码位置”映射表（附在 `INTERACTION-CONTRACT.md` 末尾）。
- [x] 对 `initialize.result.limits` 的字段来源做实现注释与文档对齐。
- [x] 明确 `turn/event` 中 `event` 字段的最小保证（允许未知事件透传）。
- [x] 明确并记录 `turn/failed` 中 `error` 的稳定性级别（面向展示，非 machine code）。
- [x] 对 `turn/input/submit` 的 `toolUseId` fallback 规则补示例与负例说明。
- [x] 对 `PAYLOAD_TOO_LARGE`（request/event）分别补客户端处理建议。

验收标准（可观察断言）：

- [x] 任何一个合同条目都能定位到具体实现文件与测试点。
- [x] 合同中列出的错误码都能在实现中找到对应分支。

---

## Phase 2 — Reference Client 功能可用性

目标：React reference client 达到“协议调试工具”级别可用，而非仅演示。

- [x] 建立独立子项目（不混用根 `package.json`）：`apps/web-reference-react/`。
- [x] 拆分基础结构：`rpcClient + store + 视图组件`。
- [x] 接入 Tailwind v4 + `shadcn/ui` 基线（保留 `src/css/theme.css` 作为主题源）。
- [x] 增加“连接生命周期提示”（connecting/connected/disconnected 时间戳）。
- [ ] 增加 turn 过滤视图（只看当前 turn / 看全部）。
- [ ] 在 input 面板展示 `expiresAt` 倒计时。
- [ ] 在 submit 结果上区分 `already_submitted_same` 与 `conflict_already_submitted` 的视觉等级。
- [ ] 增加 resume 流程入口（输入 threadId -> `thread/resume` -> 应用 staleInputs）。
- [ ] 增加错误详情抽屉（展示 JSON-RPC `code/message/data`）。
- [ ] transcript 渲染类型化：显式区分 `user/assistant/tool/system`。
- [ ] tool 事件最小展示：`tool_start/tool_update/tool_end` 按序可追踪。

验收标准（可观察断言）：

- [ ] 无需查看源码，仅通过 UI 可完成：new thread -> turn -> input submit -> completed。
- [ ] stale input 情况下，UI 明确显示“已失效且不可再提交”。
- [ ] 同一 turn 的 tool 流程在 transcript 可还原顺序。

---

## Phase 2.5 — Commander 子集接入（P1）

目标：先实现“可执行 + 可追踪”的 command 能力，不做 overlay 对齐。

- [ ] 定义一期 commander 子集（建议先 `/permissions`、`/agents`、`/hooks` 中可输出项）。
- [ ] UI 增加 command 输入路径（可与 composer 共用，保留前缀 `/`）。
- [ ] command 请求结果写入 transcript（成功/失败均可见）。
- [ ] command 错误统一映射为可读日志（message + 可选 code）。

验收标准（可观察断言）：

- [ ] 至少 2 个 command 子集在 GUI 端可执行并返回可读结果。
- [ ] command 异常不会破坏普通 turn 流程。

---

## Phase 3 — UI 可操作性硬化（非品牌美化）

目标：提升“长时间调试可用性”，不追求高保真视觉。

- [ ] 固化三区域独立滚动，防止输入区被内容挤出可视区。
- [ ] transcript 增加粘底开关（auto-scroll on/off）。
- [ ] 增加日志级别过滤（info/warn/error）。
- [ ] 增加最小空态文案规范（线程空态、转录空态、input 空态）。
- [ ] 增加窄屏布局规范实现（<900px 时上下结构）。
- [ ] 为关键动作增加忙碌态（发送中、提交中、中断中）。
- [ ] approval 表单显示完整上下文（toolName/action/effectiveDecision/workspaceRequest）。

验收标准（可观察断言）：

- [ ] 在大量事件流下，输入框始终可见并可操作。
- [ ] 用户能在不滚屏找日志的情况下定位最近一次失败原因。
- [ ] approval 提交前用户可见完整决策上下文，不依赖开发者工具。

---

## Phase T — Web 测试基线（新增）

目标：建立前端可持续测试机制，避免 UI 迭代破坏协议行为。

- [x] 建立 React 测试基础设施：Vitest + Testing Library + jsdom。
- [x] 为 `store` 增加状态机测试（input requested/resolved、assistant delta 合并）。
- [x] 为 `LeftRail` 增加交互测试（新建线程、刷新、切换线程、bridge 输入）。
- [x] 为 `TranscriptPane` 增加行为测试（Send/Interrupt disabled 条件、提交事件）。
- [x] 为 `PendingInputPane` 增加表单测试（approval/ask_user_question 提交 payload）。
- [x] 在 `apps/web-reference-react/README.md` 增加测试命令与最小测试策略说明。

验收标准（可观察断言）：

- [x] `npm run test` 可在子项目独立通过。
- [ ] 修改 UI 组件时，若破坏交互 contract，至少有 1 条测试失败提示。

---

## Phase 4 — 最终验收与发布门槛

目标：达到可持续迭代的 MVP 质量门槛。

- [ ] 生成最终验收报告：`plans/app-server/FINAL-ACCEPTANCE.md`（补齐 v2 条目）。
- [ ] 完成“20 次 thread/turn 闭环 + 10 次 approval + 10 次 ask_user_question”手工记录模板。
- [ ] 完成“重启恢复 + stale input 提交失败”手工记录模板。
- [ ] 文档索引更新：`plans/TODO-INDEX.md`、`README.md`（reference client 路径说明）。

验收标准（可观察断言）：

- [ ] 产品目标（`PRODUCT-SPEC.md` §7）中的门槛全部具备对应证据。
- [ ] TODO 中未完成项可解释为“明确后续范围”，而非遗漏。

---

## 执行规则（避免重新变成补丁式开发）

- 每次实现前先更新至少一份规格文档（Product/Contract/UI）。
- 代码 PR 必须附“对应 TODO 条目 + 验收断言”。
- 发现需求不清时先改文档，不直接改实现。
- React reference client 仅作开发验证，不向核心 runtime 反向引入耦合。
