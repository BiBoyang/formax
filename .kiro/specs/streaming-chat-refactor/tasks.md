# Implementation Plan: Streaming Chat Refactor

## Overview

将 MyChatScreen.tsx 从非流式改造为流式，实现文本与 tool_call 的即时处理和展示。使用 TypeScript，在 `src/agent2` 目录下创建新的模块，不依赖旧的 `src/agent` 代码。

## Tasks

- [ ] 1. 扩展 SSE 解析器
  - [ ] 1.1 创建 `src/agent2/sse/streamingParser.ts`，实现完整的 SSE 事件处理
    - 支持 message_start, content_block_start, content_block_delta, content_block_stop, message_delta, message_stop
    - 实现 inputJSONBuffers Map 用于累积 tool_use 的 JSON 输入
    - 在 content_block_stop 时解析 JSON，失败时设置 input 为 {}
    - _Requirements: 2.1-2.11_
  - [ ] 1.2 编写 SSE 文本累积属性测试
    - **Property 2: SSE Text Delta Accumulation**
    - **Validates: Requirements 2.4**
  - [ ] 1.3 编写 SSE JSON 往返属性测试
    - **Property 3: SSE JSON Input Round-Trip**
    - **Validates: Requirements 2.5, 2.6**
  - [ ] 1.4 编写 SSE 错误恢复属性测试
    - **Property 4: SSE Error Resilience**
    - **Validates: Requirements 2.9, 2.10**

- [ ] 2. 实现流式客户端
  - [ ] 2.1 创建 `src/agent2/streaming/StreamClient.ts`
    - 实现 streamChat 方法，发送 stream:true 请求
    - 保持现有 headers、system prompt、tools 配置
    - 使用 AbortController 实现超时控制（默认 10 分钟）
    - _Requirements: 1.1-1.5, 6.1-6.2_
  - [ ] 2.2 编写请求配置属性测试
    - **Property 1: Request Configuration Correctness**
    - **Validates: Requirements 1.1, 1.2, 1.3**

- [ ] 3. 实现对话循环逻辑
  - [ ] 3.1 在 StreamClient 中实现 while 循环
    - 消费 SSE 事件，累积文本和 tool_use
    - 检查 stop_reason，决定是否继续循环
    - 执行工具后追加 assistant content 和 tool_results 到历史
    - _Requirements: 4.1-4.5_
  - [ ] 3.2 编写循环终止属性测试
    - **Property 7: Loop Termination Correctness**
    - **Validates: Requirements 4.1, 4.2, 4.3, 4.4**

- [ ] 4. 重构工具执行器
  - [ ] 4.1 将 runLocalTool 提取到 `src/agent2/tools/ToolExecutor.ts`
    - 支持串行执行多个工具
    - 生成标准 tool_result 格式
    - 保留完整 assistant content 后追加 tool_results
    - _Requirements: 3.1-3.7_
  - [ ] 4.2 编写工具执行属性测试
    - **Property 5: Tool Execution Produces Valid Results**
    - **Validates: Requirements 3.1, 3.4, 3.7**
  - [ ] 4.3 编写工具执行顺序属性测试
    - **Property 6: Tool Execution Order Preservation**
    - **Validates: Requirements 3.2, 3.5**

- [ ] 5. Checkpoint - 核心功能验证
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 6. 更新 MyChatScreen UI
  - [ ] 6.1 修改 MyChatScreen.tsx 使用新的 StreamClient
    - 替换 callAnthropic 为流式版本
    - 实现 onTextDelta 回调即时更新消息
    - 实现 onToolStart/onToolEnd 回调显示工具状态
    - _Requirements: 5.1-5.8_
  - [ ] 6.2 添加工具状态 UI 组件
    - 显示 "🔧 Calling Read..." 等提示
    - 工具结果截断显示（默认 500 字符）
    - Loading 指示器在每轮开始/结束切换
    - _Requirements: 5.2-5.5_

- [ ] 7. 实现日志系统
  - [ ] 7.1 创建 per-run 日志文件
    - 文件名格式: `mychat-{timestamp}.log`
    - 记录 loop_start, tool_start, tool_done, response_complete, stop_reason, errors
    - 不记录每个 text delta
    - _Requirements: 6.4-6.5_

- [ ] 8. 错误处理与恢复
  - [ ] 8.1 实现流中断恢复
    - 保留已累积的文本内容
    - 显示用户友好的错误消息
    - 支持重试
    - _Requirements: 6.3, 6.6-6.8_

- [ ] 9. Final Checkpoint - 完整功能验证
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- All tasks are required for comprehensive coverage
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties
- Unit tests validate specific examples and edge cases
