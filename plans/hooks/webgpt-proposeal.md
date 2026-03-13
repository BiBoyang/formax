## A. 设计结论摘要（关键决策 ≤10）

1. **Hook 配置只从 settings 读取**（本期不做 plugins / frontmatter）：路径与优先级完全按 Formax 体系：`.formax/settings.local.json`（local） > `.formax/settings.json`（project） > `~/.formax/settings.json`（user）。加载与合并优先级沿用现有 permissions 的同款思路与路径函数。
2. **Hook 配置以“会话启动快照”运行**：SessionStart 时读取并编译 matcher；会话中不自动热重载（避免中途改配置导致不可预测行为），与 Claude Code 文档建议一致。
3. **事件模型对齐 Claude Code**：至少实现你要求的 9 个事件（PreToolUse、PermissionRequest、PostToolUse、UserPromptSubmit、Stop、SubagentStop、SessionStart、SessionEnd、PreCompact、Notification），但允许分阶段逐步接线（Phase 0/1/2/3）。
4. **最小侵入接线策略**：

   * PermissionRequest：接在现有 Bash/Skill preflight 中（只在将要 ask/prompt 时触发）。
   * PreToolUse：接在 `createToolExecutor` 内（preflight 通过后、handler 之前）。
   * PostToolUse：接在 `chat/engine.ts` 的 tool loop（拿到 toolResults 后、push tool_result 前/后均可，但要保证下一轮 LLM 能看到附加上下文）。
5. **并发策略清晰且可控**：同一事件命中的多个 hooks **并行执行**（有并发上限，例如 4），并以“优先级 + 配置顺序”确定性合并结果（即使并行也不引入随机性）。
6. **命令执行安全与稳定性**：所有 command hook 通过 **stdin 传 JSON payload**（避免把用户输入拼进命令行导致注入），强制 `timeout`，并对 stdout/stderr 做截断；实现方式复用/参考 Bash runner 已有的 timeout/截断/kill tree 模式（不要新造风险点）。
7. **退出码语义对齐 Claude**：exit code `0`=成功；`2`=“阻断/拒绝”（不同事件有不同阻断语义）；其他非 0 视为 hook 失败（默认不阻断主流程，只记录/在 debug 展示）。
8. **与 permissions 协作但不扩展权限系统复杂度**：Hook 不引入新的 tool 类型权限；PermissionRequest hook 只在“将要 ask”时介入（不允许 hook 直接覆盖配置中的 deny，保持与现有 deny-first 行为一致）。
9. **运行时调用链路明确**（工具调用完整顺序）：LLM tool_use → PermissionRequest hooks → policy/permissions preflight（含交互审批/持久化 allow）→ PreToolUse hooks → tool handler → PostToolUse hooks → tool_result 回写 messages → 下一轮 LLM。
10. **可回滚**：默认“无 hooks 配置=零行为变化”；另提供 `FORMAX_DISABLE_HOOKS=1`（或同等开关）让你在紧急情况下直接短路所有 hook 接线（不需要删代码）。

---

## B. 配置 Schema（JSON 示例 + matcher/timeout 等语义；标注与 Claude 文档差异）

### B.1 settings 文件示例（`.formax/settings.local.json`）

```json
{
  "version": 1,
  "permissions": {
    "version": 1,
    "allow": ["Bash(git status)"],
    "ask": ["Bash(*)"],
    "deny": ["Bash(rm -rf *)"]
  },
  "hooks": {
    "SessionStart": [
      {
        "hooks": [
          {
            "type": "command",
            "id": "session-banner",
            "command": "node .formax/hooks/session-start.js",
            "timeoutMs": 1500,
            "enabled": true
          }
        ]
      }
    ],
    "UserPromptSubmit": [
      {
        "hooks": [
          {
            "type": "command",
            "id": "inject-ticket-context",
            "command": "node .formax/hooks/prompt-context.js",
            "timeoutMs": 1200
          }
        ]
      }
    ],
    "PermissionRequest": [
      {
        "matcher": "^Bash$",
        "hooks": [
          {
            "type": "command",
            "id": "auto-approve-safe-bash",
            "command": "node .formax/hooks/permission-bash.js",
            "timeoutMs": 800
          }
        ]
      }
    ],
    "PreToolUse": [
      {
        "matcher": "^Bash$",
        "hooks": [
          {
            "type": "command",
            "id": "block-dangerous-bash",
            "command": "node .formax/hooks/pre-bash-guard.js",
            "timeoutMs": 800
          }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "^Bash$",
        "hooks": [
          {
            "type": "command",
            "id": "post-bash-summarize",
            "command": "node .formax/hooks/post-bash-summarize.js",
            "timeoutMs": 1500
          }
        ]
      }
    ]
  }
}
```

> 说明：Formax settings 文件中本来就会同时存在 `permissions` 等字段；本 schema 仅新增根级 `hooks`，不要求迁移任何旧字段。

### B.2 Schema（概念结构）

* `hooks`: `Record<HookEventName, HookRule[]>`
* `HookRule`：

  * `matcher?: string`

    * **语义**：JS RegExp pattern（不含 `/.../` 包裹），由运行时 `new RegExp(matcher)` 编译
    * **匹配对象**：按事件不同而不同（见 D / C）
  * `hooks: HookDef[]`（按数组顺序执行/合并）
* `HookDef`（Phase 1 只实现 command）：

  * `type: "command"`
  * `id?: string`（可选，但强烈建议写；用于跨层覆盖/禁用）
  * `enabled?: boolean`（默认 true；如果 false，该 hook 在合并后被视为“禁用占位”）
  * `command: string`
  * `timeoutMs?: number`（默认 60000；建议上限 10 分钟）
  * `env?: Record<string,string>`（可选；会与当前进程 env merge）

### B.3 与 Claude Code hooks 文档的差异（明确列出）

* **来源差异**：Claude 支持 settings + plugins + frontmatter（skills/agents/slash）；本期 Formax **只做 settings**（你已允许）。
* **字段差异**：本设计新增 `id`/`enabled`/`timeoutMs`（Claude 文档示例更偏 `timeout` 秒级；我们用毫秒是为了与现有 Node/TS 工具一致，但可以兼容 `timeout`/`timeoutMs` 双写：Phase 1 就做）。
* **输出差异（Phase 1）**：

  * Claude 的 hook 输出 JSON 可影响 permissionDecision / additionalContext 等；Formax Phase 1 实现子集：

    * PermissionRequest：允许返回 allow/deny + （可选）updatedInput
    * PreToolUse：允许 updatedInput，且支持 exit 2 阻断
    * PostToolUse：允许 additionalContext
    * UserPromptSubmit：允许 additionalContext 或 exit 2 阻断
  * Stop/SubagentStop/Notification：Phase 2 扩展 JSON 输出解析与行为。

---

## C. 事件模型与数据载荷（每个 event 的 payload）

> 所有 command hook：**stdin 接收 JSON payload**；工作目录默认 `ctx.cwd`；额外在 env 提供 `FORMAX_PROJECT_DIR`，并提供兼容别名 `CLAUDE_PROJECT_DIR`（便于复用 Claude hooks 脚本生态）。

### C.0 公共字段（所有事件都带）

```json
{
  "hook_event_name": "PreToolUse",
  "session_id": "uuid-v4",
  "cwd": "/abs/path/to/project",
  "transcript_path": "/abs/path/to/formax-session.jsonl",
  "permission_mode": "normal|acceptEdits|plan",
  "agent": { "depth": 0 },
  "timestamp": "2026-01-21T12:34:56.789Z"
}
```

* `permission_mode`：映射自 `ExecutionContext.replMode`（normal/acceptEdits/plan）
* `transcript_path`：Phase 1 可以先给“会话日志文件路径”（可为空字符串）；后续可与 AuditLog/对话转录对齐。

---

### C.1 PreToolUse

**触发点**：tool preflight 通过后、真正执行 tool handler 前。

```json
{
  "hook_event_name": "PreToolUse",
  "session_id": "...",
  "cwd": "...",
  "tool_use_id": "toolu_123",
  "tool_name": "Bash",
  "tool_input": { "command": "rm -rf node_modules" }
}
```

* 预期输出（支持两种）：

  * **exit 2**：阻断 tool（stderr 作为错误原因回写 tool_result）
  * **stdout JSON**（可选）：`{ "hookSpecificOutput": { "updatedInput": {...} } }`（Phase 1 只实现 updatedInput）

---

### C.2 PermissionRequest

**触发点**：仅当 permissions 决策为 `ask`、系统将要弹审批/询问时触发（对齐文档“before prompting user for permission”）。

```json
{
  "hook_event_name": "PermissionRequest",
  "session_id": "...",
  "cwd": "...",
  "tool_use_id": "toolu_123",
  "tool_name": "Bash",
  "tool_input": { "command": "git status" },
  "permission": {
    "baseline_decision": "ask"
  }
}
```

* 预期输出（stdout JSON）：

  * 允许返回：

    * `permissionDecision`: `"allow" | "deny"`
    * `updatedInput`: object（可选）
    * `message`: string（可选，deny 时作为理由）
* 也支持 **exit 2**：视为 deny，并把 stderr 写入 tool_result（对齐 Claude：exit 2 会把 stderr 回传）。

---

### C.3 PostToolUse

**触发点**：tool handler 完成并产出 ToolResult 后、写入 messages 前后（建议在写入前，这样 hook 能基于 tool_output 决策是否追加上下文）。

```json
{
  "hook_event_name": "PostToolUse",
  "session_id": "...",
  "cwd": "...",
  "tool_use_id": "toolu_123",
  "tool_name": "Bash",
  "tool_input": { "command": "npm test" },
  "tool_output": {
    "is_error": false,
    "content": "…(tool_result.content 原样/截断后)…"
  },
  "metrics": { "duration_ms": 1234 }
}
```

* 预期输出：

  * stdout JSON：`{ "hookSpecificOutput": { "additionalContext": "..." } }`
  * exit 2：Phase 2 才支持“阻止继续/要求用户介入”的更复杂行为；Phase 1 可以先把 stderr 作为额外上下文注入（但不改变 tool_result）。

---

### C.4 UserPromptSubmit

**触发点**：用户敲回车提交 prompt 后、把 user message 写进 history 并发起 LLM stream 之前。

```json
{
  "hook_event_name": "UserPromptSubmit",
  "session_id": "...",
  "cwd": "...",
  "prompt": "帮我跑一下 npm test 并修失败用例",
  "is_slash_command": false
}
```

* 预期输出：

  * exit 2：**阻止该 prompt 进入 history/LLM**，只向用户显示 stderr（对齐 Claude 文档）。
  * stdout JSON：`{ "hookSpecificOutput": { "additionalContext": "..." } }`（会被注入到本次 user message 的 injectedBlocks 中，优先于用户正文）

---

### C.5 Stop

**触发点**：一次 turn 内，当 LLM 返回 stopReason 非 tool_use（即将 break 出 tool loop）时。

```json
{
  "hook_event_name": "Stop",
  "session_id": "...",
  "cwd": "...",
  "stop_reason": "end_turn|max_tokens|stop_sequence|tool_use",
  "stop_hook_active": true
}
```

* Phase 2：支持 exit 2 阻止 stop（把 stderr 注入额外上下文，迫使再跑一轮 LLM）。

---

### C.6 SubagentStop

**触发点**：子代理（Task/Subagent）完成返回时（建议在 `taskSubAgent` handler 中触发）。

```json
{
  "hook_event_name": "SubagentStop",
  "session_id": "...",
  "cwd": "...",
  "subagent": { "name": "code-reviewer", "depth": 1 },
  "result": { "status": "completed|error" }
}
```

---

### C.7 SessionStart

**触发点**：REPL 启动、会话创建后立即触发。

```json
{
  "hook_event_name": "SessionStart",
  "session_id": "...",
  "cwd": "...",
  "source": "repl|ci|api",
  "args": { "model": "..." }
}
```

* 预期输出：

  * stdout（纯文本）或 stdout JSON 的 additionalContext：注入为会话级 system-reminder（建议 ephemeral）

---

### C.8 SessionEnd

**触发点**：REPL 退出（正常退出、SIGINT、fatal error）。

```json
{
  "hook_event_name": "SessionEnd",
  "session_id": "...",
  "cwd": "...",
  "reason": "exit|sigint|crash",
  "duration_ms": 123456
}
```

---

### C.9 PreCompact

**触发点**：自动 compact 或手动 compact 前（useChat 自动 compact 分支里最合适）。

```json
{
  "hook_event_name": "PreCompact",
  "session_id": "...",
  "cwd": "...",
  "trigger": "auto|manual",
  "custom_instructions": ""
}
```

---

### C.10 Notification

**触发点**：UI toast / warning / error 打算展示前（Phase 2 接线，先不改 UI 行为）。

```json
{
  "hook_event_name": "Notification",
  "session_id": "...",
  "cwd": "...",
  "notification_type": "info|warning|error",
  "message": "..."
}
```

---

## D. 合并与优先级规则（user/project/local；matcher；冲突；顺序）

### D.1 配置来源与优先级（必须严格）

* 读取 3 个 settings：

  1. `.formax/settings.local.json`
  2. `.formax/settings.json`
  3. `~/.formax/settings.json`
* **优先级**：local > project > user（与 permissions 合并一致）。
* **合并策略**（最小实现、可回滚、可预测）：

  * 对每个 `HookEventName`：把三个来源的 rules **按优先级顺序拼接**成一个数组（local 在前）
  * 在“执行前展开 hook 列表”时做 dedupe：

    * dedupe key 优先用 `hook.id`（若存在）
    * 否则 fallback 到 `type + command`（command hook）
    * **保留第一个**（即更高优先级来源）
    * 如果保留项 `enabled=false`：视为“禁用占位”，即该 key 最终不执行任何 hook（用于 local 覆盖禁用 user/project 的 hook）
  * 这样既满足“更具体覆盖”，也保证安全默认（不会因为优先级合并导致重复执行同一 hook）。

### D.2 matcher 解析与匹配对象

* `matcher` 为空：match all
* `matcher` 非空：`new RegExp(matcher)` 编译；编译失败则丢弃该 rule，并记录 warning（不 crash）。
* 事件 → matcher 目标字段：

  * PreToolUse / PostToolUse / PermissionRequest：匹配 `tool_name`
  * UserPromptSubmit：matcher **默认忽略**（因为没有稳定 selector；后续可扩展为匹配 `is_slash_command` 或 prompt 前缀）
  * SessionStart：匹配 `source`
  * PreCompact：匹配 `trigger`
  * Notification：匹配 `notification_type`
  * Stop / SubagentStop / SessionEnd：matcher 默认忽略（后续可扩展）

> 这与 Claude 文档的“matcher 主要匹配 tool_name”一致，但我们把 matcher 语义扩展到了部分非 tool 事件（仍保持简单）。

### D.3 冲突处理（多 hooks 输出不同决策）

* **PermissionRequest**：

  * 若任意 hook 输出 deny（exit 2 或 JSON deny）→ deny（保守策略）
  * 否则若任意 hook 输出 allow → allow
  * 否则维持 baseline ask（进入现有审批流程）
* **PreToolUse / UserPromptSubmit / Stop**：任意 hook exit 2 → block（保守策略）
* **additionalContext 合并**：把所有成功 hook 的 `additionalContext` 按“优先级+顺序”拼接（中间加 `\n\n`），并截断到上限（避免注入过大）。
* 解释：permissions 系统本身就是 deny-first（deny 优先于 allow/ask）。

---

## E. 执行策略（command hooks、prompt hooks 建议、失败/超时、日志）

### E.1 command hook 执行（必须具备的稳定性措施）

**执行方式**

* 使用 `child_process.spawn(command, { shell: true })`（或沿用 Bash runner 的同款 spawn），但：

  * **不把 payload 拼进命令行**
  * payload 通过 stdin 写入 JSON（UTF-8）
* `cwd`：默认 `ExecutionContext.cwd`
* `env`：`process.env` + hook.env + 标准注入：

  * `FORMAX_PROJECT_DIR`（绝对路径）
  * `CLAUDE_PROJECT_DIR`（同值，兼容 Claude hooks 脚本）
  * `FORMAX_SESSION_ID`
  * `FORMAX_HOOK_EVENT_NAME`

**timeout**

* 每个 hook 单独 timeout（默认 60s，支持 `timeout` 秒 或 `timeoutMs` 毫秒两种配置字段；最终统一成 ms）。
* timeout 时：

  * kill process（含子进程树），标记 `timed_out=true`
  * 默认不阻断主流程（除非以后加 `onTimeout: "block"` 扩展）

**stdout/stderr 截断**

* 为每个 hook 分别截断 stdout/stderr：

  * 建议上限：stdout 8k、stderr 8k（可常量）
  * 截断策略建议“保留尾部”或“保留头部 + 标记 truncated”；你已有 Bash runner 的 appendLimited（保留尾部）可直接复用/照搬实现。
* 额外：为了防刷屏，不把 hook stdout/stderr 默认直接打印到 UI；只有在 debug 或阻断场景才展示（与 Claude 文档“只有部分 hook stdout 会注入上下文”一致）。

**exit code 处理**

* `0`：成功；尝试解析 stdout JSON（若需要）；否则 stdout 作为文本（仅 SessionStart/UserPromptSubmit/PostToolUse 需要）。
* `2`：阻断（不同事件不同阻断语义，下节给出）
* `!=0 && !=2`：hook 失败：

  * 记录 warning（debug 可见）
  * 不改变主流程（继续执行其他 hooks / tool 本身）

### E.2 prompt hook（建议但不在 Phase 1 强制落地）

* Claude 有 “prompt hooks” 概念（以 stdout/JSON 注入 additionalContext 或替换 prompt）。本期你可以只把它作为 **command hook 输出 JSON** 的一种结果来实现，避免新增 hook.type。
* Phase 2/3 若要加：`type:"prompt"` 其实可以只是 `type:"command"` 的语法糖（内部仍 spawn，然后把 stdout 直接当 prompt/ctx）。

### E.3 失败/超时策略（清晰、可预期）

* 单个 hook 失败/超时：

  * **不阻断整个事件**（继续跑其他 hooks）
  * 事件最终结果只基于成功/阻断的 hook
* 多 hook 并发：

  * 有并发上限（例如 4）
  * 任何一个 hook 阻断（exit 2）→ 事件阻断（但仍要等所有并发 hook 结束？建议：阻断立即短路后续未开始的 hooks，但已在跑的让它们自然结束/尽快 kill 以省资源；实现可用 AbortController）

### E.4 日志策略（不影响现有文案）

* 默认 UI 不新增任何“hook 正在运行”文案（保持现有体验不变）
* 在以下场景才输出到用户可见：

  * UserPromptSubmit 被阻断：显示 stderr（不把 prompt 写入 history）
  * PreToolUse/PermissionRequest 阻断：返回 tool_result is_error，content 为 `Error: <stderr>`（复用现有 tool error 展示路径）
* debug 模式（如果已有 debug 开关/日志级别）：

  * 打印 hook 命中列表、耗时、exit code、截断后的 stdout/stderr（不改变默认）

### E.5 “运行时调用链路”明确版（工具调用全链路）

以一次 LLM 发起 `tool_use` 为例（Formax 当前 engine/tool loop 结构为基础）：

1. LLM stream 返回 `assistantBlocks`（含 tool_use）+ `stopReason="tool_use"` + toolResults（由 executeTool 执行产生）
2. 对每个 tool_use（在 `executeTool(call)` 内）：

   1. **PermissionRequest hooks**（仅 baseline=ask 时触发）
   2. **policy/permissions preflight**：Bash 用 `policyPreflight`，Skill 用 `skillPreflight`（包含 ask/allow/deny 与交互审批/持久化 allow）
   3. **PreToolUse hooks**
   4. tool handler 执行
   5. （Phase 1 可先不在 executor 内做）返回 ToolResult 给 engine
3. engine 拿到 `toolResults` 后：

   1. **PostToolUse hooks**（基于 tool_input/tool_output 注入 additionalContext）
   2. `loopMessages.push(tool_result...)` 写回 messages
4. engine 下一轮 while-loop 再次调用 LLM（把 PostToolUse 注入的 context 带上）

---

## F. 落地 TODO list（极其细粒度，可拆 PR/commit；含文件路径 + 验收方式）

> 说明：下面按 Phase 0/1/2/3 排列；每条都是**可独立合并的小 PR**。
> 约定：所有新增代码默认“无 hooks 配置=不改变任何现有输出/行为”。

---

### Phase 0 — 底座（配置读取/合并/匹配 + 命令执行器 + 单测）

* [ ] **新增 hooks 类型定义（不接线）**

  * Files: `packages/core/src/adapters/hooks/types.ts`（new）
  * Work: 定义 `HookEventName` union、`HookRule`、`CommandHookDef`、`HooksSettings`、`HookSource`、`HookConfigSnapshot` 等；只定义类型与最小运行时常量（默认 timeout、截断上限）。
  * Verify: `pnpm vitest`（新增纯类型文件不会影响现有测试）

* [ ] **实现 hooks settings 读取（只读，不改写 settings）**

  * Files: `packages/core/src/adapters/hooks/hooksStore.ts`（new）
  * Work:

    * 复用 permissions 的路径函数：`getProjectSettingsLocalPath/getProjectSettingsPath/getUserSettingsPath` 来定位 3 个 settings 文件
    * 读取 JSON，容错：文件不存在→空；JSON parse 失败→记录 warning 但不中断
    * 仅提取 `hooks` 字段（非 object 则忽略）
  * Verify: 新增单测（见后续）

* [ ] **实现 matcher 编译与命中判断**

  * Files: `packages/core/src/adapters/hooks/matcher.ts`（new）
  * Work:

    * `compileMatcher(matcher?: string): RegExp | null`（空=match all；非法=warning+null）
    * `matchHookRule(rule, selector: string | null): boolean`
    * 按事件定义 selector（tool_name / trigger / notification_type / source）
  * Verify: `packages/core/src/adapters/hooks/matcher.test.ts`（new）

* [ ] **实现 hooks 合并与去重（仅生成“可执行列表”，不接线）**

  * Files: `packages/core/src/adapters/hooks/merge.ts`（new）
  * Work:

    * 输入：三个来源的 `HookRule[]`（已带 source 元信息）
    * 输出：`HookConfigSnapshot`：`byEvent: Map<EventName, ResolvedHook[]>`
    * 去重规则：id 优先，否则 type+command；保留第一个；enabled=false 作为禁用占位
  * Verify: `packages/core/src/adapters/hooks/merge.test.ts`（new）

* [ ] **为 hooksStore 增加“会话快照加载”API**

  * Files: `packages/core/src/adapters/hooks/hooksStore.ts`
  * Work: 导出 `loadHooksSnapshot({ fileStore, cwd, env? })`：返回 `HookConfigSnapshot`（包含 warnings、sources、resolved hooks）。
  * Verify: 单测覆盖：local/project/user 三文件同名 hook 的覆盖/禁用逻辑

* [ ] **新增 Hook 命令执行器（spawn + stdin JSON + timeout + 截断）**

  * Files:

    * `packages/core/src/tools/hooks/commandRunner.ts`（new）
    * （可选复用）`packages/core/src/tools/modules/bash/runner.ts` 中的 `appendLimited/withTimeout/killProcessTree` 逻辑做最小复制或抽到 `packages/core/src/tools/utils/process.ts`（见下一条）
  * Work:

    * `runHookCommand({ command, cwd, env, stdinJson, timeoutMs, stdoutLimit, stderrLimit, signal })`
    * 返回 `{ exitCode, stdout, stderr, timedOut, durationMs }`（stdout/stderr 已截断）
  * Verify: `packages/core/src/tools/hooks/commandRunner.test.ts`：用 `node -e` 写小脚本模拟 stdout/stderr、sleep 超时、exit 2

* [ ] **抽取/复用 Bash runner 的“超时+截断+kill tree”工具（最小改动）**

  * Files:

    * 新增 `packages/core/src/tools/utils/processUtils.ts`（new）
    * 修改 `packages/core/src/tools/modules/bash/runner.ts`：把 `appendLimited/withTimeout/killProcessTree` 改为从 util 引入（保持行为完全一致）
  * Work: 纯搬运函数，不改逻辑、不改文案、不改常量值（保证 Bash 行为完全一致）。
  * Verify: 运行现有 tests；手动跑一次 Bash tool（对比输出无变化）

* [ ] **实现 hooks 输出 JSON 的“提取首个 JSON object”工具**

  * Files: `packages/core/src/tools/hooks/jsonOutput.ts`（new）
  * Work: 复用仓库已有 `extractFirstJsonObject` 的实现方式（它已用于 agent architect 解析）
  * Verify: 单测：混合文本+JSON、无 JSON、非法 JSON

* [ ] **新增 HookRunner（按事件匹配 → 并发执行 → 产出结构化结果）**

  * Files: `packages/core/src/tools/hooks/hookRunner.ts`（new）
  * Work:

    * 输入：`HookConfigSnapshot` + `eventName` + `payload`
    * 找到命中 hooks（matcher）→ 并发跑（limit=4）→ 汇总 `HookExecution[]`（含 source/id/exit/stdout/stderr）
  * Verify: 单测：并发 limit 生效、执行顺序的确定性（合并按 resolved 顺序）

* [ ] **加入全局禁用开关（回滚保险）**

  * Files: `packages/core/src/tools/hooks/featureFlag.ts`（new）
  * Work: `isHooksDisabled(env)`（例如 `FORMAX_DISABLE_HOOKS=1`）
  * Verify: 单测：env 生效；禁用后 runner 不执行任何命令

---

### Phase 1 — 最小可用（接线到核心链路：PermissionRequest/PreToolUse/PostToolUse/UserPromptSubmit/SessionStart/End/PreCompact）

#### 1) 构建 HooksService（统一入口，降低侵入点）

* [ ] **新增 HooksService（负责：加载快照、提供 runXxx 方法）**

  * Files: `packages/core/src/tools/hooks/service.ts`（new）
  * Work:

    * `createHooksService({ fileStore, cwd, env, sessionId })`
    * 内部：load snapshot（Phase 0）、创建 runner
    * 对外：`runSessionStart/runUserPromptSubmit/runPermissionRequest/runPreToolUse/runPostToolUse/runSessionEnd/runPreCompact`
  * Verify: 单测：service 在 hooks 缺失时返回空结果且不抛异常

#### 2) PermissionRequest：接入 Bash/Skill preflight（与 permissions 协作）

* [ ] **在 `policyPreflight`（Bash）里触发 PermissionRequest hooks（仅 baseline=ask）**

  * Files: `packages/core/src/tools/executor/policyPreflight.ts`
  * Work:

    * 在 `perm.decision === 'ask'` 且准备 `ensureApproved` 之前：调用 `hooks.runPermissionRequest(...)`
    * 若 hook 决策 allow：跳过 ensureApproved（视为已批准），继续执行
    * 若 hook 决策 deny/exit2：直接返回 ToolResult is_error（content 包含 stderr/message）
    * 支持 hook `updatedInput`：用更新后的 `call.input` 继续走 preflight/handler
    * **不改变 deny 的语义**：当 perm.decision === 'deny' 时不调用 PermissionRequest hooks（保持 deny-first、一致性）
  * Verify: 新增单测（可用 node 脚本 + 临时 settings）：

    * baseline ask + hook allow → 不再弹审批（在测试里用 mock userInput/approval）
    * baseline ask + hook deny(exit2) → 返回 tool_result error
    * baseline deny → hook 不触发（可用计数器脚本验证未执行）

* [ ] **在 `skillPreflight` 里触发 PermissionRequest hooks（仅 baseline=ask）**

  * Files: `packages/core/src/tools/executor/skillPreflight.ts`
  * Work:

    * perm.decision === 'ask' 且准备 requestAnswers 之前：调用 hook
    * hook allow → 直接 return null（视为允许）
    * hook deny/exit2 → 返回 ToolResult is_error
  * Verify: 单测同上（针对 Skill）

#### 3) PreToolUse：接入 ToolExecutor（preflight 后、handler 前）

* [ ] **扩展 `createToolExecutor` 支持可选 hooks 依赖**

  * Files: `packages/core/src/tools/executor/index.ts`
  * Work:

    * `opts` 增加可选 `hooks?: HooksService`（或更窄接口）
    * 在 preflight 通过后、`handler.execute` 前调用 `hooks.runPreToolUse`
    * 支持 updatedInput：以更新后的 input 调用 handler
    * exit2/deny：直接返回 ToolResult is_error（不进入 handler）
    * **默认无 hooks**：完全不改变行为/文案
  * Verify: 单测：执行 Bash tool_use 时，PreToolUse hook 脚本能阻断（exit2），tool 不执行（可让 handler 写文件验证没写）

#### 4) PostToolUse：接入 engine 的 tool loop（toolResults 生成后）

* [ ] **在 `packages/core/src/chat/engine.ts` 中对每个 toolResult 触发 PostToolUse hooks**

  * Files: `packages/core/src/chat/engine.ts`
  * Work:

    * `createChatEngine` deps 增加可选 `hooks?: HooksService`（不提供则不执行）
    * 在 `toolResults` 到 `loopMessages.push(tool_result...)` 之间：

      * 根据 tool_use_id 找 tool_name（已有 `toolNameById` 逻辑可复用）
      * 调用 `hooks.runPostToolUse({ tool_name, tool_input, tool_output })`
      * 若返回 additionalContext：把它添加到 **下一轮** LLM 的 `systemForThisCall` 中（新增一个 `hookInjectedSystemBlocks` 数组，类似 todoStaleReminder 的做法）
  * Verify: 集成测试：

    * 伪造 client.streamOnce：第一轮返回 tool_use，executeTool 返回 tool_result；第二轮检查传给 client.streamOnce 的 `system` 里包含 hook 注入内容

#### 5) UserPromptSubmit：接入 useChat（用户输入提交点）

* [ ] **在 `packages/core/src/features/repl/useChat.ts` 提交 prompt 前触发 UserPromptSubmit hooks**

  * Files: `packages/core/src/features/repl/useChat.ts`（在你 snippet 中已看到构造 injectedBlocks/user message 的位置）
  * Work:

    * 在创建 `userMsg`/`user` 之前调用 `hooks.runUserPromptSubmit({ prompt, is_slash_command })`
    * 若 exit2/deny：

      * 不写入 messages/historyRef
      * UI 只显示 stderr（复用现有 setMessages error 插入模式，不新增新文案）
    * 若 additionalContext：把它转成 injectedBlock（ephemeral text block + `<system-reminder>`），插入到 `injectedBlocks` **最前**，保证优先于 prompt 正文
  * Verify: 手动：配置 hook 让包含 “rm -rf” 的 prompt 被拦截，观察不会进入对话历史；单测：hook allow 时 injectedBlocks 顺序正确

#### 6) SessionStart / SessionEnd：接入 REPL 生命周期

* [ ] **在 REPL 启动时触发 SessionStart hooks，并把输出注入后续 prompt**

  * Files: `packages/core/src/screens/REPL.tsx` 或 `packages/core/src/features/repl/useReplController.ts`（取决于你实际构造 deps 的位置）
  * Work:

    * 创建 sessionId（uuid）
    * 初始化 HooksService（若禁用则不建）
    * 调用 `runSessionStart`：若返回 additionalContext，把它塞进 `pendingInjectedBlocksRef.current`（这样首个 user prompt 会带上）
  * Verify: 手动：启动 formax 后第一条对话就能看到 hook 注入的行为（例如让 hook 注入 “Project: X”）

* [ ] **在 REPL 退出时触发 SessionEnd hooks（best-effort）**

  * Files: 同上
  * Work: 在 exit handler / useEffect cleanup 中调用 `hooks.runSessionEnd({ reason })`；失败不影响退出
  * Verify: 手动：写 hook 把 SessionEnd payload 记录到文件，退出后文件存在

#### 7) PreCompact：接入自动 compact 分支

* [ ] **在 useChat 的 auto-compact 触发前调用 PreCompact hooks**

  * Files: `packages/core/src/features/repl/useChat.ts`（auto-compact 分支在 snippet 里）
  * Work: 在 `if (stats.shouldAutoCompact)` 内、compactUser 构造前触发 `runPreCompact({ trigger:"auto" })`；若 hook exit2 则跳过本次 compact（但不报错）
  * Verify: 单测：模拟 shouldAutoCompact=true 时，hook exit2 会阻止执行 `deps.engine.runTurn`（可用 spy）

---

### Phase 2 — 完整事件覆盖与更强控制（Stop/SubagentStop/Notification + 更完整 JSON 输出）

* [ ] **Stop hooks：在 engine break 前触发，可阻止 stop 并继续一轮**

  * Files: `packages/core/src/chat/engine.ts`
  * Work:

    * 在 `if (toolUseBlocks.length === 0 || stopReason !== 'tool_use') break` 之前：调用 `hooks.runStop({ stop_reason: stopReason })`
    * 若 exit2：把 stderr 注入 `systemForThisCall`（下一轮），并 **不 break**，继续 while-loop
  * Verify: 集成测试：stopReason=end_turn 时 hook exit2 会导致 engine 再调用一次 client.streamOnce

* [ ] **SubagentStop hooks：在 Task subagent handler 结束时触发**

  * Files: `packages/core/src/tools/executor/handlers/taskSubAgent.ts`
  * Work: 在 subagent 执行完成（成功/失败）处调用 `hooks.runSubagentStop(...)`（best-effort，不影响任务返回）
  * Verify: 手动：hook 写文件记录 subagent stop；跑一次 Task 工具触发

* [ ] **Notification hooks：建立轻量通知总线并接到 toast/error**

  * Files:

    * `packages/core/src/tools/hooks/notifications.ts`（new）
    * `packages/core/src/features/repl/useChat.ts` 或现有 toast helper 所在文件
  * Work:

    * 在要显示 toast 前触发 `runNotification({ type, message })`
    * Phase 2 不改变 UI 展示；仅额外触发 hook
  * Verify: 手动：hook 监听 warning/error 并写日志

* [ ] **完善 JSON 输出解析（按 Claude 文档字段名兼容）**

  * Files: `packages/core/src/tools/hooks/outputParser.ts`（new）
  * Work: 支持解析 Claude 文档提到的 `hookSpecificOutput`、`additionalContext`、`permissionDecision` 等字段名（允许大小写/别名），减少脚本迁移成本。
  * Verify: 单测：同一个 hook 脚本用不同字段名都能生效

* [ ] **实现并发短路（exit2 后取消未开始的 hooks）**

  * Files: `packages/core/src/tools/hooks/hookRunner.ts`
  * Work: runner 内用 AbortController 管理；一旦发现 exit2，取消队列中未启动 hook；已启动的可选择 kill（谨慎）
  * Verify: 单测：大量 hooks 时，exit2 触发后总耗时明显下降（用假脚本 sleep 验证）

---

### Phase 3 — 扩展源与配置 UI（可选，按你“后续阶段”需求）

* [ ] **frontmatter hooks（slash/agents/skills）读取与合并**

  * Files:

    * `packages/core/src/adapters/hooks/frontmatterSource.ts`（new）
    * 可能需要读 `.formax/commands/*.md` 等（已有命令系统）
  * Work: 只做读取 + 合并到 HookConfigSnapshot；保持 settings 仍是最高优先级（或定义更细粒度规则）
  * Verify: 手动：在某个 command frontmatter 写 hooks，触发后生效

* [ ] **/hooks 配置 UI（Ink 界面）**

  * Files: `packages/core/src/features/repl/commands/hooks.tsx`（new）等
  * Work: 只做浏览/展示当前合并后的 hooks（包含来源与 matcher），不做写入；写入作为后续 PR
  * Verify: 手动：运行 /hooks 输出列表与来源路径

* [ ] **写入 hooks（遵循现有 settings 写入模式）**

  * Files: `packages/core/src/adapters/hooks/hooksWriter.ts`（new）
  * Work: 支持把 hooks 写入 projectLocal 或 user settings（不触碰 permissions 现有字段）
  * Verify: 单测：写入后 JSON 仍合法、旧字段不丢失

---

### 测试建议（单测/集成）+ 手动验收脚本（命令序列/预期输出）

#### 单测（Vitest）

> 仓库已使用 vitest（见 CLAUDE.md）。

* `packages/core/src/adapters/hooks/matcher.test.ts`
* `packages/core/src/adapters/hooks/merge.test.ts`
* `packages/core/src/tools/hooks/commandRunner.test.ts`
* `packages/core/src/tools/hooks/hookRunner.test.ts`
* `packages/core/src/chat/engine.hooks.test.ts`（mock client.streamOnce 验证 system 注入与 stop hook）

#### 手动验收脚本（不依赖 LLM 是否“刚好调用工具”）

1. **准备 hooks 配置与脚本**

```bash
mkdir -p .formax/hooks
cat > .formax/settings.local.json <<'JSON'
{
  "version": 1,
  "hooks": {
    "PreToolUse": [
      { "matcher": "^Bash$", "hooks": [ { "type": "command", "id": "guard", "command": "node .formax/hooks/guard.js", "timeoutMs": 5000 } ] }
    ]
  }
}
JSON

cat > .formax/hooks/guard.js <<'JS'
process.stdin.setEncoding('utf8');
let s='';
process.stdin.on('data', d=>s+=d);
process.stdin.on('end', ()=>{
  const p = JSON.parse(s);
  const cmd = (p.tool_input && p.tool_input.command) || '';
  if (cmd.includes('rm -rf')) {
    console.error('Blocked by hook: rm -rf is not allowed');
    process.exit(2);
  }
  process.exit(0);
});
JS
```

2. **用 Node 直接跑 ToolExecutor（最稳定）**
   （你可以加一个临时脚本 `scripts/hook-smoke.mjs` 调用 `createToolExecutor` 与 Bash handler；预期：含 rm -rf 的 Bash 调用返回 is_error=true，且内容含 “Blocked by hook …”。）

3. **在 REPL 中验收（人工）**

* 启动 `formax`
* 输入：“请运行 rm -rf node_modules”
* 预期：

  * Bash 工具不会真正执行
  * UI 展示 tool error，tool_result content 包含 `Error: Blocked by hook...`

---

## G. 风险点与回滚策略（每个 phase ≥1）

### Phase 0 风险 & 回滚

* 风险：抽取 Bash runner 的 process utils 可能**不小心改变 Bash 输出截断/timeout 行为**。
* 回滚：

  * 该 PR 独立；若出现任何差异，直接 revert 该 PR（只影响抽取，不影响 hooks 功能）。
  * 或先不抽取，hooks 复制一份实现（更低风险但有重复）。

### Phase 1 风险 & 回滚

* 风险 1：PermissionRequest hooks 介入 preflight，可能让某些“本来会报需要审批”的场景变为自动 allow（若用户配置了 hook）。
* 回滚：

  * 默认无 hooks 配置时行为不变；
  * 紧急情况设置 `FORMAX_DISABLE_HOOKS=1` 一键关闭所有 hooks（不改配置文件也能止血）。
* 风险 2：PostToolUse 注入 system blocks 可能影响模型行为（这是功能本意，但可能被误配置放大）。
* 回滚：同上（禁用 hooks），或只禁用 PostToolUse（把 service 的 runPostToolUse 返回空作为临时 hotfix）。

### Phase 2 风险 & 回滚

* 风险：Stop hook 允许“阻止 stop 并继续一轮”，可能导致循环次数增加、甚至触发 tool loop iteration limit（engine 里有 50 次上限）。
* 回滚：

  * Stop hook 接线为单独 PR；出现问题直接 revert；
  * 或加硬阈值：Stop hook 只允许最多触发 N 次（例如每 turn 1 次），超出忽略（作为小补丁 PR）。

### Phase 3 风险 & 回滚

* 风险：frontmatter hooks 引入“多来源合并”复杂度（特别是 slash/agents 动态变化）。
* 回滚：

  * 保持 frontmatter source 作为可选 feature flag（例如 `FORMAX_ENABLE_FRONTMATTER_HOOKS=1`），默认关闭；
  * UI 先做只读展示，不做写入，降低破坏性。

---

如果你希望我把 **Phase 1 的“最小可用 hooks”接线点**再进一步细化到“每个函数内插入点（before/after 哪一行）”级别，我可以按你 repo 当前代码的实际结构（尤其是 `useReplController` 的 deps 构造、client.executeTool 的调用点）再拆出更小的 commit 粒度清单。
