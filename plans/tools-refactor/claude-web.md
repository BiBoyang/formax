# 工具插件化方案设计

基于 `proxy/manus-context.txt` 的分析，我将给出一个**渐进式、可落地**的插件化方案。

---

## A. 工具盘点与分类

### 工具分类总览表

| Tool | 类别 | 中文简介 | 典型场景 | 输出形态 | Presenter 类型 | 交互需求 | 优先级 |
|------|------|---------|---------|---------|--------------|---------|--------|
| **Read** | 文件 | 读取文件内容 | 查看源码/配置 | 多行文本(cat -n格式) | 代码块/可折叠 | 展开/折叠 | P0 |
| **Write** | 文件 | 写入文件 | 创建新文件 | 单行确认 | 单行状态 | 无 | P0 |
| **Edit** | 文件 | 精确字符串替换 | 修改代码 | Diff/Patch | **Diff视图** | 展开/对比 | **P0** |
| **Glob** | 搜索 | 文件模式匹配 | 查找文件 | 文件路径列表 | 列表/可折叠 | 展开/分页 | P0 |
| **Grep** | 搜索 | 正则搜索文件内容 | 搜索关键词 | 匹配行列表 | 列表/上下文 | 展开/分页 | P0 |
| **Bash** | 命令 | 执行Shell命令 | git/npm/构建 | 多行stdout/stderr | 代码块/可折叠 | 后台运行 | P0 |
| **Task** | 子代理 | 启动子代理 | 复杂多步任务 | 递归消息流 | **运行态+可展开** | resume/kill | **P0** |
| **TaskOutput** | 子代理 | 获取任务输出 | 查询后台任务 | 任务状态+输出 | 状态卡片 | block/poll | P1 |
| **NotebookEdit** | 文件 | 编辑Jupyter单元格 | 数据科学工作流 | Cell diff | **Cell Diff视图** | 展开/对比 | **P1** |
| **WebFetch** | 网络 | 抓取网页内容 | 获取API文档 | Markdown/HTML | 代码块/渲染 | 展开/链接 | P1 |
| **WebSearch** | 网络 | 搜索引擎查询 | 查找最新信息 | 搜索结果列表 | **结果卡片+链接** | 点击/复制 | **P1** |
| **AskUserQuestion** | 交互 | 询问用户选择 | 运行时决策 | 用户输入 | **问答/选择器** | confirm/cancel | **P0** |
| **TodoWrite** | 规划 | 管理任务清单 | 跟踪进度 | TODO列表 | **任务列表/进度** | 标记完成 | P1 |
| **EnterPlanMode** | 规划 | 进入规划模式 | 复杂任务规划 | 模式切换确认 | **确认对话框** | 同意/拒绝 | **P1** |
| **ExitPlanMode** | 规划 | 退出规划模式 | 规划完成 | 模式切换确认 | 确认对话框 | 同意/启动 | P1 |
| **KillShell** | 命令 | 终止后台Shell | 停止长运行任务 | 操作确认 | 单行状态 | 无 | P2 |
| **Skill** | 元工具 | 调用技能 | 扩展能力 | 技能输出 | 透传子工具 | 无 | P2 |
| **SlashCommand** | 元工具 | 执行斜杠命令 | 快捷指令 | 命令输出 | 透传子工具 | 无 | P2 |

---

## B. 每个工具的推荐渲染方案

### P0 优先工具（必须专门渲染）

#### 1. **Edit** - Diff/Patch 视图
```
推荐渲染：
âº Edit(src/index.ts)
âŽ¿  @@ -12,3 +12,3 @@
   10 | export function foo() {
   11 | - return 'old value'
   11 | + return 'new value'
   12 | }
   
交互：展开完整上下文（默认±3行）
高亮：- 红色背景，+ 绿色背景，行号灰色
```

#### 2. **Task** - 运行态 + 可展开子消息
```
推荐渲染（运行中）：
âº Task(code-reviewer) - Running
âŽ¿  Reviewing src/index.ts...
   [â– â– â– â–¡â–¡â–¡â–¡â–¡] 40%

推荐渲染（完成后）：
âº Task(code-reviewer) - Completed
âŽ¿  Found 3 issues (ctrl+o to expand)
   â€¦ +15 messages (ctrl+o to expand)

展开后：
âº Task(code-reviewer) - Completed
âŽ¿  Summary: Found 3 issues
   âœ" Read src/index.ts (42 lines)
   âœ" Grep "TODO" in src/ (5 matches)
   âœ— Found critical bug at line 23
   
交互：ctrl+o 展开子消息流，支持 resume 恢复
高亮：agent ID、状态、进度条
```

#### 3. **AskUserQuestion** - 问答/选择器
```
推荐渲染：
âº AskUserQuestion
âŽ¿  Which library should we use for date formatting?
   
   [Auth method] 
   â—Ž date-fns (Recommended)
      Lightweight, tree-shakable
   â—‹ moment.js
      Classic, feature-rich but heavy
   â—‹ dayjs
      Moment.js compatible, smaller
   â—‹ Other (custom input)
   
   [â†'/â†" to select, Enter to confirm, Ctrl+C to cancel]

交互：上下键选择，Enter 确认，支持 multiSelect
高亮：选中项高亮，header 标签，description 灰色
```

#### 4. **NotebookEdit** - Cell Diff 视图
```
推荐渲染：
âº NotebookEdit(notebook.ipynb)
âŽ¿  Cell [2] (code)
   @@ -1,2 +1,3 @@
   - df = pd.read_csv('data.csv')
   + df = pd.read_csv('data.csv')
   + df = df.dropna()
   
交互：展开完整 cell，查看输出
高亮：cell 类型、cell ID、diff
```

#### 5. **WebSearch** - 结果卡片 + 链接
```
推荐渲染：
âº WebSearch("React 18 documentation")
âŽ¿  Found 10 results:
   
   1. [React 18 Official Docs](https://react.dev)
      React 18 introduces concurrent features...
      
   2. [What's New in React 18](https://blog.reactjs.org/...)
      This post describes the new features...
      
   â€¦ +8 more results (ctrl+o to expand)
   
交互：ctrl+o 展开所有结果，可复制链接
高亮：标题蓝色下划线、URL 灰色、摘要正常
```

### P1 工具（现有渲染可用，但可优化）

#### Read/Bash/Glob/Grep
**当前渲染已足够**（单行状态 + 可折叠详情），**保留现有 `ToolMessage.tsx` 逻辑**，仅迁移到独立 presenter。

#### TodoWrite - 任务列表/进度
```
推荐渲染：
âº TodoWrite
âŽ¿  Updated 5 tasks:
   â˜' Fix authentication bug
   â–¶ Running tests (in progress)
   â˜ Build the project
   â˜ Deploy to staging
   
交互：实时更新状态，支持折叠
高亮：â˜' 绿色完成，â–¶ 黄色进行中，â˜ 灰色待办
```

---

## C. 工程组织结构

### 目录树（推荐）

```
src/
├── tools/
│   ├── types.ts                    # 保留：ToolDefinition, ToolCall, ToolResult
│   ├── loader.ts                   # 保留：从 JSON 加载工具定义
│   ├── registry.ts                 # 新增：统一注册中心
│   │
│   ├── executor/
│   │   ├── index.ts                # 保留：createToolExecutor
│   │   └── handlers/               # 保留现有 handlers
│   │       ├── local.ts            # 保留：Read/Write/Edit/Bash/Glob/Grep
│   │       └── taskSubAgent.ts     # 保留：Task 工具
│   │
│   ├── presenters/
│   │   ├── types.ts                # 新增：ToolPresenter 接口
│   │   ├── fallback.tsx            # 新增：通用 fallback（基于现有 ToolMessage）
│   │   ├── registry.ts             # 新增：presenter 路由
│   │   │
│   │   └── implementations/        # 新增：每个工具独立 presenter
│   │       ├── read.tsx            # Read 工具（可折叠代码块）
│   │       ├── edit.tsx            # Edit 工具（Diff 视图）✅ P0
│   │       ├── bash.tsx            # Bash 工具（多行输出）
│   │       ├── task.tsx            # Task 工具（运行态+展开）✅ P0
│   │       ├── askUserQuestion.tsx # 问答/选择器 ✅ P0
│   │       ├── webSearch.tsx       # 搜索结果卡片 ✅ P1
│   │       ├── notebookEdit.tsx    # Cell Diff ✅ P1
│   │       ├── todoWrite.tsx       # 任务列表
│   │       └── enterPlanMode.tsx   # 确认对话框
│   │
│   └── toolkits/                   # 新增：工具模块（可选，未来扩展）
│       ├── file/                   # 文件工具包
│       │   ├── spec.ts             # Read/Write/Edit 的 spec
│       │   ├── handler.ts          # 对应 executor
│       │   └── presenter.tsx       # 对应 presenter
│       └── subagent/               # 子代理工具包
│           ├── spec.ts
│           ├── handler.ts
│           └── presenter.tsx
│
├── components/
│   └── tool/
│       ├── ToolMessage.tsx         # 保留：作为 fallback 基类/工具函数
│       └── ToolRouter.tsx          # 新增：根据 tool name 路由 presenter
│
└── screens/
    └── REPL.tsx                    # 保留：使用 ToolRouter 替代直接 ToolMessage
```

---

### 关键接口签名

#### 1. `ToolPresenter` 接口（新增）
```typescript
// src/tools/presenters/types.ts

import type { Msg } from '../../components/tool/ToolMessage'

export interface ToolPresenterProps {
  message: Msg
  onInteraction?: (action: ToolInteraction) => void
}

export type ToolInteraction =
  | { type: 'expand'; toolId: string }
  | { type: 'collapse'; toolId: string }
  | { type: 'confirm'; toolId: string; value: unknown }
  | { type: 'cancel'; toolId: string }
  | { type: 'resume'; toolId: string }

export interface ToolPresenter {
  /** 工具名称（用于注册） */
  name: string
  
  /** 是否能处理该消息 */
  canHandle(message: Msg): boolean
  
  /** 渲染组件 */
  render(props: ToolPresenterProps): React.ReactNode
}
```

#### 2. `ToolRegistry` 接口（新增）
```typescript
// src/tools/registry.ts

import type { ToolDefinition } from './types'
import type { ToolHandler } from './executor'
import type { ToolPresenter } from './presenters/types'

export interface ToolRegistry {
  /** 注册工具定义（spec） */
  registerSpec(spec: ToolDefinition): void
  
  /** 注册工具执行器（handler） */
  registerHandler(handler: ToolHandler): void
  
  /** 注册工具渲染器（presenter） */
  registerPresenter(presenter: ToolPresenter): void
  
  /** 获取工具定义 */
  getSpec(name: string): ToolDefinition | undefined
  
  /** 获取工具执行器 */
  getHandler(name: string): ToolHandler | undefined
  
  /** 获取工具渲染器 */
  getPresenter(name: string): ToolPresenter | undefined
  
  /** 列出所有已注册工具 */
  listTools(): string[]
}

export function createToolRegistry(): ToolRegistry
```

#### 3. `ToolRouter` 组件（新增）
```typescript
// src/components/tool/ToolRouter.tsx

import React from 'react'
import type { Msg } from './ToolMessage'
import type { ToolRegistry } from '../../tools/registry'
import { FallbackPresenter } from '../../tools/presenters/fallback'

interface ToolRouterProps {
  message: Msg
  registry: ToolRegistry
  onInteraction?: (action: ToolInteraction) => void
}

export function ToolRouter({ message, registry, onInteraction }: ToolRouterProps) {
  const toolName = message.toolInfo?.name
  
  if (!toolName) {
    return <FallbackPresenter message={message} />
  }
  
  const presenter = registry.getPresenter(toolName)
  
  if (presenter && presenter.canHandle(message)) {
    return presenter.render({ message, onInteraction })
  }
  
  // Fallback to generic presenter
  return <FallbackPresenter message={message} />
}
```

---

### 调用流程示意

```
用户输入 "Review this code"
    ↓
REPL.tsx → useReplController
    ↓
ChatEngine.runTurn
    ↓
StreamClient.streamOnce
    ↓
ToolExecutor.execute(ToolCall { name: "Task", input: { subagent_type: "code-reviewer", ... } })
    ↓
TaskSubAgentToolHandler.execute (via registry.getHandler("Task"))
    ↓
SubAgentRunner.run → 返回 ToolResult { content: "Found 3 issues" }
    ↓
StreamSink({ type: 'tool_end', result })
    ↓
useReplController → 更新 messages: [..., { role: 'tool', toolInfo: { name: 'Task', ... } }]
    ↓
REPL.tsx 渲染 messages.map(m => <ToolRouter message={m} registry={toolRegistry} />)
    ↓
ToolRouter → registry.getPresenter("Task")
    ↓
TaskPresenter.render({ message, onInteraction }) → 渲染运行态+展开UI
    ↓
用户按 ctrl+o → onInteraction({ type: 'expand', toolId: 'task-123' })
    ↓
useReplController 更新展开状态 → TaskPresenter 重新渲染展开视图
```

---

## D. 增量迁移计划

### Phase 1: 基础设施搭建（1-2天）
**目标：建立注册机制，保持现有功能不变**

1. **创建 `ToolRegistry` 和 `PresenterRegistry`**
   - `src/tools/registry.ts`：统一注册中心（spec/handler/presenter）
   - `src/tools/presenters/types.ts`：`ToolPresenter` 接口
   - `src/tools/presenters/registry.ts`：presenter 路由逻辑

2. **迁移 `ToolMessage.tsx` 为 `FallbackPresenter`**
   - `src/tools/presenters/fallback.tsx`：**保留现有所有逻辑**（formatToolCallParts/formatToolResult）
   - 作为通用 fallback，覆盖 90% 工具的默认渲染
   - **不改变现有 UI**，纯重构

3. **创建 `ToolRouter` 组件**
   - `src/components/tool/ToolRouter.tsx`：根据 tool name 路由到对应 presenter
   - 在 `REPL.tsx` 中替换 `<ToolMessage>` 为 `<ToolRouter>`

4. **Wiring：在 `cli.tsx` 中初始化 registry**
   ```typescript
   const toolRegistry = createToolRegistry()
   
   // 注册 specs
   tools.forEach(t => toolRegistry.registerSpec(t))
   
   // 注册 handlers
   toolRegistry.registerHandler(localHandler)
   toolRegistry.registerHandler(taskHandler)
   
   // 注册 fallback presenter
   toolRegistry.registerPresenter(new FallbackPresenter())
   
   // 传给 REPL
   <REPL ... toolRegistry={toolRegistry} />
   ```

**验收标准**：所有现有工具渲染不变，测试通过。

---

### Phase 2: 实现 P0 专用 Presenters（3-5天）

**优先顺序**（按用户体验影响排序）：

#### 2.1 **Edit** - Diff 视图（Day 1）
- `src/tools/presenters/implementations/edit.tsx`
- 使用 `diff` 算法库（如 `diff` npm 包）或手动解析 `old_string`/`new_string`
- 高亮：- 红色背景，+ 绿色背景，@ 灰色
- 交互：ctrl+o 展开完整文件（可选）

#### 2.2 **Task** - 运行态 + 展开（Day 2-3）
- `src/tools/presenters/implementations/task.tsx`
- 运行中：显示进度条（基于子消息数估算）
- 完成后：显示摘要 + "â€¦ +N messages (ctrl+o to expand)"
- 展开：递归渲染子消息（需要在 `ToolResult` 中附加子消息历史）
- 交互：ctrl+o 展开/折叠，支持 resume

#### 2.3 **AskUserQuestion** - 问答/选择器（Day 4）
- `src/tools/presenters/implementations/askUserQuestion.tsx`
- 使用 Ink 的 `useInput` + `useState` 实现上下键选择
- 支持 `multiSelect`（空格切换选中）
- Enter 确认后调用 `onInteraction({ type: 'confirm', value: selectedOptions })`
- **阻塞渲染**：在用户确认前，暂停后续工具调用

#### 2.4 **WebSearch** - 结果卡片（Day 5）
- `src/tools/presenters/implementations/webSearch.tsx`
- 解析 `ToolResult.content`（假设返回 JSON 格式的搜索结果）
- 渲染：编号、标题（蓝色+下划线）、URL（灰色）、摘要
- 交互：ctrl+o 展开所有结果，支持复制链接（可选）

**验收标准**：4 个 P0 工具的渲染符合设计，交互流畅。

---

### Phase 3: 覆盖其余工具（1-2天/工具）

#### 3.1 P1 工具
- **NotebookEdit**：Cell Diff 视图（类似 Edit，但针对 cell）
- **TodoWrite**：任务列表/进度条
- **EnterPlanMode/ExitPlanMode**：确认对话框（类似 AskUserQuestion，但更简单）

#### 3.2 P2 工具（可延后）
- **KillShell/TaskOutput**：单行状态（复用 fallback）
- **Skill/SlashCommand**：透传子工具（复用 fallback）

---

### Phase 4: 优化与扩展（持续）

1. **工具模块化（toolkits）**
   - 将相关工具（如 Read/Write/Edit）打包为 `file` toolkit
   - 每个 toolkit 包含 spec/handler/presenter，便于独立维护

2. **交互增强**
   - 实现全局快捷键（ctrl+o 展开/折叠所有工具）
   - 支持工具结果的复制/导出

3. **性能优化**
   - 对长输出工具（Bash/Read）实现虚拟滚动
   - 对 Task 子消息实现懒加载

---

## E. 可复用的现有结构（保留/微调）

### âœ… 保留（直接复用）
1. **`src/tools/types.ts`**：`ToolDefinition`, `ToolCall`, `ToolResult` → 作为核心类型
2. **`src/tools/loader.ts`**：`loadToolDefinitions` → 继续从 JSON 加载
3. **`src/tools/executor/`**：`ToolExecutor`, `ToolHandler` → 执行层架构已合理
4. **`src/tools/executor/handlers/local.ts`**：本地工具实现 → 无需改动
5. **`src/tools/executor/handlers/taskSubAgent.ts`**：Task 实现 → 无需改动
6. **`src/utils/toolFormatting.ts`**：`formatToolCallParts`, `formatToolResult` → 作为 fallback 工具函数
7. **`src/components/tool/ToolMessage.test.tsx`**：测试用例 → 迁移到 `FallbackPresenter.test.tsx`

### ðŸ"„ 微调（重构/增强）
1. **`ToolMessage.tsx`** → **`FallbackPresenter.tsx`**
   - 保留所有渲染逻辑
   - 实现 `ToolPresenter` 接口
   - 作为默认 fallback

2. **`REPL.tsx`**
   - 替换 `<ToolMessage message={msg} />` 为 `<ToolRouter message={msg} registry={toolRegistry} />`
   - 传入 `toolRegistry` 作为 prop

3. **`cli.tsx`**
   - 初始化 `toolRegistry`
   - 注册所有 spec/handler/presenter
   - 传给 REPL

### âŒ ä¸æŽ¨èæŽ¨å€'重来
- **ä¸**删除现有 `ToolMessage.tsx`（改为 fallback）
- **ä¸**重写 executor 层（已经是插件化设计）
- **ä¸**改动核心类型（`ToolCall`/`ToolResult` 已足够通用）

---

## F. 关键设计决策说明

### 1. 为什么不推荐 "每个工具一个文件夹"？
**推荐独立 presenter 文件，但不推荐 toolkit 文件夹**（至少 Phase 1-3 不需要）。理由：
- 大部分工具的 spec 已在 `tools.json`
- handler 层已有 `local.ts`（覆盖 6 个工具）
- 过早模块化会增加复杂度

**未来可选**：当单个工具逻辑超过 200 行时，再拆分为 toolkit。

### 2. 为什么保留 `FallbackPresenter`？
- **90% 的工具**（如 Read/Write/Bash/Glob/Grep）现有渲染已足够
- **避免重复代码**：每个工具都重新实现 "单行状态 + 可折叠详情" 是浪费
- **渐进式迁移**：先覆盖 P0，其余工具复用 fallback

### 3. 为什么 `ToolRouter` 而非直接 `ToolPresenter.render`？
- **解耦**：REPL 不依赖具体 presenter，只依赖 registry
- **Fallback**：当 presenter 未注册时，自动降级到 fallback
- **未来扩展**：可以在 router 层添加权限控制/日志/性能监控

---

## G. 实现检查清单

### Phase 1（基础设施）
- [ ] `src/tools/registry.ts` → `createToolRegistry()`
- [ ] `src/tools/presenters/types.ts` → `ToolPresenter` 接口
- [ ] `src/tools/presenters/fallback.tsx` → 迁移 `ToolMessage.tsx`
- [ ] `src/components/tool/ToolRouter.tsx` → 路由逻辑
- [ ] `cli.tsx` → 初始化 registry
- [ ] `REPL.tsx` → 替换为 `ToolRouter`
- [ ] **测试**：所有现有工具渲染不变

### Phase 2（P0 工具）
- [ ] `edit.tsx` → Diff 视图
- [ ] `task.tsx` → 运行态 + 展开
- [ ] `askUserQuestion.tsx` → 问答/选择器
- [ ] `webSearch.tsx` → 结果卡片
- [ ] **测试**：4 个 P0 工具的交互流畅

### Phase 3（P1 工具）
- [ ] `notebookEdit.tsx` → Cell Diff
- [ ] `todoWrite.tsx` → 任务列表
- [ ] `enterPlanMode.tsx` / `exitPlanMode.tsx` → 确认对话框

---

## H. 最终效果预览

### 迁移前（当前）
```typescript
// REPL.tsx
messages.map(msg => <ToolMessage message={msg} />)
```

### 迁移后（Phase 1）
```typescript
// REPL.tsx
messages.map(msg => <ToolRouter message={msg} registry={toolRegistry} />)
```

**UI 完全一致**，但内部已切换到插件化架构。

### Phase 2 后（专用 presenters）
```typescript
// Edit 工具：Diff 视图
âº Edit(src/index.ts)
âŽ¿  @@ -12,3 +12,3 @@
   - return 'old value'
   + return 'new value'

// Task 工具：运行态
âº Task(code-reviewer) - Running [â– â– â– â–¡â–¡] 60%

// AskUserQuestion：选择器
âº AskUserQuestion
âŽ¿  Which library?
   â—Ž date-fns (Recommended)
   â—‹ moment.js
```

---

## I. 总结

### 核心原则
1. **渐进式**：先基础设施，再专用渲染
2. **保留可用**：fallback 覆盖 90% 工具
3. **插件化**：每个工具独立 presenter，统一注册
4. **不推倒重来**：复用现有 executor/handler/types

### 关键收益
- **可扩展**：新工具只需注册 presenter，无需改 REPL
- **可维护**：每个工具的渲染逻辑独立，便于调试
- **用户体验**：专用渲染（Diff/Task/问答）显著提升交互质量

### 风险与缓解
- **风险**：过度抽象导致复杂度增加
- **缓解**：Phase 1 不改变 UI，验证架构可行性
- **风险**：交互类工具（AskUserQuestion）需要阻塞逻辑
- **缓解**：在 `useReplController` 中实现交互状态管理