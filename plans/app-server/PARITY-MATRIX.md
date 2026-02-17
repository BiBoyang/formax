# TUI/GUI Parity Matrix（语义层）

更新时间：2026-02-12

## 目标

这份矩阵用于追踪“同一用户意图在 TUI 与 GUI 是否走同一语义路径”，并绑定到具体模块与测试门禁。

## 能力矩阵

| 能力 | 语义单一来源 | TUI 接入 | App-Server 接入 | Web 接入 | 测试门禁 |
| --- | --- | --- | --- | --- | --- |
| mode 注入（normal/acceptEdits/plan） | `src/features/semantics/core/modeSemantics.ts` | `src/features/repl/controller/send.ts` | `src/app-server/turnRunner.ts` | `apps/web-reference-react/src/App.tsx`（`turn/start.mode` + `turn/modeChanged` + replay state） | `src/features/semantics/core/modeSemantics.test.ts` + contract |
| mode transition（运行期切换） | `src/features/semantics/core/replModeTransition.ts` | `src/features/repl/useReplController.ts` | `src/app-server/turnRunner.ts`（`turn/modeChanged`） | `apps/web-reference-react/src/App.tsx`（消费通知与线程缓存） | `src/features/semantics/core/replModeTransition.test.ts` + `src/app-server/turnRunner.test.ts` + `apps/web-reference-react/src/App.test.tsx` |
| slash 语义（/init） | `src/features/semantics/core/slashSemantics.ts` | `src/features/repl/controller/send.ts` | `src/app-server/turnRunner.ts` | N/A（server 结果驱动） | `src/features/semantics/core/slashSemantics.test.ts` |
| turn 输入构建 | `src/features/semantics/adapters/turnInputBuilder.ts` | `src/features/repl/controller/send.ts` | `src/app-server/turnRunner.ts` | N/A | `src/features/semantics/adapters/turnInputBuilder.test.ts` + contract |
| input 生命周期（approval/question） | `src/features/semantics/runtime/inputStateMachine.ts` | N/A（runtime manager） | `src/app-server/turn/inputStore.ts` | `apps/web-reference-react/src/store.ts` | `src/features/semantics/runtime/inputStateMachine.test.ts` + `src/app-server/turn/inputStore.test.ts` + `apps/web-reference-react/src/store.test.ts` |
| 工具事件归并（start/update/end） | `apps/web-reference-react/src/toolEventNormalizer.ts` | N/A | N/A | `apps/web-reference-react/src/store.ts` + `apps/web-reference-react/src/App.tsx` | `apps/web-reference-react/src/toolEventNormalizer.test.ts` + reducer/UI tests |
| 事件去重与乱序保护（eventId/traceId/seq） | `apps/web-reference-react/src/turnEventCursor.ts` | N/A | 发出序号字段 | `apps/web-reference-react/src/App.tsx` | `apps/web-reference-react/src/turnEventCursor.test.ts` + `apps/web-reference-react/src/App.test.tsx` |

## 当前已知缺口

1. 协议文档需补齐 `turn/modeChanged` 与 replay state 中 `mode` 字段说明（文档一致性项）。
2. 协议扩展（replay / command-dispatch）尚未进入本阶段实现。
3. commander 全量能力迁移不在当前主线。

## 合并前最小检查清单

1. 根仓库：`bun run type-check`
2. 语义层：`bun run test -- src/features/semantics/**`
3. app-server：`bun run test -- src/app-server/turn/inputStore.test.ts src/app-server/turnRunner.test.ts`
4. web：在 `apps/web-reference-react` 下运行
   - `bun run type-check`
   - `bun run test -- src/turnEventCursor.test.ts src/toolEventNormalizer.test.ts src/store.test.ts src/App.test.tsx`
