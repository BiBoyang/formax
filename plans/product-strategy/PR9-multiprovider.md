# PR9 — 多家大模型兼容（Anthropic + OpenAI / OpenAI-compatible）

> 本文件从 `plans/product-strategy/Formax 产品化完整执行计划.md` 中拆出，作为 PR9 的独立 TODO/验收清单，避免主计划文档过长影响查阅与维护。

## 目标（Outcome）
- 在不破坏现有工具调用/tool loop/StreamEvent/UI 的前提下，新增 `openai` 与 `openai-compatible` 支持。
- 保持 Anthropic 路径行为不变（回归必须全绿）。
- 为后续 PR10（Gemini）与可选“ai SDK 替换”留好扩展点，但本 PR 不强行引入。

## 关键约束（Hard constraints）
- **StreamEvent 契约不破坏**：UI 依赖 `src/streaming/types.ts` 的事件形状与 `id` 稳定性。
- **tool loop 语义不变**：ChatEngine 只在 `stopReason !== 'tool_use'` 或无 tool call 时结束回合。
- **interactive=false 不可阻塞**：subagent（Task）与非交互执行必须立刻返回稳定错误 `tool_result`，不得等待用户输入或审批确认。
- **坏 JSON/abort 不挂死**：任何半截 arguments / abort / parse 失败都必须最终补齐 `tool_end`（避免 UI 永久 loading）。

## 设计落地文档（Implementation specs）
- PR9d（OpenAI native streaming 规格）：`plans/product-strategy/PR9d-openai-streaming.md`

---

## Checklist（按 PR9a → PR9e 的最小风险顺序）

### PR9a — ChatEngine 解耦 Anthropic-only 类型（零行为改动）
**目的**：把 `src/chat/engine.ts` 从 `AnthropicStreamClient + ContentBlock` 中解耦，改为依赖 provider-agnostic `LlmStreamClient` + `StreamTurnResult`。

已完成（见 git history）。为保持 plans 目录“纯 pending”，本文件不再保留已完成 checklist。

**验收**
- `bun run type-check`
- `bun run test`
- 手动：Anthropic 跑一轮 tool loop，观察 `tool_start → tool_input → tool_end → complete` 不变。

---

### PR9b — Provider 注入点统一（仍默认 Anthropic）
**目的**：把“new Anthropic client”的注入点变为“按 config 选择 provider client”，但默认仍走 Anthropic。

- [ ] 新增 provider 工厂/registry（例如 `src/streaming/factory.ts` 或 `src/llm/registry.ts`）。
- [ ] 在 CLI 主入口链路注入（参考 `src/entrypoints/cli.tsx` → `src/legacy/runLegacyCli.tsx` → `src/chat/engine.ts`）。
- [ ] Subagent 注入点同样统一（参考 `src/subagents/runner.ts`）。

**DoD**
- [ ] `llm.provider` 默认不变；不配置 openai 也能正常运行。
- [ ] Anthropic 全回归通过。

---

### PR9c — OpenAI（Responses）“纯文本流”先跑通（不启用工具）
**目的**：最小可用地跑通 OpenAI streaming（只 `assistant_delta + usage + complete`），为后续工具链路做铺垫。

- [ ] 新增 `src/streaming/openai/*`：OpenAIStreamClient + SSE parser（仅文本）。
- [ ] 配置：`llm.provider=openai` 可选；baseUrl 默认 `https://api.openai.com/v1`（兼容自定义）。
- [ ] 错误处理：HTTP 非 2xx 直接抛错（engine 捕获并 emit `error`）。
- [ ] 可选：增加 debug 开关输出原始 SSE 到 logs（为 PR9d/PR9e 复现用）。

**DoD**
- [ ] OpenAI：纯文本对话可正常 streaming 输出并结束，不 crash。

---

## PR9d — OpenAI native streaming + 工具全链路（分段合入，强制测试）
> 规格与映射表见：`plans/product-strategy/PR9d-openai-streaming.md`

### PR9d1 — ToolCallAssembler（通用）+ 单元测试
- [ ] 新增 `ToolCallAssembler`（exactly-once / 并发安全 / abort 补齐 tool_end / 坏 JSON 不挂死）。
- [ ] 覆盖 10+ 条边界测试（交错分片、缺 id、坏 JSON、重复 done、abort mid-stream 等）。

### PR9d2 — Responses：function_call 事件解析 → tool_start/tool_input（先不执行工具）
- [ ] 解析 `function_call` 相关事件并 emit `tool_start/tool_input`（id 使用 `call_id`，维护 `item_id → call_id` 路由）。

### PR9d3 — Responses：executeTool + tool_end（闭环）
- [ ] arguments 完整后执行一次工具，emit `tool_end`。
- [ ] parse 失败/abort：直接构造 error `ToolResult`，仍需 `tool_end`。
- [ ] toolResults 返回时按出现顺序稳定排序（避免 history 漂移）。

### PR9d4 — Responses：tool_result 回注 + 多轮 tool loop 端到端
- [ ] 将 canonical `tool_result` 写回 OpenAI Responses 的 tool output 结构（call_id 对齐），并能继续下一轮生成最终回答。

### PR9d5 — Chat Completions fallback（用于 openai-compatible）
- [ ] `openai.apiMode = responses|chat`（默认 responses）。
- [ ] Chat 的 tool_calls 分片复用同一 assembler；支持 `finish_reason=tool_calls`。
- [ ] `stream_options.include_usage` 不支持时自动降级重试（最多一次），或降级为“无 usage”。

### PR9d6 — Debug/复现设施（强烈建议）
- [ ] 原始 SSE 录制（开关 + logsDir）。
- [ ] 将一次失败 SSE dump 固化为 fixture，写成可 replay 的单测（避免回归反复抓包）。

**DoD（PR9d 总体）**
- [ ] OpenAI Responses：无工具/单工具/双工具交错分片 都可跑通。
- [ ] interactive=false：遇到需要审批的工具能立刻 `tool_end(is_error)`，不挂住。
- [ ] abort：不留“running”工具，UI 不会永久 loading。

---

### PR9e — OpenAI-compatible（生态现实补齐）
**目的**：支持仅实现 `/v1/chat/completions` 的网关（OpenRouter/自建代理等）。

- [ ] baseUrl 可自定义，默认走 Chat Completions。
- [ ] tool output 回注按 chat 语义：`role=tool` + `tool_call_id`。
- [ ] include_usage 降级策略完善。
- [ ] 最小连接测试（key/baseUrl/model）与最小 models 列表（可延后但要有 plan）。

**DoD**
- [ ] OpenAI-compatible：纯文本 + 单工具闭环可跑通。

---

### PR9f（可选）— 引入 ai SDK 作为“第二后端”（native vs ai-sdk 可切换）
> 不是本轮强制目标；仅当 native 跑稳后再做。

- [ ] `llm.backend = native|ai-sdk`（默认 native）。
- [ ] 两条路径输出同样的 StreamEvent/ToolCall 语义（否则不要引入）。

---

## 最小回归矩阵（建议做成 CI 必跑集合）
- Anthropic：纯文本、单工具（Read/Glob）、需要审批的工具（Write/Edit/Bash）在 interactive=false 下不阻塞
- OpenAI Responses：纯文本、单工具（arguments 分片）、双工具交错分片、坏 JSON、abort mid-stream
- OpenAI Chat（fallback）：纯文本、tool_calls 分片、include_usage 不支持降级

## 相关参考（非唯一事实来源）
- `plans/product-strategy/PR9d-openai-streaming.md`：本仓库落地规格（映射表 + assembler + 测试矩阵）
- `plans/adapter/webgpt3.md`：WebGPT 的工程落地拆分与审查（路径基本贴合）
- `plans/adapter/opencode-vs-formax.md`：opencode 的 provider 组织方式（registry/transform 思路）
- `docs/SUBAGENT-APPROVAL-STRATEGY.md`：subagent 的审批/交互约束
