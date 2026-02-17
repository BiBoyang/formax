# App-Server Semantics Handoff

更新时间：2026-02-18

## 当前稳定快照

- 基线提交：`2acad0a8573c2803547441086c4cbe3f0ebe6497`
- 提交标题：`feat(semantics): harden cross-path parity and add safety gates`
- 状态：已收口，`plans/app-server/TODO-INDEX.md` 当前无未完成项。

## 这版已锁定的关键点

- Web 端 `turn/completed|turn/failed` 只通过 canonical adapter finalize（严格 envelope）。
- cross-path contract fixture 覆盖 stream / notification / replay-like 的 input lifecycle + terminal status。
- replay-first 边界固定，history fallback 仅在允许场景触发。
- TUI 与 Web 的 tool 展示走共享 selector（`toolViewModel`）。
- REPL 单写入门禁已接入 pre-review。
- streaming 语义性能基线与阈值检查已落地。

## 恢复现场最小命令

```bash
git show --stat 2acad0a8573c2803547441086c4cbe3f0ebe6497
bun run test:repl-semantic-gate
cd apps/web-reference-react && bunx vitest run --config vitest.config.ts src/app/runtime/processNotification.test.ts src/app/runtime/replayThreadEvents.test.ts src/app/runtime/threadActions.test.ts
cd /Users/david/Documents/github/formax && bun run check:repl-single-writer
bun run check:semantic-streaming-perf
```

## 新需求插入规则（避免被语义化任务绑住）

- 新 bug/新功能可直接插入，不要求先扩展语义化 TODO。
- 仅当改动触及语义关键路径（canonical/projection/replay/single-writer）时，补跑语义门禁。
- 若只是普通业务逻辑或 UI 细节，按对应模块的定向测试即可。

## 相关文档入口

- 架构蓝图：`plans/app-server/SEMANTICS-ARCHITECTURE-BLUEPRINT.md`
- 协议约束：`plans/app-server/INTERACTION-CONTRACT.md`
- API 语义：`plans/app-server/API-REFERENCE.md`
- 单写入审计：`plans/app-server/SINGLE-WRITER-AUDIT.md`
- 性能基线：`plans/app-server/PERF-BASELINE.md`
