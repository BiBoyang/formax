# TASK-SOURCE：harness-refactor-loop（唯一派生源）

更新时间：2026-02-23  
来源：用户《Formax Harness Engineering 落地计划（稳定性优先，增量改造，分阶段上锁）》

> 本文件是 `TODO-INDEX.md` 的唯一任务来源。  
> `README.md` 只保留目标与执行方式，不再作为派生源。

## Source Items（可派生条目）

- `HRS-01-DOCS-SOT`: 建立并维护 Harness 单一事实源文档（`docs/*`），只写可执行规则、验收命令、失败处理。
- `HRS-02-LAYER-CONTRACT`: 落实 `Types -> Config -> Repo -> Service -> Runtime -> UI` 合同，维护映射、检查脚本与 baseline，仅阻断新增违规。
- `HRS-03-CI-GATE`: 维护 `harness-checks` 门禁链路与节奏（软门禁 -> 硬门禁），保证验证项与 runbook 同步。
- `HRS-04-TRACE-REPLAY`: 推进 trace 上下文连通与 realtime/replay 一致性契约测试。
- `HRS-05-SINGLE-WRITER`: 维护 single-writer 护栏，禁止语义关键路径新增旁路 transcript 直接写入。
- `HRS-06-REPO-KNOWLEDGE`: 让 repo 成为知识系统：AGENTS 仅做索引、规则下沉 `docs/`、变更沉淀到 `plans/app-server/` 并保持可追溯。
- `HRS-07-ACCEPTANCE`: 维护验收场景与两级验证（PR 级 + 全量兜底）的一致性。
- `HRS-08-COMPAT`: 维持公共接口与用户行为兼容，不做破坏性 CLI/API 变更。

## 派生约束（强约束）

1. `TODO-INDEX.md` 的每条待办必须包含：
   - `source=<source_id>`
   - `acceptance=<command>`
2. `source_id` 必须来自本文件 `Source Items`。
3. `acceptance` 必须是可直接执行的命令（可链式，如 `cmd1 && cmd2`）。
4. 不允许从 `README.md` 的口号式目标直接派生任务。

## 默认验收命令模板（按需选用）

- `bun run type-check`
- `bun run check:layer-contracts`
- `bun run check:golden-principles`
- `bun run check:presenter-parity`
- `bun run test -- <targeted-files>`
