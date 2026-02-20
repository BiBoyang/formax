# Web Reference React Refactor Blueprint

目标：对 `apps/web-reference-react` 做**结构性优化**，提升可维护性、性能与调试确定性，同时保持“协议验证客户端”的定位与行为稳定（不把它演进成生产 UI）。

最后更新时间：2026-02-21

## 执行状态（2026-02-21）

- Phase 0：已完成
- Phase 1：已完成
- Phase 2：已完成（保持 `useReducer` 路线，projection/log selectors/thread cache 已收敛）
- Phase 3：已完成
- Phase 4：已完成（含 worker 路径与 fallback）
- Phase 5：已完成
- 当前待办：无（以 `plans/web-reference-react-refactor/TODO-INDEX.md` 为准）

## 背景与现状（快速画像）

该 app 当前具备良好的测试基础（Vitest + Playwright），并且在语义/协议层面复用了仓库内的 canonical semantics（例如投影、thread runtime state、canonical event adapter 等）。但在 Web 侧实现上，存在几个明显的“高耦合/高 churn”热点：

- **`src/app/useAppRuntime.ts` 过度聚合**
  - 连接层（RPC/WebSocket）、数据 ops（thread/diff/history）、回放/replay、UI 状态（pane sizes、dock 状态、notice）、以及大量 `ref` 同居一个 hook。
  - 结果是：职责边界不清晰、调试成本高、重构风险大、性能优化难以局部化。
- **`src/store.ts` 既当 reducer 又做投影合并/日志整形**
  - reducer 内有投影增量合并、logs merge、工具名 hydrate、以及大量数组复制/拼接。
  - 当 transcript 变长、通知频繁时，React state 变更会放大渲染成本与 GC 压力。
- **Transcript 渲染窗口是“手写 windowing”，但仍有全量 rerender 风险**
  - `TranscriptPane` 通过 `renderLimit` + slice 限制渲染数量，这很好；但 `openToolIds/openThinkingIds` 是对象 state，每次 toggle 会让整个 list 重新 render。
  - `MarkdownRenderer` 虽有 cache，但仍存在“解析/净化/高亮”在主线程竞争的问题（尤其是包含大量 code blocks 的 assistant 输出）。
- **跨层 import 路径长、耦合隐性**
  - 多处引用仓库根 `src/features/**` 的实现（通过相对路径），这对“reference app 作为独立工程”的边界不友好，未来移动文件/重命名会产生脆弱性。

## 大方向 / 方针（原则 + 优先级）

这些方针用于指导所有后续改动，避免“为了重构而重构”：

1) **以语义/协议正确性为第一约束**
   - 该 app 的核心价值是验证 app-server 协议、replay/projection 行为与 UI 交互不回退。
   - 任何重构必须保持事件顺序、投影输出、pending input 行为一致；优先加/补测试锁行为，再动结构。

2) **先解耦“运行时（runtime）”与“视图（UI）”，再谈性能**
   - 先把 `useAppRuntime` 拆成可测试的模块（transport、thread runtime、data ops、ui adapters）。
   - 性能优化以“减少无意义 rerender、避免大数组复制、将重计算移出 React render”作为主轴。

3) **把“数据源”做成单一事实来源（SSOT），降低 duplicated state**
   - 当前同时存在 `state.logs`、`logsByThreadId`、projection state、以及多个 thread-scoped ref。
   - 目标是：明确每条数据的 owner（store vs ref cache vs derived selector），减少同步/双写。

4) **主线程预算优先给交互（滚动/输入），重计算应可中断/可降级**
   - Markdown 解析/净化/高亮、diff patch 渲染等都应具备 idle 调度、缓存、以及“先快后全”的渐进策略。

5) **reference app 也要“工程化边界”，但不追求过度抽象**
   - 只抽取能显著降低 churn 的边界：`runtime/`、`state/`、`ui/`、`adapters/`。
   - 保持文件可定位、易调试；避免引入重型框架（除非 virtualization 需要）。

## 目标架构（建议形态）

### 1) Runtime 与 UI 的接口收敛

让 UI 仅消费一个稳定的 `AppRuntime`（selectors + actions），而不是一坨 props：

- `runtime/transport`：RPC client connect/request、重连、pending request 生命周期
- `runtime/thread`：replay、notification processing、thread state 缓存（thread-scoped）
- `runtime/dataOps`：thread list/history、diff summary/patch、archive/rename
- `state/`：单一 store（可选 external store）+ typed actions + selectors
- `ui/`：AppShell/Transcript/Diff 等纯视图，避免直接触碰 transport 细节

### 2) Store 侧“最小更新”与“派生计算外移”

在 reducer 内避免做重计算与 O(n) merge：

- 把投影合并（projection → transcript items）做成：
  - **增量**：基于事件 id/turn segment 的 patch 更新
  - **可缓存**：按 threadId/turnId 缓存
  - **可调度**：必要时使用 idle/transition 做低优先级更新

### 3) Transcript 渲染从“数组 map”升级为“可局部更新”

- item 行组件 memo 化（按 `item.id` 与必要 props）
- open/close 状态使用更细粒度的 state（例如 `useReducer` + per-id toggle，或放入 external store），避免触发全列表 render
- 如 transcript 规模进一步扩大：引入轻量 virtualization（react-virtual / react-window）作为可选阶段

## 分阶段蓝图（可执行、低风险）

### Phase 0：基线与护栏（1–2 天）

- **目标**：在不改行为的前提下，增加可观测性与重构安全网。
- **改动面**
  - 增加“开发态性能标记”（例如 console.time/measure 或轻量 instrumentation 开关）
  - 明确关键不变量：notification 顺序、projection hydrate 行为、history fallback 条件
- **验收**
  - `npm run type-check`
  - `npm run test`
  - `npm run test:e2e`

### Phase 1：拆分 `useAppRuntime`（职责解耦，不改 store 语义）（2–4 天）

- **目标**：把连接/回放/ops 从 hook 内抽出来，形成明确模块边界。
- **建议拆分**
  - `src/app/runtime/connectRpcClient.ts` 保持，但把初始化链（handshake + refresh + resume + replay）抽成 `initializeRuntime.ts`
  - `processNotification` 保持纯函数风格，context 类型更严格（减少 `any`）
  - `createThreadDataOps`、`createThreadActions`、`createComposerActions` 保持 factory，但收敛依赖参数，避免把整个世界塞进去
- **验收**
  - 全部单测 + e2e
  - 手动验证：切线程/回放、load earlier、diff patch 展开、archive rollback

### Phase 2：收敛 state：定义 SSOT + selectors（3–6 天）

- **目标**：减少 duplicated state 与大数组复制，降低 rerender 面积。
- **策略（两种选其一，建议从 A 开始）**
  - A) **保持 React `useReducer`**，但把重计算（投影合并/日志 merge）搬到 reducer 外的“投影引擎”，reducer 只存最小事实（events/projection snapshot cursor）。
  - B) 引入 **external store + `useSyncExternalStore`**（仅限本 app），让 selectors 精确订阅，UI 组件按需更新。
- **具体落点**
  - 明确：`logs` 是“渲染模型”还是“协议事件的派生结果”
  - 若走 A：将 `applyCanonicalProjectionEvent` 的重逻辑移到 `src/app/core/projectionEngine.ts`（或类似），做增量 patch
  - 统一 thread-scoped 缓存：把 `logsByThreadId/historyCursor/transcriptSource` 收敛到一个 `ThreadCache` 模块
- **验收**
  - 性能对比：同等 transcript 规模下，滚动/输入不卡顿（至少主观 + 简单 measure）
  - 全测试通过

### Phase 3：Transcript 渲染优化（2–5 天）

- **目标**：让“打开/关闭 tool/thinking”不会让整个 transcript list 重绘。
- **建议动作**
  - 抽 `TranscriptItemRow`，对 `message/thinking/tool/footer/log` 分支做 memo
  - `openToolIds/openThinkingIds` 改为更细粒度状态（例如 Map + 局部订阅，或用 `useReducer` 并把 row 组件拆开）
  - 可选：把 `filteredLogs` 的 filter 移到 selector 层（只在 logs 变更时做），避免 UI render 时重复创建闭包/临时对象
- **验收**
  - 手动：连续 toggle 50 次不明显掉帧
  - e2e 覆盖：tool summary rows 刷新后仍可展开（已有 e2e）

### Phase 4：Markdown pipeline 的主线程预算（3–7 天）

- **目标**：大段 markdown（含 code blocks）不阻塞输入与滚动。
- **建议动作**
  - 高亮调度：`highlightCodeBlocks` 用 `requestIdleCallback`/`scheduler.postTask`（可降级）做“低优先级”
  - 可选：引入 Web Worker（把 marked + shiki 搬到 worker；DOMPurify 仍在主线程，或做“先渲染未高亮→后替换”）
  - cache 策略：以 `hash(text)` 为 key（已做），但区分“base html”和“highlighted html”，避免重复 sanitize
- **验收**
  - 人工构造长代码块输出：输入框仍可即时输入、滚动不中断

### Phase 5：边界稳定性（路径与共享语义）（可选，2–4 天）

- **目标**：减少 `../../../../src/...` 的脆弱耦合，使改动更可控。
- **建议动作**
  - 在 `apps/web-reference-react/src/semantics/` 建一个“薄适配层”统一 re-export 需要的语义函数/类型（集中一个入口，减少散落引用）
  - 或在 Vite/TS paths 中给 root semantics 建别名（仅内部开发用途）
- **验收**
  - build/type-check 仍通过
  - repo 内移动语义文件时，只需改一个适配入口

## 风险清单与回滚策略

- **投影/回放行为漂移**：任何涉及 `store.ts` 与 replay/projection hydrate 的改动，必须先补单测锁住输出形态（尤其 turn segment 合并与 toolName hydrate）。
- **性能优化导致时序问题**：把计算调度到 idle/transition 时，需要明确“UI 可延迟但协议状态不可延迟”的边界；必要时保留同步 fallback。
- **跨线程缓存一致性**：thread 切换时的 ref/state 同步要有单一入口（避免多处 `useEffect` 同时写）。

## 验收命令清单（最小闭环）

在 `apps/web-reference-react/` 下：

- `npm run type-check`
- `npm run test`
- `npm run test:e2e`

## 建议的落地顺序（最小风险路径）

优先按 Phase 0 → 1 → 3 执行（先解耦，再做局部渲染优化），最后再动 Phase 2/4（涉及数据模型与计算调度，收益大但风险更高）。
