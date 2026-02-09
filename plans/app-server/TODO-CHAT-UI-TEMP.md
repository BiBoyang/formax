# Chat UI 临时收敛 TODO（Web Reference）

> 目标：先收集聊天区已发现问题，后续集中一轮改动，不在本文件阶段直接改代码。
> 范围：仅 `apps/web-reference-react` 中央聊天区（Transcript + Composer）及其关联渲染策略。

## P0（先做，影响可用性）

- [ ] 页面定位从“日志页”切换为“用户会话页”
  - 现象：当前主区域大量小按钮 + info 日志卡片，阅读重心错误
  - 验收：默认首屏以会话内容（标题/消息流/输入）为中心，日志信息默认弱化或折叠

- [x] 回合结束后自动清理/折叠 `thinking` 行
  - 现象：turn 已 completed 仍显示 `thinking`
  - 验收：`turn/completed` 后主聊天流不再显示该 turn 的进行中 thinking 指示

- [ ] 系统事件默认降噪（`usage` / `event complete` / `turn completed`）
  - 现象：主聊天流被 info 卡片淹没
  - 验收：默认视图仅展示对话主内容（user/assistant/tool 核心事件）；系统事件进入可展开区域或 debug 视图

- [ ] 按 turn 分组渲染事件链路
  - 现象：`turn started -> thinking -> assistant -> complete` 分散在流水中
  - 验收：同一 turn 的事件可被感知为单个分组块，assistant 回复是分组主内容

- [ ] 调整默认过滤策略
  - 现象：`Log Filter=all` 初始即日志墙
  - 验收：默认进入“聊天视图优先”模式；日志为按需查看

## P1（强烈建议，影响体验）

- [ ] 顶部条改为“会话头部”而非“调试工具条”
  - 目标：展示会话标题（thread title），不是一排细小操作按钮
  - 验收：顶部主要信息为标题与必要状态；操作入口控制在 1-2 个主动作

- [ ] assistant/user/tool 信息层级重排
  - 目标：assistant 内容视觉权重高于系统日志；tool 信息次级但可读
  - 验收：长对话中可一眼扫描 assistant 主回复，不被 info 卡片抢焦点

- [ ] 顶部控制条语义分组
  - 目标：筛选控件、连接状态、turn 操作分组而非同级混排
  - 验收：用户可在 1 秒内区分“状态展示”和“交互动作”

- [ ] `Stick` 文案/语义明确化
  - 目标：改为更直观的自动滚动语义（如 `Auto-scroll`）
  - 验收：非开发用户也能理解该开关作用

- [ ] 顶部控件减法：移除非高频小按钮直出
  - 目标：像 `All Turns / Active Turn / Stick` 这类二级能力收进二级入口（过滤面板/更多菜单）
  - 验收：顶部不再出现一排小胶囊按钮；会话头部信息密度明显下降

- [ ] 消息流纵向节奏压缩
  - 目标：减少 info 卡片高度和过大留白
  - 验收：同屏可见信息量明显提升且不拥挤

## P2（视觉完善）

- [ ] 输入区视觉减重（保留功能）
  - 目标：减少输入区高度和边框噪声，释放聊天阅读空间
  - 验收：桌面 1080p 下聊天区可视高度提升

- [ ] 回合结束锚点样式
  - 目标：提供轻量 turn footer/badge，替代重复文本日志
  - 验收：每轮结束状态清晰且不打断阅读流

- [ ] 统一 turnId 展示策略
  - 目标：避免在多处重复展示同一 turnId
  - 验收：turnId 仅在需要调试时显示，主视图不冗余

## 实施顺序（建议）

1. P0-1/P0-2：先解决 “thinking 残留 + 日志降噪”
2. P0-3/P0-4：完成 turn 分组和默认过滤策略
3. P1 全项：完成信息层级与头部交互语义
4. P2 全项：输入区与视觉精修

## 备注

- 本文件是临时收敛清单；确认后再同步到主线 `plans/app-server/TODO.md`。
- 当前阶段不改动协议，不新增后端字段，仅调整前端渲染与交互策略。

## 视觉重构专项 (Based on Visual Review)

> 来源：`visual_design_review.md`
> 目标：将工程界面转化为产品级界面

### Phase 1: 框架净化 (Layout & Cleanup)

- [x] **App 布局重写**
  - 使用 flex 布局替代 legacy grid，移除 dashboard header。
  - 实现三栏布局：Nav (260px) / Chat (Flex) / Context (Fixed)。

### Phase 2: 消息流重塑 (Stream Refinement)

- [ ] **气泡样式升级**
  - User 消息：右侧，高亮色背景，大圆角。
  - Assistant 消息：左侧，透明/白底，优化 Markdown 渲染排版。
- [ ] **Thinking 组件化**
  - 实现 `Thinking` 折叠块：进行时展开流光动画，结束后自动折叠为摘要。
- [ ] **系统日志降噪**
  - 将 `usage`, `turn complete`, `handshake` 等系统级信息移出主消息流，或改为极大弱化的图标/Toast。

### Phase 3: 输入区现代化 (Input Modernization)

- [ ] **Composer 悬浮化**
  - 将底部厚重表单改为悬浮（Floating）或无边框（Borderless）胶囊样式。
- [x] **Interrupt 集成**
  - (Done in Phase 5)

### Phase 4: 用户反馈专项 (User Feedback Fixes)

- [x] **Left Rail 视觉升级**
- [x] **Diff Pane 修复**

### Phase 5: 交互现代化 (Interaction Fixes)

- [x] **Interrupt 按钮归位**
  - 移除顶部 Header 的 Interrupt 按钮。
  - 在 Composer (输入框) 内部实现 Stop 图标。
- [x] **Pending Input 上下文融合**
  - 移除右侧 Pending Input 列表的表单模式。
  - 实现嵌入式卡片：当 input requested 时，在输入框上方直接弹出表单。

## 长列表与历史加载（Phase A）

> 结论来源：对比 `chatgpt方案` 与最新 `opencode` 实现后收敛。
> 目标：先解决“切线程看不到历史 + 长会话滚动卡顿/跳动”，暂不引入重型虚拟列表。

### A0. 协议与数据面（必须先做）

- [x] 新增 `thread/messages`（推荐）或扩展 `thread/read`（二选一，默认前者）
  - 原因：当前 `thread/read` 仅返回 `transcriptPreview`，由 `readSessionPreview` 限制为 tail 预览（默认 6 条、每条截断）。
  - 参数建议：`{ threadId, limit?: number, cursor?: string }`
  - 返回建议：`{ data: Array<{ id, role, text, createdAt }>, nextCursor: string | null }`
- [x] 保持 `thread/read` 兼容（左栏预览继续可用），聊天主历史改走 `thread/messages`
- [x] 增加后端测试
  - `src/app-server/threadStore.test.ts`
  - `src/app-server/server.test.ts`
  - 断言：分页顺序稳定、cursor 可推进、空页/越界安全

### A1. 前端状态模型（按线程隔离）

- [x] `AppState` 增加 `logsByThreadId`、`historyCursorByThreadId`、`historyLoadingByThreadId`
- [x] 选择线程时加载该线程第一页历史；并切换 `activeThreadId` 对应 transcript 视图
- [x] 清理线程污染：切线程时不复用上一线程 `activeTurn/pendingInput`
- [x] 错误回退：历史加载失败时保留旧渲染并提示可重试

### A2. 渐进渲染（参考 opencode，不上虚拟列表）

- [x] 引入 `turnStart` 渐进渲染窗口
  - 初始只渲染最近 `turnInit = 30` 条（可配置）
  - 后台回填批次 `turnBatch = 20`
- [x] 使用 `requestIdleCallback`（fallback `setTimeout(0)`）做回填调度
- [x] 回填锚点补偿
  - 回填前记录 `beforeTop/beforeHeight`
  - 回填后执行 `scrollTop += (newHeight - beforeHeight)`
- [x] 增加 “Render earlier messages” 按钮（批量展开已拉取历史）

### A3. 历史分页入口（超长会话）

- [x] 顶部或列表起始处增加 “Load earlier messages”
- [x] `historyLoading` 态文案：`Loading earlier messages...`
- [x] 分页参数默认
  - `limit = 50`
  - 单次 `loadMore = +50`
  - 上限保护（客户端显示层可配）

### A4. 自动滚动与手势稳定性

- [x] 保留粘底，但用户上翻后不抢滚动（`userScrolled`）
- [x] 输入区上方显示“回到底部”按钮（仅 overflow 且非 bottom）
- [x] 滚动容器设置 `overflow-anchor` 策略，避免浏览器锚点干扰
- [ ] nested scroll 边界手势只在必要时接管（避免误触抢滚动）

### A5. 验收（Phase A Done）

- [x] 选择任意线程后，2 秒内可见该线程历史（非 preview）
- [x] 500+ 消息会话：滚动不出现明显跳跃，输入框始终可用
- [x] 上翻阅读时新消息到达不抢焦点；点击“回到底部”可恢复
- [x] load more 后位置不漂移（锚点补偿生效）

### 计划改动文件（Phase A）

- `src/app-server/server.ts`
- `src/app-server/threadStore.ts`
- `src/app-server/server.test.ts`
- `src/app-server/threadStore.test.ts`
- `apps/web-reference-react/src/types.ts`
- `apps/web-reference-react/src/store.ts`
- `apps/web-reference-react/src/App.tsx`
- `apps/web-reference-react/src/components/TranscriptPane.tsx`
- `apps/web-reference-react/src/components/TranscriptPane.test.tsx`
