# useReplController Refactors Phase 2

Status: `in_progress`
基线提交: `45624e0`
目标: 在不改行为的前提下，继续降低 `send` 链路复杂度并减少后续回归成本。

## 执行规则

- 单个 slice 完成后再统一 `test + type-check + review`，通过后提交。
- 每次提交保持单一意图，不混入无关改动。
- 默认 review 等级: `medium`。

## Slice 看板

- [x] P2.1: 拆分 `send.ts` 中 auto-compact 分支到独立模块（`sendAutoCompact.ts`）
- [x] P2.2: 拆分 `send.ts` 中 main-turn 执行分支到独立模块（`sendMainTurn.ts`）
- [x] P2.3: 收窄 `send.ts` 为路由编排壳（当前 480 行）
- [x] P2.4: provider 解析改为显式约束（未知 provider 不再静默回退）
- [x] P2.5: 增加 dev-only 单写入源断言（同 turn tool row 不重复）
- [ ] P2.6: 测试中环境变量写法逐步迁移到 `vi.stubEnv`
- [ ] P2.7: 更新 `CODEMAP.md` 的 REPL 控制器入口映射

## 验收标准

- `send.ts` 主体只保留: pre-main 路由 + main turn 调度 + finalize。
- 关键回归用例保持通过（`useReplController.test.tsx` / `send.test.ts`）。
- `bun run type-check` 通过。
- `codex review --uncommitted -c model="gpt-5.3-codex" -c model_reasoning_effort="medium"` 无中高优先级问题。

## 本轮结果（P2.1-P2.3）

- 新增 `src/features/repl/controller/sendMainTurn.ts` 承载 `runMainSendTurn(...)` 主体执行流程。
- 新增 `src/features/repl/controller/sendAutoCompact.ts` 承载 auto-compact 预处理与 notice 发射。
- 新增 `src/features/repl/controller/sendTypes.ts`，收敛 send 相关共享类型与 `createSendTurnContext(...)`。
- `src/features/repl/controller/send.ts` 从 551 行降到 480 行，仅保留 pre-main 路由与本地命令处理主壳。
- `src/features/repl/controller/provider.ts` 改为显式校验 provider；`useReplController.send()` 对不支持 provider 回显 command subline 并跳过 turn。
- `src/features/repl/controller/canonicalTurnMessages.ts` 新增 dev-only invariant：同一 turn 禁止重复 `toolUseId` tool row。
