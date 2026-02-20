# TODO-INDEX：web-reference-react-refactor（Rolling）

更新时间：2026-02-21
任务来源（唯一）：
- `plans/web-reference-react-refactor/README.md`

> 本清单只保留未完成任务。历史完成记录以 Git commit 为准。

## 当前待办

- Phase 2：收敛 state（SSOT + selectors）
  - 明确 active transcript logs 的单一选择入口（thread cache + fallback + visible filter）并补 selector 测试。
  - 将 thread 切换/回滚路径中的 transcript logs 读取统一到 selector，减少 `state.logs`/`logsByThreadId` 分散读取。

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
