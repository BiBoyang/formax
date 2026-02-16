# useReplController Refactors Phase 2

Status: `in_progress`
基线提交: `45624e0`
目标: 在不改行为的前提下，继续降低 `send` 链路复杂度并减少后续回归成本。

## 执行规则

- 单个 slice 完成后再统一 `test + type-check + review`，通过后提交。
- 每次提交保持单一意图，不混入无关改动。
- 默认 review 等级: `medium`。

## Slice 看板

- [ ] P2.1: 拆分 `send.ts` 中 auto-compact 分支到独立模块（如 `sendAutoCompact.ts`）
- [ ] P2.2: 拆分 `send.ts` 中 main-turn 执行分支到独立模块（如 `sendMainTurn.ts`）
- [ ] P2.3: 收窄 `send.ts` 为路由编排壳（目标文件长度 < 500 行）
- [ ] P2.4: provider 解析改为显式约束（未知 provider 不再静默回退）
- [ ] P2.5: 增加 dev-only 单写入源断言（同 turn tool row 不重复）
- [ ] P2.6: 测试中环境变量写法逐步迁移到 `vi.stubEnv`
- [ ] P2.7: 更新 `CODEMAP.md` 的 REPL 控制器入口映射

## 验收标准

- `send.ts` 主体只保留: pre-main 路由 + main turn 调度 + finalize。
- 关键回归用例保持通过（`useReplController.test.tsx` / `send.test.ts`）。
- `bun run type-check` 通过。
- `codex review --uncommitted -c model="gpt-5.3-codex" -c model_reasoning_effort="medium"` 无中高优先级问题。
