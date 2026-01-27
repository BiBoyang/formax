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

### 1) `src/screens/repl/createReplCommandRegistry.ts`

- [ ] 覆盖：
  - [ ] registry 构造的主要分支（至少覆盖 1 次返回路径）
  - [ ] 关键的 fallback/guard 分支

### 2) `src/subagents/builtins.ts`

- [ ] 覆盖：
  - [ ] builtins 列表/映射的主要分支
  - [ ] 关键 guard（缺字段/默认值）

### 3) `src/tools/modules/exitPlanMode/handler.ts`

- [ ] 覆盖：
  - [ ] 正常退出路径
  - [ ] 非 plan mode / 无 session 等边界路径

### 4) `src/utils/terminal.ts`

- [ ] 覆盖：
  - [ ] ANSI/clear 等封装的主要分支
  - [ ] no-op / 环境不支持的边界分支

### 5) `src/screens/repl/promptMode.ts`

- [ ] 覆盖：
  - [ ] prompt mode 判定的主要分支
  - [ ] 与 overlays/hooks 相关的 guard 分支

### 6) `src/adapters/permissions/permissionKeys.ts`

- [ ] 覆盖：
  - [ ] key 解析/格式化的分支（合法 + 非法）

### 7) `src/adapters/fs/checkWritableDir.ts`

- [ ] 覆盖：
  - [ ] 可写/不可写/不存在 的分支

### 8) `src/tools/modules/bash/presenter.tsx`

- [ ] 覆盖：
  - [ ] error 输出（exit code + stderr 展示）
  - [ ] approved/denied/pending 等分支

### 9) `src/tools/modules/write/presenter.tsx`

- [ ] 覆盖：
  - [ ] prompt/pending 与完成态分支

### 10) `src/ui/hooks/utils.ts`

- [ ] 覆盖：
  - [ ] matcher/hook label 相关分支（含无 matcher 事件）
