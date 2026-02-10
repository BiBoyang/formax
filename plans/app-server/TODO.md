# TODO：Formax App Server（主线入口）

更新时间：2026-02-10

> 说明：`TODO.md` 保持为“入口级索引”，避免与详细执行清单双写漂移。

## 当前执行主线

- [ ] TUI/GUI 语义一致性融合路线（v2）
  - 执行清单：`plans/app-server/TODO-SEMANTICS-PARITY.md`
  - 来源融合：`plans/app-server/SEMANTICS-PARITY-ARCH.txt` + `plans/app-server/webgpt-response-2.txt` + 代码现状
  - 目标：统一 Turn 输入构建、mode 注入、input 生命周期、tool 事件归一、事件光标策略

## 近期已落地（作为基线，不再重复维护 TODO 项）

- [x] Web 事件幂等与顺序保护（`eventId + traceId + seq`）
- [x] `thread/resume` stale input 恢复链路
- [x] transcript 收敛（thinking 运行/完成态 + turn footer）
- [x] 中栏/右栏滚动边界治理 + Playwright 基线用例

## 暂缓（等待 Extended 结果后再决策）

- [ ] ThreadStateReducer 全量抽象（server/web 统一线程状态归约）
- [ ] 协议扩展（`replay`、`command/dispatch` 等）
- [ ] commander 全量能力迁移（超出 `/init`）
