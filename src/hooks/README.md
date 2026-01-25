# src/hooks

Formax 的 Claude Code 风格 hooks 子系统：在“关键时机”运行本地脚本（`type: command`），并把结果用于审计/调试/（可选）影响下一轮模型上下文。

> 原则：**稳定优先**。新增 hook 事件必须可回滚、可测试、且不改变既有 UI 文案/交互（除非明确要求）。

## 现状（已接线）

这些事件已接入主流程（会被实际调用）：

- `PreToolUse`：tool handler 执行前（工具执行链路）
- `PermissionRequest`：审批 UI 前（工具执行链路）
- `PostToolUse`：tool 执行后（工具执行链路；支持 `additionalContext` 注入下一次模型请求）
- `UserPromptSubmit`：用户提交消息后、当轮首次 LLM 请求前（ChatEngine；支持 `additionalContext` 一次性注入当轮首次请求；Phase 1 不允许 block）
- `SessionStart`：会话启动/恢复时（ChatEngine；支持 `additionalContext` 一次性注入当轮首次请求；Phase 1 不允许 block）

### matcher-less 事件（重要）

在 Claude Code 文档里，像 `UserPromptSubmit` / `SessionStart` 这种事件可以省略 `matcher` 字段。
Formax 也按这个语义实现：

- **运行时**：matcher-less 事件总是视为 `*`（match all），即使 settings 里写了 `matcher` 也会被忽略
- **配置落盘**：matcher-less 事件在 `.formax/settings*.json` 里不会写入 `matcher` 字段（与 Claude Code 示例一致）
- **UI**：matcher-less 事件不会出现 “Matchers/Tool Matchers” 页面，也不会显示 “Matcher:” 行

## 新增一个 hook 事件：标准步骤

> 目标：每次新增事件，都走同一套“改哪些文件/补哪些测试/跑哪些检查”的流程，避免漏改。

### 1) 类型定义

- `src/hooks/types.ts`
  - 扩展 `HookEventName`
  - 扩展 `MergedHooks`（每个 event 一条数组）

### 2) 配置加载 + 合并 + matcher 语义

- `src/hooks/store.ts`
  - 解析 settings / 合并三层（`user`/`project`/`projectLocal`）
  - 决定该事件是否需要 matcher（例如 tool 类事件需要，session 类事件一般不需要）
- `src/hooks/store.test.ts`
  - 增补解析/合并/排序/“缺省 matcher”语义的测试

### 3) runtime：payload + 执行 + stdout 解析

- `src/hooks/runtime.ts`
  - 构造 payload（**给脚本的参数**；snake_case 兼容 Claude Code）
  - 加 `runXxx(...)` 入口（返回 `runs[]` + `additionalContext[]` + `blocked` 等）
  - 明确 exit code 语义（是否允许 block）
- `src/hooks/runtime.test.ts`
  - 覆盖：
    - `exitCode=2` 语义（是否阻断）
    - `stdout` JSON（camelCase / snake_case）解析 `additionalContext`
    - 非 JSON stdout 是否作为 `additionalContext` 注入（如适用）

### 4) 接线到主流程（必须）

两条典型入口：

- **工具执行链**：`src/tools/executor/index.ts`
  - 对 `PreToolUse / PermissionRequest / PostToolUse`
- **对话/模型调用链**：`src/chat/engine.ts`
  - 对 `UserPromptSubmit` 以及“只影响模型上下文、不属于 tool”的事件

并在相应测试里补齐 HooksRuntime mock：

- `src/chat/engine.test.ts`
- `src/tools/executor/index.test.ts`
- `src/tools/executor/policyPreflight.test.ts`

### 5) UI（如需要）

仅在 UI 需要展示/选择事件时修改：

- `src/ui/hooks/constants.ts`：事件列表/启用开关
- `src/ui/hooks/HooksDialog.tsx`：不支持事件的提示文案（保持准确，不要改风格）
- `src/ui/hooks/HooksDialog.test.tsx`：锁定 UI 文案/事件列表（避免回归）

### 6) 验证与交付

每次都跑：

- `bun run type-check`
- `bun run test`
- `codex review --uncommitted`
- 提交 commit（Conventional Commit）

## 关键文件速查

- 类型：`src/hooks/types.ts`
- 配置：`src/hooks/store.ts`
- 执行：`src/hooks/runner.ts`、`src/hooks/runtime.ts`
- 匹配：`src/hooks/matcher.ts`
- 审计：`src/hooks/audit.ts`
