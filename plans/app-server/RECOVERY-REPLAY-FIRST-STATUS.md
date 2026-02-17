# Replay-First Recovery Status

更新时间：2026-02-18

目标来源：
- `plans/app-server/ARCHITECTURE-ROADMAP.md`（Milestone 3）
- `plans/app-server/SEMANTICS-ARCHITECTURE-BLUEPRINT.md`（恢复一致性）

## 结论

- `hasGap=true`：已走 baseline replay + snapshot hydrate 重建路径（`replayThreadEvents.ts`）。
- reconnect：连接恢复后会对 active thread 重新执行 replay（`connectRpcClient.ts`）。
- restart / thread switch：线程切换与新线程创建会优先 replay 恢复，失败才回退（`threadActions.ts`）。

## 证据（测试）

在 `apps/web-reference-react` 下执行：

```bash
bunx vitest run --config vitest.config.ts \
  src/app/runtime/processNotification.test.ts \
  src/app/runtime/replayThreadEvents.test.ts \
  src/app/runtime/threadActions.test.ts
```

最近一次结果：`3 files / 41 tests` 全部通过。

