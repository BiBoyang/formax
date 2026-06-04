# Hooks 合同（唯一事实源）

最后更新：2026-06-04  
状态：规范性（Normative）

本文档定义 Formax hooks 子系统的事件语义、matcher 规则、blocking 语义与 `additionalContext` 注入边界。

范围：
- hook 事件集合与 matcher 语义
- hooks 的三层加载/合并/去重规则
- blocking 与 non-blocking 事件的 exit code 语义
- `additionalContext` 的提取与注入时机
- ChatEngine / tool executor 中的 hooks 注入边界
- MCP tool names 在 tool hook events 中的摘要边界

不在范围内：
- hooks UI 对话框的具体布局和交互细节
- command hook 的业务脚本内容
- audit 展示文案与 hooks debug 呈现细节

相关文档（信息性镜像）：
- `docs/references/hooks-payload-reference.md`
- `docs/environment-variables.md`
- `packages/core/src/hooks/README.md`
- `docs/contracts/mcp-client-contract.md`

规范关键字约定：
- `MUST`、`SHOULD`、`MAY` 采用 RFC 2119 语义。

## 1. 规范模型（Canonical Model）

`HOOK-001`  
当前 canonical hook 事件集合 MUST 为：
1. `PreToolUse`
2. `PermissionRequest`
3. `PostToolUse`
4. `UserPromptSubmit`
5. `SessionStart`
6. `Stop`

`HOOK-002`  
本合同的规范性实现权威 MUST 位于以下代码路径：
1. `packages/core/src/hooks/types.ts`
2. `packages/core/src/hooks/store.ts`
3. `packages/core/src/hooks/settingsStore.ts`
4. `packages/core/src/hooks/runtime.ts`
5. `packages/core/src/hooks/runner.ts`
6. `packages/core/src/chat/engine.ts`

## 2. Matcher 与事件筛选合同

`HOOK-101`  
以下事件 MUST 使用 matcher 语义：
1. `PreToolUse`
2. `PermissionRequest`
3. `PostToolUse`
4. `SessionStart`

`HOOK-102`  
`UserPromptSubmit` 与 `Stop` MUST 被视为 matcher-less 事件：
1. runtime 中始终按 `*` 处理
2. 配置持久化时不得写入 `matcher`
3. 若用户配置了非 `*` matcher，系统 MAY 记录 warning，但 MUST 继续按 `*` 处理

`HOOK-103`  
`SessionStart` 的 matcher MUST 只接受：
1. `startup`
2. `resume`
3. `clear`
4. `compact`
5. `*`

缺失 matcher 时 fallback MUST 为 `*`；非法值 MUST 被降级为 `*` 并记录 warning。

`HOOK-104`  
tool-matcher 语义 MUST 保持：
1. `*` -> match all
2. 纯字符串 -> exact tool name match
3. 含 regex 元字符的 matcher -> regex 匹配
4. 非法 regex -> conservative non-match

`HOOK-105`  
MCP tool calls MUST use their full model-facing tool name, such as `mcp__<server>__<tool>`, for `PreToolUse`, `PermissionRequest`, and `PostToolUse` matcher evaluation. Hooks MUST NOT receive a shortened server/tool alias as the canonical matcher name.

`HOOK-106`  
MCP hook payloads MUST carry the full qualified MCP tool name. Original server/tool identity MAY be included as additional MCP metadata, but the canonical hook matcher field remains the model-facing tool name.

## 3. 配置加载与合并合同

`HOOK-201`  
hooks 配置 MUST 从以下来源加载：
1. `<project>/.formax/settings.local.json`
2. `<project>/.formax/settings.json`
3. `<FORMAX_CONFIG_DIR>/settings.json`

`HOOK-202`  
合并优先级 MUST 为 `projectLocal` > `project` > `user`。

`HOOK-203`  
merged hooks 去重 MUST 以 `command` 为键；高优先级来源保留命令所有权。  
若高优先级条目缺失可选字段（如 `timeoutMs`），系统 MAY 继承低优先级条目的该字段。

`HOOK-204`  
对于 matcher-required 事件，空 matcher 规则 MUST 被忽略并记录 warning；若需要“全匹配”，配置必须显式写 `*`。

`HOOK-205`  
只有 `type: command` 且 `command` 非空的 hook 定义才 MUST 被加载进 runtime。

## 4. Runtime 执行合同

`HOOK-301`  
所有 hooks 当前 MUST 通过本地 command 执行；payload 以 JSON 形式写入 stdin。

`HOOK-302`  
runtime 注入的项目根环境变量 MUST 包含：
1. `CLAUDE_PROJECT_DIR`
2. `FORMAX_PROJECT_DIR`

`HOOK-303`  
command hook 的默认并发度 MUST 为 4，默认超时 MUST 为 60000ms。

`HOOK-304`  
stdout / stderr 捕获 MUST 截断到固定上限，并在截断时追加统一的 truncated 标记，而不是无限增长。

## 5. Blocking 语义合同

`HOOK-401`  
`PreToolUse` 与 `PermissionRequest` 中，`exitCode=2` MUST 表示 blocked；该结果可以阻断后续执行路径。

`HOOK-402`  
`PostToolUse` 中，`exitCode=2` MUST 被收集为 `blockingErrors`，并作为后续模型调用的提醒上下文；它 MUST NOT retroactively 撤销已经完成的 tool result。

`HOOK-403`  
`UserPromptSubmit`、`SessionStart`、`Stop` 当前 MUST 是 non-blocking 事件：
1. `exitCode=2` 只记录在 `runs`
2. 不得阻断当前 app flow / model call

## 6. `additionalContext` 注入边界合同

`HOOK-501`  
规范性 `additionalContext` MUST 通过 stdout JSON 提供，并支持两种字段风格：
1. camelCase: `hookSpecificOutput.hookEventName` + `additionalContext`
2. snake_case: `hook_specific_output.hook_event_name` + `additional_context`

`HOOK-502`  
只有当输出中的 `hookEventName` 与当前事件名一致时，`additionalContext` 才能被接受；事件名不一致、空字符串或非字符串值 MUST 被忽略。

`HOOK-503`  
`UserPromptSubmit`、`SessionStart`、`Stop` 在 `exitCode=0` 且 stdout 非 JSON 时，stdout 文本 MAY 被直接当作 `additionalContext` 注入。

`HOOK-504`  
`PostToolUse` 的 `additionalContext` 当前 MUST 只来自规范性 JSON；普通 stdout 文本不得被直接注入。

`HOOK-505`  
`UserPromptSubmit` 与 `SessionStart` 的 `additionalContext` MUST 只作用于该 session 中“下一次初始模型请求”，并且 MUST NOT 持久化进长期 history。

`HOOK-506`  
`PostToolUse.additionalContext` MUST 作用于该 tool_result 之后的下一次模型调用，并且 MUST NOT 持久化进长期 history。

`HOOK-507`  
`Stop.additionalContext` MUST 作用于“下一轮”的首次模型请求，而不是刚刚结束的那一轮；它也 MUST NOT 持久化进长期 history。

## 7. 一致性测试映射（Conformance Test Map）

本合同的主测试集：
1. `packages/core/src/hooks/store.test.ts`
2. `packages/core/src/hooks/settingsStore.test.ts`
3. `packages/core/src/hooks/runtime.test.ts`
4. `packages/core/src/hooks/runner.test.ts`
5. `packages/core/src/chat/engine.test.ts`
6. `packages/core/src/tools/executor/index.test.ts`
7. `packages/core/src/tools/executor/policyPreflight.test.ts`

## 8. 变更控制

当变更以下任一行为时：
1. hook 事件集合
2. matcher 语义
3. blocking 语义
4. `additionalContext` 注入边界

必须按以下顺序执行：
1. 先更新本文件。
2. 再更新 `store/settingsStore/runtime/runner` 与入口 wiring。
3. 同步更新 `docs/references/hooks-payload-reference.md`。
4. 在后续 README 治理中，让 `packages/core/src/hooks/README.md` 降级为 informative deep dive，而不是继续承载 canonical truth。

若实现与本合同冲突，应视为实现漂移并立即收敛修正。
