# Hooks Payload Reference

本文件记录 Formax hooks runtime 传给脚本的 stdin payload 形状，以及 runtime 解析 stdout 的 reference 行为。

规范性事实源见：`docs/contracts/hooks-contract.md`。

## 1. 公共约定

1. payload 通过 stdin 以 JSON object 传递。
2. 字段命名默认使用 snake_case。
3. command hook 的工作目录是当前 runtime `cwd`。
4. runtime 额外注入：
   - `CLAUDE_PROJECT_DIR`
   - `FORMAX_PROJECT_DIR`

## 2. Event Payloads

### 2.1 `PreToolUse`

```json
{
  "hook_event_name": "PreToolUse",
  "tool_name": "Bash",
  "tool_input": {
    "command": "pwd"
  },
  "cwd": "/abs/project"
}
```

### 2.2 `PermissionRequest`

```json
{
  "hook_event_name": "PermissionRequest",
  "tool_name": "Bash",
  "tool_input": {
    "command": "rm -rf tmp"
  },
  "cwd": "/abs/project"
}
```

### 2.3 `PostToolUse`

```json
{
  "hook_event_name": "PostToolUse",
  "tool_name": "Bash",
  "tool_input": {
    "command": "pwd"
  },
  "tool_response": {
    "tool_use_id": "tool-1",
    "content": "/abs/project\n"
  },
  "cwd": "/abs/project"
}
```

### 2.4 `UserPromptSubmit`

```json
{
  "hook_event_name": "UserPromptSubmit",
  "prompt": "帮我看下这个错误",
  "cwd": "/abs/project",
  "permission_mode": "default"
}
```

### 2.5 `SessionStart`

```json
{
  "session_id": "session-123",
  "hook_event_name": "SessionStart",
  "source": "resume",
  "cwd": "/abs/project",
  "permission_mode": "default"
}
```

`source` 当前可能值：
1. `startup`
2. `clear`
3. `resume`
4. `compact`

### 2.6 `Stop`

```json
{
  "session_id": "session-123",
  "hook_event_name": "Stop",
  "stop_hook_active": false,
  "cwd": "/abs/project",
  "permission_mode": "default"
}
```

## 3. Stdout JSON 解析

### 3.1 camelCase 形式

```json
{
  "hookSpecificOutput": {
    "hookEventName": "PostToolUse",
    "additionalContext": "CTX_FROM_HOOK"
  }
}
```

### 3.2 snake_case 形式

```json
{
  "hook_specific_output": {
    "hook_event_name": "PostToolUse",
    "additional_context": "CTX_FROM_HOOK"
  }
}
```

解析规则：
1. 只有 `hookEventName` / `hook_event_name` 与当前事件一致时才接受。
2. `additionalContext` / `additional_context` 必须是非空字符串。
3. 非 JSON stdout 不会生成 `parsedJson`。

## 4. Exit Code Reference

| Event | `exitCode=0` | `exitCode=2` | 其他非 0 |
|---|---|---|---|
| `PreToolUse` | 成功 | blocked | failed |
| `PermissionRequest` | 成功 | blocked | failed |
| `PostToolUse` | 成功 | blocking error（提醒下一次模型调用） | failed |
| `UserPromptSubmit` | 成功 | 记录到 runs，不阻断 | failed |
| `SessionStart` | 成功 | 记录到 runs，不阻断 | failed |
| `Stop` | 成功 | 记录到 runs，不阻断 | failed |

## 5. `additionalContext` 注入摘要

| Event | 来源 | 注入时机 | 是否持久化 |
|---|---|---|---|
| `PostToolUse` | 仅规范 JSON | 对应 `tool_result` 之后的下一次模型调用 | 否 |
| `UserPromptSubmit` | 规范 JSON 或成功非 JSON stdout | 当前轮首次模型请求 | 否 |
| `SessionStart` | 规范 JSON 或成功非 JSON stdout | 当前 session 首次模型请求 | 否 |
| `Stop` | 规范 JSON 或成功非 JSON stdout | 下一轮首次模型请求 | 否 |

## 6. 相关代码

1. `src/hooks/runtime.ts`
2. `src/hooks/runner.ts`
3. `src/chat/engine.ts`
