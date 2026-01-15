# Context 管理落地 TODO（Formax）

目标：**UI 对话完整保留**（不丢历史），但**发给 LLM 的 prompt history 自动控长**，并提供 `/compact` 与后续自动压缩能力。

## 事实约束 / 不变量

- **UI transcript ≠ Prompt transcript**：UI `messages` 可以完整；prompt history 必须可截断/压缩。
- **tool 对必须成对**：任何 trimming/compact 后都必须保持 `tool_use ↔ tool_result` 一致，不得出现：
  - 孤儿 `tool_result`
  - `tool_use` 没有对应 result（除非你明确把它整段移除）
- SlashCommand 的 kind 以 `src/features/commands/registry.ts` 为准：`local | local_async | llm`（不要假设其他 kind）。
- **context_window_tokens ≠ max_tokens**：`max_tokens` 是输出上限，不是上下文窗口。

## P0 — 盘点现状（不改行为）

- [x] 画清链路图：UI messages、prompt history、system/injected blocks、streaming usage 的来源与流向
- [x] 列表：哪些内容会进 prompt history、哪些只进 UI（先按现状写）
- [x] 输出短文档：把“改哪儿”写清楚（后续实现对照）

**DoD**
- [x] 文档可被新人读懂，并能定位到关键入口文件

## P1 — context window 数据源（决定 meter/阈值）

- [x] 明确 `contextWindowTokens` 数据源（推荐先落地：模型元数据表）
  - [x] 为 model 元数据新增 `contextWindowTokens?: number`
  - [x] Anthropic 常用模型先填一版默认表（可后续扩展）
  - [x] 允许 config 覆盖（env/config）
- [x] 新增通用参数（参考 Codex，可配置）
  - [x] `effective_context_window_percent`（默认 0.95）
  - [x] `auto_compact_token_limit_percent`（默认 0.90）
  - [x] `baseline_tokens`（默认 12000）
- [x] 单测：给定 contextWindow/percent/baseline，输出 `effectiveLimit/autoCompactLimit/percentRemaining` 稳定

**DoD**
- [x] `bun run test`（相关 tests）通过
- [x] `bun run type-check` 通过

## P2 — Context Meter（先只显示，不改变 prompt）

- [x] 定义 `ContextStats`（used/limit/percentRemaining/shouldAutoCompact/source）
- [ ] token 估算策略：usage 优先，估算兜底
  - [x] 估算兜底：bytes/4（基于 prompt JSON 体积粗估）
  - [ ] usage 优先：拿到“当前 prompt/history 使用量”再替换估算（provider usage 目前仅是本轮消耗）
- [x] UI 显示：放在 Header/状态栏（先做最小、稳定、不闪）
- [x] 开关：可关闭 meter（不影响行为）

**DoD**
- [x] UI 可见稳定的 percent/tokens（不闪、不乱跳）

## P3 — Prompt 写入点的“硬截断”（安全兜底，不做总结）

> 这一刀是“立刻止血”：即使没有 `/compact`，也保证不会因 tool 输出/提醒太长把 prompt 撑爆。

- [x] 在“写入 prompt history”的统一入口加 `pruneForPromptBudget()`
  - [x] **只影响 prompt**，不删 UI messages
- [x] `pruneForPromptBudget()` 规则（必须保持 tool 成对）
  1) [x] 先截断容易爆的块
     - [x] `tool_result`（超长内容截断并标记）
     - [x] 长 stdout（Bash/TaskOutput 等）统一截断策略
     - [x] 长 injected reminder（如 todos stale）统一截断策略
  2) [x] 仍超限：从最老 turn 丢弃，并避免“tool_result 作为开头”导致的孤儿 result
  3) [x] 最后兜底：保留 `system + last user + 必要 tool 对`
- [ ] 单测覆盖：
  - [x] 超长 tool_result 会先截断
  - [x] trimming 后不会以 tool_result 开头（避免孤儿 result）
  - [x] 多工具并发结果 trimming 不破坏对
  - [x] injected reminders 很长时优先截断
  - [x] 仍超限时的“最小保留集”正确

**DoD**
- [x] 大输出不再把 prompt 撑爆
- [x] trimming 后 messages 满足 tool 成对不变量

## P4 — 手动 `/compact`（可见压缩 prompt，UI 不丢）

- [ ] 实现 `/compact` 命令（registry kind 按现有体系）
- [ ] Compact 行为：
  - [ ] 用一次“总结回合”生成 summary（写入 prompt history）
  - [ ] 重写 prompt history：`system + summary + 最近 N 条 turn/必要 tool 对`
  - [ ] UI 插入一条“已压缩”的提示（不删除 UI 历史）
- [ ] 防抖/防循环：
  - [ ] 同一 turn 不重复 compact
  - [ ] compact 后立刻更新 meter
- [ ] 单测：
  - [ ] `/compact` 前后，下一次请求 messages 确实变短但含 summary
  - [ ] tool loop 中途触发 `/compact` 的行为明确且不破坏工具链（可先禁用）

**DoD**
- [ ] `/compact` 可用；compact 后继续对话与 tool loop 正常

## P5 — 自动压缩（可选，等 P3/P4 稳定再做）

- [ ] pre-turn：发请求前若 `shouldAutoCompact` 则自动 compact
- [ ] tool-loop：只有在“还需要继续下一轮”且预算不足时才触发
- [ ] 限制策略：
  - [ ] 每 N turn 最多自动 compact 1 次
  - [ ] 避免死循环：超限时优先走硬截断兜底
- [ ] UI：轻提示可关闭

**DoD**
- [ ] 长对话不频繁爆上下文
- [ ] 不出现自动 compact 死循环

## P6 — 文档沉淀（面向开源读者）

- [ ] 写一篇 learning note：Codex 的上下文管理（事实）→ Formax 的映射（实现）
- [ ] `CODEMAP.md` 增加“上下文管理去哪改”的入口索引
- [ ] `pitfalls.md` 记录：如何复现/定位“prompt 被撑爆”的坑（关键词+复现步骤）

---

## 可选：如果还想再问一次 WebGPT（只问两件最不确定的）

> 仅建议在你还缺“权威 context window 表 + 总结提示词模板”时用这一轮。

```
你是资深 LLM 产品/架构工程师。请基于我提供的 Formax 代码打包（repomix 文件）与我对 Codex 开源实现的观察，补齐“上下文管理”方案的两个关键缺口，并输出可直接落地的 checklist。

背景（事实约束）：
- Formax 是 React+Ink CLI；UI messages 与发送给 LLM 的 prompt history 需要解耦（UI 保留完整，prompt 可压缩/截断）。
- 命令注册机制的 kind 只有：local / local_async / llm（不要假设其它 kind 或文件路径）。
- trimming 必须维护 tool_use ↔ tool_result 成对不变量（不能产生孤儿 tool_result 或 tool_use 无 result）。
- 我们已有 Anthropic streaming；后续会加 OpenAI，但这次只要求方案对 provider-agnostic 友好。

你需要补齐的两件事（请给“按表实现就能跑”的粒度）：
1) provider/model 的 context window 数据源与表：
   - 给出 Anthropic 常见模型（以及 OpenAI 常见模型，如果你能确定）的 context window tokens 对照表。
   - 每一项必须给出来源（官方文档链接或可靠引用）；不确定就标注“不确定/需用户确认”，不要编造。
   - 给出默认的 effective_window_percent、auto_compact_percent、baseline_tokens 建议值，并说明为什么。
2) /compact 的总结提示词模板与边界用例：
   - 给出一份可直接使用的 summarization prompt 模板（system/developer/user 的结构），要求总结后仍能继续工具调用、保留用户偏好/未完成任务/关键结论。
   - 列出至少 15 个边界用例清单（例如：长 tool 输出、多工具并发、plan mode、todos reminder、用户要求保留原文等），并给出对应的处理策略。

输出格式要求：
- 先给一页“最终架构图/数据流”（文字版即可）
- 然后给超细 checklist（按 P0/P1/P2，包含：改哪些文件、加哪些类型/函数、DoD、要跑的 tests/commands）
- 最后给风险清单与最小回滚策略
```
