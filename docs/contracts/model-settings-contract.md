# Model Settings 合同（唯一事实源）

最后更新：2026-03-14  
状态：规范性（Normative）

本文档定义 Formax 的模型设置行为（tier 选择、active model 解析、context window 解析与 `/model` 持久化）的唯一事实来源。

范围：
- `defaultTier`、`tierModels`、`llm.model`（legacy sonnet override）的解析关系
- `ANTHROPIC_DEFAULT_*_MODEL` 的优先级与 active model 解析
- `contextWindowTokens` 的运行时优先级（env / tier map / legacy）
- `/model` 写盘与上下文窗口同步的行为边界

不在范围内：
- `/config` 对话框暴露项与 sparse write 细节（见 config settings 合同）
- transcript 呈现与 command subline 文案细节（见 slash command 合同）

相关文档（信息性镜像）：
- `docs/contracts/config-settings-contract.md`
- `docs/contracts/slash-command-contract.md`
- `docs/environment-variables.md`

相关实现（规范锚点）：
- `packages/core/src/config/modelTier.ts`
- `packages/core/src/config/config.ts`
- `packages/core/src/features/commands/replEnvironmentService.ts`
- `packages/core/src/features/commands/registry.ts`
- `packages/core/src/core/setup/session.ts`
- `packages/core/src/adapters/setup/writeSetupFiles.ts`

规范关键字约定：
- `MUST`、`SHOULD`、`MAY` 采用 RFC 2119 语义。

## 1. Tier 与 Active Model

`MODEL-001`  
模型 tier 集合 MUST 为 `haiku | sonnet | opus`。非法 tier 输入 MUST 回退到默认 tier（`sonnet`）。

`MODEL-002`  
active tier 解析 MUST 由 `defaultTier`（含 env/config 合并后的结果）决定，且默认值 MUST 为 `sonnet`。

`MODEL-003`  
`resolveModelForTier` 的优先级 MUST 为：
1. tier 对应 env 变量（`ANTHROPIC_DEFAULT_HAIKU_MODEL` / `...SONNET...` / `...OPUS...`）
2. 若 tier 为 `sonnet`，`llm.model`（legacy 覆盖）
3. `llm.tierModels[tier]`
4. 内建默认模型映射

`MODEL-004`  
`/model default` MUST 视为 `sonnet` 的别名。

## 2. Context Window 优先级

`MODEL-101`  
运行时 `llm.contextWindowTokens` 的优先级 MUST 为：
1. 有效 `FORMAX_CONTEXT_WINDOW_TOKENS`（正整数）
2. `llm.tierContextWindowTokens[activeTier]`
3. `llm.contextWindowTokens`（legacy 单值）

`MODEL-102`  
当第 1-3 项均缺失时，发送层 MAY 使用 provider/model 元数据推断作为兜底；该兜底值 MUST NOT 反向改变 config 解析优先级。

## 3. `/model` 持久化与同步

`MODEL-201`  
`/model <tier>` 的持久化目标 MUST 为 global config 的 `llm.defaultTier`。

`MODEL-202`  
若 project 层覆盖导致 effective tier 与用户请求不一致，命令输出 SHOULD 明确提示“已保存 global tier，但当前 effective tier 被 project 覆盖”。

`MODEL-203`  
`persistDefaultModelTier` 在同步 context window 时 MUST 以 effective tier（重载 runtime config 后）为准；MUST NOT 以请求 tier 直接覆盖错误 slot。

`MODEL-204`  
`persistDefaultModelTier` MUST NOT 将仅来源于 `FORMAX_CONTEXT_WINDOW_TOKENS` 的临时 env 覆盖值写回磁盘配置。

## 4. Setup 写入

`MODEL-301`  
Setup 流程在可用时 SHOULD 持久化 `llm.tierModels` 与 `llm.tierContextWindowTokens`，并保持 `llm.model` 与默认 tier（`sonnet`）一致。

`MODEL-302`  
当 setup 返回 provider 模型窗口信息时，quick/advanced 模式切换 MUST 维持 tier-level context window 的一致性，避免回退为固定默认值造成漂移。
