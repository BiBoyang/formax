# Requirements Document

## Introduction

本文档定义了将 MyChatScreen.tsx 的对话循环从非流式（stream:false）改造为流式（stream:true）的需求。目标是实现文本与 tool_call 的即时处理和展示，提升用户体验。

## Glossary

- **Stream_Client**: 负责发送流式请求并消费 SSE 事件的客户端模块
- **SSE_Parser**: 解析 Server-Sent Events 的解析器，复用现有 parseAnthropicSSE.ts
- **Tool_Executor**: 执行本地工具（Read、Write、Bash、Glob）的模块
- **Chat_UI**: 聊天界面组件，负责展示消息和工具状态
- **Message_History**: 对话历史记录，包含 user、assistant 消息及 tool_result

## Requirements

### Requirement 1: 流式请求配置

**User Story:** As a developer, I want the chat to use streaming mode, so that I can see responses as they arrive instead of waiting for the complete response.

#### Acceptance Criteria

1. WHEN sending a request to Anthropic API, THE Stream_Client SHALL set `stream: true` in the request payload
2. THE Stream_Client SHALL preserve existing headers including `anthropic-version`, `anthropic-beta`, and authentication headers
3. THE Stream_Client SHALL preserve existing system prompt configuration
4. THE Stream_Client SHALL use tools from `proxy/tools.json`
5. THE Stream_Client SHALL use environment variables `ANTHROPIC_API_KEY2`, `ANTHROPIC_BASE_URL2`, and `ANTHROPIC_MODEL`

### Requirement 2: SSE 事件处理

**User Story:** As a user, I want to see text appearing character by character, so that I know the AI is actively responding.

#### Acceptance Criteria

1. WHEN receiving `message_start`, THE SSE_Parser SHALL initialize the response structure
2. WHEN receiving `content_block_start` with `text` type, THE SSE_Parser SHALL initialize a text block at the given index
3. WHEN receiving `content_block_start` with `tool_use` type, THE SSE_Parser SHALL initialize a tool_use block and create an input buffer for JSON accumulation
4. WHEN receiving `content_block_delta` with `text_delta` type, THE SSE_Parser SHALL extract the text and immediately push it to the UI
5. WHEN receiving `content_block_delta` with `input_json_delta` type, THE SSE_Parser SHALL concatenate `partial_json` to the current tool's input buffer
6. WHEN receiving `content_block_stop`, THE SSE_Parser SHALL finalize the current content block; for tool_use blocks, parse the accumulated JSON input
7. WHEN receiving `message_delta`, THE SSE_Parser SHALL capture `stop_reason` and `stop_sequence` for loop control
8. WHEN receiving `message_stop`, THE SSE_Parser SHALL signal the end of the current response and clear all buffers
9. IF JSON parsing fails during `content_block_stop`, THEN THE SSE_Parser SHALL log the error, set input to empty object `{}`, and continue processing other blocks
10. IF a parsing error occurs for any SSE event, THEN THE SSE_Parser SHALL log the error and continue processing subsequent events
11. THE SSE_Parser SHALL process events in order: message_start → content_block_start → content_block_delta → content_block_stop → message_delta → message_stop

### Requirement 3: 工具调用处理

**User Story:** As a user, I want to see tool execution progress, so that I understand what the AI is doing with my files.

#### Acceptance Criteria

1. WHEN a complete `tool_use` block is received (after content_block_stop), THE Tool_Executor SHALL immediately execute the corresponding local tool
2. WHEN multiple tool_use blocks exist in one response, THE Tool_Executor SHALL execute them sequentially (not in parallel) to avoid ordering issues
3. WHEN a tool execution starts, THE Chat_UI SHALL display a visual indicator (e.g., "🔧 Calling Read...")
4. WHEN a tool execution completes, THE Tool_Executor SHALL generate a `tool_result` message with `role: user` and `type: tool_result`
5. THE Tool_Executor SHALL preserve the complete assistant content (including all tool_use blocks) in message history before appending tool_results
6. THE Tool_Executor SHALL support existing tools: Read, Write, Bash, Glob
7. IF a tool execution fails, THEN THE Tool_Executor SHALL return an error message as the tool result

### Requirement 4: 对话循环策略

**User Story:** As a developer, I want the chat to automatically continue when tools are called, so that multi-step operations complete without manual intervention.

#### Acceptance Criteria

1. THE Stream_Client SHALL implement a while loop that continues until no more tool calls are needed
2. WHEN the response contains `tool_use` blocks AND `stop_reason` is `tool_use`, THE Stream_Client SHALL execute tools and continue to the next iteration
3. WHEN the response contains no `tool_use` blocks OR `stop_reason` is not `tool_use`, THE Stream_Client SHALL exit the loop
4. WHEN continuing to the next iteration, THE Stream_Client SHALL append the assistant's content and tool_results to the message history
5. THE Stream_Client SHALL log loop iterations with labels: `loop_start`, `response`, `tool_start`, `tool_done`

### Requirement 5: UI 即时展示

**User Story:** As a user, I want to see all activity in real-time, so that I'm never left wondering what's happening.

#### Acceptance Criteria

1. WHEN text deltas are received, THE Chat_UI SHALL append them to the current assistant message immediately
2. WHEN a tool_use block is detected, THE Chat_UI SHALL insert a tool indicator message (e.g., "🔧 Calling Read...")
3. WHEN a tool_result is generated, THE Chat_UI SHALL display a result summary (truncated if too long)
4. WHEN tool output exceeds a configurable threshold (default 500 chars), THE Chat_UI SHALL truncate with "..." or provide a collapsible preview
5. THE Chat_UI SHALL show a loading indicator at the start of each streaming round and hide it when the round completes
6. THE Chat_UI SHALL maintain smooth scrolling as new content arrives
7. THE Chat_UI SHALL prevent screen flooding by batching rapid updates if necessary
8. THE truncation threshold for tool output SHALL be configurable via environment variable or constant

### Requirement 6: 错误处理与日志

**User Story:** As a developer, I want comprehensive logging and error handling, so that I can debug issues effectively.

#### Acceptance Criteria

1. THE Stream_Client SHALL implement a configurable timeout for streaming requests (default 10 minutes, longer than non-streaming)
2. IF a timeout occurs, THEN THE Stream_Client SHALL abort the request gracefully and display an error message
3. IF a network error occurs, THEN THE Stream_Client SHALL log the error and display a user-friendly message
4. THE Stream_Client SHALL create a per-run log file in `proxy/logs/` with timestamp naming (e.g., `mychat-2026-01-05T12-00-00.log`)
5. THE Stream_Client SHALL log key events: loop_start, tool_start, tool_done, response_complete, stop_reason, errors (NOT every text delta)
6. IF the stream is interrupted, THEN THE Stream_Client SHALL preserve any accumulated text content and allow user to retry
7. THE Stream_Client MAY implement optional retry logic for transient failures
8. THE timeout value SHALL be configurable via environment variable `ANTHROPIC_TIMEOUT_MS`
