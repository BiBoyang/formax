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

## 优先顺序（跳过 search / glob / webFetch 后）

### 2) `src/tools/modules/killShell`

- [ ] 覆盖至少这些分支（按现有实现细化断言）：
  - [ ] 没有正在运行的 shell / session
  - [ ] 传入 id 不存在 / 已结束
  - [ ] 正常 kill 成功
  - [ ] 重复 kill（幂等/错误信息一致性）

### 3) `src/tools/presenters`

- [ ] 优先挑“用户经常看到”的 presenter 补分支（例如：错误格式化、空内容、分段渲染）
- [ ] 覆盖点建议：
  - [ ] `is_error=true` 的 tool_result 展示分支
  - [ ] content 结构差异（string vs blocks / 多行 vs 单行）分支
  - [ ] 截断/省略/上限分支（如果有）

### 4) `src/streaming/anthropic`

- [ ] 增补“解析分支”的测试（fixture/单元）：
  - [ ] 非预期 event / 字段缺失
  - [ ] error event / 终止原因分支
  - [ ] tool_use / tool_result 边界（如果 parser 有）

### 5) `src/tools/modules/webSearch`

- [ ] 覆盖失败分支（网络失败/空结果/输入不合法/被 policy 拒绝）
- [ ] 覆盖“成功但结果为空”的分支（如果支持）

### 6) `src/tools/modules/taskOutput`

- [ ] 覆盖：
  - [ ] 空输出/缺字段
  - [ ] 多段输出（合并/渲染分支）
  - [ ] 错误输出分支

### 7) `src/components/chat`

- [ ] 按 coverage 报告挑 1-2 个“分支多且常触发”的组件补测试（Ink UI：键盘路由/条件渲染）

### 8) `src/tools/modules/notebookEdit`

- [ ] 覆盖常见失败分支（路径/输入/权限）
- [ ] 覆盖成功路径的关键边界（空 patch/多 patch/无变更）

### 9) `src/tools/modules/grep`

- [ ] 覆盖：
  - [ ] 0 matches
  - [ ] 参数缺失/非法
  - [ ] ripgrep 执行失败（exit code != 0）分支
