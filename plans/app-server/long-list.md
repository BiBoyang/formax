opencode 本地路径：/Users/david/Documents/github/opencode

前端渲染与虚拟化
packages/app/src/pages/session/message-timeline.tsx - 消息时间线组件，实现虚拟滚动和懒加载 message-timeline.tsx:310-349
packages/app/src/pages/session.tsx - 会话页面主组件，包含消息可见性控制和滚动管理 session.tsx:537-548
packages/app/src/pages/session/use-session-hash-scroll.ts - 基于哈希的消息滚动定位逻辑 use-session-hash-scroll.ts:1-129
分页与数据同步
packages/app/src/context/sync.tsx - 实现分页获取消息，支持 limit 和 offset 参数
packages/app/src/context/sync-optimistic.test.ts - 乐观更新测试，展示消息即时插入逻辑
packages/app/src/context/global-sync/event-reducer.ts - SSE 事件处理器，实时同步消息状态
消息压缩与存储优化
packages/opencode/src/session/compaction.ts - 消息压缩核心逻辑，包括溢出检测和智能修剪 compaction.ts:30-39 compaction.ts:49-89
导航与交互优化
packages/ui/src/components/message-nav.tsx - 消息导航组件，支持紧凑模式和快速跳转
国际化与UI文本
packages/app/src/i18n/br.ts - 包含"加载更早消息"等UI文本定义 br.ts:434-438
TUI参考实现
packages/opencode/src/cli/cmd/tui/routes/session/index.tsx - TUI版本的消息导航和滚动实现，可作为Web版参考 index.tsx:246-290 index.tsx:585-645
Notes
Web应用的主要优化逻辑集中在 packages/app 目录
后端压缩逻辑在 packages/opencode/src/session/compaction.ts
UI组件库在 packages/ui 中提供可复用的导航组件
TUI实现在 packages/opencode/src/cli/cmd/tui 中提供了类似的优化思路
Wiki pages you might want to explore:

Client-Server Model (anomalyco/opencode)
Project and Workspace Management (anomalyco/opencode)


