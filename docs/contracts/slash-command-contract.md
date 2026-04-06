# Slash Command 合同（唯一事实源）

最后更新：2026-03-07  
状态：规范性（Normative）

本文档定义 Formax slash command 的发现、覆盖优先级、dispatch 消费边界，以及 UI 输出与下一轮模型注入的关系。

范围：
- builtin / user / project command 的发现与覆盖规则
- slash command dispatch 的默认优先级与 `preferredSpecId` 选择行为
- `SlashCommandEffect -> CommandResult` 的 UI / model 映射
- overlay dismiss subline、local/local_async 输出、model injection 边界
- 精确 `/clear`、`/compact`、`/context` 与未知 slash command 的 pre-main 路由边界

不在范围内：
- 非 slash command 的普通用户输入语义
- `/config` setting merge / persist 语义
- 交互输入 (`approval` / `ask_user_question`) 的生命周期合同
- tools pipeline 的 `ToolResult` 协议

相关文档（信息性镜像）：
- `docs/contracts/semantics-contract.md`
- `docs/contracts/tool-runtime-contract.md`
- `docs/contracts/config-settings-contract.md`
- `docs/contracts/interactive-input-contract.md`

相关实现（规范锚点）：
- `packages/core/src/features/commands/registry.ts`
- `packages/core/src/features/commands/CommandStore.ts`
- `packages/core/src/features/commands/contracts.ts`
- `packages/core/src/features/commands/adapter.ts`
- `packages/core/src/features/repl/controller/send/send.ts`
- `packages/core/src/features/repl/controller/send/sendPreMainRouting.ts`
- `packages/core/src/features/repl/controller/ui/overlays.ts`
- `packages/core/src/features/semantics/core/commandRouting.ts`

规范关键字约定：
- `MUST`、`SHOULD`、`MAY` 采用 RFC 2119 语义。

## 1. 权威模型

`CMD-001`  
slash command builtin 列表、默认 dispatch 优先级与 effect 类型 MUST 以 `packages/core/src/features/commands/registry.ts` 为准。

`CMD-002`  
user / project command 的目录扫描、frontmatter 解析与覆盖规则 MUST 以 `packages/core/src/features/commands/CommandStore.ts` 为准。

`CMD-003`  
`SlashCommandEffect` 到 `CommandResult` 的 UI / model 分流 MUST 以 `packages/core/src/features/commands/adapter.ts` 与 `packages/core/src/features/commands/contracts.ts` 为准。

`CMD-004`  
REPL pre-main slash routing（`/clear`、`/compact`、`/context`、generic dispatch、fall-through）MUST 以 `packages/core/src/features/repl/controller/send/sendPreMainRouting.ts` 与 `packages/core/src/features/semantics/core/commandRouting.ts` 为准。

## 2. 发现与覆盖优先级

`CMD-101`  
当前 slash command 来源 MUST 包含：
1. builtin commands
2. user commands：`<FORMAX_CONFIG_DIR>/commands/**/*.md`
3. project commands：`<project>/.formax/commands/**/*.md`

`CMD-102`  
custom command 的合法 id MUST 由 markdown 相对路径推导，规则为：
1. 去掉 `.md`
2. 路径分段使用 `:` 连接
3. 最终 command id 以 `/` 开头

`CMD-103`  
在 custom command store 中，同名 command 冲突时 MUST 使用 project 覆盖 user。

`CMD-104`  
builtin 与 custom command 允许共享同一 command 名。`list()` / suggestion MAY 同时展示多个 variant；不得因重名而强制折叠为单一 spec。

`CMD-105`  
默认 dispatch 选择顺序 MUST 为：
1. `preferredSpecId` 指向的候选（若存在）
2. builtin
3. project
4. user
5. 其余候选中的首项

`CMD-106`  
当 custom command frontmatter 含 `disable-model-invocation=true|1|yes` 时，dispatch MUST 返回本地 disabled 消息；MUST NOT 继续走 LLM blocks 路径。

## 3. 路由与消费边界

`CMD-201`  
slash command 解析 MUST 对 command 名做小写归一化，并保留剩余参数文本为 `args`。

`CMD-202`  
精确 `/clear` MUST 在 generic slash dispatch 之前由 dedicated clear path 处理。

`CMD-203`  
精确 `/compact` MUST 在 generic slash dispatch 之前由 dedicated compact path 处理。

`CMD-203A`  
精确 `/context` 在 TUI 路径 MUST 先走 dedicated local diagnostics path；app-server / Web 路径 MAY 通过 `command/dispatch` 返回同等的本地 diagnostics 输出。当前 diagnostics 输出 MUST 同时包含：
1. 当前最新 compact boundary 后 continuation-view snapshot 视图（若不存在 boundary，则退化为当前 persisted prompt history）
2. “next-turn fixed context” 视图（未来用户正文出现前的固定上下文开销投影）
3. snapshot 与 next-turn fixed 视图各自的 top contributors 排行，帮助识别最重的 system / history / fixed blocks
4. 当参数精确为 `--json` 时，MUST 返回同一 diagnostics 数据的 JSON 文本表示
5. app-server / Web 的 local-dispatch MAY 额外携带同一 diagnostics 数据的结构化 payload，避免客户端反解析 stdout
6. app-server / Web 当前的 `local.diagnostics` payload 在 `schemaVersion=1` 下 MUST 提供稳定消费契约：
   - `kind`
   - `schemaVersion`
   - `mode`
   - `model`
   - `latestCompactBoundary`
   - `snapshot`
   - `nextTurnFixed`
   - `notes`
   未知附加字段 MAY 存在，但客户端 MUST 忽略它们。
7. `nextTurnFixed` diagnostics payload MUST 暴露 `microCompactImpact` 基础字段（`compactedBlocks`、`compactedToolNames`、`estimatedTokensSaved`、`keptRecentBlocks`），供后续展示层与客户端调试消费
8. text diagnostics SHOULD 额外展示 microcompact impact 小节，至少包含 `projected history before/after microcompact/prune` 与 `estimated tokens saved by microcompact`
9. diagnostics payload MUST 暴露 `latestCompactBoundary`；若该值非 `null`，至少要稳定提供 `schemaVersion`，并 SHOULD 暴露 `trigger`、`preTokens`、`summaryKind`、`keepStrategy`；当前若存在 `rehydrationPlan`、`rehydrationCost`、`preservedSegment` 也 SHOULD 一并暴露
10. 当 `kind` 不匹配、`schemaVersion` 非 `1`、或稳定字段缺失/类型错误时，客户端 MUST 将整个 diagnostics payload 视为不可用，而不是继续做 loose partial parsing
11. snapshot text diagnostics SHOULD 额外展示 `System prompt breakdown`；当前 system prompt 至少会按 `Identity`、heading 前 `Preamble`、以及顶层 `# section` 做 breakdown，避免把 system 只当成单个黑盒 contributor
12. `nextTurnFixed` diagnostics payload SHOULD 暴露 `lifecycleMarkers`，用于比较 `snapshot`、`post_microcompact`、`post_prune`、`post_compact` 四个阶段的估算差异；text diagnostics SHOULD 提供对应的人类可读 lifecycle 小节
当前 `summaryKind` MAY 为：
 - `model_summary`
 - `session_memory`
当前 `keepStrategy` MAY 为：
 - `keep_last_turns`
 - `keep_combo`（`keepLastTurns`、`keepMinTokens`、`keepMinUserTurns`）

`CMD-204`  
当前 `commandRouting.shouldUseCommandDispatch` 基线 MUST 仅对以下命令返回 true：
1. `/init`
2. `/compact`
3. `/context`
4. `/todos`

`CMD-203B`
精确 `/context` 当前仅接受两种参数形态：
1. 无参数：返回人类可读的 text diagnostics
2. `--json`：返回 JSON diagnostics
其余参数 MUST 返回 `Usage: /context [--json]`

`CMD-205`  
未知 slash command 或未被消费的 slash command MUST fall through 到主发送流程；不得被强制转成本地错误。

## 4. UI 与 Model 正交合同

`CMD-301`  
slash command 的 UI 输出与下一轮模型注入 MUST 视为正交维度。  
显示本地输出不等于自动注入模型上下文；注入模型上下文也不要求重复渲染大块 UI。

`CMD-302`  
Claude-style 本地命令输出 MUST 使用 `assistant` + `ui.kind='command_subline'` 表达；MUST NOT 引入第二套 bespoke 数据结构。

`CMD-303`  
`kind='local'` 的 slash effect：
1. MUST 以 `command_subline` 渲染 `stdout`
2. 只有存在 `recordForNextTurn` 时，才 MAY 生成 `injectNextTurn`

`CMD-304`  
`kind='local_async'` 的 slash effect：
1. MUST 先渲染 loading subline
2. 成功后 MUST 逐行渲染 `stdout`
3. 失败后 MUST 渲染 `Error: <message>` subline
4. 只有返回 `recordForNextTurn` 时，才 MAY 追加 injected blocks

`CMD-305`  
`kind='llm'` 的 slash effect MUST 通过 `CommandResult.data.kind='llm'` 进入主模型发送流程，而不是先渲染本地 assistant 文本。

`CMD-306`  
`kind='open_*_dialog'` 的 slash effect MUST 只打开 overlay；dismiss 后的 UI 行由 overlay close path 决定，而不是由 open path 预写。

## 5. Overlay Close 与 Dismiss 行为

`CMD-401`  
overlay dismiss / close 后的反馈行 MUST 使用 `command_subline`，并保持现有单行或多行 contract。

`CMD-402`  
当前 dismiss 子行 contract MUST 包含：
1. `Agents dialog dismissed`
2. `Permissions dialog dismissed`
3. `Hooks dialog dismissed`
4. `Status dialog dismissed`
5. `Model selection dismissed`

`CMD-403`  
`/resume` dismiss 当前 MUST 保留特殊路径：追加一条 user `/resume` 行，再追加 assistant `Resume cancelled` subline。

## 6. Custom Command Frontmatter

`CMD-501`  
custom command frontmatter 当前支持：
1. `description`
2. `argument-hint`
3. `disable-model-invocation`

`CMD-502`  
description 取值顺序 MUST 为：
1. frontmatter `description`
2. 正文第一条有意义文本
3. fallback `Custom command`

`CMD-503`  
project / user custom command 的 LLM 路径 MUST 通过 `buildFileCommandContent(...)` 构造 blocks；不得把 markdown body 直接拼接成非结构化字符串注入。

## 7. 变更流程

当改动 slash command 的发现、覆盖优先级、dismiss 输出、`command_subline`、或 next-turn injection 边界时：
1. 先更新本文件。
2. 再更新 `packages/core/src/features/commands/*` 与 REPL send / overlay 实现。
3. 若变更影响跨端语义或 canonical UI message 类型，再同步 `docs/contracts/semantics-contract.md` 的摘要边界。

若实现与本合同冲突，应视为实现漂移并立即收敛修正。
