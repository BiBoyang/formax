# TODO-INDEX：web-reference-react-refactor（Rolling）

更新时间：2026-02-21
任务来源（唯一）：
- `plans/web-reference-react-refactor/README.md`

> 本清单只保留未完成任务。历史完成记录以 Git commit 为准。

## 当前待办

- Phase 1：拆分 `useAppRuntime`（职责解耦，不改 store 语义）
  - `createThreadDataOps` / `createThreadActions` / `createComposerActions`：收敛依赖参数，避免“把整个世界塞进去”
  - 验收：
    - 全部单测 + e2e
    - 手动验证：切线程/回放、load earlier、diff patch 展开、archive rollback

- Phase 2：收敛 state（SSOT + selectors）
  - 选择策略（两种选其一，建议从 A 开始）：
    - A) 继续用 React `useReducer`，把投影合并/日志 merge 移到 reducer 外投影引擎，reducer 只存最小事实（events/projection snapshot cursor）
    - B) 引入 external store + `useSyncExternalStore`（仅限本 app），selectors 精确订阅
  - 具体落点：
    - 明确 `logs` 的定位：渲染模型 vs 协议事件派生结果
    - 若走 A：将 `applyCanonicalProjectionEvent` 的重逻辑迁出到 `src/app/core/projectionEngine.ts`（或类似），做增量 patch
    - 统一 thread-scoped 缓存：收敛 `logsByThreadId` / `historyCursor` / `transcriptSource` 到 `ThreadCache`
  - 验收：
    - 性能对比：同等 transcript 规模下滚动/输入不卡顿（主观 + 简单 measure）
    - 全测试通过

- Phase 3：Transcript 渲染优化（局部更新，避免全量 rerender）
  - 抽 `TranscriptItemRow`，对 `message` / `thinking` / `tool` / `turn_footer` / `log` 分支 memo 化
  - 将 `openToolIds` / `openThinkingIds` 改为更细粒度状态（Map + 局部订阅，或 `useReducer` + row 拆分）
  - 可选：将 `filteredLogs` filter 移到 selector 层（仅在 logs 变更时计算）
  - 验收：
    - 手动：连续 toggle 50 次无明显掉帧
    - e2e：tool summary rows 刷新后仍可展开（已有用例）

- Phase 4：Markdown pipeline 主线程预算（解析/净化/高亮渐进）
  - 高亮调度：`highlightCodeBlocks` 使用 `requestIdleCallback` / `scheduler.postTask`（可降级）做低优先级
  - 可选：引入 Web Worker（marked + shiki 在 worker；主线程做 DOMPurify，或先非高亮渲染后替换）
  - cache 策略：区分 base html 与 highlighted html，避免重复 sanitize
  - 验收：
    - 人工构造长 code blocks：输入可即时、滚动不中断

- Phase 5（可选）：边界稳定性（集中语义引用入口，降低相对路径耦合）
  - 在 `apps/web-reference-react/src/semantics/` 建薄适配层，统一 re-export 语义函数/类型（集中入口）
  - 或给 root semantics 建 Vite/TS paths 别名（仅内部开发用途）
  - 验收：
    - build/type-check 通过
    - 语义文件移动时，仅需改一个适配入口

## 再生规则（当“当前待办”为空时）

1. 仅从 `plans/web-reference-react-refactor/README.md` 派生下一批任务。
2. 按“小切片可提交”拆分（每项尽量 2-6 文件改动）。
3. 每项固定流程：实现 -> 定向测试 -> `codex review` -> 提交。
4. 新任务写入本文件后，旧的已完成项不回填。

## 长期约束（重构不变的底线）

- 该 app 是**协议验证客户端**：不把它演进为生产 UI。
- 语义/协议正确性第一：事件顺序、投影输出、pending input 行为必须保持稳定；先补测试再动结构。
- 性能调度边界清晰：UI 可延迟，协议状态不可延迟；必要时保留同步 fallback。
- thread 切换一致性：跨线程缓存/refs/state 同步要有单一入口，避免多处 effect 竞写。

## 固定验收命令（在 `apps/web-reference-react/` 下执行）

- `npm run type-check`
- `npm run test`
- `npm run test:e2e`
