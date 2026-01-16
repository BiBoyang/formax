# Tools 系统：已完成内容 & 后续计划

> 目标：逐步对齐 Claude Code 的 tool 生态（`proxy/tools-copy.json`），同时保持 formax 的实现是「可插拔工具模块化」。

## 当前架构（本项目真实实现）

- **工具规范来源（Spec）**
  - **唯一事实来源**：`src/tools/modules/**` 每个 Tool Module 自带 `spec`（`ToolDefinition`）
  - **运行时聚合**：`src/entrypoints/cli.tsx` 注册 modules → `toolRegistry.listSpecs()` 生成“暴露给模型”的 tools 列表
  - **Patch**：`src/tools/patches/*`（例如 Task 的 schema/description 动态补齐）
  - **对照参考**：`proxy/tools-copy.json`（抓包得到的“参考全集”）；`proxy/tools.json` 不再参与运行时（仅保留为历史/参考）
  - **差异追踪（避免忘记）**：`npm run tools:coverage`（工具名覆盖率）与 `npm run tools:parity`（schema 字段差异）

- **工具执行（Handler）**
  - `src/chat/engine.ts` 流式 loop 解析到 `tool_use` → `executeTool`
  - `src/tools/executor/index.ts` 选择匹配的 `ToolHandler` 并执行
  - 工具执行与 UI 解耦：UI 只消费流式事件与工具结果

- **工具渲染（Presenter）**
  - `src/components/tool/ToolRouter.tsx` 按工具名查 `ToolRegistry.getPresenter`
  - 有 presenter 用 presenter；否则 fallback 到 `src/components/tool/ToolMessage.tsx`
  - 各工具自己的 UI/高亮逻辑尽量放在 `src/tools/modules/<tool>/presenter.tsx`

- **运行时管理器（Runtime Managers）**
  - `src/tools/runtime/taskManager.ts`
    - 管理后台任务：`create/list/wait/cancel`
    - 支持“进行中输出更新”（`updateResult`）与取消（`setCancel` + `AbortSignal`）
- `src/tools/runtime/userInputManager.ts`
    - 支持 “暂停 → 等待用户输入 → 继续执行”（`AskUserQuestion` / PlanMode 确认 / Edit approvals）
    - `isPending(toolUseId)` 允许 UI 判断是否正在等待输入（从而隐藏输入框/避免抢键盘）

## 已集成/已实现（重点变更）

### 1) Claude Code 风格的「后台任务链路」

- `Task(run_in_background=true)` → 立即返回 `{ task_id }`，后台跑 sub-agent
- `Bash(run_in_background=true)` → 立即返回 `{ task_id, shell_id }`，后台跑 shell 命令
- `Bash` → 走 policy 判定 `allow/confirm/deny`；`confirm` 时弹出本地确认 UI（可选“本次会话记住该命令”），确认必须来自用户交互而非模型自填字段（plan mode / sub-agent 默认更严格）
- `TaskOutput(task_id, block, timeout)` → 拉取后台任务输出（running 时也会带当前输出）
- `KillShell(shell_id)` → 取消后台 Bash（通过 `TaskManager.cancel`）
- 内置命令 `/tasks`（不走模型）→ 列出所有后台任务（id/kind/status/label）

入口注册与依赖注入：
- `src/entrypoints/cli.tsx`：创建 `TaskManager/UserInputManager`，注册相关工具；用 `UserInputProvider` 注入 `userInputManager`；并把 `taskManager` 注入 REPL
- `src/features/repl/useReplController.ts`：实现 `/tasks` 命令（不走模型）
- `src/tools/modules/askUserQuestion/presenter.tsx`：交互式问答 UI（选择/多选/Review），提交时调用 `userInputManager.submitAnswers`
- `src/screens/REPL.tsx`：当 `AskUserQuestion` 运行中时隐藏输入框，避免抢键盘；取消时 `abort()` 并显示 “User declined …”

### 2) 已实现的工具（handler + presenter 视情况）

已实现 handler（可执行）：
- `Read`, `Write`, `Edit`, `Glob`, `Grep`
- `Bash`（支持前台/后台）
- `NotebookEdit`
- `TodoWrite`
- `WebSearch`, `WebFetch`
- `SlashCommand`（执行 `.formax/commands/*.md` 自定义命令）
- `Task`（sub-agent）
- `TaskOutput`
- `AskUserQuestion`
- `KillShell`

仅实现 presenter（用于更接近 Claude Code 输出风格）：
- `Search`（目前仅渲染层；执行仍以 Grep/Search 等为准）

### 3) Slash 命令下拉提示（Claude Code 风格）

- 输入框以 `/` 开头时显示命令列表（支持上下键选择、Tab 补全、Enter 先补全后发送）
- 未实现的命令会在列表中置灰
- 位置：
  - 命令注册表（单一事实来源）：`src/features/commands/registry.ts`
  - 渲染：`src/components/chat/InputBar.tsx`
  - 交互：`src/screens/REPL.tsx`
- 说明：
  - `/tasks`、`/plan`：本地命令（不走模型，不污染下一次请求）
  - `/init`：注册为 “LLM 命令”（会把命令 prompt blocks 注入本次请求）
  - `.formax/commands/*.md`：自动加载为插件命令（`foo.md` → `/foo`），执行时会把 md 内容展开并注入本次请求

### 4) Plan Mode（Enter/ExitPlanMode + Shift+Tab）

- REPL 支持 `shift+tab` 循环切换 `normal → acceptEdits → plan`
- plan mode 下会在每个 turn 注入 `<system-reminder>`（偏规划、少执行），并在退出 plan mode 时注入一次“Exited Plan Mode”提醒
- plan mode 围绕一个 **plan file** 运转（默认 `~/.formax/plans/<slug>.md`，可用 `FORMAX_PLAN_DIR` 覆盖）
- plan mode 的限制由工具 handler 侧执行：
  - ✅ `Write/Edit` **仅允许**对 plan file 写入/修改（并跳过逐次确认）；其他路径一律拒绝
  - `Bash` 会按 policy 更严格（通常需要确认或直接 deny）
- `EnterPlanMode` / `ExitPlanMode` tool 已实现交互确认：
  - `EnterPlanMode`：询问是否进入 plan mode（Yes/No）
  - `ExitPlanMode`：询问是否开始实现（auto-accept / manual approve / 反馈修改计划）
- `/plan`：本地命令预览 plan file 内容（不污染下一次请求）
- TODO：统一 handler/presenter 的“是否为 plan file”路径规范化（当前 presenter 里用 `process.cwd()` 解析相对路径；如果后续支持切换 cwd/多工作目录，需要把 cwd 通过 context 传入或抽到共享 util）

### 5) Edit approvals（Write/Edit/NotebookEdit）

- `normal` 模式下：每次 `Write/Edit/NotebookEdit` 都会弹出本地确认 UI（Yes / Yes+allow all / 反馈）
- `acceptEdits` 模式下：自动执行，不再逐次确认
- “allow all edits during this session” 会把 mode 切到 `acceptEdits`
- REPL 在出现上述交互提示时会隐藏输入框，避免键盘事件冲突

## tools-copy.json 还缺什么（未实现）

来自 `proxy/tools-copy.json`（对齐目标）但目前仍缺：
- `Skill`（技能执行：需要定义“skill 是什么/从哪里来/是否允许访问哪些能力”）

## 后续建议路线（按价值/依赖排序）

1. **命令系统统一（SlashCommand + 本地命令）**
   - ✅ 已把 `/tasks`、`/plan`、`/init` 收敛到“命令注册表”（并支持 `.formax/commands/*.md` 插件命令）
   - 本地实现 `/status`、`/doctor` 等（先做 stub 输出也行），避免落到模型乱跑
   - `SlashCommand` tool 先做最小闭环：列出可用命令/执行命令/返回说明（与 UI 下拉提示共用同一份命令源）

2. **Plan Mode（Enter/ExitPlanMode）**
   - 已实现基础闭环；后续可细化：Exit 是否强制 plan 输出、plan 模板/持久化、UI 展示更贴近 Claude Code

3. **Skill 工具定义**
   - 明确 skill 的来源（本地文件？内置模板？远端？）
   - 给出最小可用实现（例如：skill=“code-reviewer” → 触发 Task 或载入预置 prompt）

4. **完善后台任务体验**
   - `/tasks` 输出更像 Claude Code：过滤、详情、默认排序、展示最近输出片段
   - 长输出分页/折叠策略统一（TaskOutput 与 Bash）
   - 任务持久化（可选）：重启后还能看到历史任务/输出（写入 logs）

5. **工具规范生成（长期）**
   - ✅ 已摆脱运行时对 `proxy/tools.json` 的依赖：由 Tool Modules 生成/拼装 spec（保持唯一事实来源）
   - `tools-copy.json` 继续作为“对齐参考全集”（长期目标），并用 `npm run tools:coverage` 跟踪覆盖率
