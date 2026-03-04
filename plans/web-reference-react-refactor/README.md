# Web Reference React Refactor Blueprint (Active)

目标：在不改变现有语义和交互的前提下，完成一轮“不过度”的前端稳态优化，优先降低渲染开销与维护负担。

最后更新时间：2026-03-05

## 执行状态（Active）

- 已完成：运行时状态更新去抖回合（Slice A/B/C/D/E/F/G/H/I/J/K/L/M/N/O）。
- 已完成：运行时边界收口回合（Slice P）：
  - `threadDataOps` 与 `diffDataOps` 职责拆分
  - `useDevLoadAllHistory` 下沉 dev-only 历史加载状态机
  - `thread/composer/diff` UI handler 组合器下沉到 `runtime/*`
- 已完成：组合根瘦身回合（Slice Q）：
  - `useRuntimeViewState` 抽离 view state + stable setter 组
  - `useRuntimeEventOrchestrator` 抽离 notification/replay/archive 编排
  - `useRuntimeActionsBundle` 抽离 thread/composer action 组装
  - `buildAppShellProps` 抽离 AppShell props 组装映射
  - `rpcQueueMetrics` 抽离队列指标日志策略
- 已完成：组合根细节优化回合（Slice R）：
  - `useRuntimeActionsBundle` 参数按 `core/thread/composer` 分组，移除 25+ 平铺参数签名
  - `useRuntimeRefSync` 扩展为统一同步 `activeTurnId/pendingInputs/sortedThreads` refs
  - notice auto-dismiss 从 `useAppRuntime` 下沉到 `useRuntimeViewState`
- 当前待办：以 `plans/web-reference-react-refactor/TODO-INDEX.md` 为准

## 范围约束（严格）

- 不做产品化 UI 改版，不改文案和交互语义。
- 只做低风险、可回归验证的优化；禁止“为了优化而优化”。
- 每项都要有对应测试或回归验证。

## 当前任务清单（唯一来源）

- 当前无未完成切片；下一批任务由 `TODO-INDEX.md` 再生规则派生。

## 执行循环（固定）

- 每个切片：实现 -> 定向测试 -> `codex review` -> 提交。
- 切片粒度：尽量 2-6 文件。
- 阶段门禁（在 `apps/web-reference-react/` 下）：
  - `npm run type-check`
  - `npm run test -- <targeted files>`
