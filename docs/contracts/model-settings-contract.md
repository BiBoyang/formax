# Model Settings 合同（唯一事实源）

最后更新：2026-06-01  
状态：规范性（Normative）

本文档定义 Formax 的模型设置行为（tier 选择、active model 解析、context window provenance、runtime profile、`/model` 持久化）的唯一事实来源。

范围：
- `defaultTier`、`tierModels`、`llm.model`（legacy sonnet override）的解析关系
- `ANTHROPIC_DEFAULT_*_MODEL` 的优先级与 active model 解析
- `contextWindowTokens` 的运行时优先级（env / tier snapshot / legacy / local known-model fallback）
- context window `source` / `binding` / `runtime profile` 的语义
- `/model` 写盘与上下文窗口同步的行为边界
- thread runtime preference overrides for app-server execution
- app-server / Web turn 期间的 runtime ownership 一致性

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
- `packages/core/src/config/runtimeModelProfile.ts`
- `packages/core/src/config/modelCapability.ts`
- `packages/core/src/config/modelContextWindow.ts`
- `packages/core/src/features/commands/replEnvironmentService.ts`
- `packages/core/src/features/commands/registry.ts`
- `packages/core/src/core/setup/session.ts`
- `packages/core/src/adapters/setup/writeSetupFiles.ts`
- `packages/core/src/app-server/index.ts`
- `packages/core/src/app-server/turnRunner.ts`

规范关键字约定：
- `MUST`、`SHOULD`、`MAY` 采用 RFC 2119 语义。

## 1. Tier 与 Active Model

`MODEL-001`  
模型 tier 集合 MUST 为 `haiku | sonnet | opus`。非法 tier 输入 MUST 回退到默认 tier（`sonnet`）。

`MODEL-002`  
active tier 解析 MUST 由 `defaultTier`（含 env/config 合并后的结果）决定，且默认值 MUST 为 `sonnet`。

`MODEL-002A`
For thread-bound app-server execution, an explicit thread runtime preference `modelTier` MUST override global/project default-tier selection for that thread only. Effective tier resolution is:
1. valid `thread.preferences.modelTier`
2. effective runtime config `llm.defaultTier`
3. `sonnet`

The override selects the tier; concrete model resolution still follows `MODEL-003`, including tier env variables, legacy sonnet override, configured tier models, and built-in defaults.

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
运行时 `effective context window` 的优先级 MUST 为：
1. 有效 `FORMAX_CONTEXT_WINDOW_TOKENS`（正整数）
2. `llm.tierContextWindowTokens[activeTier]`，且其 binding MUST 与当前 active model identity 匹配
3. `llm.contextWindowTokens`（legacy 单值）
4. local known-model fallback（`known_model_map`）

`MODEL-102`  
当第 1-4 项均缺失时，发送层 MAY 使用 provider/model 元数据推断作为兜底；该兜底值 MUST NOT 反向改变 config 解析优先级。

`MODEL-103`  
capability source taxonomy MUST 为：
- `provider_list`
- `provider_detail`
- `catalog`
- `heuristic`
- `known_model_map`

`MODEL-104`  
config/runtime budget source taxonomy MUST 至少覆盖：
- `env_override`
- `tier_config`
- `legacy_config`
- `migrated_legacy`
- `binding_mismatch`
- `none`

`MODEL-105`  
persisted tier snapshot SHOULD 带 `source` 与 `binding`。其中 `binding` MUST 由 `(provider, normalized baseUrl, model)` 组成，而不是只保存 model name。

`MODEL-106`  
当 `llm.tierContextWindowTokens[activeTier]` 存在但其 binding 与当前 active model identity 不匹配时，运行时 MUST 将其视为 `binding_mismatch`；MUST NOT 继续把该 snapshot 当作 authoritative budget。

`MODEL-107`  
`FORMAX_CONTEXT_WINDOW_TOKENS` MUST 被视为 runtime override，而不是 model capability；它 MUST NOT 写回磁盘配置。

`MODEL-108`  
legacy `llm.contextWindowTokens` MUST 仅作为兼容 mirror / fallback；它 MUST NOT 重新成为 tier snapshot 的唯一事实源。

## 3. `/model` 持久化与同步

`MODEL-201`  
`/model <tier>` 的持久化目标 MUST 为 global config 的 `llm.defaultTier`。

`MODEL-202`  
若 project 层覆盖导致 effective tier 与用户请求不一致，命令输出 SHOULD 明确提示“已保存 global tier，但当前 effective tier 被 project 覆盖”。

`MODEL-203`  
`persistDefaultModelTier` 在同步 context window 时 MUST 以 effective tier（重载 runtime config 后）为准；MUST NOT 以请求 tier 直接覆盖错误 slot。

`MODEL-204`  
`persistDefaultModelTier` MUST NOT 将仅来源于 `FORMAX_CONTEXT_WINDOW_TOKENS` 的临时 env 覆盖值写回磁盘配置。

`MODEL-205`  
`persistDefaultModelTier` 在同步 context window 时 MUST 消费 shared runtime profile resolver，而不是从裸 `contextWindowTokens` 反推来源。

`MODEL-206`  
当 effective runtime profile 的 source 为 `binding_mismatch`、`none` 或 `heuristic` 时，`persistDefaultModelTier` MUST NOT 将该值静默固化为新的 authoritative snapshot。

`MODEL-207`  
当 effective runtime profile 的 source 为 persisted snapshot、legacy mirror 或 `known_model_map` 时，`persistDefaultModelTier` MAY 将当前 effective tier 的 context window mirror 回 config；该写盘 MUST 只针对当前 effective tier，并 SHOULD 保留现有 source/binding metadata。

## 4. Setup 写入

`MODEL-301`  
Setup 流程在可用时 SHOULD 持久化 `llm.tierModels` 与 `llm.tierContextWindowTokens`，并保持 `llm.model` 与默认 tier（`sonnet`）一致。

`MODEL-302`  
当 setup 返回 provider 模型窗口信息时，quick/advanced 模式切换 MUST 维持 tier-level context window 的一致性，避免回退为固定默认值造成漂移。

`MODEL-303`  
setup capability detection 顺序 MUST 保持为：
1. explicit provider list metadata
2. model detail probe
3. catalog fallback
4. heuristic fallback

`MODEL-304`  
setup MUST 保留 detection provenance；detected / catalog / heuristic MUST NOT 在 setup session 内被压平成无法区分的裸数字。

`MODEL-305`  
heuristic fallback MUST NOT 默认持久化为 authoritative snapshot。catalog snapshot 若持久化，MUST 同时带 source 与 binding。

## 5. Runtime Ownership

`MODEL-401`  
runtime MUST 通过 shared `RuntimeModelProfile` 解析 active model、model source、effective context window、context window source / binding，以及 budget 参数。

`MODEL-401A`
Thread-bound execution MUST resolve `RuntimeModelProfile` from base runtime config plus sparse thread runtime preferences. `thinkingMode` effective resolution is:
1. `thread.preferences.thinkingMode` when present
2. effective runtime config `llm.thinkingMode`

`thinkingEffort` effective resolution is:
1. `thread.preferences.thinkingEffort` when present
2. effective runtime config `llm.thinkingEffort`
3. Formax default `medium`

Valid Anthropic thinking effort values are `low | medium | high | xhigh | max`. `thinkingMode=false` MUST suppress request-time thinking/effort fields without clearing the durable `thinkingEffort` preference. `medium` is the Formax default, not a claim about the provider's implicit default.

`MODEL-402`  
同一个 turn 内，model identity、prompt budget、context meter budget、cache-editing provider 判定 MUST 来自同一份 frozen runtime profile snapshot。

`MODEL-403`  
app-server / Web runtime cache MUST 按 runtime profile fingerprint 重建或命中；当 fingerprint 变化时，旧 runner / client MUST NOT 继续承载新 turn。

`MODEL-404`  
diagnostics payload SHOULD 暴露 resolved model、context window source、bound model，以及 runtime profile fingerprint，便于区分 provider-detected snapshot、legacy mirror、known-model fallback 与 env override。
