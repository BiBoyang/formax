# Hooks（Claude Code 风格）集成 TODO（Phase 1）

目标：在 Formax 中集成 Claude Code hooks 的最小可用底座，优先覆盖 `PreToolUse / PermissionRequest / PostToolUse`，并按抓包对齐 `PostToolUse.additionalContext` 的注入行为。

范围约束（Phase 1）：
- 只做 `type: command`（跑本地命令）
- 不做 `/hooks` UI，不做 plugins，不做 SessionStart/Stop/UserPromptSubmit 等扩展事件（后置）
- 不引入 system-reminder “体系工程”，但 **允许**按 Claude Code 抓包结果使用 `<system-reminder>...</system-reminder>` 作为 *hook 注入的容器文本*

关键事实（来自本地抓包）：
- Claude Code 的 `PostToolUse.additionalContext` 会被转换成 `<system-reminder>` 注入到后续模型调用（同一轮 tool loop 内即可生效）。
- 注入位置存在两种变体：
  - 作为 `tool_result` 同一个 content string 的尾部拼接（见 `proxy/traffic-logs-hooks-function/0012_*`）
  - 作为紧跟 `tool_result` 的 `text` content block（见 `proxy/traffic-logs-hooks-function/0010_*`、`0024_*`）
- 我们 Phase 1 先固定实现为：**紧跟的 text content block**（用户已拍板）。

## H0：对齐目标锁定（不写代码，只确认）
- [x] 确认 Phase 1 的注入位置：`tool_result` 后追加一个 `text` block，内容为 `<system-reminder>...</system-reminder>`（已确认）
- [x] 确认 Phase 1 的 UI 策略：借鉴 Claude Code（Running hook.../blocking error 等简短文案；详细 stderr 仅在展开/调试输出里出现）

## H1：Hooks 配置读取与三层合并（.formax）
- [x] 定义 settings 读取位置（对齐现有 permissions 读法）：
  - `<repoRoot>/.formax/settings.local.json`
  - `<repoRoot>/.formax/settings.json`（如存在）
  - `~/.formax/settings.json`
- [x] 定义 hooks schema（只包含 Phase 1 事件）：
  - `hooks.PreToolUse[] / hooks.PermissionRequest[] / hooks.PostToolUse[]`
  - 每条：`matcher` + `hooks[]`（Phase 1 仅 `type: command` + `command: string`）
- [x] 合并规则（Phase 1）：
  - 先按层级拼接（projectLocal → project → user），保持顺序可追溯
  - 同一事件里“完全相同的 command 字符串”去重（对齐 Claude Code “去重”直觉，避免重复跑）

## H2：Hook runner（并发 + timeout + stdout/stderr + exit code 语义）
- [x] matcher 实现（按 `plans/hooks/hooks.md`）：
  - 匹配对象是 tool name（如 `Bash` / `Read` / `Write`）
  - `matcher` 支持 `Edit|Write` 这类正则并集（大小写敏感）
- [x] command hook 执行：
  - stdin：event payload JSON（包含 `tool_input` / `tool_response` / `cwd` / `session_id?` 等）
  - stdout/stderr：截断（大小限制、附加 “(truncated)” 标记）
  - timeout：单 hook 独立 timeout（默认 60s，可后置做配置项）
- [x] 并发策略：
  - 同一事件匹配多个 hooks：并行执行
  - 加并发上限（例如 4），并保证合并结果顺序确定（以配置顺序为准）
- [x] exit code 语义（按 `plans/hooks/hooks.md` + 我们的“稳态折中”）：
  - `0`：成功；若 stdout 为 JSON 且可解析，则处理结构化字段
  - `2`：阻断错误；**不解析 stdout JSON**，只使用 stderr 文本
  - 其他非 0：非阻断错误；记录 stderr（但不影响主流程）

## H3：PreToolUse 接入（工具执行前）
- [x] 在 ToolExecutor 的 preflight 之前触发 `PreToolUse`
- [ ] 支持最小决策：
  - 若任一 hook exit code=2（阻断）→ 阻止工具执行，返回工具错误（简短）
  - Phase 1 不做 `updatedInput`（后置）
- [ ] 审计：记录 hook 运行结果（eventName/toolName/command/exitCode/duration）

## H4：PermissionRequest 接入（审批 UI 之前）
- [x] 在 ApprovalService 弹 UI 之前触发 `PermissionRequest`
- [ ] Phase 1 最小决策：
  - exit code=2 → 直接拒绝权限（不弹 UI）
  - exit code=0 → 不短路，保持现有审批流程（除非后续实现 JSON decision）
  - 其他非 0 → 不阻断，仅记录

## H5：PostToolUse 接入（工具执行后 + 下一轮注入）
- [x] 工具执行后触发 `PostToolUse`
- [x] 解析 stdout JSON 中的 `hookSpecificOutput.additionalContext`
- [x] 注入策略（本项目 Phase 1 固定实现）：
  - 对下一次模型调用（同一 tool loop 内的“下一轮”）：
    - 在 `tool_result` content blocks 后追加一个 `text` block
    - 文本格式：`<system-reminder>\nPostToolUse:<ToolName> hook additional context: ...\n</system-reminder>`
- [x] exit code=2（PostToolUse）处理（对齐抓包）：
  - 不阻止工具（工具已执行完）
  - 追加 `<system-reminder>`（文案含 “blocking error from command …: [cmd]: {stderr}” 的最小信息）

## H6：测试与回滚
- [ ] 单测：matcher（大小写/正则/不命中）、executor（timeout/并发/截断/exit code 语义）、JSON 解析
- [ ] 集成测试：模拟 tool loop（Bash 工具）验证：
  - `PostToolUse.additionalContext` 会以“tool_result 后 text block”的方式进入下一次模型请求
  - exit code=2 的 PostToolUse 会产生 “blocking error” 的 `<system-reminder>`
- [x] 回滚开关：`FORMAX_DISABLE_HOOKS=1`（完全禁用 hooks）

## 待后置（明确不做 / 未来再做）
- [ ] SessionStart/UserPromptSubmit/Stop/SubagentStop/PreCompact 等扩展事件
- [ ] plugins hooks
- [ ] hooks 热重载 vs 会话快照语义（Phase 2+ 再统一产品决策）
