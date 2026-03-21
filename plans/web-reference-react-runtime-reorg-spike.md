# WAF-D2 Spike: runtime 目录大重排蓝图（仅方案）

## 目标

- 为 `packages/web-reference-react/src/app` 的 runtime 相关代码建立可落地的重排方案。
- 保证重排期间不改变既有语义（线程切换、流式事件、终端桥接、pane 布局、设置持久化）。

## 当前主要痛点

1. runtime 职责分散：
   - state 映射、事件归一化、UI 适配层分布在多个目录，改动时需要跨文件追踪。
2. 命名不一致：
   - 同类逻辑在 `app/`, `store`, `eventAdapters`, `semantics` 等之间边界不够直观。
3. 测试入口与实现入口对应关系弱：
   - 新同学很难快速定位“某个行为应该改哪一层”。

## 目标目录（提案）

```text
src/
  app/
    runtime/
      reducers/
      projections/
      events/
      persistence/
      bridges/
    ui/
    core/
```

- `reducers/`: 主状态推进与 action 规约。
- `projections/`: 面向 UI 的派生结果与选择器。
- `events/`: RPC/tool/transcript 事件标准化与顺序保障。
- `persistence/`: local/session storage 边界。
- `bridges/`: desktop/web 差异桥接封装。

## 分阶段迁移策略

1. Phase A（结构准备）
   - 仅新增目录和 barrel 文件，不移动实现，先建立目标边界。
2. Phase B（无行为迁移）
   - 逐类搬迁文件（每次只迁一种职责），保持导出 API 不变。
3. Phase C（导入收敛）
   - 清理旧路径，统一到新目录。
4. Phase D（契约与文档更新）
   - 更新 `CODEMAP.md` 与相关 contracts/link 文档。

## 每次迁移切片约束

1. 每个 commit 只迁 2-5 个文件。
2. 不在同一切片同时做“路径迁移 + 逻辑重构”。
3. 完成迁移切片后必须运行：
   - `npm --prefix packages/web-reference-react run test -- src/App.test.tsx`
   - `npm --prefix packages/web-reference-react run test -- src/components/TranscriptPane.test.tsx`
   - `npm --prefix packages/web-reference-react run test -- src/components/LeftRail.test.tsx`
   - `codex review --uncommitted -c model="gpt-5.3-codex" -c model_reasoning_effort="medium"`

## 风险与守护

1. 事件顺序风险：
   - 容易在迁移中破坏 `seq`/`eventId` 去重与有序性，必须用现有集成测试锁定。
2. 性能风险：
   - selector/projection 若跨层搬迁时意外失去 memo，会造成 UI 重渲染放大。
3. 回滚策略：
   - 每个切片保证单独可回退，避免“大迁移单提交”。

## 结论

- D2 已有可执行蓝图和分阶段约束，后续可在稳定窗口按小切片落地。
- 当前轮次不执行生产代码迁移，先完成方案固化与风险前置。
