# TODO：Formax App Server（单一清单）

更新时间：2026-02-13

> 本文件是 `plans/app-server/` 下唯一 TODO。  
> 本次已将 `plans/app-server/webgpt-response.txt` 转译为可执行项，并按“结构化改造优先、止血方案降级”重排。

## WebGPT 回复评估（先判定是否过时）

### 仍然成立（需要继续推进）

- Web 仍是多入口语义链路：`thread/messages` + `thread/replay` + 实时 `turn/*` notification 并存。
- Web transcript 核心 reducer 仍是“按 turn tail 扫描并回写”的模式，不是显式 segment 状态机。
- ordering 主键仍是 `traceId + seq` 去重/丢弃，尚未切到 `replaySeq` 主导。
- 刷新路径仍是先 history 再 replay 增量，不是 replay-first 的单一语义重建。

### 已部分缓解（但未根治）

- toolName 丢失问题：
  - 已缓解：`sessionEventReader` 已支持从 start 继承 toolName（update/end 缺字段时保名）。
  - 未根治：`turnRunner` 写 `app_tool_event` 时 update/end 仍可能不带 toolName；实时链路仍可能遇到“首见即 update/end”。
- hasGap 路径：
  - 已有：Web 在 `hasGap=true` 时会回到 baseline 逻辑。
  - 未根治：仍依赖 history 与 replay 混合，不是单一投影源。

### 已过时或需要降权的点（给出原因）

- “先做止血再做结构化”中的止血优先级，按当前要求降级：只保留为兜底，不作为主线。
- Tool UI 组件化“从零开始”建议降权：Web/TUI 当前都已有 Tool Blocks 能力，主问题变成“跨端共享语义层”而非“是否组件化”。

---

## 主线 TODO（结构化改造优先）

### P0：Canonical 语义层（最高优先级）

- [x] T0 定义统一 `CanonicalEvent` 与 `Segment` 模型
  - 文件：
    - 新增 `src/features/semantics/core/canonicalEvents.ts`
    - 新增 `src/features/semantics/projection/transcriptProjection.ts`
  - 要点：
    - Event Envelope 最小字段：`threadId/turnId/eventId/replaySeq/ts/source`
    - tool 粘性字段缓存：`toolUseId -> toolName`
    - turn 内 segment 显式建模（assistant/thinking/tool/input/footer）
  - 验收：
    - 纯单元测试覆盖幂等、顺序、segment 开闭规则。

- [x] T1 实现唯一投影 reducer：`reduceTranscriptProjection`
  - 文件：
    - `src/features/semantics/projection/transcriptProjection.ts`
  - 要点：
    - delta 只能 append 到“当前打开 segment”
    - tool event 到来必须关闭当前文本 segment
    - 禁止回写旧 segment
  - 验收：
    - 构造“同一 turn 多段 assistant/tool/assistant”序列，顺序稳定。

- [x] T2 Web 入口适配到 canonical projector（替换手写语义）
  - 文件：
    - `apps/web-reference-react/src/App.tsx`
    - `apps/web-reference-react/src/store.ts`
    - 可新增 `apps/web-reference-react/src/eventAdapters.ts`
  - 要点：
    - notification/replay/history 都先转换为 canonical event 再喂 projector
    - `store.ts` 仅保留 UI 本地状态（滚动、选择、dock 展开），语义状态由 projector 产出
  - 验收：
    - 移除/停用 `append_assistant_delta` 与 `append_thinking_delta` 的 turn-tail 回写语义。
  - 当前进展：
    - 已完成：notification + replay 路径接入 canonical（`apply_canonical_event`），并新增顺序回归测试。
    - 已完成：`apps/web-reference-react/src/store.ts` 停用 legacy turn-tail action（`append_* / append_tool_event / annotate_tool_input_state`），主路径收敛到 canonical projection。
    - 已完成：history 路径接入 canonical 适配（`thread/messages -> canonical events -> projection -> logs`），不再走手写 tool/message 映射。

- [x] T3 TUI 接入同一 projector（语义统一，渲染可不同）
  - 文件：
    - `src/features/repl/controller/streaming.ts`
  - 要点：
    - TUI streaming 事件先转 canonical，再走共享 projection
    - TUI 可继续保留 transient/static 呈现差异，但不再自定义另一套语义
  - 验收：
    - Web/TUI 同输入事件序列下，segment 顺序与边界一致。
  - 当前进展：
    - 已完成：TUI `useReplStreaming` 增加 `StreamEvent -> CanonicalEvent` 语义桥接，并将事件实时喂给共享 `reduceTranscriptProjection`（先并行桥接，不改现有 TUI 渲染）。
    - 已完成：TUI 在 turn 进行中优先使用 canonical projection 生成 transient transcript（assistant/thinking/tool），减少流式阶段的顺序漂移。
    - 已完成：TUI 在 canonical transient 激活后不再回退 legacy transient，避免 turn footer 之后被晚到 legacy delta 抢占展示。
    - 已完成：TUI 在 turn 结束时用 canonical segment 序列回填当轮 tail（替换 legacy 当轮 assistant/tool 拼接结果），减少“完成态顺序与刷新后不一致”。
    - 已完成：canonical bridge 激活时，TUI 停止写入 legacy assistant/thinking turn 内消息（工具消息仍保留用于完成态细节），进一步收敛到“projector 驱动顺序、legacy 仅补细节”。
    - 已完成：turn 完成态 tail 合并改为“assistant 仅匹配复用 legacy id/timestamp，tool 保留 legacy 细节字段并补 canonical 标准字段”，修复 canonical 回填下的内容/顺序回归。
    - 已完成：turn 完成态 tool 合并改为 canonical `name/status` 优先、legacy 详情字段优先（result/middleLines 等），并补充回归测试锁定该规则。
    - 后续优化（非阻塞）：TUI transcript 渲染仍基于原 `Msg` 更新路径，尚未由 projector 输出直接驱动。

- [x] T4 建立跨端语义一致性测试矩阵
  - 文件：
    - 新增 `src/features/semantics/__tests__/projectionParity.test.ts`
    - 视情况新增 web/tui 适配层测试
  - 要点：
    - 覆盖：ordering、去重、toolName sticky、mode/input 交错
  - 验收：
    - 同一 fixture 在 Web/TUI projector 输出一致（不比样式，只比语义状态）。
  - 当前进展：
    - 已完成：新增 `projectionParity.test.ts`，覆盖同一 turn 语义序列在 Web notification adapter 与 TUI stream adapter 下的投影一致性。
    - 已完成：新增 stream canonical adapter 与 turn notification canonical adapter 的单测，以及 `useReplStreaming` canonical bridge 投影回归测试（assistant/tool/footer）。
    - 已完成：补充 parity fixture 覆盖 `toolName` sticky 与 duplicate canonical event 去重一致性。
    - 已完成：补充 `turnNotificationCanonicalAdapter` 的 tool input 交错测试（`inputRequested/inputResolved` 与 tool event 混排）。
    - 已完成：补充 replay gap 场景 parity 覆盖（snapshot + tail 恢复与全量连续投影一致）。

### P1：刷新与实时统一为 replay-first

- [x] T5 Web 线程切换改为 replay-first（history 降为 fallback）
  - 文件：
    - `apps/web-reference-react/src/App.tsx`
  - 要点：
    - thread 切换：先 replay 拉取并重建语义，再按需补 history
    - `mapThreadHistoryToLogs` 逐步退场（仅应急 fallback）
  - 验收：
    - 刷新前后 transcript 结构一致（不再“history 一套、streaming 一套”）。
  - 当前进展：
    - 已完成：`App.tsx` 在线程切换/新线程场景优先 `thread/replay(after=0)` 重建；`hasGap` 与 replay 空窗口时才走 `thread/messages` fallback。
    - 已完成：历史上翻分页仅在 history fallback 模式可用；一旦 replay 成为该线程 canonical 来源会清理 history cursor 并关闭 messages 分页入口。

- [x] T6 app-server replay 状态快照补齐可恢复信息
  - 文件：
    - `src/app-server/server.ts`
    - `src/app-server/threadStore.ts`
    - `src/app-server/store/sessionEventReader.ts`
  - 要点：
    - 回放 state 能支持 projector 从任意 cursor 恢复（含 sticky toolName、必要上下文）
  - 验收：
    - `hasGap=true` 后能稳定重建，不出现 toolName 退化或 segment 丢失。
  - 当前进展：
    - 已完成：`thread/replay.state` 补充 `toolNameByUseId` sticky cache，Web hydration 会把该映射注入 canonical projection seed。
    - 已完成：`thread/replay.state` 补充 `pendingInputs` 详情快照（不再仅 `pendingInputCount`），Web replay hydration 会恢复 pending approval/ask 输入态。
    - 已完成：`thread/replay.state` 补充 `projection` 快照（segments + sticky maps），`hasGap=true` 时 Web 优先用 projection 直恢复。
    - 已完成：`hasGap=true` 且 runtime cache 缺失时，server 仍会返回可恢复的 projection state 快照（避免降级到历史拼接）。
    - 已完成：Web 在 replay-source 线程遇到 `hasGap=true` 且无 projection 时，直接重基线 cursor，不再回退 `thread/messages`。
    - 已完成：Web 在 history-source 且已有 transcript 缓存时遇到 `hasGap=true`，直接重基线 cursor，避免重复请求 `thread/messages`。
    - 已完成：server baseline replay（`after` 省略）也返回 projection 快照；Web 在 `hasGap=true` 且首包无 projection 时会二次拉取 baseline snapshot 恢复，不再回退 `thread/messages`。

- [x] T7 文档契约统一（以结构化语义为准）
  - 文件：
    - `plans/app-server/INTERACTION-CONTRACT.md`
    - `plans/app-server/API-REFERENCE.md`
    - `plans/app-server/UI-SPEC.md`
    - `plans/app-server/FINAL-ACCEPTANCE.md`
    - `plans/app-server/DOC-CONSISTENCY-CHECKLIST.md`
  - 要点：
    - 明确 replaySeq/canonical ordering、toolName sticky、gap 重建策略
  - 验收：
    - 文档中不存在互相冲突的 ordering/source 描述。

### P2：Tool Presentation IR（并行，不阻塞 P0/P1）

- [x] T8 统一 Tool Presentation IR（跨端 presenter，端内 renderer）
  - 文件：
    - 新增 `src/features/tools/presentation/*`（IR + registry）
    - Web：`apps/web-reference-react/src/components/tool/*` 适配 renderer
    - TUI：`src/screens/repl/transcript.tsx` 或现有 tool blocks 渲染入口
  - 要点：
    - 新工具特化只改 presenter
    - 全局 UI 基元调整只改 renderer
  - 验收：
    - 新增一个工具 renderer 时，不需要同时改多端多处语义代码。
  - 当前进展：
    - 已完成：新增跨端共享参数解析基元 `src/features/tools/presentation/paramsText.ts`（parse/order/stringify/json-array count）。
    - 已完成：Web `formatToolParams` 与 `toolBlocksRegistry` 改为消费共享基元，减少 tool 参数解析分叉。
    - 已完成：语义层 canonical adapters（stream/turn notification）统一使用共享 `formatToolInputAsParamsText` 产出可解析 `key=value` 形式的 `paramsText`。
    - 已完成：共享参数解析兼容旧 replay 的 JSON-object `paramsText`，避免历史数据回放出现原始 `{...}` 退化展示。
    - 已完成：新增跨端共享展示文案基元 `src/features/tools/presentation/labels.ts`，Web/TUI 的 AskUserQuestion/TodoWrite 共用计数标签与状态摘要规则。
    - 已完成：EnterPlanMode/ExitPlanMode 的状态摘要规则收敛到共享 labels 基元，减少 Web/TUI 规则分叉。
    - 已完成：AskUserQuestion 答案解析逻辑下沉到共享基元 `src/features/tools/presentation/askAnswers.ts`，Web 与 TUI 复用同一解析函数。
    - 已完成：AskUserQuestion 题目归一化与 `fieldId` 解析下沉到共享基元 `src/features/tools/presentation/askQuestions.ts`，Web/TUI 统一键名策略。
    - 已完成：新增共享 `toolSemantics`（`ask/todo/plan` 语义分类 + interactive 判定），并接入 Web tool blocks 路由与 TUI prompt-mode 判定，减少端内硬编码分叉。
    - 已完成：Web AskUserQuestion 在 detail 缺失时会尝试从 summary JSON 提取答案，并对原始 `{...}` 摘要降噪为语义文案（避免折叠行出现孤立 `{`）。
    - 已完成：Web AskUserQuestion 题目计数改为优先读取未截断 `paramsText` 并走共享 `interactivePrompts` 归一化，避免长 JSON 被 display 截断后误显示 `0 questions`。
    - 已完成：Enter/ExitPlanMode 的问题与选项定义抽到共享 `planModeQuestions` 基元，handler 与 TUI prompt 展示共用同一份文案/顺序，减少交互规则漂移。
    - 已完成：新增共享 `interactivePrompts` 模型层（ask/enter-plan/exit-plan），并接入 TUI presenters（AskUserQuestion / EnterPlanMode / ExitPlanMode）统一 prompt 语义源。
    - 说明：TUI 的交互式 prompt 具体布局/输入控件仍保留端内实现（符合“跨端 presenter、端内 renderer”边界），语义层已统一。

---

## 降级止血清单（仅兜底，不抢主线）

> 以下项来自 WebGPT Phase 1，保留但降级。  
> 触发条件：若 P0/P1 排期被阻塞，先做这些以降低线上风险。

- [x] S1 Web `store.ts` 去掉 turn-tail 回写扫描，改最小版 open-segment 指针
  - 原因：可快速止血，但会与 T1 重叠，属于过渡实现。

- [x] S2 `turnRunner` 在 `tool_input/tool_update/tool_end` 追加 `toolName`
  - 文件：`src/app-server/turnRunner.ts`
  - 原因：向后兼容字段补齐，可独立落地且风险低。

- [x] S3 `turnEventCursor` 主键切到 replaySeq（trace/seq 只保留诊断）
  - 文件：`apps/web-reference-react/src/turnEventCursor.ts` + `apps/web-reference-react/src/App.tsx`
  - 原因：能降低乱序风险，但仍非最终结构化方案。

- [x] S4 `toolEventNormalizer` 增加跨事件 toolName cache（首次 update/end 也尽量回填）
  - 文件：`apps/web-reference-react/src/toolEventNormalizer.ts`
  - 原因：修复概率性 `Tool (...)` 退化，但最终应由 canonical projector 统一处理。

---

## WebGPT 建议“不遗漏”映射表（逐条对照）

| WebGPT Recommendation-to-File Map | 本仓当前状态 | 对应任务 | 备注 |
| --- | --- | --- | --- |
| 1. Web delta 改为当前 segment append | 未完成 | T1（主线）/ S1（兜底） | 当前仍有 turn-tail 回写逻辑 |
| 2. tool_event 关闭文本段 | 未完成 | T1（主线）/ S1（兜底） | 当前无显式 open segment 状态 |
| 3. Server update/end 补 toolName | 部分完成 | T6（主线）/ S2（兜底） | 仅 reader 侧保名，写入侧仍缺 |
| 4. Web toolName sticky | 部分完成 | T2（主线）/ S4（兜底） | 已补 logs 级 sticky cache；canonical projector 统一仍待完成 |
| 5. ordering 迁移 replaySeq | 部分完成 | T2 + T5（主线）/ S3（兜底） | notification 过滤已 replaySeq 优先；线程切换仍非 replay-first |
| 6. 共享 Transcript Projection | 未完成 | T0/T1/T2/T3/T4 | 本次主线核心 |
| 7. 减少 history->logs 直映射 | 部分完成 | T5/T6 | 线程切换已 replay-first；history 仍用于 fallback 与上翻分页 |
| 8. Tool UI IR 插拔体系 | 已完成 | T8 | 已形成共享语义/解析/标签/prompt 模型，端内只保留 renderer 差异 |

---

## Validation Matrix 映射（防遗漏）

| 验收点 | 对应任务 | 必要断言 |
| --- | --- | --- |
| 同一 turn 顺序稳定（无反转/穿插） | T1 / T4（兜底 S1） | delta 不回写旧 segment；tool 插入后后续 delta 必开新段 |
| toolName 不退化为 `Tool (...)` | T2 / T6（兜底 S2/S4） | update/end 缺字段时仍可从 sticky cache 恢复名称 |
| replay gap 重建正确 | T5 / T6 | `hasGap=true` 不走增量拼接，必须触发重建 |
| mode/input 交错一致 | T0 / T2 / T3 / T4 | input/mode 只在 projector 演化，幂等去重 |
| segment 边界保留 | T1 / T4 | assistant/thinking/tool/input 均为独立 segment，可多段并存 |

---

## 现有基线（保留）

- [x] `thread/replay` 已落地（含 `hasGap` 与 runtime state）
- [x] `command/dispatch` 已落地（`/init`、`/clear`、`/compact`、`/todos`）
- [x] mode/input 语义层已有基础（`threadRuntimeState`、`inputStateMachine`、`commandRouting`）
- [x] Web 审批输入区 dock 已落地（ask 分页 / approval submit）
- [x] Canonical transcript projection 基础已落地（`canonicalEvents` + `transcriptProjection`）
- [x] Web 实时 turn 事件已切 canonical projection（含 assistant/tool/input/footer 路径）

---

## 其他 backlog（不在本次 WebGPT 主线内）

- [x] commander 命令范围确认（当前仅支持 `/init`、`/clear`、`/compact`、`/todos`，其余能力暂不扩展）
- [ ] 配置类命令（如 `/agents`、`/hooks`、`/permissions`）默认不接入 Web
- [ ] 远程暴露场景安全增强（TLS/WSS、细粒度鉴权、限流与审计）
