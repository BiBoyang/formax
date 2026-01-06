# REPL.tsx 分层重构方案

## 问题分析

当前 `REPL.tsx` (413 行) 混合了以下职责：

- 系统提示词定义 (L30-36)
- 工具加载逻辑 (L17-28)
- 流式对话循环与回调处理 (L57-214)
- 消息状态管理 (L39-45, 各处 setMessages)
- UI 渲染逻辑 (L286-411)

这种耦合使得扩展 sub_agent 非常困难。

---

## 1. 推荐目录结构

```
src/
├── core/                          # 核心业务逻辑（与 UI 无关）
│   ├── prompts/
│   │   ├── index.ts               # 导出所有提示词
│   │   ├── system.ts              # 系统提示词
│   │   └── commands.ts            # /init 等命令提示词
│   │
│   ├── tools/
│   │   ├── index.ts               # 统一导出
│   │   ├── loader.ts              # 工具定义加载器
│   │   ├── executor.ts            # 工具执行器（已有）
│   │   └── types.ts               # ToolCall, ToolResult 类型
│   │
│   ├── streaming/
│   │   ├── index.ts               # 统一导出
│   │   ├── client.ts              # StreamClient（已有）
│   │   ├── loop.ts                # 流式循环控制器（新）
│   │   └── types.ts               # StreamCallbacks, MessageParam
│   │
│   ├── agent/
│   │   ├── index.ts               # Agent 主入口
│   │   ├── AgentSession.ts        # 会话管理（新）
│   │   └── SubAgent.ts            # 子代理接口（预留）
│   │
│   └── config/
│       ├── index.ts               # 统一导出
│       ├── env.ts                 # 环境变量（已有）
│       └── settings.ts            # 运行时配置
│
├── hooks/                         # React Hooks（UI 与核心的桥接）
│   ├── useAgent.ts                # Agent 会话 Hook
│   ├── useMessages.ts             # 消息状态管理
│   └── useStreamingCallbacks.ts   # 流式回调转 UI 状态
│
├── screens/
│   └── REPL.tsx                   # 纯 UI/交互层
│
└── components/                    # UI 组件（保持现有结构）
```

---

## 2. 关键模块职责与接口

### 2.1 `core/prompts/system.ts`

```typescript
// 系统提示词管理
export interface SystemPromptBlock {
  type: "text";
  text: string;
  cache_control?: { type: "ephemeral" };
}

export function getSystemPrompt(): SystemPromptBlock[] {
  return [
    {
      type: "text",
      text: "You are Claude Code, Anthropic's official CLI for Claude.",
      cache_control: { type: "ephemeral" },
    },
  ];
}
```

### 2.2 `core/prompts/commands.ts`

```typescript
// 命令提示词
export function buildInitPrompt(): string { ... }
export function buildTaskPrompt(task: string): string { ... }  // 预留
```

### 2.3 `core/tools/loader.ts`

```typescript
import type { ToolDefinition } from "./types";

export interface ToolLoaderOptions {
  toolsPath?: string; // 默认 'proxy/tools.json'
}

export function loadTools(options?: ToolLoaderOptions): ToolDefinition[];
export function getToolByName(name: string): ToolDefinition | undefined;
```

### 2.4 `core/config/settings.ts`

```typescript
// 集中配置读取
export interface AgentConfig {
  apiKey: string;
  baseURL: string;
  model: string;
  timeoutMs: number;
  logDir: string;
}

export function getAgentConfig(): AgentConfig {
  return {
    apiKey: process.env.ANTHROPIC_API_KEY2!,
    baseURL: process.env.ANTHROPIC_BASE_URL2!,
    model: process.env.ANTHROPIC_MODEL || "claude-sonnet-4-5-20250929",
    timeoutMs: Number(process.env.ANTHROPIC_TIMEOUT_MS || 600000),
    logDir: path.resolve(process.cwd(), "proxy/logs"),
  };
}
```

### 2.5 `core/agent/AgentSession.ts`

```typescript
import type { Msg } from "@/components/tool/ToolMessage";
import type { StreamCallbacks } from "../streaming/types";

export interface AgentSessionOptions {
  tools: ToolDefinition[];
  systemPrompt: SystemPromptBlock[];
  onMessage: (msg: Msg) => void;
  onError: (error: Error) => void;
  onLoadingChange: (loading: boolean, text?: string) => void;
}

export class AgentSession {
  constructor(options: AgentSessionOptions);

  // 发送用户消息并处理完整对话循环
  async sendMessage(content: string): Promise<void>;

  // 处理 /init 等命令
  async handleCommand(command: string): Promise<void>;

  // 中断当前请求
  abort(): void;

  // 获取消息历史（用于持久化）
  getHistory(): Msg[];
}
```

### 2.6 `hooks/useAgent.ts`

```typescript
import { AgentSession } from "@/core/agent/AgentSession";

export interface UseAgentReturn {
  messages: Msg[];
  isLoading: boolean;
  loadingText: string;
  error: string | null;
  sendMessage: (content: string) => Promise<void>;
  abort: () => void;
}

export function useAgent(): UseAgentReturn {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [loadingText, setLoadingText] = useState("Thinking");
  const [error, setError] = useState<string | null>(null);
  const sessionRef = useRef<AgentSession | null>(null);

  useEffect(() => {
    const tools = loadTools();
    const systemPrompt = getSystemPrompt();

    sessionRef.current = new AgentSession({
      tools,
      systemPrompt,
      onMessage: (msg) => setMessages((prev) => [...prev, msg]),
      onError: (err) => setError(err.message),
      onLoadingChange: (loading, text) => {
        setIsLoading(loading);
        if (text) setLoadingText(text);
      },
    });
  }, []);

  return { messages, isLoading, loadingText, error, sendMessage, abort };
}
```

---

## 3. REPL.tsx 重构后示例

```tsx
import React from 'react'
import { Box, Text, useInput, Static } from 'ink'
import { useAgent } from '@/hooks/useAgent'
import { HeaderBanner } from '@/components/chat/HeaderBanner'
import { InputBar } from '@/components/chat/InputBar'
import { MessageList } from '@/components/chat/MessageList'  // 新增

export function REPL({ onExit }: Props): React.ReactNode {
  const [input, setInput] = useState('')
  const { messages, isLoading, loadingText, error, sendMessage, abort } = useAgent()

  useInput((key, meta) => {
    if (meta.ctrl && key === 'c') {
      abort()
      onExit?.() ?? process.exit(0)
    }
  })

  const handleSend = async (value: string) => {
    if (!value.trim() || isLoading) return
    setInput('')
    await sendMessage(value.trim())
  }

  return (
    <Box flexDirection="column" height="100%">
      <HeaderBanner ... />
      <MessageList messages={messages} />
      {isLoading && <LoadingIndicator text={loadingText} />}
      {error && <ErrorDisplay error={error} />}
      <InputBar value={input} onChange={setInput} onSubmit={handleSend} disabled={isLoading} />
    </Box>
  )
}
```

**重构后 REPL.tsx 仅约 50-80 行，只负责：**

- 键盘事件处理
- 输入状态管理
- 组件布局渲染

---

## 4. SubAgent 设计（参考 Claude Code 官方实现）

> [!IMPORTANT]
> 以下设计基于 Claude Code 官方 Sub-Agent 架构，详见 [plans/sub-agent/claude-code-research.md](../sub-agent/claude-code-research.md)

### 4.1 核心原则

| 原则           | 说明                                                |
| -------------- | --------------------------------------------------- |
| **隔离上下文** | 每个 SubAgent 有独立的 context window，不共享主对话 |
| **工具白名单** | 显式指定可用工具，而非继承主 Agent 全部工具         |
| **禁止嵌套**   | SubAgent 不能生成其他 SubAgent，防止递归失控        |
| **返回摘要**   | 只返回结果摘要给主 Agent，节省 token                |

### 4.2 定义方式（Markdown + YAML frontmatter）

```markdown
## <!-- .agent/subagents/code-reviewer.md -->

name: code_reviewer
description: Reviews code for bugs and best practices
tools:

- Read
- Grep
- Glob

---

You are a code reviewer. Analyze code for:

1. Bugs and logic errors
2. Security vulnerabilities
3. Performance issues

Return a concise summary (max 500 chars).
```

### 4.3 SubAgent 接口

```typescript
// core/agent/SubAgent.ts
export interface SubAgentConfig {
  name: string;
  description: string;
  systemPrompt: string;
  tools: string[]; // 白名单工具名
}

export interface SubAgentResult {
  summary: string; // 返回给主 Agent 的摘要
  artifacts?: string[]; // 生成的文件路径
  success: boolean;
  error?: string;
}

export class SubAgent {
  private config: SubAgentConfig;
  private context: Msg[] = []; // 隔离的上下文

  constructor(config: SubAgentConfig);

  // 执行任务（隔离上下文，不访问主 Agent 历史）
  async run(task: string, signal?: AbortSignal): Promise<SubAgentResult>;

  // 获取允许的工具（白名单过滤）
  getAllowedTools(): ToolDefinition[];
}
```

### 4.4 SubAgent 注册与调用

```typescript
// core/agent/SubAgentRegistry.ts
export class SubAgentRegistry {
  private agents: Map<string, SubAgentConfig> = new Map();

  // 从 .agent/subagents/*.md 加载
  loadFromDirectory(dir: string): void;

  // 根据名称获取
  get(name: string): SubAgentConfig | undefined;

  // 列出所有可用 SubAgent
  list(): SubAgentConfig[];
}

// 使用示例（在 ToolHandler 中）
export class SubAgentToolHandler implements ToolHandler {
  canHandle(name: string): boolean {
    return name === "Task" || name === "Agent";
  }

  async execute(call: ToolCall): Promise<ToolResult> {
    const agentName = call.input.agent;
    const task = call.input.task;

    const config = this.registry.get(agentName);
    if (!config) {
      return {
        tool_use_id: call.id,
        content: `Unknown agent: ${agentName}`,
        is_error: true,
      };
    }

    const subAgent = new SubAgent(config);
    const result = await subAgent.run(task);

    // 只返回摘要，不返回完整历史
    return { tool_use_id: call.id, content: result.summary };
  }
}
```

### 4.5 内置 SubAgent 类型

| 名称            | 用途                               | 工具                   |
| --------------- | ---------------------------------- | ---------------------- |
| `browser_agent` | 浏览器操作（点击、截图、读取 DOM） | Browser, Screenshot    |
| `code_reviewer` | 代码审查                           | Read, Grep, Glob       |
| `test_runner`   | 运行测试                           | Bash, Read             |
| `plan_agent`    | 研究和规划复杂任务                 | Read, Grep, Glob, Bash |

---

## 5. 迁移步骤建议

| 阶段 | 任务                           | 风险 |
| ---- | ------------------------------ | ---- |
| 1    | 提取 `core/prompts/*`          | 低   |
| 2    | 提取 `core/tools/loader.ts`    | 低   |
| 3    | 提取 `core/config/settings.ts` | 低   |
| 4    | 创建 `AgentSession` 类         | 中   |
| 5    | 创建 `useAgent` Hook           | 中   |
| 6    | 重构 `REPL.tsx`                | 中   |
| 7    | 实现 `SubAgent` + Registry     | 高   |
| 8    | 添加 `SubAgentToolHandler`     | 高   |

> [!TIP]
> 建议每个阶段完成后运行测试确保功能不变，特别是阶段 4-6。
