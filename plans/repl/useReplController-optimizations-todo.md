# useReplController / 语义化后续优化 TODO

Status: `in_progress`  
基线: `plans/repl/useReplController-refactors-phase2.md` 已完成  
目标: 在不改行为前提下，继续降低 `useReplController` 复杂度并提升语义层一致性。

## 约束（先对齐）

- 不引入 `src/features/semantics/index.ts` 这类统一 barrel 入口。
- 保持当前目录命名入口风格（`xxx/xxx.ts`），不回退到 `index.ts` 聚合导出。
- 每个 slice 单一意图：完成后 `test + type-check + review` 再提交。

## TODO 看板

- [x] S1: 抽出「SessionWriter 进程信号/退出处理」  
  位置: `src/features/repl/useReplController.ts` -> `src/features/repl/controller/session/*`  
  目标: 下沉 `SIGINT/SIGTERM/beforeExit/uncaughtException/unhandledRejection` flush 逻辑，hook 仅保留调用。

- [x] S2: 抽出 `runResumeSessionTransition`，统一三类 session 切换  
  位置: `src/features/repl/controller/session/sessionTransitions.ts`  
  目标: `abort/newSession/resume` 同风格；`useReplController` 内 `resumeSession` 仅保留 guard + orchestration。

- [x] S3: 抽出 provider 错误 UI 更新 helper  
  位置: `src/features/repl/controller/shared/*` 或 `src/features/repl/controller/send/*`  
  目标: `send` 中 providerError 分支只保留一行 helper 调用。

- [x] S4: 继续下沉 send 主流程 orchestrator  
  位置: `src/features/repl/useReplController.ts` + `src/features/repl/controller/send/*`  
  目标: `send` 只保留输入 guard 与 orchestration call；将 main/pre-main 组装进一步集中到 controller 层。

- [ ] S5: 语义适配器重复逻辑去重（不改入口结构）  
  位置: `src/features/semantics/adapters/streamCanonicalAdapter.ts`、`src/features/semantics/adapters/turnNotificationCanonicalAdapter.ts`  
  目标: 抽公共解析 helper（tool/assistant/thinking 映射），降低跨端漂移风险。

- [ ] S6: canonical turn merge 策略再拆分  
  位置: `src/features/repl/controller/canonical/canonicalTurnMessages.ts`  
  目标: 分离“segment->message 映射”与“legacy/canonical 合并策略”，便于排查重复 tool row/assistant 丢失。

## 暂缓项（明确不在本轮做）

- 不做 `send` 依赖数组“ref 化降噪”改造（易引入 stale closure 风险）。
- 不做 `isFailureSubline` 工厂化（当前收益低）。
- 不做 semantics 统一 barrel 入口（与当前入口策略冲突）。

## 验收标准

- `src/features/repl/useReplController.ts` 目标降到 `~820-860` 行区间。
- 关键测试通过：
  - `src/features/repl/useReplController.test.tsx`
  - `src/features/repl/controller/send/*.test.ts`
  - `src/features/repl/controller/canonical/*.test.ts`
  - `src/features/semantics/__tests__/projectionParity.test.ts`
  - `src/features/semantics/runtime/*.test.ts`
- `bun run type-check` 通过。
- `codex review --uncommitted -c model="gpt-5.3-codex" -c model_reasoning_effort="medium"` 无中高问题。
