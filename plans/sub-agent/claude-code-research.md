# Claude Code Sub-Agent 架构研究

> 基于网络搜索整理的 Claude Code 官方 Sub-Agent 实现方案

## 1. 核心概念

Sub-Agent 是预配置的 AI "人格"，每个都有特定用途、专业领域和自定义 system prompt。主 Agent 作为协调者，将任务委派给专门的 Sub-Agent 处理。

```
┌─────────────────────────────────────────────────────────┐
│                 Main Agent (Orchestrator)               │
│                                                         │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐     │
│  │ SubAgent A  │  │ SubAgent B  │  │ SubAgent C  │     │
│  │ (Reviewer)  │  │ (Debugger)  │  │ (Browser)   │     │
│  │             │  │             │  │             │     │
│  │ Own Context │  │ Own Context │  │ Own Context │     │
│  │ Own Tools   │  │ Own Tools   │  │ Own Tools   │     │
│  └─────────────┘  └─────────────┘  └─────────────┘     │
│                                                         │
│  特点：隔离上下文 | 工具白名单 | 禁止嵌套 | 返回摘要   │
└─────────────────────────────────────────────────────────┘
```

---

## 2. 核心设计原则

| 原则           | 说明                                  | 优势                       |
| -------------- | ------------------------------------- | -------------------------- |
| **隔离上下文** | 每个 SubAgent 有独立的 context window | 防止主对话污染，节省 token |
| **专一职责**   | 每个 SubAgent 有特定的 system prompt  | 更高的任务成功率           |
| **工具白名单** | 显式配置可用工具                      | 安全控制，精确权限         |
| **禁止嵌套**   | SubAgent 不能生成其他 SubAgent        | 防止递归失控               |
| **结果汇总**   | 只返回摘要给主 Agent                  | 减少 context 膨胀          |

---

## 3. 任务流程

1. **任务识别**: 主 Agent 分析用户请求
2. **代理选择**: 自动选择或用户显式调用 SubAgent
3. **隔离执行**: SubAgent 在独立上下文中工作
4. **阻止嵌套**: SubAgent 不能再生成其他 SubAgent
5. **结果汇总**: 返回摘要/关键结果给主 Agent

---

## 4. 定义方式

SubAgent 使用 **Markdown + YAML frontmatter** 定义：

```markdown
## <!-- .agent/subagents/code-reviewer.md -->

name: code_reviewer
description: Reviews code for bugs and best practices
tools:

- Read
- Grep
- Glob

---

You are a code reviewer. Your job is to:

1. Analyze the provided code for bugs
2. Check for security vulnerabilities
3. Suggest improvements

Return a concise summary of findings (max 500 characters).
```

### 字段说明

| 字段          | 必填 | 说明                        |
| ------------- | ---- | --------------------------- |
| `name`        | ✅   | 唯一标识符，用于调用        |
| `description` | ✅   | 简短描述，帮助主 Agent 选择 |
| `tools`       | ❌   | 白名单工具，不指定则无工具  |
| (body)        | ✅   | System prompt 内容          |

---

## 5. 常见 SubAgent 类型

### 5.1 browser_agent

控制浏览器进行 Web 交互。

```yaml
name: browser_agent
description: Controls web browser for testing and scraping
tools:
  - Browser
  - Screenshot
  - ReadDOM
```

**能力**:

- 点击元素、滚动页面
- 输入文本
- 读取 console logs
- 捕获 DOM 结构/截图/视频

### 5.2 code_reviewer

代码审查专家。

```yaml
name: code_reviewer
description: Reviews code for bugs, security issues, and best practices
tools:
  - Read
  - Grep
  - Glob
```

### 5.3 test_runner

自动执行测试。

```yaml
name: test_runner
description: Runs tests and reports results
tools:
  - Bash
  - Read
```

### 5.4 plan_agent

研究和规划复杂任务。

```yaml
name: plan_agent
description: Researches codebase and creates implementation plans
tools:
  - Read
  - Grep
  - Glob
  - Bash
```

---

## 6. 实现接口设计

### 6.1 SubAgentConfig

```typescript
interface SubAgentConfig {
  name: string;
  description: string;
  systemPrompt: string;
  tools: string[]; // 白名单工具名
}
```

### 6.2 SubAgentResult

```typescript
interface SubAgentResult {
  summary: string; // 返回给主 Agent 的摘要（关键）
  artifacts?: string[]; // 生成的文件路径
  success: boolean;
  error?: string;
}
```

### 6.3 SubAgent 类

```typescript
class SubAgent {
  private config: SubAgentConfig;
  private context: Message[] = []; // 隔离的上下文
  private allowedTools: Set<string>;

  constructor(config: SubAgentConfig) {
    this.config = config;
    this.allowedTools = new Set(config.tools);
    // 注意：不接收 parentSession，强制隔离
  }

  // 检查是否允许执行该工具
  canUseTool(name: string): boolean {
    return this.allowedTools.has(name);
  }

  // 执行任务
  async run(task: string, signal?: AbortSignal): Promise<SubAgentResult> {
    // 1. 使用隔离的 context（不访问主 Agent 历史）
    // 2. 只使用白名单工具
    // 3. 工具循环结束后生成摘要
    // 4. 返回 SubAgentResult
  }
}
```

### 6.4 SubAgentRegistry

```typescript
class SubAgentRegistry {
  private agents: Map<string, SubAgentConfig> = new Map();

  // 从 .agent/subagents/*.md 加载所有 SubAgent 定义
  async loadFromDirectory(dir: string): Promise<void>;

  // 根据名称获取配置
  get(name: string): SubAgentConfig | undefined;

  // 列出所有可用 SubAgent（供主 Agent 选择）
  list(): { name: string; description: string }[];
}
```

---

## 7. 与 ToolHandler 集成

SubAgent 作为特殊的 Tool 被主 Agent 调用：

```typescript
class SubAgentToolHandler implements ToolHandler {
  private registry: SubAgentRegistry;

  canHandle(name: string): boolean {
    // 处理 Task、Agent、Dispatch 等调用 SubAgent 的工具
    return name === "Task" || name === "Agent" || name === "Dispatch";
  }

  async execute(call: ToolCall, ctx: ExecutionContext): Promise<ToolResult> {
    const agentName = call.input.agent || call.input.name;
    const task = call.input.task || call.input.prompt;

    // 1. 查找 SubAgent 配置
    const config = this.registry.get(agentName);
    if (!config) {
      return {
        tool_use_id: call.id,
        content: `Unknown agent: ${agentName}`,
        is_error: true,
      };
    }

    // 2. 创建隔离的 SubAgent 实例
    const subAgent = new SubAgent(config);

    // 3. 执行任务
    const result = await subAgent.run(task, ctx.signal);

    // 4. 只返回摘要（关键：不返回完整历史）
    return {
      tool_use_id: call.id,
      content: result.summary,
      is_error: !result.success,
    };
  }
}
```

---

## 8. 关键实现细节

### 8.1 上下文隔离

```typescript
// ❌ 错误：共享父会话上下文
class SubAgent extends AgentSession {
  constructor(config, parentSession) {
    this.context = parentSession.getHistory(); // 污染！
  }
}

// ✅ 正确：完全隔离
class SubAgent {
  constructor(config) {
    this.context = []; // 空白开始
  }
}
```

### 8.2 禁止嵌套

```typescript
class SubAgent {
  async run(task: string): Promise<SubAgentResult> {
    // 在工具执行器中过滤掉 Task/Agent/Dispatch
    const filteredTools = this.getAllowedTools().filter(
      (t) => !["Task", "Agent", "Dispatch"].includes(t.name)
    );

    // 使用过滤后的工具列表
    await this.streamClient.runTurn({
      tools: filteredTools,
      // ...
    });
  }
}
```

### 8.3 摘要生成

```typescript
class SubAgent {
  async run(task: string): Promise<SubAgentResult> {
    // ... 执行任务 ...

    // 最后一步：让 SubAgent 生成摘要
    const summaryPrompt = `
Based on the work you just completed, provide a concise summary (max 500 chars) 
for the main agent. Focus on:
1. What was accomplished
2. Key findings or changes
3. Any issues encountered
`;

    const summary = await this.generateSummary(summaryPrompt);
    return { summary, success: true };
  }
}
```

---

## 9. 参考资源

- [Anthropic Claude Code Sub-Agents 官方文档](https://claude.com)
- [Claude Agent SDK](https://anthropic.com)
- [Sub-Agent 最佳实践](https://medium.com)

---

## 10. 与现有方案对比

| 方面       | Claude Code 官方 | Codex 方案         | Antigravity 方案（更新后） |
| ---------- | ---------------- | ------------------ | -------------------------- |
| 定义方式   | Markdown 文件    | `ToolHandler` 插件 | Markdown + Registry        |
| 上下文隔离 | ✅ 强制隔离      | ⚠️ 需手动实现      | ✅ 强制隔离                |
| 工具限制   | ✅ 白名单        | ✅ `canHandle`     | ✅ 白名单                  |
| 嵌套限制   | ✅ 禁止          | ⚠️ 无限制          | ✅ 禁止                    |
| 返回格式   | 摘要             | ToolResult         | 摘要                       |
