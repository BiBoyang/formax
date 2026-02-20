# TODO-INDEX：web-reference-react-refactor（Rolling）

更新时间：2026-02-20
任务来源（唯一）：
- `plans/web-reference-react-refactor/README.md`

> 本清单只保留未完成任务。历史完成记录以 Git commit 为准。

## 当前待办

- [ ] 6.1-C 迁移 replay/data ops 调用点到契约层
- [ ] 6.2-A 抽离 `markdownService`（worker/cache/fallback）并保持行为不变
- [ ] 6.2-B 增补 markdown service 单测（worker error / abort / cache）
- [ ] 6.3-A 新增 Thread ViewModel selector 与单测
- [ ] 6.3-B LeftRail/useAppRuntime 接入 Thread ViewModel selector
- [ ] 7.1-A 建立 runtime orchestrator 骨架并迁移连接初始化编排
- [ ] 7.2-A 下沉线程事务（switch/archive/replay hydrate）到 orchestrator
- [ ] 7.3-A 为 reconnect/rollback 路径补集成回归测试
- [ ] 8.1-A 搭建 transcript selector-store（保留现有语义）
- [ ] 8.2-A 引入可开关 virtualization（默认关闭）
- [ ] 8.3-A 建立固定性能压测场景与回归门禁

## 再生规则（当“当前待办”为空时）

1. 仅从 `plans/web-reference-react-refactor/README.md` 派生下一批任务。
2. 按“小切片可提交”拆分（每项尽量 2-6 文件改动）。
3. 每项固定流程：实现 -> 定向测试 -> `codex review` -> 提交。
4. 新任务写入本文件后，旧的已完成项不回填。
