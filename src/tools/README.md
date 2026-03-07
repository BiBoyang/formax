# src/tools

Status: Informative deep dive.

Canonical docs:
- [docs/contracts/semantics-contract.md](../../docs/contracts/semantics-contract.md)
- [docs/contracts/tool-runtime-contract.md](../../docs/contracts/tool-runtime-contract.md)
- [docs/contracts/prompt-tool-exposure-contract.md](../../docs/contracts/prompt-tool-exposure-contract.md)
- [docs/contracts/interactive-input-contract.md](../../docs/contracts/interactive-input-contract.md)
- [docs/contracts/permissions-policy-contract.md](../../docs/contracts/permissions-policy-contract.md)
- [docs/contracts/hooks-contract.md](../../docs/contracts/hooks-contract.md)

本文件用于代码近侧说明、扩展路径和调试提示；涉及稳定工具执行顺序、`ToolSearch` runtime、`ToolResult` / `CommandResult` 边界、用户输入语义、权限规则或 hooks 交互时，先更新上面的 canonical docs。

Last verified: 2026-03-07

## 1) 作用（What）

工具系统核心：提供 tool 注册、加载、执行与渲染的完整管道。

- **做什么**：
  - Registry（注册表）：集中管理 tool 的 handler、presenter、spec 和元数据
  - Executor（执行器）：路由工具调用、校验 allow/deny list、分发给 handler 执行
  - Runtime（运行时）：管理后台任务（TaskManager）和用户输入请求（UserInputManager）
  - Presenter（呈现器）：为每个工具提供 Ink UI 渲染组件
- **不做什么**：
  - 不处理 streaming 解析（由 `streaming/` 负责）
  - 不持久化工具状态（执行完即结束，状态由上层 chat loop 管理）
  - 不定义 subagent 运行逻辑（由 `features/subagents/` 负责）

## 2) 入口（Entry points）

| 入口                | 说明                                  |
| ------------------- | ------------------------------------- |
| `registry.ts`       | ToolRegistry 类，注册并查询工具       |
| `executor/index.ts` | createToolExecutor 工厂，返回执行函数 |

上层 chat engine (`src/chat/engine.ts`) 在初始化时：

1. 从 registry 获取 handlers → 传给 executor
2. 从 registry 获取 specs → 传给 streaming client

## 3) 流程（Flow）

```mermaid
flowchart LR
    A[ToolModule<br/>spec/handler/presenter] -->|register| B[ToolRegistry]
    B -->|getHandlers| C[createToolExecutor]
    B -->|listSpecs| D[StreamClient]
    D -->|tool_use_id| C
    C -->|canHandle→execute| E[ToolHandler]
    E -->|ToolResult| D
    B -->|getPresenter| F[ToolMessage UI]
```

1. 启动时 `modules/*/index.ts` 调用 `registry.register(module)`
2. Chat engine 用 `registry.listSpecs()` 把工具定义发给 LLM
3. LLM 返回 tool_use 时 StreamClient 调用 executor
4. Executor 检查 allow/deny list → 找 handler → 执行
5. 结果通过 `onEvent({ type:'tool_end', result })` 上报 UI
6. Presenter 渲染该工具的执行状态

## 4) 边界与约束（Boundaries / Invariants）

稳定边界先看 [docs/contracts/tool-runtime-contract.md](../../docs/contracts/tool-runtime-contract.md)：

- executor gate 顺序、subagent deny set、soft-fallback ToolSearch
- `ToolResult` block 形状与 `tool_reference` 使用规则
- tools pipeline 与 slash-command `CommandResult` 的职责分层

本 README 只保留 contributor heuristics：

- 新增 tool module 到 `modules/` 并在 registry 注册
- handler 可异步、可请求用户输入（通过 `UserInputManager`）、可创建后台任务（通过 `TaskManager`）
- handler 不直接操作 overlay / command-subline UI；这些属于 slash-command pipeline
- presenter 负责渲染，不承担副作用或协议定义
- deferred `ToolSearch` 的“何时暴露给模型”看 prompt/tool exposure 合同，不在这里重复

## 5) 如何扩展（How to extend）

### 新增一个 tool

1. 创建 `modules/<name>/spec.ts`（工具定义）、`handler.ts`（执行逻辑）、`presenter.tsx`（UI）、`index.ts`（导出 ToolModule）
2. 在 `index.ts` 中 export `createXToolModule()` 工厂
3. 在 `registry.ts` 文件底部调用 `registry.register(createXToolModule())`
4. 验证：`bun run tools:coverage` 检查覆盖率

### 给工具添加审批流程

1. Handler 调用 `userInputManager.requestAnswers(...)` 返回 Promise
2. UI 层（如 `editApprovalPrompt.tsx`）监听 pending 状态并渲染选项
3. 用户选择后调用 `userInputManager.submitAnswers(...)`

### 添加后台长任务

1. Handler 调用 `taskManager.create({ run: ... })` 返回 taskId
2. 立即返回 `ToolResult`，告知 LLM taskId
3. 后续用 TaskOutput 工具查询/取消该任务

## 6) 常见坑 & 排查（Pitfalls / Debug）

| 现象                                        | 优先检查                                                   | 命令                                                    |
| ------------------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------- |
| LLM 调用工具但返回 "Tool X not implemented" | `executor/index.ts` NESTED_DENY_TOOLS + handler canHandle  | `bun run type-check`                                    |
| Spec/Handler 名称不一致导致漏执行           | `SPEC_HANDLER_MISMATCHES.md` 文档 + `bun run tools:parity` | `bun run tools:parity`                                  |
| 用户输入卡住（Promise 未 resolve）          | `runtime/userInputManager.ts` pending map                  | -                                                       |
| 后台任务执行后结果丢失                      | `runtime/taskManager.ts` 任务是否 resolveDone              | `bun run test -- src/tools/runtime/taskManager.test.ts` |
| Presenter 报错导致 UI 崩溃                  | `../components/tool/FallbackToolPresenter.tsx` 兜底渲染    | -                                                       |
| allow/deny list 不生效                      | `executor/index.ts` normalizeCtx 检查                      | `bun run test -- src/tools/executor`                    |

## 7) 相关链接（Repo links）

- [CODEMAP.md#tools-registry--loader](../../CODEMAP.md#tool-registry--loader)
- [CODEMAP.md#tool-execution-pipeline](../../CODEMAP.md#tool-execution-pipeline)
- [CODEMAP.md#tool-ui--presenters](../../CODEMAP.md#tool-ui--presenters)
- [SPEC_HANDLER_MISMATCHES.md](./SPEC_HANDLER_MISMATCHES.md)
- [STATUS.md](./STATUS.md)
