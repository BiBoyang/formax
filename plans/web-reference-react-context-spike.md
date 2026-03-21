# WAF-D1 Spike: Context 化消除 Props Drilling（仅方案）

## 目标

- 在不改现有产品语义的前提下，评估 `web-reference-react` 中可安全 Context 化的 state/handlers。
- 明确哪些 props 链是“可下沉到 Context”的，哪些应保持显式 props 以控制渲染边界。

## 当前链路（摘要）

1. `AppShell -> TranscriptPane -> ComposerDock`
   - 传递 `mode`、`inputText`、`connectionStatus`、`onSend`、`onInterrupt` 等。
2. `AppShell -> LeftRail/RightRail/Terminal`
   - 传递 pane 显隐、宽高、拖拽提交函数、thread 选中状态。
3. `TranscriptPane -> TranscriptFeed/rows`
   - 传递 render-window 结果、展开历史、滚动贴底相关行为。

## Context 候选（建议按阶段）

1. `ThreadUiContext`（低风险）
   - 内容：`activeThreadId`、thread 级只读 metadata、thread list selection helpers。
   - 原因：消费点分散、更新频率中低、对输入框打字热路径影响小。

2. `PaneLayoutContext`（中风险）
   - 内容：left/right/terminal 显隐状态、尺寸缓存、toggle/restore handler。
   - 风险：拖拽时高频更新，Context 粒度过大时会触发整树重渲染。
   - 缓解：state 与 actions 分拆为两个 context；dragging transient state 继续局部化。

3. `ComposerSessionContext`（高风险，后置）
   - 内容：`inputText`、slash menu 状态、mode、send/interrupt 入口。
   - 风险：输入热路径最敏感；若 Provider 覆盖范围过大会导致明显 typing jank。
   - 缓解：优先保持 `TranscriptPane -> ComposerDock` 显式 props；仅将只读配置项 Context 化。

## 不建议 Context 化（当前阶段）

1. `useRenderWindow` 内部滚动与 render-limit 状态机。
   - 理由：局部状态强、事件高频、与 DOM refs 耦合，跨组件共享收益低、风险高。
2. 工具行展开态 `openToolIds`。
   - 理由：作用域局部，迁移到全局 context 会扩大渲染面。

## 推荐实施顺序

1. 先做 `ThreadUiContext`（只读/低频）。
2. 再做 `PaneLayoutContext`（state/actions 双 context）。
3. `ComposerSessionContext` 仅在 profile 证明无打字回归后再推进。

## 验证基线

1. 自动化：
   - `npm --prefix packages/web-reference-react run test -- src/App.test.tsx`
   - `npm --prefix packages/web-reference-react run test -- src/components/TranscriptPane.test.tsx`
   - `npm --prefix packages/web-reference-react run test -- src/components/LeftRail.test.tsx`
2. 手工 smoke：
   - 快速输入/删除 + slash 菜单导航无明显卡顿。
   - 拖拽 sidebar/right rail/terminal 与 toggle 记忆行为保持。
   - 线程切换后 transcript 与 terminal 状态不串线。

## 结论

- D1 已形成可执行 spike 方案，可在后续独立迭代按“低风险到高风险”顺序推进。
- 当前轮次不实施生产代码改动，符合“先 spike”约束。
