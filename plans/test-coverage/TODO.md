# 测试覆盖率提升 TODO（Vitest）

> 基线（2026-01-27，本机 `npm test -- --coverage`）：
> - Statements: 73.01% (8041 / 11013)
> - Branches: 59.76% (5433 / 9091)
> - Functions: 78.81% (1395 / 1770)

## 已落地

- 新增 `test:coverage:gate`：`vitest run --coverage && node ./scripts/check-coverage-thresholds.mjs`
- 当前 gate 只检查少量关键文件的 statements（避免“一刀切”导致 CI 噪音）

如果后续要扩展 gate 的覆盖范围，优先在“稳定/安全关键”的文件上加阈值，并同步补齐对应回归测试。
