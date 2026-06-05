# Config Settings 合同（唯一事实源）

最后更新：2026-06-04  
状态：规范性（Normative）

本文档定义 Formax runtime config 合并、`/config` 持久化与当前 settings 分类的唯一事实来源。

范围：
- `FormaxConfigV1` / patch 的合法字段与默认值
- runtime config 的来源优先级与 `sources` 归属
- `/config` 当前支持的 setting 子集与持久化目标
- runtime defaults vs thread-bound overrides
- sparse writes、默认值剥离、即时生效边界
- output-style / thinking-mode / verbose-output 的分类与 side effects
- MCP server config storage envelope 摘要边界

不在范围内：
- 环境变量完整枚举与用户分类说明
- auth store 文件格式的完整规范
- 非 config dialog 的 slash command 输出细节

相关文档（信息性镜像）：
- `docs/environment-variables.md`
- `docs/contracts/model-settings-contract.md`
- `docs/contracts/prompt-tool-exposure-contract.md`
- `docs/contracts/semantics-contract.md`
- `docs/contracts/mcp-client-contract.md`

相关实现（规范锚点）：
- `packages/core/src/config/settings/schema.ts`
- `packages/core/src/config/settings/resolve.ts`
- `packages/core/src/config/settings/persist.ts`
- `packages/core/src/config/config.ts`
- `packages/core/src/features/commands/configDialogService.ts`
- `packages/core/src/tui/config/ConfigDialog.tsx`
- `packages/core/src/features/repl/controller/session/localCommandInjection.ts`

规范关键字约定：
- `MUST`、`SHOULD`、`MAY` 采用 RFC 2119 语义。

## 1. 权威模型

`CFG-001`  
config 字段、默认值与 patch 合法性 MUST 以 `packages/core/src/config/settings/schema.ts` 为准。

`CFG-002`  
runtime config 合并、来源归属与 env 解析 MUST 以 `packages/core/src/config/settings/resolve.ts` 为准。

`CFG-003`  
disk patch merge 与默认值剥离 MUST 以 `packages/core/src/config/settings/persist.ts` 为准。

`CFG-004`  
最终运行时消费形状（路径归一化、active model 解析后注入 REPL/runtime）MUST 以 `packages/core/src/config/config.ts` 为准。

`CFG-006`  
当存在有效 `FORMAX_CONTEXT_WINDOW_TOKENS` 时，运行时 `llm.contextWindowTokens` MUST 采用该 env 值。否则当存在 `llm.tierContextWindowTokens` 时，MUST 以 active tier 对应值为准；若该值缺失，MUST 回退到 `llm.contextWindowTokens`（legacy 单值）。

`CFG-005`  
`/config` dialog 当前暴露的 setting 子集、source label 与持久化目标 MUST 以 `packages/core/src/features/commands/configDialogService.ts` 和 `packages/core/src/tui/config/ConfigDialog.tsx` 为准。

## 2. 解析与优先级

`CFG-101`  
runtime config 来源优先级 MUST 为：
1. `default`
2. `global`
3. `project`
4. `env`
5. `flags`

后项 MUST 覆盖前项。

`CFG-102`  
当前 disk config 读取范围 MUST 仅包含：
1. global config：`<FORMAX_CONFIG_DIR>/config.json`
2. project config：`<cwd>/.formax/config.json`

legacy config 路径 MAY 继续存在于 path 计算中，但当前 runtime config 读取流程 MUST NOT 将其作为 active config 输入。

`CFG-103`  
`ResolvedConfig.sources` MUST 为每个已知 key 给出最终来源；若某 key 未被上层 patch 覆盖，来源 MUST 记为 `default`。

`CFG-104`  
无效 config 字段、无效 section 或无效 env 值 MUST 被忽略，并通过 `warnings` 暴露；MUST NOT 中止整份 config 解析。

`CFG-105`  
env override 只对 `resolve.ts` 显式解析的变量生效。未解析或历史遗留 env key MUST NOT 隐式改变 runtime config。

## 2A. MCP Config Storage 摘要

`CFG-150`  
Persisted MCP server config MUST live under existing `config.json` storage as `mcp.servers`. Formax MUST NOT add a separate `.mcp.json` or MCP-specific persisted config file in Phase 1A.

`CFG-151`  
REPL Phase 1A MUST feed `mcp.servers` from user/global `config.json` into the MCP manager activation path. Repo-local project MCP config MUST be ignored in Phase 1A until a project MCP trust/approval gate exists.

`CFG-152`  
SDK Phase 1A MUST NOT read local user/project config files for MCP. SDK MCP servers MUST come only from explicit `options.mcpServers` / session overlay.

`CFG-153`  
app-server/Web/Electron Phase 1A MUST NOT read local MCP config or activate MCP servers. app-server uses explicit empty MCP overlay only.

`CFG-154`  
`mcp.servers` parsing MUST be strict. Unknown transport fields, OAuth/browser auth fields, HTTP session policy fields, reconnect policy fields, and legacy SSE runtime fields MUST be rejected for Phase 1A.

`CFG-155`
Invalid user/global `mcp.servers` MUST fail MCP config loading with actionable validation issues for entrypoints that load MCP config. MCP config MUST NOT silently degrade to an empty server map. SDK/app-server Phase 1A MUST skip persisted MCP parsing entirely, and repo-local project MCP config remains ignored until a project trust gate exists.

## 3. Auth 与运行时派生

`CFG-201`  
`FORMAX_API_KEY` 存在时，auth source MUST 优先使用 env；否则 MAY 回退到 global auth store 中 `provider + authRef` 对应的 entry。

`CFG-202`  
`FORMAX_BASE_URL` 在进入 resolved config 前 MUST 做 Anthropic-compatible 归一化；进入 `RuntimeConfig` 后，trailing slash MUST 被移除。

`CFG-203`  
`logsDir`、`subagentsDir`、`planDir` 在 `RuntimeConfig` 中 MUST 转换为绝对路径；缺省值 MUST 由 `packages/core/src/config/config.ts` 的当前逻辑决定。

## 4. `/config` 当前支持范围

`CFG-301`  
当前 `/config` dialog 暴露的 setting 子集 MUST 仅包含：
1. `ui.outputStyle`
2. `llm.thinkingMode`
3. `ui.verboseOutput`

`CFG-302`  
`/config` source label MUST 使用以下映射：
1. `default -> Default`
2. `global -> User`
3. `project -> Project`
4. `env -> Env`
5. `flags -> Flags`

`CFG-303`  
`/config` 持久化目标 MUST 为：
1. `outputStyle` -> project config
2. `thinkingMode` -> global config
3. `verboseOutput` -> global config

`CFG-303A`
TUI `/model <tier>` and `/config thinkingMode` remain global-default writes. They MUST NOT silently become thread-scoped writes. Thread-scoped model/thinking overrides are represented by thread runtime preferences and are written through the app-server runtime-state preference surface, not through existing TUI global commands.

`CFG-304`  
`outputStyle` 的值 MUST 经过 `OutputStyleSchema` 校验；无效值 MUST 回退为 `default` 后写入 patch 逻辑。

`CFG-305`  
`thinkingMode` 与 `verboseOutput` 的 `/config` 写入当前 MUST 使用布尔 coercion。

## 5. Sparse Write 与即时生效

`CFG-401`  
config patch 写盘 MUST 采用 merge-on-read，再执行默认值剥离；与默认值相同的字段 MUST NOT 长期保留在 patch 文件中。

`CFG-402`  
`/config` 保存后 MUST 立即重新加载 effective runtime config；当前行为 MUST NOT 依赖“重启后才生效”。

`CFG-403`  
`/config` 退出提示 MUST 保持当前 contract：
1. 未改动 -> `Status dialog dismissed`
2. 改动 `outputStyle` -> `Set output style to <Label>`
3. 改动 `thinkingMode` -> `Set thinking mode to <boolean>`
4. 改动 `verboseOutput` -> `Set verbose output to <boolean>`

## 6. Setting 分类与 side effects

`CFG-501`  
`outputStyle` MUST 视为 prompt-affecting setting。  
它改变下一轮 injected reminder block 的内容，但 MUST NOT 直接修改 tool exposure、permissions 或 transcript semantics。

`CFG-502`  
`thinkingMode` MUST 视为 request-parameter setting。  
它影响发送层的 `thinkingEnabled` / thinking request 行为，但 MUST NOT 触发本地 command injection。

`CFG-502A`
`thinkingMode` remains boolean in v1. `llm.thinkingEffort` is a separate request-parameter setting with valid Anthropic values `low | medium | high | xhigh | max`. Global `thinkingEffort` defaults MAY be persisted through runtime-defaults config writes; `/config thinkingMode` MUST NOT silently become an effort selector.

`CFG-503`  
`verboseOutput` MUST 视为 UI-only setting。  
它影响 thinking block 等可见渲染，但 MUST NOT 改变 prompt blocks 或 request payload。

`CFG-504`  
当前 `/config` exit 只有 `outputStyle` 变更 MAY 触发 local command injection；`thinkingMode` 与 `verboseOutput` 变更 MUST NOT 注入下一轮模型上下文。

`CFG-505`  
当 session save 启用时，`config_exit` 事件 MAY 记录所有退出；但 `output_style_changed` 与 `local_command_injection(source=config_output_style)` 只应出现在 `outputStyle` 变更路径。

## 7. 变更流程

当新增或修改 config setting、merge precedence、env override 或 `/config` 持久化行为时：
1. 先更新本文件。
2. 若涉及 env 变量名或分类，再更新 `docs/environment-variables.md`。
3. 再更新实现与测试。
4. 若影响 prompt 注入顺序或 request 组装，再同步 `docs/contracts/prompt-tool-exposure-contract.md` 的摘要边界。

若实现与本合同冲突，应视为实现漂移并立即收敛修正。
