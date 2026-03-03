# SDK Contract Alignment Loop Blueprint (Active)

目标：在不实现未支持能力的前提下，持续对齐 `@anthropic-ai/claude-agent-sdk` 的已支持外部契约，并保持 `src/sdk` 内部实现解耦、可测试、可提交。

最后更新时间：2026-03-03

## 需求来源（固定）

- `plans/claude-agent-sdk/`
- 重点参考：`plans/claude-agent-sdk/claude-agent-sdk-exports-reference.md`

说明：
- 本循环的需求来源来自上述目录与文档。
- 对齐目标是“已支持能力的外部契约与命名参考”，不是官方 SDK 的格式或类型 1:1 复制。

## 执行状态（Active）

- 进行中：阶段 1（已支持能力对齐，优先 `query` 契约）
- 当前待办：以 `plans/sdk-contract-alignment-loop/TODO-INDEX.md` 为准

## 范围约束（严格）

- 外部契约对齐：只对齐“项目当前已支持 + 有测试覆盖”的能力。
- 内部实现解耦：`query` 继续做编排入口，复杂分支拆到子模块。
- 未支持能力不做：`mcpServers`、`createSdkMcpServer`、`tool`、`hooks`、`plugins`、`settingSources` 等暂不实现。
- 不做 SDK 以外大结构改造，不做发布层改造。

## 对齐原则（固定）

- 入口层：尽量沿用官方导出名与参数名（仅限已支持能力）。
- 语义层：行为保持 Formax 现有稳定语义，不为“同名”牺牲稳定性。
- 校验层：所有外来数据必须先校验再进入运行流程。
- 迭代层：每个切片实现后，自动派生下一个“最小可提交”任务。

## 当前任务清单（唯一来源）

- 见 `plans/sdk-contract-alignment-loop/TODO-INDEX.md`

## 提交留痕（必做）

- 每次完成切片并提交后，必须同步更新：
  - `plans/sdk-contract-alignment-loop/COMMIT-LOG.md`
- 留痕最小字段：
  - 日期
  - commit hash
  - commit message
  - 对应切片 ID（如 `QRY-01`）

## 执行循环（固定）

- 每个切片：实现 -> 定向测试 -> `codex review` -> 提交。
- 切片粒度：尽量 2-8 文件。
- 阶段门禁：
  - `bun run test -- <targeted files>`
  - `bun run type-check`
  - `codex review --uncommitted -c model="gpt-5.3-codex" -c model_reasoning_effort="medium"`
