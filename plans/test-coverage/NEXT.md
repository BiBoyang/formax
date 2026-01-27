# Test Coverage 下一轮（按 Branches 优先）

目标：在不改 UI 文案/颜色/间距、不做大重构的前提下，优先把“稳定基座相关”模块的 **branch coverage** 补齐；每个模块尽量用“最小回归测试”覆盖关键分支（deny/allow/error/edge cases）。

> 明确不做（本轮跳过）：`src/tools/modules/search`、`src/tools/modules/glob`、`src/tools/modules/webFetch`  
> 原因：优先级/投入产出比不高；后续需要再做时再开一轮。

## 执行规范（每个模块一轮）

- [ ] 先跑目标模块相关测试（单文件/小范围），确认当前行为
- [ ] 只补“缺失分支”的测试：错误/空输入/边界/异常分支优先，避免为了覆盖率写无意义测试
- [ ] 跑 `bun run test:coverage:gate`
- [ ] 更新本文件：把完成项直接删除（不留 `[x]` 噪音）
- [ ] `git add` + commit（Conventional Commit）

## 优先顺序（按 Branches 倒序；跳过 search / glob / webFetch）

> 参考 `coverage/coverage-final.json`（branches% 升序）。

<!-- empty: all done -->
