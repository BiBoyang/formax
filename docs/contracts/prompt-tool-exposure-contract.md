# Prompt 与 Tool Exposure 合同（唯一事实源）

最后更新：2026-03-07  
状态：规范性（Normative）

本文档定义 Formax 在请求构造阶段的 prompt variant、deferred tool exposure、skills reminder、request dry-run preview 的唯一事实来源。

范围：
- system prompt variant 选择（`legacy` / `deferred_aligned`）
- deferred tool exposure 与 `ToolSearch`-first 加载语义
- skills 可用性在 legacy / deferred 两种模式下的呈现规则
- request-scoped helper blocks 的注入与持久化边界
- request dry-run preview 的对齐约束
- REPL / app-server / SDK 三条主路径的共享语义

不在范围内：
- 单个 tool 的业务合同与输入输出细节
- permissions / approval / ask_user_question 语义
- provider/network 发送后的传输行为与第三方返回差异

相关文档（信息性镜像）：
- `docs/contracts/tool-runtime-contract.md`
- `docs/environment-variables.md`
- `docs/contracts/skills-contract.md`
- `docs/learnings/2026-03-06-deferred-tool-exposure-shared-resolver.md`
- `docs/learnings/2026-03-06-deferred-prompt-variant-and-skills-reminder.md`
- `docs/learnings/2026-03-06-request-dry-run-preview.md`

规范关键字约定：
- `MUST`、`SHOULD`、`MAY` 采用 RFC 2119 语义。

## 1. 语义权威源

`PTE-001`  
prompt/tool exposure 的规范性实现权威 MUST 位于以下代码路径：
1. `packages/core/src/prompts/system.ts`
2. `packages/core/src/tools/runtime/deferredToolExposureResolver.ts`
3. `packages/core/src/tools/runtime/deferredToolExposure.ts`
4. `packages/core/src/chat/engine.ts`

`PTE-002`  
REPL、app-server、SDK MUST 共享同一 prompt variant 与 deferred tool exposure 语义；各入口只允许做参数注入与适配，不得发明独立分支。

## 2. Prompt Variant 合同

`PTE-101`  
`FORMAX_DEFERRED_TOOL_EXPOSURE` MUST 被视为一个 linked behavior bundle。该开关改变的不是单一文案，而是以下三件事的联动：
1. system prompt variant
2. tools 暴露方式
3. skills 可用性呈现方式

`PTE-102`  
当 `FORMAX_DEFERRED_TOOL_EXPOSURE=0` 时，system prompt variant MUST 为 `legacy`。  
当 `FORMAX_DEFERRED_TOOL_EXPOSURE=1` 时，system prompt variant MUST 为 `deferred_aligned`。

`PTE-103`  
deferred-aligned prompt 的可选能力段落（capabilities）MUST 继续由代码常量控制；不得仅为了 prompt 文案切换而引入新的 runtime env toggle。

`PTE-104`  
REPL、app-server、SDK MUST 使用同一个 variant resolver；不允许出现某一入口是 deferred tools，而 system prompt 仍停留在 legacy 的漂移状态。

## 3. Tool Exposure 合同

`PTE-201`  
legacy 模式下，请求 tools 列表 MUST 直接从当前 turn 的过滤后 tool catalog 派生；不得引入 deferred catalog gate。

`PTE-202`  
deferred 模式下，catalog 级工具暴露 MUST 采用 `ToolSearch`-first 策略。  
在工具被显式加载前，deferred catalog 内的工具 MUST NOT 直接进入初始 `request.tools`。

`PTE-203`  
deferred exposure 的 catalog/session 状态 MUST 由 shared resolver/store 管理，并且 MUST 使用稳定的 session key：
1. 有显式 session key 时优先使用显式 key
2. 否则回退到 `cwd` 维度 key

`PTE-204`  
一旦 deferred catalog 中的工具被加载进 turn，可见 tool spec MUST 携带 `defer_loading: true` 元数据。

`PTE-205`  
`ToolSearch` 成功加载工具时，结果内容 MUST 支持结构化 `tool_reference` block；文本摘要 MAY 同时存在，但 structured reference 是 canonical 机制。

`PTE-206`  
非 catalog 的辅助性 wrapper tools MAY 由具体入口在 resolver 结果之上追加，但这 MUST NOT 让 deferred catalog 工具绕过 `ToolSearch`-first 规则。

`PTE-207`  
`FORMAX_DEFERRED_TOOL_SOFT_FALLBACK` MAY 提供兼容性 direct-call 补救路径，但它 MUST NOT 改变 canonical request framing，也 MUST NOT 取代 shared resolver 作为工具暴露真值。

`PTE-208`
session-memory restore MAY expose `recentDeferredToolNames` as a bounded next-turn hint derived from prior successful `ToolSearch` calls. This hint MUST NOT rehydrate `DeferredToolExposureStore.loadedNames`, MUST NOT make those tools visible without the normal `ToolSearch`-first resolver path, and MUST remain best-effort restore context only.

## 4. Skills 呈现合同

`PTE-301`  
skills 可用性信息在任一请求路径中 MUST 只有一个 canonical 呈现位置；不得同时把完整 skills 清单作为 request-scoped helper block 和 Skill tool description 的双重真值。

`PTE-302`  
legacy 模式下，可用 skills 清单 MUST 继续内嵌在 Skill tool description 中。

`PTE-303`  
deferred 模式下，可用 skills 清单 MUST 通过 ephemeral `<system-reminder>` helper block 呈现；Skill tool description MUST 关闭内嵌 inventory，以避免重复与漂移。

`PTE-304`  
skills reminder 文本 MUST 在进入 `<system-reminder>` 前完成基本转义与单行化处理，避免破坏 reminder framing。

## 5. Helper Blocks 与持久化边界

`PTE-401`  
`<available-deferred-tools>` 与 skills reminder MUST 属于 request-scoped ephemeral prompt blocks。

`PTE-402`  
resolver 生成的 helper blocks MUST 出现在该次请求的 user-authored blocks 之前；不同入口可在其后追加其他 helper families，但不得把 resolver blocks 放到用户正文之后。

`PTE-403`  
resolver 生成的 helper blocks MUST NOT 进入长期持久化历史，包括但不限于：
1. REPL session history
2. app-server thread snapshots
3. SDK 返回的 persisted history

`PTE-404`  
若请求路径需要返回 stripped history，则 stripped 结果 MUST 以去除 injected helper blocks 后的用户消息作为持久化/对外历史版本。

`PTE-405`  
`# claudeMd` helper block（`<system-reminder>`）MUST 由同一注入器统一组装，按以下顺序拼接上下文：
1. 全局 `CLAUDE.md`（若存在）
2. 项目 `CLAUDE.md`（若存在）
3. auto-memory `MEMORY.md`（仅在 `FORMAX_DEFERRED_TOOL_EXPOSURE=1` 且文件存在时）

`PTE-406`  
auto-memory 文件路径 MUST 与 system prompt 中声明的 memory 目录一致（同一 `buildAutoMemoryDirectoryPath` 规则），并且 `MEMORY.md` 注入内容 MUST 在 200 行内（超过部分截断）。当 `FORMAX_DEFERRED_TOOL_EXPOSURE=0` 时，`MEMORY.md` MUST NOT 注入。

## 6. Request Dry-Run Preview 合同

`PTE-501`  
`FORMAX_REQUEST_DRY_RUN=1` 时，runtime MUST 先按正常路径构造该次请求的 `system`、`messages`、`tools`，并在 post-injection、pre-transport 边界导出 payload。

`PTE-502`  
dry-run 模式 MUST 将 payload 写入本地 JSON，并且 MUST NOT 发出真实网络请求。

`PTE-503`  
当 `FORMAX_REQUEST_DRY_RUN_DIR` 未设置时，默认输出目录 MUST 为 `<cwd>/proxy/request-dry-run`。

`PTE-504`  
dry-run preview 是诊断能力，不是第二套请求构造逻辑。任何 deferred exposure、skills reminder、system prompt variant 的修改，dry-run 与 live path MUST 保持相同的请求装配结果。

## 7. 一致性测试映射

本合同的主测试集：
1. `packages/core/src/prompts/system.test.ts`
2. `packages/core/src/tools/runtime/deferredToolExposureResolver.test.ts`
3. `packages/core/src/features/repl/controller/send/sendMainTurn.test.ts`
4. `packages/core/src/app-server/turnRunner.test.ts`
5. `packages/core/src/sdk/query.test.ts`
6. `packages/core/src/chat/engine.test.ts`
7. `packages/core/src/config/runtimeFlags.test.ts`
8. `packages/core/src/tools/modules/skill/index.test.ts`

## 8. 变更控制

当变更以下任一行为时：
1. deferred tool exposure
2. skills reminder 呈现
3. system prompt variant 联动
4. request dry-run preview

必须按以下顺序执行：
1. 先更新本文件。
2. 再更新 `packages/core/src/prompts/system.ts`、`packages/core/src/tools/runtime/deferredToolExposureResolver.ts`、`packages/core/src/tools/runtime/deferredToolExposure.ts`、相关入口 wiring。
3. 同步更新 `docs/environment-variables.md`（若 env 语义变化）与相关 learnings。
4. 保持 `formax-system-prompt-workflow` 指向本合同，而不是继续在 skill 中承载长期真相。

若实现与本合同冲突，应视为实现漂移并立即收敛修正。
