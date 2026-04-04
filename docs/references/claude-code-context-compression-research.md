# Claude Code 上下文压缩实现调研与 Formax 对照

Last verified: 2026-04-03

## 0. 结论先行

这次调研的核心结论是：

1. Claude Code 的“上下文压缩”不是单一 `/compact` 命令，而是一整套分层的 context-pressure 管理系统。
2. 它的目标不是“尽快把历史总结成一段话”，而是优先保留最近上下文的颗粒度，只在必要时才做 full compact。
3. 这套机制已经扩展成了一个跨层协议，覆盖：
   - query 主循环中的多级降载
   - manual `/compact`
   - auto compact
   - 413 / media 错误后的 reactive compact
   - transcript / resume / remote SDK / bridge 的 compact boundary 语义
   - compact 后的状态重建与再注入
4. 对比之下，Formax 当前实现是“单层 summary compact + per-turn hard prune”的简单方案，能工作，但离 Claude Code 这种“多级降级、协议化恢复、状态重注入”的成熟实现还有明显差距。

一句话概括：

> Claude Code 把 context compression 做成了“分层上下文治理系统”；Formax 目前更像“在压力过大时做一次总结，再用 prune 兜底”。

## 1. 调研范围与可信度说明

本次调研基于本地快照：

- `claude-code`: `/Users/david/Documents/github/claude-code`
- `formax`: `/Users/david/Documents/github/formax`

主要阅读的 Claude Code 文件：

- `src/query.ts`
- `src/commands/compact/compact.ts`
- `src/services/compact/compact.ts`
- `src/services/compact/autoCompact.ts`
- `src/services/compact/microCompact.ts`
- `src/services/compact/apiMicrocompact.ts`
- `src/services/compact/prompt.ts`
- `src/services/compact/sessionMemoryCompact.ts`
- `src/services/compact/postCompactCleanup.ts`
- `src/services/compact/grouping.ts`
- `src/utils/messages.ts`
- `src/utils/messages/mappers.ts`
- `src/utils/sessionStorage.ts`
- `src/utils/analyzeContext.ts`
- `src/services/api/claude.ts`
- `src/entrypoints/sdk/coreSchemas.ts`
- `src/entrypoints/sdk/controlSchemas.ts`
- `src/remote/sdkMessageAdapter.ts`
- `src/remote/SessionsWebSocket.ts`
- `src/components/TokenWarning.tsx`

主要阅读的 Formax 文件：

- `packages/core/src/features/repl/controller/send/send.ts`
- `packages/core/src/features/repl/controller/send/sendMainTurn.ts`
- `packages/core/src/features/repl/controller/send/contextCompressionService.ts`
- `packages/core/src/features/repl/controller/send/compactFlow.ts`
- `packages/core/src/chat/context/compact.ts`
- `packages/core/src/chat/context/prune.ts`
- `packages/core/src/chat/context/budget.ts`
- `packages/core/src/chat/context/estimate.ts`
- `packages/core/src/chat/context/modelWindow.ts`
- `packages/core/src/prompts/compact.ts`
- `packages/core/src/config/settings/schema.ts`

### 1.1 快照不完整说明

这份 Claude Code 快照足够研究主流程，但不是 100% 完整源码。当前仓库里存在调用点、但缺失源码文件的模块至少包括：

- `reactiveCompact`
- `snipCompact`
- `snipProjection`
- `cachedMicrocompact`
- `contextCollapse`
- 一些类型文件（例如导入路径指向的 `src/types/message.ts` 在快照中未找到）

因此：

- 下文对 `compactConversation`、`autoCompact`、`microcompact`、`sessionMemoryCompact`、boundary / sessionStorage 语义的结论是高置信度。
- 对 `reactive compact`、`snip`、`context collapse` 的细节是依据调用点和注释做的推断，置信度低于前者。

## 2. Claude Code 的整体架构图

从 `src/query.ts` 看，Claude Code 在一次正常 query 里并不是直接“拿 messages 去调模型”，而是会在模型调用前走一条 context-pressure 管线：

1. 从最后一个 compact boundary 后取上下文视图。
2. 对超大的 tool result 先做预算替换。
3. 可选的 `snip`。
4. `microcompact`。
5. `context collapse`。
6. `autocompact`。
7. 如果还超限，再走 blocking limit 或在 413 后触发 `reactive compact`。
8. compact 后并不是只保留 summary，还会重建 boundary、summary message、tail、attachments、hooks、resume 元数据。

这意味着 Claude Code 的设计思想是：

- 先做最便宜、最局部、信息损失最小的压缩。
- 只有前几层不够时，才做 full summary compact。
- compact 之后要保证“继续工作所需的状态”仍可恢复。

## 3. Claude Code 的消息模型与 compact boundary 协议

Claude Code 的上下文压缩不是靠“把历史数组直接替换掉”这么简单，它设计了一套专门的 boundary 协议。

### 3.1 compact boundary 是显式系统消息

`src/utils/messages.ts` 里有：

- `createCompactBoundaryMessage(trigger, preTokens, lastPreCompactMessageUuid?, userContext?, messagesSummarized?)`
- `isCompactBoundaryMessage(...)`
- `findLastCompactBoundaryIndex(...)`
- `getMessagesAfterCompactBoundary(...)`

compact boundary 的职责：

- 在 transcript 中标出一次 compact 发生的位置。
- 作为“之后所有 prompt 视图从哪里开始切片”的锚点。
- 携带 `compactMetadata`，包括：
  - `trigger`: `manual` 或 `auto`
  - `preTokens`
  - `userContext`
  - `messagesSummarized`
  - `preservedSegment`（部分 compact / session-memory compact 时很关键）

### 3.2 prompt 视图只看最后一个 compact boundary 之后

`getMessagesAfterCompactBoundary(messages)` 的语义非常重要：

- 找到最后一个 compact boundary。
- 只返回这个 boundary 之后的消息切片。
- 如果没有 boundary，返回全部消息。
- 在启用 `HISTORY_SNIP` 时，还会投影出 snipped view。

这就意味着：

- boundary 之前的历史不再直接进 prompt。
- prompt 看到的是“最新 compact 之后的 continuation view”。

### 3.3 summary 不是普通文本，而是特制的 compact-summary user message

compact 后会创建一个 user message，内容来自 `getCompactUserSummaryMessage(...)`。

这个 summary message：

- 会告诉模型“当前会话是从之前一个跑满上下文的会话继续的”
- 会塞入 compact summary 正文
- 可附带 transcript 路径，提示模型必要时去读原 transcript
- 可附带 `Recent messages are preserved verbatim.`
- 在 suppress follow-up 模式下会追加明确 continuation 指令：
  - 不要承认 summary
  - 不要 recap
  - 直接接着干

message 上的关键标记：

- `isCompactSummary: true`
- 可选 `isVisibleInTranscriptOnly: true`
- partial compact 时还会附带 `summarizeMetadata`

### 3.4 boundary + preservedSegment = resume / continue 的协议层

`annotateBoundaryWithPreservedSegment(...)` 会在 boundary 里写入：

- `headUuid`
- `anchorUuid`
- `tailUuid`

这套 metadata 被 `src/utils/sessionStorage.ts` 的 `applyPreservedSegmentRelinks(...)` 使用。

设计目的：

- compact 后如果保留了一段 `messagesToKeep`，这些消息在磁盘 transcript 上可能仍保留原 parent 链。
- 恢复时需要把它们重新挂接到新的 compact summary / boundary 之后。
- 所以 compact 不是简单“删前缀 + 拼 summary”，而是显式记录一条“恢复链重连指令”。

这也是 Claude Code 和很多简单实现最大的区别之一：

> 它把 compact 当成 transcript 协议事件，而不只是内存里的数组替换。

### 3.5 SDK / remote / bridge 都认 compact boundary

外围配套也很完整：

- `src/entrypoints/sdk/coreSchemas.ts` 为 `compact_boundary` 定义了 schema
- `src/utils/messages/mappers.ts` 负责 internal <-> SDK metadata 映射
- `src/remote/sdkMessageAdapter.ts` 把 SDK 的 compact boundary 转成内部消息
- `src/remote/SessionsWebSocket.ts` 还专门处理 compaction 期间的短暂 `4001 session not found`

说明 compact 已经不是 REPL 内部私有实现，而是远端协议的一部分。

## 4. Claude Code 的阈值与触发模型

Claude Code 在 `src/services/compact/autoCompact.ts` 里把阈值逻辑拆得很明确。

### 4.1 有效窗口不是模型原始窗口

`getEffectiveContextWindowSize(model)` 的计算是：

- 先拿 model 的 context window
- 再预留一部分 token 给 compact summary 输出
- 预留值取 `min(modelMaxOutputTokens, 20_000)`
- 结果才是 autocompact 使用的有效窗口

含义：

- 它不是把整个窗口都拿来塞历史
- 会为 compact 自身保留生存空间

### 4.2 关键常量

Claude Code 里和 compact 相关的重要常量包括：

- `AUTOCOMPACT_BUFFER_TOKENS = 13_000`
- `WARNING_THRESHOLD_BUFFER_TOKENS = 20_000`
- `ERROR_THRESHOLD_BUFFER_TOKENS = 20_000`
- `MANUAL_COMPACT_BUFFER_TOKENS = 3_000`
- `MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES = 3`

这意味着它会区分：

- warning 阶段
- error 阶段
- manual `/compact` 需要预留的最后 3k headroom
- autocompact 连续失败的 circuit breaker

### 4.3 auto-compact 是否启用

`isAutoCompactEnabled()` 同时受这些条件影响：

- `DISABLE_COMPACT`
- `DISABLE_AUTO_COMPACT`
- 用户配置里的 `autoCompactEnabled`

### 4.4 shouldAutoCompact 的 guard 很多

`shouldAutoCompact(...)` 会跳过这些场景：

- `querySource === 'session_memory'`
- `querySource === 'compact'`
- `querySource === 'marble_origami'`（context-collapse ctx-agent）
- auto compact 被禁用
- reactive-only mode
- context collapse 已启用并接管上下文管理

也就是说 Claude Code 很注意避免：

- compact 自己触发 compact
- 不同 context 管理系统互相打架
- 死循环 / 递归 compact

### 4.5 blocking limit 也和 compact 有协作

`src/query.ts` 里还有一个 hard blocking limit 检查：

- 当 auto-compact 关闭时，如果已经到 blocking limit，直接报 synthetic prompt-too-long
- 但会为手动 `/compact` 预留空间
- 刚 compact 完、或刚 snip 完时会跳过这个拦截，避免用旧 token usage 误杀

这点很重要：

> Claude Code 的 compact 逻辑不是“失败了才想起 compact”，而是在主循环层面给 `/compact` 保留逃生空间。

## 5. Claude Code 在 query 主路径里的分层压缩

`src/query.ts` 是 Claude Code 上下文压缩的总调度器。

一次 query 开始后，关键顺序是：

1. `messagesForQuery = getMessagesAfterCompactBoundary(messages)`
2. `applyToolResultBudget(...)`
3. 可选 `snipCompactIfNeeded(...)`
4. `microcompactMessages(...)`
5. 可选 `contextCollapse.applyCollapsesIfNeeded(...)`
6. `autoCompactIfNeeded(...)`
7. 如果 compact 成功，`buildPostCompactMessages(...)` 并继续当前 query
8. 否则进入正常模型请求
9. 若流式响应被 withheld 的 413 / media 错误击中，再走 collapse drain 或 reactive compact retry

这套顺序背后的设计原则很清楚：

- 工具输出太大，先局部处理。
- prompt cache 还可利用时，不要急着 full compact。
- 可以“折叠”“清空”“裁剪”的，先不要“总结”。
- full compact 是后手。

## 6. Claude Code 的 microcompact

`src/services/compact/microCompact.ts` 是 Claude Code 最值得借鉴的一层。

它处理的是：

> 不改变“任务语义”的前提下，优先缩掉昂贵的旧 tool results。

### 6.1 compactable tools 是白名单

它只会 compact 这些工具的结果：

- `Read`
- shell tools
- `Grep`
- `Glob`
- `WebSearch`
- `WebFetch`
- `Edit`
- `Write`

思路很合理：

- 这些工具结果最容易膨胀
- 很多旧结果对当前推理只剩“曾经做过某步”的价值
- 但最近几条仍可能有用，所以不是一刀切

### 6.2 两条 microcompact 路径

当前快照里可见两条路径：

1. cached microcompact
2. time-based microcompact

旧的 legacy microcompact 路径已经被移除。

### 6.3 cached microcompact：不改本地消息，只改 API 层 cache edits

cached microcompact 的核心特征：

- 只在 main thread 上运行
- 追踪 compactable tool result 的 `tool_use_id`
- 计算哪些旧 tool result 应该删除
- 生成 `cache_edits` block
- 把 edits 推迟到 API 层注入
- 本地消息内容本身不变

换句话说，它的目标是：

> 尽量不碰本地 transcript，只在发送给 API 时以 cache editing 的方式把旧 tool result 从缓存前缀里扣掉。

这很高级，因为：

- UI scrollback 不受影响
- 本地恢复逻辑更简单
- prompt cache hit 仍可尽量保留

同时它还会：

- 记录 baseline `cache_deleted_input_tokens`
- 等 API 返回后再用真实 delta 发 `microcompact_boundary`

说明它连“省了多少 token”都尽量以后端真实统计为准，而不是全靠客户端估算。

### 6.4 time-based microcompact：缓存过期后，直接清老 tool result 内容

`evaluateTimeBasedTrigger(...)` / `maybeTimeBasedMicrocompact(...)` 处理的是另一类情况：

- 距上次 assistant 消息已经过了足够久
- 后端 prompt cache 大概率已经冷掉
- 那么再努力保 cache prefix 也没有意义

此时它会：

- 保留最近 `keepRecent` 条 compactable tool result
- 把更老的 tool result 内容改成固定文案
  - `[Old tool result content cleared]`
- 记录 saved token
- reset cached microcompact state

这是一种非常务实的策略：

- cache 已冷
- 历史工具输出又很大
- 那就直接内容清空，只保留“发生过这个工具调用”的结构

### 6.5 microcompact 的启发

这层机制对 Formax 最有借鉴价值。

原因是：

- 成本低
- 收益高
- 实现风险明显低于 full compact / session memory
- 很适合作为 full compact 前的第一道减压层

## 7. API 原生 context management

`src/services/compact/apiMicrocompact.ts` 和 `src/services/api/claude.ts` 表明 Claude Code 还预留了一条更靠近后端的路径：

- `clear_tool_uses_20250919`
- `clear_thinking_20251015`

请求里会在满足 beta 条件时带上：

- `context_management: { edits: [...] }`

这说明 Claude Code 的未来方向之一是：

> 不只是客户端自己改消息数组，还可以把一部分 context editing 下沉到模型 API 的原生能力。

这条路径当前对 Formax 暂时还不现实，但值得记住：

- 如果后续目标 provider 支持 server-side context edits
- 这会比纯客户端裁剪更强，也更准确

## 8. Claude Code 的 full compactConversation

`src/services/compact/compact.ts` 是 full compact 的核心。

### 8.1 compact 前的准备

进入 `compactConversation(...)` 后会先做：

- 计算 `preCompactTokenCount`
- 执行 `PreCompact` hooks
- merge custom instructions 和 hook 注入的 instructions
- 设置 compacting UI 状态

### 8.2 summary prompt 设计得非常强

`src/services/compact/prompt.ts` 的 prompt 不是一句“请总结一下”。

它有这些特点：

- 强制纯文本输出
- 明确禁止工具调用
- 要求输出 `<analysis>` 和 `<summary>`
- 要求结构化覆盖：
  - 用户真实请求
  - 技术概念
  - 文件与代码片段
  - 错误与修复
  - 问题解决过程
  - 全部 user messages
  - pending tasks
  - current work
  - optional next step

之后再通过 `formatCompactSummary(...)` 把 `<analysis>` 删掉，只保留 summary。

也就是说：

- compact prompt 不是“面向摘要可读性”
- 而是“面向连续开发可恢复性”

### 8.3 compact 请求本身也考虑 prompt-too-long

compact summary 的生成并不是无脑一次调用。

如果 compact 请求自己也 hit 了 prompt-too-long：

- 会进入 `truncateHeadForPTLRetry(...)`
- 基于 `groupMessagesByApiRound(...)` 以 API round 为单位删最旧组
- 最多重试 `MAX_PTL_RETRIES = 3`
- 还会加一个 synthetic marker 防止重试时卡在自己的 marker 上

这一点很重要：

> Claude Code 连“compact 自己都太长怎么办”都单独实现了 fallback，而不是直接报错让用户自己处理。

### 8.4 优先走 prompt-cache-sharing 的 forked agent

`streamCompactSummary(...)` 里会先尝试：

- `runForkedAgent(...)`
- 复用主线程 prompt cache
- `maxTurns: 1`
- `skipCacheWrite: true`
- 用 `createCompactCanUseTool()` 明确 deny tools

如果这条路失败，再回退到普通 streaming path。

### 8.5 发送给 compact summarizer 前还会预处理消息

会做这些事情：

- `stripImagesFromMessages(...)`
- `stripReinjectedAttachments(...)`
- 只取 `getMessagesAfterCompactBoundary(messages)`
- thinking disabled

目的非常明确：

- 图片 / 文档对总结帮助不大，但很费 token
- 一些会在 compact 后重新注入的 attachment 没必要再喂给 summarizer

### 8.6 full compact 后不会只剩 summary

compact 完成后，Claude Code 会重建 post-compact context，包含：

- boundaryMarker
- summaryMessages
- attachments
- hookResults

并按固定顺序由 `buildPostCompactMessages(...)` 组装：

1. boundary
2. summary messages
3. messagesToKeep（如果有）
4. attachments
5. hook results

### 8.7 compact 后会再注入大量“继续工作需要的状态”

这是 Claude Code 和简单实现的最大差别之一。

compact 后它会异步重建很多状态：

- 最近读过的文件附件
  - 最多 5 个文件
  - 总 token budget 50k
  - 单文件上限 5k tokens
- plan file attachment
- plan mode attachment
- invoked skills attachment
  - 单 skill 5k tokens
  - 总预算 25k
- async agent attachments
- deferred tools delta attachment
- agent listing delta attachment
- MCP instruction delta attachment
- SessionStart hooks 结果

这意味着 Claude Code 的 compact 不是“压完就干净了”，而是：

> 压完以后重新把继续工作真正需要的 context 以更便宜、更结构化的形式补回来。

### 8.8 compact 后 cleanup 很重视共享状态

`runPostCompactCleanup(...)` 会清理：

- microcompact state
- main-thread context-collapse state
- memory files cache / user context cache
- system prompt sections
- classifier approvals
- speculative checks
- beta tracing state
- session messages cache

同时又明确不清某些状态，比如 invoked skills 的内容。

说明作者非常清楚：

- compact 后哪些缓存已经失效
- 哪些又必须跨 compact 保留

## 9. Claude Code 的 manual `/compact`

`src/commands/compact/compact.ts` 的手动命令流程是：

1. 先把上下文投影到最后一个 compact boundary 之后。
2. 无 custom instructions 时，优先尝试 session-memory compact。
3. reactive-only mode 时，走 reactive compact 路径。
4. 否则先跑 `microcompactMessages(...)`，再跑传统 `compactConversation(...)`。
5. compact 成功后做 cleanup、warning suppression、displayText 生成。

重点在于：

- 手动 `/compact` 也不是直达 full summary
- 它先尝试更便宜或更结构化的路径

## 10. Claude Code 的 session memory compaction

`src/services/compact/sessionMemoryCompact.ts` 是另一条很强的路线。

它的本质不是“现场让模型总结”，而是：

> 利用后台维护的 session memory，当上下文过大时直接把这份 memory 作为 compact summary 使用。

### 10.1 触发条件

需要同时满足：

- session memory 功能启用
- sm compact 功能启用
- session memory 文件存在
- session memory 不是空模板

### 10.2 保留尾部不是固定 N 条，而是按最小工作集扩张

`calculateMessagesToKeepIndex(...)` 的策略很成熟：

- 从 `lastSummarizedMessageId` 后面开始
- 然后向前扩张，直到满足：
  - 至少 `minTokens = 10_000`
  - 至少 `minTextBlockMessages = 5`
- 但不会超过 `maxTokens = 40_000`
- 最后再用 `adjustIndexToPreserveAPIInvariants(...)` 修正：
  - tool_use / tool_result 成对
  - 同一个 `message.id` 的 thinking 块不被截断

这和“固定保留最后 N 轮”相比强很多，因为它更接近“保留最小可工作上下文”。

### 10.3 session-memory compact 也使用 boundary + preserved segment

它并不是简单：

- 用 session memory 当 summary
- 然后把尾巴拼上

而是同样会：

- 创建 boundary
- 创建 compact summary user message
- 用 `annotateBoundaryWithPreservedSegment(...)` 记录保留段 relink 信息

说明 session-memory compact 也是完整协议路径，不是特判 hack。

### 10.4 对 auto-compact 还会检查结果是否仍超阈值

如果是 auto compact 场景：

- session-memory compact 后
- 若 `postCompactTokenCount >= autoCompactThreshold`
- 它会直接放弃这条路径，退回其他 compact 策略

这很务实，避免“压了等于没压”。

## 11. Claude Code 的 partial compact

`partialCompactConversation(...)` 支持两种方向：

- `from`
  - 总结 pivot 之后的消息
  - 保留更早的消息
  - 适合 prefix-preserving
- `up_to`
  - 总结 pivot 之前的消息
  - 保留更新的消息
  - 适合 suffix-preserving

并且：

- 使用专门的 partial compact prompt
- `up_to` 会移除旧 compact boundary / compact summary，防止新的 summary 被旧 boundary 吃掉
- `from` / `up_to` 的 `anchorUuid` 语义不同

这说明 Claude Code 并不把 compact 限定为“只能压老前缀”，它已经支持用户选定一段消息做局部压缩。

## 12. Claude Code 的 introspection、warning 与 remote 配套

### 12.1 `/context` 不是简单 token 数字，而是完整拆解

`src/utils/analyzeContext.ts` 和 `/context` 命令会给出：

- system prompt tokens
- system tools
- MCP tools
- deferred tools
- custom agents
- memory files
- skills
- messages
- autoCompactThreshold
- message breakdown
  - tool call tokens
  - tool result tokens
  - attachments
  - assistant/user messages
  - per-tool breakdown

这让 Claude Code 的 compact 决策不再是黑盒。

### 12.2 TokenWarning 和 suppression

`src/components/TokenWarning.tsx` + `compactWarningState.ts` 的作用：

- 在接近阈值时提示
- compact 成功后暂时 suppress warning
- reactive-only / context-collapse 模式下还会改显示逻辑

这说明 UI 也与 compact 状态机深度耦合。

### 12.3 remote session 明确考虑 compaction 短暂断连

`src/remote/SessionsWebSocket.ts` 专门处理：

- compaction 期间可能短暂出现 `4001 session not found`
- 给出有限重试窗口

这从侧面证明 compact 在远端 worker 模式下是重操作，且作者显式做过这类兼容。

## 13. Claude Code 调研里的几个关键设计原则

总结下来，Claude Code 的 compact 体系遵循这些原则：

1. 先局部降载，后整体总结。
2. compact 不是数组改写，而是带 boundary 的 transcript 协议事件。
3. compact 后必须显式重建“继续工作所需状态”。
4. compact 需要和 hooks、resume、remote、SDK、UI warning 全链路协同。
5. 不是每次都让模型再总结，session memory 这种结构化缓存更优先。
6. compact 本身也要有 fallback，不能因为 compact 太长就彻底卡死。

## 14. Formax 当前实现梳理

Formax 当前的 compact 机制是有效的，但明显更轻量。

### 14.1 Formax manual `/compact`

入口：

- `packages/core/src/features/repl/controller/send/send.ts`
- `packages/core/src/features/repl/controller/send/compactFlow.ts`
- `packages/core/src/chat/context/compact.ts`
- `packages/core/src/prompts/compact.ts`

流程：

1. `/compact` 被命令路由识别。
2. 构造一个 tools-free 的 compact turn。
3. compact prompt 由 `buildCompactRequest(...)` 生成。
4. 调 `engine.runTurn(...)` 跑一轮无工具总结。
5. 取最后一个 assistant 的文本作为 summary。
6. 用 `rebuildHistoryAfterCompaction(...)` 重建 history。
7. 手动 compact 固定 `keepLastTurns = 0`。
8. UI 插入：
   - `compact_boundary`
   - `compact_banner`
   - `compact_summary`
   - command subline

### 14.2 Formax auto-compact

入口：

- `packages/core/src/features/repl/controller/send/contextCompressionService.ts` 的 `prepareHistoryForTurn(...)`

guard 条件：

- `enableAutoCompact`
- 有 `contextWindowTokens`
- `historyRef.current` 非空
- 非 tool user turn 至少 2 轮
- 距上次 auto compact 至少 `autoCompactMinTurnsBetweenRuns`
- `computeContextStats(...).shouldAutoCompact === true`

成功后：

- 调 `runCompactFlow({ source: 'auto' })`
- `keepLastTurns = cfg.context.compactKeepLastTurns`
- compact 完再走一次 `pruneForPromptBudget(...)`
- UI 只显示一条 auto-compact notice
- 失败是 best-effort，直接吞掉，不阻断正常 turn

### 14.3 Formax 的 compact summary prompt 很简洁

`packages/core/src/prompts/compact.ts` 里的要求是：

- 保留用户目标 / 约束 / 偏好
- 保留关键技术决策与 trade-offs
- 保留重要文件路径、命令、API
- 保留 open questions 与 next steps
- 保持 concise and structured
- 不调用工具
- output only the summary

这个 prompt 很合理，但相比 Claude Code 明显更轻：

- 没要求列出所有 user messages
- 没要求 current work / pending tasks / precise next step
- 没要求 `<analysis>` 草稿
- 没要求覆盖错误与修复链

因此它更像“高质量摘要 prompt”，而不是“面向继续开发恢复的 compact protocol prompt”。

### 14.4 Formax 的 history 重建非常简单

`packages/core/src/chat/context/compact.ts` 的逻辑是：

- 构造一个 summary user message，正文包在 `<system-reminder>...</system-reminder>`
- `selectTailForCompaction(previousHistory, keepLastTurns)`
- 最终 history = `[summaryMsg, ...tail]`

tail 选择策略：

- 按最后 N 个非 tool user turn 来找起点
- 从起点切整个后缀

优点：

- 简洁
- 稳定
- 容易理解

缺点：

- 只有固定 turn 数策略
- 没有 token-aware 的“最小工作集”扩张
- 没有 compact boundary metadata
- 没有 preserved segment relink

### 14.5 Formax 的主路径更依赖 hard prune

`packages/core/src/features/repl/controller/send/sendMainTurn.ts` 在主 turn 前后都会做：

- `pruneForPromptBudget(...)`

`packages/core/src/chat/context/prune.ts` 的策略是：

1. 如果没超预算，不动。
2. 先截断超长 `tool_result` 内容。
3. 再截断超长 ephemeral injected text。
4. 不够就从最旧消息开始 drop，同时保持 tool_use / tool_result 成对。
5. 再不够就缩成 essential tail。
6. 最后甚至 force-fit 成单条 text message。

这保证了“永远尽量 fit budget”，但它和 Claude Code 的分层设计相比，有两个明显差异：

- 它的主降载手段仍然是“裁剪消息数组”
- 它缺少专门的“中间层 context compression”，比如 microcompact / session memory / partial compact

### 14.6 Formax 的 context budget 和估算也更简单

Formax 默认 context 配置来自 `packages/core/src/config/settings/schema.ts`：

- `effectiveContextWindowPercent = 0.95`
- `autoCompactTokenLimitPercent = 0.9`
- `baselineTokens = 12000`
- `compactKeepLastTurns = 4`
- `enableAutoCompact = true`
- `autoCompactMinTurnsBetweenRuns = 8`

Token 估算：

- `estimatePromptTokens(...)` 直接按 `JSON.stringify(payload)` 的 UTF-8 bytes / 4

模型窗口：

- `packages/core/src/chat/context/modelWindow.ts` 只对少数模型做 hardcode：
  - Anthropic `claude-3*` -> 200k
  - OpenAI `gpt-4o*` / `gpt-4-turbo*` -> 128k
  - `gpt-3.5-turbo` -> 16385

相比 Claude Code：

- 精度更低
- 模型覆盖更少
- 缺乏 `/context` 级别的真实 breakdown

## 15. Claude Code 与 Formax 的差异总表

| 维度 | Claude Code | Formax 当前状态 |
| --- | --- | --- |
| 主策略 | 分层 context governance | summary compact + hard prune |
| compact 协议 | 有 explicit boundary + metadata + preservedSegment | 无协议化 boundary metadata，prompt history 只放 summary user message |
| full compact prompt | 面向连续开发恢复的重型结构化 prompt | 简洁摘要 prompt |
| compact 前减压 | tool result budget / snip / microcompact / context collapse | 主要靠 `pruneForPromptBudget()` |
| auto compact | 独立阈值体系 + circuit breaker + 多 guard | 基础 guard + token 百分比阈值 |
| compact 后重建 | summary + tail + file/plan/skill/agent/MCP attachments + hooks | summary + tail |
| session memory compact | 有 | 无 |
| partial compact | 有 | 无 |
| API-native context management | 有预留 | 无 |
| `/context` introspection | 很强 | 只有简单 meter |
| remote / SDK 协议 | compact boundary 已协议化 | 当前主要是本地实现 |
| resume / transcript relink | 有 preserved segment 重连 | 无 |

## 16. 对 Formax 的借鉴建议

这里按“收益 / 风险 / 落地难度”给一个建议优先级。

### 16.1 P0：先补一层 microcompact，不要一上来就做大改

最值得先做的是：

- 在 `pruneForPromptBudget()` 之前，引入一个独立的 `microCompactHistory(...)`
- 只针对高膨胀、低长期价值的工具结果做压缩

建议第一版只处理：

- `Read`
- `Grep`
- `Glob`
- shell 输出
- `WebFetch`

第一版实现建议：

- 不改协议
- 不做 cache editing
- 只在本地把“较旧的 tool_result 内容”替换成短文本 stub
- 至少保留最近 3-5 个工具结果原文

这样收益很大：

- 可以明显减少 full compact 触发频率
- 比直接 drop message 更保守
- 实现复杂度远低于 session memory / partial compact

### 16.2 P0：把“硬裁剪”和“语义压缩”分层

建议把 Formax 的上下文治理拆成至少三层：

1. `truncateHotContent`
   - 你现在已经有一部分了
2. `microCompactHistory`
   - 清旧 tool result 内容
3. `runCompactFlow`
   - 真正让模型做 summary compact

这样可以减少当前“超预算就直接 prune 消息数组”的生硬感。

### 16.3 P1：引入显式 compact boundary metadata

即使一开始不做 preservedSegment 全量协议，也建议至少新增：

- compact boundary 作为 prompt-history 里的显式事件
- boundary metadata 记录：
  - `trigger`
  - `preTokens`
  - `summaryKind`
  - `keepStrategy`

原因：

- 便于后续做 resume / session save / web parity
- 让 compact 不再只是“某个 user message 长得像 summary”
- 便于后续做 partial compact 或 session-memory compact

### 16.4 P1：compact 后补回最关键状态

这是 Claude Code 一个很值得学的点。

Formax 当前 compact 后只留下：

- summary
- 最近 N turns

但实际继续工作常需要：

- 最近读过的文件内容
- 当前 plan / todos
- 当前模式信息
- 某些 injected reminder 的稳定形态

可以考虑做一个轻量版 post-compact rehydration：

- 最近 2-3 个 Read 文件附件
- 当前 plan path / todos path 摘要
- 当前 mode reminder

这样 compact 后的第一轮恢复质量会明显更稳。

### 16.5 P1：做一个 `/context` 诊断视图

你现在已经有：

- `computeContextStats`
- `estimatePromptTokens`

但还缺：

- system prompt 占比
- history 占比
- tool result 占比
- injected reminder 占比
- compact 阈值线

建议做一个最小版 `/context`：

- 总 token 估算
- system / messages / tool-results / injected 四类 breakdown
- 下一次 auto-compact 阈值

这个功能会大幅降低后续调 compact 的盲调成本。

### 16.6 P1：把 tail keep 策略从“固定 N 轮”升级为“最小工作集”

Claude Code 的 session-memory compact 很值得借鉴的一点是：

- 保留尾部不是固定 N
- 而是满足“至少 X tokens + 至少 Y 条 text messages”

Formax 后续可以把：

- `compactKeepLastTurns`

升级成更灵活的组合策略，比如：

- `keepLastTurns`
- `keepMinTokens`
- `keepMinUserTurns`

第一版甚至不必替换旧配置，只要在内部计算时多一层兜底即可。

### 16.7 P2：引入 session memory / rolling memory

如果你后面想把 compact 做得更像 Claude Code，真正的下一阶段不是 partial compact，而是：

- 持续维护一份 session memory
- auto compact 时优先尝试 session memory compact

原因：

- 重复让主模型总结整段历史，成本高
- 质量也不一定稳定
- 而滚动 memory 更适合做“长期事实层”

这会是一个中型项目，但长期价值很高。

### 16.8 P2：考虑 partial compact

当你开始有：

- boundary metadata
- session save
- 更稳的 compact 恢复语义

再引入 partial compact 会更合适。

否则 partial compact 很容易把问题从“上下文压缩”升级成“历史链恢复和 UI 一致性工程”。

## 17. 我建议的 Formax 落地顺序

如果按工程投入和收益比排序，我建议这样推进：

### 第一阶段

- 新增 `microCompactHistory(...)`
- 主 turn 里在 `pruneForPromptBudget(...)` 之前调用
- 只处理旧 tool results
- 新增一个简版 `/context` 诊断视图

### 第二阶段

- compact boundary 元数据化
- compact 后补回最近文件 / plan / mode 状态
- 将 tail keep 从固定 N 轮升级为最小工作集策略

### 第三阶段

- 持续 session memory
- auto compact 优先走 session-memory compact
- 再考虑 partial compact

## 18. 最后判断

如果目标是“尽快把 Formax 的上下文压缩做得明显更强”，我不建议直接复制 Claude Code 的 full compact 全家桶。

更合适的路径是：

1. 先学 Claude Code 的分层思想。
2. 先补 `microcompact` 和 `/context` introspection。
3. 再把 compact 从“单次摘要”升级成“带 boundary 和状态重建的协议事件”。

对 Formax 来说，最有性价比的借鉴不是“更复杂的总结 prompt”，而是这三件事：

- old tool results 的分层减压
- compact 后关键状态的重建
- compact 语义从普通消息升级为协议化 boundary
