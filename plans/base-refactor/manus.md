
# REPL 分层与 Sub-Agent 重构方案

您好，作为资深 TS/Node/Ink 架构师，我已仔细分析了您提供的 `formax` 项目代码和 `codex.md` 架构蓝图。`codex.md` 提供了非常出色的分层思想，我的方案将在此基础上，聚焦于可落地的实施路径、Sub-agent 核心约束的实现，并提供两种不同取向的方案供您决策。

---

## A. 总览与边界

### 1. 现状核心问题

1.  **UI 与业务逻辑高度耦合**：`src/screens/REPL.tsx` 是一个典型的“上帝组件”，它直接负责了配置加载、工具读取、提示词构建、网络请求、流式解析、工具执行、状态管理和 UI 渲染的所有工作。这使得任何单一逻辑的变更（如修改工具执行策略）都可能影响整个组件，难以维护和测试。

2.  **配置与依赖硬编码**：API Keys、Base URL、日志路径等配置散落在 UI 与底层 streaming client 中，通过 `process.env` 直接读取。这使得模块无法在不同上下文中（如测试、其他入口点）复用，也缺乏统一的配置管理和校验。

3.  **工具执行策略僵化**：旧的工具执行器通过一个巨大的 `switch` 语句实现工具分发。这种方式无法扩展，特别是无法支持像 `Task` 这样需要截然不同执行策略（启动一个独立的 agent 实例）的工具。

4.  **缺乏应用层抽象**：`REPL.tsx` 直接调用底层的 `StreamClient`，并手动处理复杂的流式回调（`onTextDelta`, `onToolStart`, `onToolEnd`）来拼装 UI 状态。这使得 UI 组件承担了过多的业务流程编排（Orchestration）职责。

5.  **Sub-agent 机制缺失**：当前架构完全没有 Sub-agent 的概念，无法实现上下文隔离、工具白名单等核心约束，也未实现 `tools.json` 中已定义的 `Task` 工具。

### 2. 重构核心原则

- **单一职责原则 (SRP)**：严格遵循 `codex.md` 的分层思想，确保每个模块只做一件事（例如：`REPL.tsx` 只管渲染，`engine.ts` 只管编排，`StreamClient.ts` 只管通信）。
- **依赖倒置原则 (DIP)**：上层模块（如 `REPL.tsx`）不应依赖下层模块的具体实现（如 `AnthropicStreamClient`），而应依赖于抽象接口（如 `ChatEngine`）。所有依赖通过入口点（`cli.tsx`）进行组装和注入（DI）。
- **面向接口编程**：为 `ChatEngine`, `ToolHandler`, `SubAgentRunner` 等核心模块定义清晰的 TypeScript 接口，便于替换实现和单元测试。
- **可扩展性**：新的工具类型（如 Sub-agent）和新的 LLM Provider 应能以插件形式（如 `ToolHandler`）添加，而无需修改核心业务流程代码。

### 3. 对 `codex.md` 的调整与确认

`codex.md` 提出的目录结构和模块边界非常合理，我将完全采纳。我仅补充一点具体建议：

- **日志处理**：`StreamClient` 中的日志硬编码 (`appendLog`) 应被移除。建议在 `cli.tsx` 中初始化一个全局 logger（如 `pino` 或一个简单的 `console` 封装），并将其作为依赖注入给需要的模块。这符合依赖倒置原则，并使日志策略（如日志级别、输出目标）完全由顶层配置控制。


---

## B. 分阶段迁移计划

我将提供两套方案的迁移计划。**方案 A** 旨在快速落地，最大限度复用现有代码；**方案 B** 则是更彻底的重构，追求长期的可扩展性。

### 方案 A：保守/最小改动方案

此方案的核心是“包装”而非“重写”，快速将 `REPL.tsx` 的逻辑下沉，并实现 `Task` 工具。

#### 阶段 1：基础垫片层与配置中心

- **目标**：建立最底层的、无依赖的模块，将硬编码的配置统一管理。
- **文件清单**：
  - **新增**: `src/env/config.ts`
  - **新增**: `src/prompts/index.ts`, `src/prompts/system.ts`, `src/prompts/init.ts`
  - **新增**: `src/streaming/types.ts`
  - **修改**: `src/screens/REPL.tsx` (暂时引入 `loadRuntimeConfig` 和 `build*Prompt` 函数)
- **验收标准**：
  - REPL 正常启动，无功能退化。
  - `REPL.tsx` 中的 `SYSTEM_PROMPT` 和 `buildInitPrompt` 硬编码被 `prompts` 模块的调用替代。
  - `createStreamClientFromEnv` 内部开始使用 `loadRuntimeConfig` 获取配置（或在 REPL 中加载后传入）。

#### 阶段 2：实现 Task 工具处理器

- **目标**：优先实现 `Task` 工具的执行逻辑（Sub-agent 隔离 + 工具白名单），并能在 REPL 中展示结果。
- **文件清单**：
  - **新增**: `.agent/subagents/code-reviewer.md` (示例 sub-agent)
  - **新增**: `src/subagents/types.ts`
  - **新增**: `src/subagents/registry.ts`
  - **新增**: `src/subagents/runner.ts` (核心：隔离上下文、实现工具白名单)
  - **新增**: `src/tools/executor/handlers/taskSubAgent.ts` (实现 `Task` 工具的 `ToolHandler`，桥接 `SubAgentRunner`)
  - **修改**: `src/entrypoints/cli.tsx` (在 wiring 中注入 `taskSubAgent` handler)
- **验收标准**：
  - 在 REPL 中输入调用 `Task` 工具的指令（例如：“用 code-reviewer sub-agent 审查一下 `src/screens/REPL.tsx` 的代码质量”），模型能够正确调用 `Task` 工具。
  - `ToolMessage` 能够正确显示 `Task` 工具的启动、运行中、以及最终返回的摘要结果。
  - `SubAgentRunner` 的执行日志显示它只使用了 `code-reviewer.md` 中定义的白名单工具。

#### 阶段 3：剥离 REPL 逻辑

- **目标**：将 `REPL.tsx` 中的状态管理和事件处理逻辑剥离到 `useReplController`。
- **文件清单**：
  - **新增**: `src/features/repl/useReplController.ts`
  - **修改**: `src/screens/REPL.tsx` (大幅简化，只保留 UI 和对 `useReplController` 的调用)
  - **修改**: `src/entrypoints/cli.tsx` (开始进行初步的依赖组装)
- **验收标准**：
  - REPL 所有功能（发送消息、工具调用、`/init`、Ctrl+C）与重构前完全一致。
  - `REPL.tsx` 文件行数显著减少，复杂的 `useState`, `useCallback` 逻辑移至 `useReplController.ts`。

#### 方案 A 总结

- **说明**：方案 A 是“最小改动思路”，当前仓库实际选择更彻底的方案（新核心 + 删除旧实现），因此此处仅作对比参考。
- **优点**：改动范围小，每一步都可以快速验证，能最快速度让 `Task` 工具跑起来。
- **缺点**：`ToolExecutor` 的扩展性问题没有根本解决，`StreamClient` 的职责依然过重，只是被包装了起来。

---

### 方案 B：进取/可扩展方案

此方案严格遵循 `codex.md` 的分层架构，实现一个全新的、与旧实现无关的聊天核心。

#### 阶段 1：建立纯净的核心层 (P0)

- **目标**：创建所有无依赖的、纯函数的、可独立测试的核心模块。
- **文件清单**：
  - **新增**: `src/env/config.ts`
  - **新增**: `src/prompts/*` (所有提示词构建器)
  - **新增**: `src/tools/types.ts`
  - **新增**: `src/streaming/types.ts`
  - **新增**: `src/subagents/types.ts`
- **验收标准**：
  - 所有新增模块都有对应的 `.test.ts` 文件，并通过单元测试。
  - 这些模块不依赖任何 UI（如 `src/screens`）下的文件。

#### 阶段 2：抽象化工具与 Sub-agent (P1)

- **目标**：建立可插拔的工具执行器和 Sub-agent 运行机制。
- **文件清单**：
  - **新增**: `src/tools/loader.ts` (从 JSON 加载工具定义)
  - **新增**: `src/tools/executor/index.ts` (定义 `ToolHandler` 接口和 `createToolExecutor`)
  - **新增**: `src/tools/executor/handlers/local.ts` (将旧的本地工具 `switch` 分发逻辑迁移至此，作为 `LocalToolHandler`)
  - **新增**: `src/subagents/registry.ts` (加载 `.agent/subagents/*.md`)
  - **新增**: `src/subagents/runner.ts`
  - **新增**: `src/tools/executor/handlers/taskSubAgent.ts` (实现 `Task` 工具的 `ToolHandler`)
- **验收标准**：
  - `createToolExecutor([new LocalToolHandler(), new TaskSubAgentHandler()])` 可以创建一个能同时处理本地命令和 `Task` 命令的执行器。
  - `SubAgentRegistry` 能正确加载并解析 `.md` 文件。
  - `SubAgentRunner` 的单元测试通过，能验证其上下文隔离和工具白名单的逻辑。

#### 阶段 3：打造新的聊天引擎 (P2)

- **目标**：创建新的 `StreamClient` 和 `ChatEngine`，彻底取代旧 streaming client。
- **文件清单**：
  - **新增**: `src/streaming/anthropic/StreamClient.ts` (一个全新的、干净的实现，依赖 `RuntimeConfig` 和 logger)
  - **新增**: `src/chat/engine.ts` (实现 `ChatEngine` 接口，编排 `StreamClient` 和 `ToolExecutor`)
- **验收标准**：
  - `ChatEngine` 的集成测试通过，能够模拟一次完整的 `runTurn`，包括多轮工具调用。
  - 新的 `StreamClient` 完全解耦了日志和配置的硬编码。

#### 阶段 4：UI 迁移与清理 (P3)

- **目标**：将 REPL UI 迁移到新的聊天引擎，并彻底删除旧代码。
- **文件清单**：
  - **新增**: `src/features/repl/useReplController.ts`
  - **修改**: `src/screens/REPL.tsx` (完全依赖 `useReplController`)
  - **修改**: `src/entrypoints/cli.tsx` (完成所有新模块的依赖注入)
  - **删除**: 旧实现目录（已完成）
- **验收标准**：
  - REPL 所有功能恢复，表现与重构前一致。
  - `Task` 工具能够被成功调用和渲染。
  - 项目中不再存在对旧实现目录的任何引用。

#### 方案 B 总结

- **替换/保留**：旧实现目录被完全删除和替换。
- **优点**：架构清晰，边界明确，高度可扩展，可测试性强，完全符合 `codex.md` 的长期愿景。
- **缺点**：初期工作量更大，迁移周期更长，需要小步快跑、保证每个阶段的测试覆盖。

---

### 方案取舍与建议

| 维度 | 方案 A (保守) | 方案 B (进取) | 推荐 |
| :--- | :--- | :--- | :--- |
| **开发速度** | 快，预计 2-3 天 | 慢，预计 5-8 天 | 方案 A |
| **代码质量** | 中，技术债未完全偿还 | 高，架构清晰 | 方案 B |
| **可扩展性** | 有限，添加新工具类型仍需修改 `switch` | 极高，插件式 `ToolHandler` | 方案 B |
| **风险** | 低，改动范围小 | 中，需要完整的测试覆盖确保无功能退化 | 方案 A |
| **团队能力要求** | 低 | 高，需要对分层和 DI 有深入理解 | - |

**我的推荐：**

如果**时间紧迫**，目标是尽快让 `Task` sub-agent 功能上线，我推荐**方案 A**。它是一个务实的、风险较低的选择，可以在短期内解决核心问题。后续可以再规划一次重构，将 `ToolExecutor` 彻底插件化。

如果团队追求**长期的架构健康度**和**可维护性**，并且有足够的时间和测试资源，我强烈推荐**方案 B**。这是一次“正确的”重构，虽然阵痛期更长，但它为项目未来的所有功能扩展（更多 sub-agent、更多工具、甚至替换 LLM 后端）打下了坚实的基础。**从“架构师”的视角出发，方案 B 是更优的选择。**

---

## C. Sub-agent 设计落地

本节将详细阐述如何具体实现 Claude Code 风格的 Sub-agent，无论选择方案 A 还是 B，这部分的设计都是共通的。

### 1. `.md` 规范 (Markdown + YAML frontmatter)

Sub-agent 的定义将存放在 `.agent/subagents/` 目录下，每个文件代表一个可用的 Sub-agent。

**文件路径示例**: `.agent/subagents/code-reviewer.md`

**文件格式**:

```markdown
---
name: code-reviewer
description: An expert code reviewer that analyzes code for quality, security, and best practices. Use this for reviewing specific files or pull requests.
tools:
  - Read
  - Glob
  - Grep
---

You are an expert senior software engineer acting as a code reviewer. Your sole purpose is to analyze the provided code and return a concise summary of your findings. 

**IMPORTANT RULES:**
1.  Your response MUST be a brief summary of your findings, under 500 characters.
2.  Do NOT include conversational fluff. Get straight to the point.
3.  If you identify multiple files of interest, list their paths in the `artifacts` field.
4.  Focus on code quality, security vulnerabilities, performance bottlenecks, and maintainability.
```

- **YAML Frontmatter**:
  - `name` (string, required): Sub-agent 的唯一标识符，将用于 `Task` 工具的 `subagent_type` 输入。
  - `description` (string, required): 在主会话中，用于帮助主 Agent 理解此 Sub-agent 的用途，以便在合适的时机选择它。
  - `tools` (string[], required): 工具白名单。此 Sub-agent 在运行时只能访问这个列表中的工具。
- **Body (Markdown)**:
  - 文件剩余部分将作为该 Sub-agent 的 **System Prompt**。这里是指导 Sub-agent 行为、角色和输出格式的核心区域。必须明确指示它输出摘要。

**依赖说明**: 需要引入一个 YAML 解析库来处理 frontmatter。`gray-matter` 是一个轻量级且广泛使用的选择，它能同时解析 frontmatter 和 body 内容。或者，可以手动编写一个简单的正则表达式解析器来避免引入新依赖，但健壮性稍差。

### 2. `SubAgentRegistry` 与 `SubAgentRunner`

#### `SubAgentRegistry`: 加载与查询中心

**职责**: 负责从文件系统加载、解析和管理所有可用的 Sub-agent 配置。

**接口签名 (`src/subagents/registry.ts`)**:

```typescript
import type { SubAgentConfig } from './types';

export interface SubAgentRegistry {
  /**
   * 从指定目录加载所有 *.md Sub-agent 定义
   * @param dir - The directory to scan for .md files.
   */
  loadFromDirectory(dir: string): Promise<void>;

  /**
   * 根据名称获取单个 Sub-agent 配置
   * @param name - The name of the sub-agent (from YAML frontmatter).
   */
  get(name: string): SubAgentConfig | undefined;

  /**
   * 列出所有已加载的 Sub-agent 的基本信息（用于帮助主 Agent 选择）
   */
  list(): Array<{ name: string; description: string }>;
}

// 实现细节：内部使用 Map<string, SubAgentConfig> 存储
// loadFromDirectory 会使用 fs.readdir 遍历目录，对每个 .md 文件使用 gray-matter 解析
```

#### `SubAgentRunner`: 隔离的执行环境

**职责**: 接收一个 Sub-agent 配置和任务描述，在一个完全隔离的环境中执行它，并返回一个结构化的摘要结果。

**接口签名 (`src/subagents/runner.ts`)**:

```typescript
import type { SubAgentConfig, SubAgentResult } from './types';
import type { ChatEngine } from '../chat/engine'; // 方案 B
import type { StreamClient } from '../streaming/anthropic/StreamClient'; // 方案 A/B
import type { ToolDefinition } from '../tools/types';

// Runner 的依赖
interface SubAgentRunnerDependencies {
  // 方案 B: 传入一个预配置好的 engine 实例
  engine: ChatEngine;
  // 方案 A: 直接传入底层的 client
  // client: StreamClient;
  // toolExecutor: ToolExecutor; // 方案 A 需要
  
  // 传入所有已加载的工具定义，以便进行白名单过滤
  allTools: ToolDefinition[];
}

export interface SubAgentRunner {
  /**
   * 运行一个 Sub-agent 任务
   * @param args
   */
  run(args: {
    agentConfig: SubAgentConfig;
    prompt: string; // The user's task/prompt for the sub-agent
    signal?: AbortSignal;
  }): Promise<SubAgentResult>;
}
```

### 3. `TaskSubAgentToolHandler`: 将 Sub-agent 作为工具

**职责**: 实现 `ToolHandler` 接口，专门处理名为 `Task` 的工具调用。它作为桥梁，将主会话中的 `Task` tool-call 转换为一次 `SubAgentRunner` 的执行。

**接口签名 (`src/tools/executor/handlers/taskSubAgent.ts`)**:

```typescript
import type { ToolHandler, ToolCall, ToolResult } from '../../types';
import type { SubAgentRegistry } from '../../../subagents/registry';
import type { SubAgentRunner } from '../../../subagents/runner';

interface TaskSubAgentHandlerDependencies {
  registry: SubAgentRegistry;
  runner: SubAgentRunner;
}

export class TaskSubAgentToolHandler implements ToolHandler {
  private readonly deps: TaskSubAgentHandlerDependencies;

  constructor(deps: TaskSubAgentHandlerDependencies) {
    this.deps = deps;
  }

  canHandle(name: string): boolean {
    return name === 'Task';
  }

  async execute(call: ToolCall, ctx: { signal?: AbortSignal }): Promise<ToolResult> {
    // 1. 校验输入
    const { subagent_type, prompt, description } = call.input;
    if (typeof subagent_type !== 'string' || typeof prompt !== 'string') {
      return { tool_use_id: call.id, content: 'Error: Missing required fields subagent_type or prompt.', is_error: true };
    }

    // 2. 从 Registry 获取 Sub-agent 配置
    const agentConfig = this.deps.registry.get(subagent_type);
    if (!agentConfig) {
      return { tool_use_id: call.id, content: `Error: Sub-agent type \'${subagent_type}\' not found.`, is_error: true };
    }

    // 3. 调用 Runner 执行
    try {
      const result = await this.deps.runner.run({
        agentConfig,
        prompt,
        signal: ctx.signal,
      });

      // 4. 格式化结果为 ToolResult
      const content = result.success 
        ? result.summary 
        : `Sub-agent failed: ${result.error}`;
      
      // 将 artifacts 序列化到 content 中，或设计新的 ToolResult 结构
      const finalContent = result.artifacts && result.artifacts.length > 0
        ? JSON.stringify({ summary: content, artifacts: result.artifacts })
        : content;

      return {
        tool_use_id: call.id,
        content: finalContent,
        is_error: !result.success,
      };
    } catch (e) {
      return { tool_use_id: call.id, content: `Error executing sub-agent: ${e.message}`, is_error: true };
    }
  }
}
```

### 4. 核心约束实现

这是确保 Sub-agent 行为正确的关键。

1.  **隔离上下文 (Isolated Context)**
    - **在哪里做**: `SubAgentRunner.run()` 方法内部。
    - **如何实现**: 在调用 `ChatEngine.runTurn` (方案 B) 或 `StreamClient.streamChat` (方案 A) 时，**必须**传入一个全新的、只包含当前任务 `prompt` 的 `history` 数组。**严禁**将主会话的 `history` 传入。
      ```typescript
      // In SubAgentRunner.run
      const initialHistory = []; // Or whatever the engine expects for a new session
      const userMessage = { role: 'user', content: buildUserContent(prompt) };
      
      await this.deps.engine.runTurn({
        history: initialHistory, // <-- 关键：空的 history
        user: userMessage,
        system: buildSystemPrompt(agentConfig.systemPrompt),
        // ... other args
      });
      ```

2.  **工具白名单 (Tool Whitelist)**
    - **在哪里做**: `SubAgentRunner.run()` 和 `ToolExecutor` (方案 B) / `runLocalTool` (方案 A)。
    - **如何实现 (两层防御)**:
      1.  **模型输入层**: 在 `SubAgentRunner` 中，从 `allTools` 中根据 `agentConfig.tools` 白名单进行过滤，只将允许的 `ToolDefinition[]` 传递给 `engine.runTurn` 的 `tools` 参数。这是第一道防线，防止模型看到或尝试调用未授权的工具。
          ```typescript
          // In SubAgentRunner.run
          const allowedTools = this.deps.allTools.filter(t => 
            agentConfig.tools.includes(t.name)
          );
          // ...
          await this.deps.engine.runTurn({ tools: allowedTools, ... });
          ```
      2.  **执行器层**: 在 `ToolExecutor` (或 `LocalToolHandler`/`TaskSubAgentToolHandler`) 的 `execute` 方法中，增加一道校验。即使模型“幻觉”般地调用了一个不在白名单内的工具，执行器也应拒绝执行。这需要 `execute` 方法能接收到当前生效的白名单。
          *方案 B 的实现会更优雅，`ChatEngine` 可以将白名单工具列表透传给 `ToolExecutor`。*

3.  **禁止嵌套 (No Nesting)**
    - **在哪里做**: `SubAgentRunner.run()` 的工具白名单过滤逻辑中。
    - **如何实现**: 在向 `engine.runTurn` 传递 `tools` 列表之前，**强制**从 `allowedTools` 数组中剔除名为 `Task` (或 `Agent`, `Dispatch` 等未来可能出现的同类工具) 的工具定义。这是最简单、最可靠的实现方式。
      ```typescript
      // In SubAgentRunner.run, after filtering by whitelist
      const nonNestableTools = allowedTools.filter(t => t.name !== 'Task');
      
      await this.deps.engine.runTurn({ tools: nonNestableTools, ... });
      ```

4.  **只返回摘要 (Summary-only Return)**
    - **在哪里做**: `SubAgentRunner.run()` 的结果处理部分，以及 `TaskSubAgentToolHandler.execute()` 的格式化部分。
    - **如何实现**:
      1.  Sub-agent 的 **System Prompt** (`.md` 文件 body) 必须明确指示模型只输出摘要，并提供格式要求（如字数限制）。
      2.  `SubAgentRunner` 在收到 `engine.runTurn` 的最终 assistant 回复后，将其内容作为 `SubAgentResult.summary`。
      3.  `TaskSubAgentToolHandler` 在收到 `SubAgentResult` 后，将 `summary` 作为 `ToolResult.content` 的主要部分。如果 `summary` 过长（例如，超过 500 字符），可以在这里进行硬截断，并附上提示 `... (truncated)`，以保证主会话的上下文不会被污染。
      4.  **Artifacts 处理**: 对于文件列表等结构化产物，Sub-agent 的 prompt 应指导它使用特定格式输出（如 `Artifacts: ["path1", "path2"]`）。`SubAgentRunner` 可以用正则或简单的解析器提取这部分内容，放入 `SubAgentResult.artifacts` 数组。最终 `TaskSubAgentToolHandler` 可以选择将 `summary` 和 `artifacts` 一起 JSON 序列化后放入 `ToolResult.content`，这样主 Agent 就能同时获得摘要和结构化产物。
          ```typescript
          // In TaskSubAgentToolHandler.execute
          const result = await this.deps.runner.run(...);
          let finalContent = result.summary;

          if (result.artifacts && result.artifacts.length > 0) {
            finalContent = JSON.stringify({ 
              summary: result.summary.slice(0, 500), // Hard limit
              artifacts: result.artifacts 
            }, null, 2);
          }
          
          return { tool_use_id: call.id, content: finalContent, ... };
          ```

---

## D. 核心接口与 wiring 示例

本节提供方案 B（进取/可扩展方案）的核心 TypeScript 接口签名和在入口点 `cli.tsx` 中组装依赖的示例流程。

### 1. 核心模块接口签名

```typescript
// src/env/config.ts
export interface RuntimeConfig {
  llm: {
    provider: 'anthropic';
    baseUrl: string;
    apiKey: string;
    model: string;
    timeoutMs: number;
  };
  paths: {
    toolsJsonPath: string;
    logsDir: string;
    subagentsDir: string;
  };
}
export function loadRuntimeConfig(env?: NodeJS.ProcessEnv, cwd?: string): RuntimeConfig;

// src/prompts/types.ts (或直接在 index.ts)
export type PromptBlock =
  | { type: 'text'; text: string; cache_control?: { type: 'ephemeral' } }
  | { type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean }
  | { type: 'tool_use'; id: string; name: string; input: unknown };

// src/tools/types.ts
export interface ToolDefinition {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}
export interface ToolCall { id: string; name: string; input: Record<string, unknown> }
export interface ToolResult { tool_use_id: string; content: string; is_error?: boolean }

// src/tools/executor/index.ts
export interface ToolHandler {
  canHandle(name: string): boolean;
  execute(call: ToolCall, ctx: { cwd: string; signal?: AbortSignal }): Promise<ToolResult>;
}
export type ToolExecutor = (call: ToolCall, ctx: { cwd: string; signal?: AbortSignal }) => Promise<ToolResult>;
export function createToolExecutor(handlers: ToolHandler[]): ToolExecutor;

// src/streaming/types.ts
export type StreamEvent =
  | { type: 'assistant_delta'; text: string }
  | { type: 'tool_start'; id: string; name: string; input: unknown }
  | { type: 'tool_end'; id: string; result: ToolResult }
  | { type: 'error'; error: Error }
  | { type: 'complete'; finalHistory: ChatHistory };
export type StreamSink = (ev: StreamEvent) => void;

// src/chat/engine.ts
export type ChatMessage = { role: 'user' | 'assistant'; content: PromptBlock[] };
export type ChatHistory = ChatMessage[];

export interface ChatEngine {
  runTurn(args: {
    history: ChatHistory;
    userMessage: ChatMessage;
    systemPrompt: PromptBlock[];
    tools: ToolDefinition[];
    onEvent: StreamSink;
    signal?: AbortSignal;
    cwd: string;
  }): Promise<ChatHistory>; // 返回包含本次交互的完整新 history
}

export function createChatEngine(deps: {
  client: StreamClient; // 底层 LLM 通信客户端
  executor: ToolExecutor; // 工具执行器
}): ChatEngine;

// src/streaming/anthropic/StreamClient.ts
// (这是 ChatEngine 依赖的底层客户端，负责实际的 fetch 和 SSE 解析)
export interface StreamClient {
  runTurn(args: {
    messages: ChatMessage[];
    system: PromptBlock[];
    tools: ToolDefinition[];
    onEvent: StreamSink; // 注意：这里的 onEvent 可能更底层，只包含 SSE 事件
    executeTool: ToolExecutor; // 或者直接在这里执行工具
    signal?: AbortSignal;
    cwd: string;
  }): Promise<void>;
}
```

### 2. `cli.tsx` 依赖注入 (Wiring) 流程

这是将所有解耦的模块组装在一起并注入 UI 的核心步骤。它清晰地展示了依赖关系和控制流。

```typescript
// src/entrypoints/cli.tsx

import React from 'react';
import { render } from 'ink';
import { REPL } from '../screens/REPL';

// 1. 配置加载
import { loadRuntimeConfig } from '../env/config';

// 2. 工具链
import { loadToolDefinitions } from '../tools/loader';
import { createToolExecutor } from '../tools/executor';
import { LocalToolHandler } from '../tools/executor/handlers/local';
import { TaskSubAgentToolHandler } from '../tools/executor/handlers/taskSubAgent';

// 3. Sub-agent 链
import { createSubAgentRegistry } from '../subagents/registry';
import { createSubAgentRunner } from '../subagents/runner';

// 4. 聊天引擎链
import { createChatEngine } from '../chat/engine';
import { AnthropicStreamClient } from '../streaming/anthropic/StreamClient';

// 5. UI 控制器
import { useReplController } from '../features/repl/useReplController';

async function main() {
  // ======================================================
  // 1. 实例化所有依赖 (The "Wiring" part)
  // ======================================================

  const cwd = process.cwd();
  
  // (A) 加载配置
  const config = loadRuntimeConfig(process.env, cwd);

  // (B) 加载工具定义
  const allTools = await loadToolDefinitions({ filePath: config.paths.toolsJsonPath });

  // (C) 实例化 Sub-agent 相关模块
  const subAgentRegistry = createSubAgentRegistry();
  await subAgentRegistry.loadFromDirectory(config.paths.subagentsDir);
  
  // (D) 实例化聊天引擎和其依赖
  const streamClient = new AnthropicStreamClient(config.llm); // 注入 LLM 配置
  
  // (E) 实例化完整的工具执行器 (包含 Task handler)
  // 注意：SubAgentRunner 依赖 ChatEngine，但 ChatEngine 又依赖 ToolExecutor，
  // 而 ToolExecutor 的 TaskHandler 又依赖 SubAgentRunner。这里存在循环依赖。
  // 解决方案：延迟注入或使用事件总线。这里用一个简单的延迟注入。
  
  const runnerDeps = {
      engine: undefined as any, // 稍后注入
      allTools,
  };
  const subAgentRunner = createSubAgentRunner(runnerDeps);
  
  const taskHandler = new TaskSubAgentToolHandler({ 
    registry: subAgentRegistry, 
    runner: subAgentRunner 
  });
  const localHandler = new LocalToolHandler();
  const toolExecutor = createToolExecutor([taskHandler, localHandler]);

  const chatEngine = createChatEngine({ 
    client: streamClient, 
    executor: toolExecutor 
  });
  
  // 回填循环依赖
  runnerDeps.engine = chatEngine;

  // (F) 准备注入给 UI 的顶层依赖
  const replDependencies = {
    engine: chatEngine,
    tools: allTools,
    config,
    cwd,
  };

  // ======================================================
  // 2. 渲染 UI，注入依赖
  // ======================================================

  // REPLWrapper 负责将依赖传递给 useReplController，然后传递给 REPL
  const App = () => {
    // useReplController 现在从 props 或 context 获取依赖，而不是直接调用
    const controller = useReplController(replDependencies);
    return <REPL {...controller} onExit={() => process.exit(0)} />;
  };

  render(<App />, { exitOnCtrlC: false });
}

main().catch(console.error);
```

---

## E. 风险与回归建议

### 1. 最可能被破坏的点

1.  **流式 UI 状态**：`REPL.tsx` 中目前通过多个 `useState` 和在回调中 `setMessages` 的复杂逻辑来处理工具消息的“运行中”、“已完成”、“错误”等状态，以及 assistant 文本的流式追加。将此逻辑迁移到 `useReplController` 时，很容易破坏消息的实时更新、顺序或最终状态，导致 UI 显示错乱、重复或丢失消息。

2.  **AbortController 信号传递**：`Ctrl+C` 中断逻辑贯穿了 `REPL -> StreamClient -> fetch`。在新的分层中，必须确保 `signal` 从 `useReplController` 被正确传递到 `ChatEngine`，再到 `StreamClient` 和 `ToolExecutor`，任何一环断裂都会导致中断功能失效。

3.  **工具执行与回调时序**：`StreamClient` 中，工具的执行（`executeToolFn`）和 SSE 事件的解析是并发进行的。重构时必须小心处理 `Promise` 的创建和 `await` 时机，确保 `tool_end` 事件总是在工具执行完毕后才发出，并且 `tool_result` 能正确地插入到下一轮的 `messages` 历史中。

### 2. 回归验证策略

在每个阶段完成后，执行以下手动回归测试：

- **简单问答**：输入一个不需要工具的问题，验证 assistant 能否正常流式输出文本。
- **单工具调用**：执行一个 `ls -l` (`Bash` 工具)，验证 `ToolMessage` 能否正确显示“运行中”状态，然后更新为“已完成”和结果摘要。
- **多工具调用**：给出一个需要多步（如 `Glob` -> `Read`）才能完成的任务，验证多条 `ToolMessage` 能否按顺序正确渲染。
- **错误处理**：调用一个会失败的工具（如 `Read` 一个不存在的文件），验证 `ToolMessage` 能否显示为“错误”状态，并且 assistant 能否基于错误信息继续思考。
- **中断操作**：在 assistant 或工具正在“运行中”时按 `Ctrl+C`，验证程序能否立即退出或停止当前任务。
- **/init 命令**：运行 `/init` 命令，验证其特殊提示词和行为是否与之前保持一致。
- **Task 工具测试**：在实现了 `Task` 工具后，专门测试调用一个 Sub-agent，验证其能独立运行并返回摘要，且主会话的 `ToolMessage` 正确显示。

### 3. 建议补充的测试

除了现有的 `REPL.test.tsx`，建议补充以下单元/集成测试：

1.  **`prompts/*.test.ts`**: 对每个 `build*Prompt` 函数进行快照测试，确保输出的 `PromptBlock[]` 结构符合预期。
2.  **`env/config.test.ts`**: 测试 `loadRuntimeConfig` 在不同环境变量组合下的输出是否正确，特别是对 `baseURL` 的归一化处理。
3.  **`subagents/registry.test.ts`**: Mock `fs` 模块，测试 `SubAgentRegistry` 能否正确读取、解析 `.md` 文件（包括 frontmatter 和 body），并处理文件不存在或格式错误的边界情况。
4.  **`tools/executor/handlers/taskSubAgent.test.ts`**: Mock `SubAgentRegistry` 和 `SubAgentRunner`，测试 `TaskSubAgentToolHandler` 在接收到合法的和非法的 `Task` tool-call 输入时，能否返回正确的 `ToolResult`。
5.  **`chat/engine.test.ts` (集成测试)**: 这是最重要的测试。Mock `StreamClient` 和 `ToolExecutor`，测试 `ChatEngine.runTurn` 的核心编排逻辑。例如：
    - 验证当 `StreamClient` 返回 `stop_reason: 'tool_use'` 时，`ToolExecutor` 是否被调用。
    - 验证 `ToolExecutor` 的结果是否被正确格式化并添加到下一轮 `StreamClient` 调用的 `messages` 历史中。
    - 验证当 `stop_reason` 不是 `tool_use` 时，循环是否正确终止。

### 4. 依赖约束说明

关于引入 `gray-matter` 的建议：

- **收益**: 它是专门用于解析带有 YAML frontmatter 的文件的库，非常成熟、健壮，能优雅地处理各种边界情况（如不同的分隔符、空的 frontmatter 等）。这将使 `SubAgentRegistry` 的实现变得非常简单和可靠。
- **替代方案**: 手动编写一个基于正则表达式的解析器。例如，`const match = body.match(/^---\n([\s\S]+?)\n---\n([\s\S]*)/);`。这可以避免增加新依赖，但需要自己处理 YAML 的解析（如果 frontmatter 变复杂则很困难），且正则表达式的维护成本更高。
- **体积/风险**: `gray-matter` 体积很小，无其他依赖，是一个非常安全的开发时依赖，对最终构建产物体积无影响。
- **结论**: 强烈建议引入 `gray-matter`，其带来的健壮性和开发效率远超“零依赖”的约束。这是一个合理的工程权衡。
