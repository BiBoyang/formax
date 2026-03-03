# Commit Log：sdk-contract-alignment-loop

> 规则：每次该循环产生新提交，必须在本文件追加一条记录。

## 2026-03-03

- `110149e` `feat(sdk): align query permission and abort inputs`
  - 切片：`QRY-01`、`QRY-02`
  - 说明：新增 `permissionMode` 与 `abortController` 对齐入口，补类型/校验/测试/文档。

- `e247e3a` `refactor(sdk): extract query input request handlers`
  - 切片：`QRY-03`
  - 说明：将 approval/ask_user_question 处理分支从 `query/runner` 抽离为独立模块，保持行为不变。

- `0c96a72` `docs(sdk): add query contract alignment matrix`
  - 切片：`QRY-04`
  - 说明：新增 query 对齐矩阵文档，并在 SDK README 建立引用。

- `4d6d9e4` `feat(sdk): align systemPrompt preset option`
  - 切片：`QRY-05`
  - 说明：支持 `systemPrompt` 官方 preset 形态子集（`claude_code` + `append`），并补充校验与测试。

- `46af01d` `feat(sdk): align thinking config option`
  - 切片：`QRY-06`
  - 说明：支持 `thinking` 子集对齐（`adaptive/enabled/disabled`）并映射现有执行开关。

- `[pending]` `test(sdk): add query option alignment regression suite`
  - 切片：`QRY-07`
  - 说明：新增 query 选项对齐回归测试组，覆盖 `permissionMode`、`abortController`、`systemPrompt preset`、`thinking`。
  - 备注：本条 hash 在下一次提交中回填。

- `44396d3` `feat(sdk): add session query APIs with validated outputs`
  - 切片：`SES-01`
  - 说明：新增 `listSessions/getSessionMessages`、统一入口导出、校验与测试。

- `ca4c333` `feat(sdk): enrich session list metadata safely`
  - 切片：`SES-02`
  - 说明：补齐 `firstPrompt/fileSize` 元数据与容错，并更新测试与文档。
