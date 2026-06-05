# Permissions 与 Policy 合同（唯一事实源）

最后更新：2026-06-04  
状态：规范性（Normative）

本文档定义 Formax 中 permissions / policy preflight / approval remember side effects 的唯一事实来源。

范围：
- `allow` / `ask` / `deny` 与 `allow` / `prompt` / `deny` 的语义关系
- policy action 映射、默认决策、规则优先级
- permissions settings 与 policy rules 的叠加方式
- workspace 边界与 session workspace allow 语义
- `approve_remember` 的持久化与 session side effects
- MCP tool-name permissions 摘要边界

不在范围内：
- approval / ask_user_question 的 payload 形状与生命周期
- approval renderer 的具体 UI 布局、按钮文案与导航
- 非 policy action tool 的实现细节

相关文档（信息性镜像）：
- `docs/contracts/interactive-input-contract.md`
- `docs/frontend/app-server-ui-spec.md`
- `docs/environment-variables.md`

规范关键字约定：
- `MUST`、`SHOULD`、`MAY` 采用 RFC 2119 语义。

## 1. 规范模型（Canonical Model）

`PERM-001`  
permissions/policy 的 canonical 语义 MUST 由以下层组合而成：
1. `PolicyAction` 映射
2. policy rules（session / project / global）
3. permissions settings overlay（`allow` / `ask` / `deny`）
4. workspace boundary 检查
5. interactive approval side effects

`PERM-002`  
运行时 effective decision 词汇 MUST 使用：
1. `allow`
2. `prompt`
3. `deny`

`PERM-003`  
permissions settings 的 overlay 词汇 MUST 使用：
1. `allow`
2. `ask`
3. `deny`

其中 `ask` 的 canonical 含义是“强制该动作进入 prompt 路径”，不是独立于 `prompt` 的第四种运行时终态。

`PERM-004`  
本合同的规范性实现权威 MUST 位于以下代码路径：
1. `packages/core/src/tools/executor/policyAction.ts`
2. `packages/core/src/core/policy/engine.ts`
3. `packages/core/src/tools/executor/policyPreflight.ts`
4. `packages/core/src/tools/executor/approvalService.ts`
5. `packages/core/src/adapters/permissions/permissionsStore.ts`
6. `packages/core/src/adapters/permissions/matcher.ts`

## 2. Policy Action 与默认决策

`PERM-101`  
只有映射到以下 `PolicyAction.kind` 的行为才受本合同约束：
1. `fs.read`
2. `fs.write`
3. `bash.exec`
4. `net.fetch`
5. `net.search`
6. `tool.install`

MCP Phase 1A MUST NOT add a new `mcp.call` `PolicyAction`. MCP tool calls extend the existing tool permission / approval flow by tool name, as defined in `PERM-250` through `PERM-256`.

`PERM-102`  
当前 canonical tool-to-action 映射 MUST 保持：
1. `Read` / `Glob` / `Grep` -> `fs.read`
2. `Write` / `Edit` / `NotebookEdit` -> `fs.write`
3. `Bash` -> `bash.exec`
4. `WebFetch` -> `net.fetch`
5. `WebSearch` -> `net.search`
6. `Grep` 缺失 ripgrep 时的安装前置检查 -> `tool.install`

`PERM-103`  
在没有命中任何 policy rule 时，默认决策 MUST 为：

| Action kind | Default |
|---|---|
| `fs.read` | `allow` |
| `fs.write` | `prompt` |
| `bash.exec` | `allow` |
| `net.fetch` | `deny` |
| `net.search` | `deny` |
| `tool.install` | `allow` |

## 2A. MCP Tool Permission 摘要

`PERM-250`  
MCP tool calls MUST be permissioned by their model-facing fully-qualified tool name `mcp__<server>__<tool>`, not by a new policy action kind and not by call arguments.

`PERM-251`  
Interactive main path MCP tool calls MUST default to prompt when no matching allow exists. Non-interactive and sub-agent MCP tool calls MUST fail closed when approval would be required.

`PERM-252`  
`approve_remember` for an MCP tool MUST remember the exact fully-qualified tool name by default. It MUST NOT include arguments in the remember key.

`PERM-253`  
Hand-authored permissions MAY use exact `mcp__<server>__<tool>`, server-level `mcp__<server>`, or wildcard `mcp__<server>__*` forms. Runtime MUST NOT auto-generate server-level or wildcard MCP rules in Phase 1A.

`PERM-254`  
MCP permissions MUST reuse existing permissions overlay precedence: `deny` > `ask` > `allow`; list precedence wins before match specificity. MCP MUST NOT add MCP-specific specificity ordering.

`PERM-255`  
There is no `mcp.server.start` approval action in Phase 1A. MCP server startup is host/runtime config activation and MUST NOT be authorized by model tool-call approval.

`PERM-256`  
MCP arguments belong in prompt/audit payload only. They MUST NOT be serialized into permission allow/ask/deny keys.

`PERM-257`  
Plan mode MUST fail closed for MCP tool calls in Phase 1A. Because Phase 1A does not classify MCP tools by filesystem effect or target path, MCP tools MUST NOT bypass the existing plan-mode rule that only the active plan file may be edited.

## 3. Policy Rules 合同

`PERM-201`  
持久化 policy rules MUST 分为两层：
1. project: `<project>/.formax/rules.json`
2. global: `<FORMAX_CONFIG_DIR>/rules.json`

`PERM-202`  
session allow rules MUST 是进程内会话态，不得写入 `rules.json`。

`PERM-203`  
effective policy 评估 MUST 使用：
1. session rules
2. project rules
3. global rules

`PERM-204`  
命中多个 policy rule 时，选中规则的优先级 MUST 为：
1. decision priority: `deny` > `prompt` > `allow`
2. scope priority: `session` > `project` > `global`
3. specificity priority: 更具体的 match 优先
4. stable tie-break: 同层同优先级时，后出现的规则覆盖先出现的规则

## 4. Permissions Settings 合同

`PERM-301`  
permissions settings MUST 从以下来源加载，并按优先级去重：
1. `projectLocal`: `<project>/.formax/settings.local.json`
2. `project`: `<project>/.formax/settings.json`
3. `user`: `<FORMAX_CONFIG_DIR>/settings.json`

`PERM-302`  
同一规则同时出现在多个 settings 来源时，MUST 保留高优先级来源（`projectLocal` > `project` > `user`）。

`PERM-303`  
permissions overlay 的匹配优先级 MUST 为：
1. `deny`
2. `ask`
3. `allow`

`PERM-304`  
`Bash` 权限匹配语义 MUST 保持：
1. `Bash` 表示 tool-level 全量匹配
2. `Bash(<exact command>)` 表示精确命令匹配
3. `Bash(prefix:*)` 表示以单词边界为准的前缀匹配
4. `Bash(<glob*pattern>)` 表示 glob 匹配
5. `Bash(*)` MUST NOT 被解释为“匹配所有命令”

`PERM-305`  
`WebFetch` / `WebSearch` 的 permissions overlay 当前 MUST 以 tool-level 匹配为准；更细粒度的 URL/query 前缀控制应由 policy rules 承担，而不是 permissions lists。

## 5. Effective Decision 组合规则

`PERM-401`  
effective decision MUST 先从 policy engine 结果出发，再叠加 repl mode、workspace boundary、tool-specific classifier 与 permissions overlay。

`PERM-402`  
`acceptEdits` 模式下，仅当 action 为 `fs.write` 且 policy engine 结果为 `prompt` 时，effective decision MAY 提升为 `allow`；任何 `deny` 结果都 MUST 保持不变。

`PERM-403`  
若 action 命中 workspace out-of-bounds 检查，且当前结果不是 `deny`，effective decision MUST 变为 `prompt`。

`PERM-404`  
`Bash` 风险分类器 MAY：
1. 对高风险命令直接 `deny`
2. 对 confirm-risk 命令强制 `prompt`

但若已有显式 policy `allow` 命中，则 confirm-risk prompt MAY 被该 allow 抵消。

`PERM-405`  
`Bash` / `WebFetch` / `WebSearch` 叠加 permissions overlay 时，必须满足：
1. permissions `deny` -> effective decision MUST 为 `deny`
2. permissions `ask` -> `allow` MUST 提升为 `prompt`
3. permissions `allow` -> 仅在未命中显式 policy `deny` / `prompt` 时，才可把当前 decision 放宽为 `allow`

`PERM-406`  
sub-agent 或 non-interactive 路径 MUST NOT 进入 prompt；若该动作需要 approval 或 workspace 扩权，必须直接返回 error。

`PERM-407`
sub-agent 的 workspace 边界 MUST 基于父 `Task` 执行时继承的 `ExecutionContext.cwd` 计算；这不改变 `PERM-406` 的 fail-closed / no-prompt 语义。

## 6. Workspace 边界合同

`PERM-501`  
effective workspace roots MUST 由以下部分组成：
1. 仓库/运行时检测得到的 workspace roots
2. session workspace additions
3. `<FORMAX_CONFIG_DIR>/plans` 目录作为内建白名单根（与 `FORMAX_DEFERRED_TOOL_EXPOSURE` 无关）
4. 按当前 `cwd` 计算出的 auto-memory 目录（`buildAutoMemoryDirectoryPath`）作为内建白名单根（与 `FORMAX_DEFERRED_TOOL_EXPOSURE` 无关）

`PERM-502`  
`permissions.workspace.additionalDirectories` 的磁盘字段 MAY 被解析以保持前向兼容，但当前 runtime MUST NOT 让它直接成为 effective workspace roots。

`PERM-503`  
workspace additions 当前 MUST 是 project-root 级 session state，不得持久化为长期 policy rule。

`PERM-504`  
当 `fs.read` / `fs.write` / `Grep`（含 symlink escape）访问 canonical roots 外路径时：
1. interactive main path -> MUST 走 approval prompt，并附带 `workspaceRequest.dir`
2. non-interactive 或 sub-agent path -> MUST 直接 deny

`PERM-505`  
`FORMAX_DEFERRED_TOOL_EXPOSURE` 开关 MUST NOT 影响 auto-memory 目录是否加入 workspace 白名单。

`PERM-506`  
当 action 为 `fs.write` 且目标位于 auto-memory 目录时，runtime MAY 将默认 `prompt` 提升为 `allow` 以避免交互审批；但显式 `prompt` 与显式 `deny` MUST 保持原决策。

`PERM-507`  
`<FORMAX_CONFIG_DIR>/plans` 目录 MUST 始终被视为 workspace 白名单根，不受 `FORMAX_DEFERRED_TOOL_EXPOSURE` 开关影响。

## 7. Remember Side Effects 合同

`PERM-601`  
`approve` 只表示本次放行；MUST NOT 写入任何长期 settings/rules。

`PERM-602`  
若 approval 提供 `updated_input_json` 且通过校验，则后续 approve/remember 语义 MUST 绑定到“更新后的 action”，不是原 action。

`PERM-603`  
`approve_remember` + `fs.write` MUST 切换当前 session 到 `acceptEdits` 模式；MUST NOT 写入 `permissions.allow`，也 MUST NOT 写入 policy rules。

`PERM-604`  
`approve_remember` + `bash.exec` MUST 写入 repo-local `permissions.allow`，目标文件为 `<project>/.formax/settings.local.json`。

`PERM-605`  
`approve_remember` + `fs.read` 且带 `workspaceRequest.dir` MUST 只写入 session workspace addition；MUST NOT 写入 policy rules。

`PERM-606`  
除 `fs.write` 与 workspace read 这两类固定语义外，其余 `approve_remember` MUST 按 scope 处理：
1. `session` -> 仅增加 session allow rule
2. `project` -> 写入 project `rules.json`
3. `global` -> 写入 global `rules.json`

`PERM-607`  
approval 返回未知 scope 时，canonical fallback MUST 为 `session`。

`PERM-608`  
`feedback` 与 `cancel/reject` MUST 视为拒绝本次工具执行，不得产生 remember side effects。

`PERM-609`  
对 `fs.write` 与 workspace read 而言，UI 中出现或缺失的 scope 选择不改变其 canonical remember 结果；scope 仅对第 `PERM-606` 条的“普通 policy action”生效。

`PERM-610`  
approval-like 决策解释（`approve` / `approve_remember` / `feedback` / `cancel`）MUST 由共享 resolver 统一收口，不得在 `approvalService` 与 `skillPreflight` 中维护分叉实现。规范锚点：
1. `packages/core/src/tools/executor/approvalLikePrompt.ts`（`resolveApprovalLikeOutcome`）
2. `packages/core/src/tools/executor/approvalService.ts`
3. `packages/core/src/tools/executor/skillPreflight.ts`

## 8. 一致性测试映射（Conformance Test Map）

本合同的主测试集：
1. `packages/core/src/tools/executor/policyPreflight.test.ts`
2. `packages/core/src/tools/executor/approvalService.test.ts`
3. `packages/core/src/adapters/permissions/matcher.test.ts`
4. `packages/core/src/adapters/permissions/permissionsStore.test.ts`
5. `packages/web-reference-react/src/components/InputApprovalDock.test.tsx`

## 9. 变更控制

当变更以下任一行为时：
1. permissions allow/ask/deny 语义
2. policy 默认值或规则优先级
3. workspace boundary / workspace remember
4. `approve_remember` side effects

必须按以下顺序执行：
1. 先更新本文件。
2. 再更新 `policyPreflight` / `approvalService` / `permissionsStore` / `matcher` 与对应测试。
3. 保持 `docs/contracts/interactive-input-contract.md`、`docs/frontend/app-server-ui-spec.md` 为摘要或 renderer-level 说明，不重复完整 policy semantics。
4. 在后续 skill 变薄时，让 `formax-permissions-workflow` 指向本合同，而不是继续承载长期真相。

若实现与本合同冲突，应视为实现漂移并立即收敛修正。
