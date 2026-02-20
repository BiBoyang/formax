# TODO-INDEX：web-reference-react-refactor（Rolling）

更新时间：2026-02-21
任务来源（唯一）：
- `plans/web-reference-react-refactor/README.md`

> 本清单只保留未完成任务。历史完成记录以 Git commit 为准。

## 当前待办

- Phase 2：收敛 state（SSOT + selectors）
  - 选择策略（两种选其一，建议从 A 开始）：
    - A) 继续用 React `useReducer`，把投影合并/日志 merge 移到 reducer 外投影引擎，reducer 只存最小事实（events/projection snapshot cursor）
    - B) 引入 external store + `useSyncExternalStore`（仅限本 app），selectors 精确订阅
  - 具体落点：
  - 验收：
    - 性能对比：同等 transcript 规模下滚动/输入不卡顿（主观 + 简单 measure）
    - 全测试通过

- Phase 4：Markdown pipeline 主线程预算（解析/净化/高亮渐进）
  - 可选：引入 Web Worker（marked + shiki 在 worker；主线程做 DOMPurify，或先非高亮渲染后替换）
  - 验收：
    - 人工构造长 code blocks：输入可即时、滚动不中断

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
