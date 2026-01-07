# Tools 系统：已完成内容 & 后续计划

> 目标：逐步对齐 Claude Code 的 tool 生态（`proxy/tools-copy.json`），同时保持 formax 的实现是「可插拔工具模块化」。

## 当前架构（本项目真实实现）

- **工具规范来源（Spec）**
  - 基础：`proxy/tools.json`（为了测试 token/成本，暂时只放子集）
  - 增量：各 Tool Module 通过 `ToolRegistry.specOverride` 注入（逐步补齐 `tools-copy.json` 的全集）
  - Patch：`src/tools/patches/*`（例如 Task 的 schema/description 动态补齐）

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
    - 支持 `AskUserQuestion` “暂停 → 等待用户输入 → 继续执行”

## 已集成/已实现（重点变更）

### 1) Claude Code 风格的「后台任务链路」

- `Task(run_in_background=true)` → 立即返回 `{ task_id }`，后台跑 sub-agent
- `Bash(run_in_background=true)` → 立即返回 `{ task_id, shell_id }`，后台跑 shell 命令
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
- `Task`（sub-agent）
- `TaskOutput`
- `AskUserQuestion`
- `KillShell`

仅实现 presenter（用于更接近 Claude Code 输出风格）：
- `Search`（目前仅渲染层；执行仍以 Grep/Search 等为准）

### 3) Slash 命令下拉提示（Claude Code 风格）

- 输入框以 `/` 开头时显示命令列表（支持上下键选择、Tab 补全、Enter 先补全后发送）
- 未实现的命令会在列表中置灰（目前本地仅实现 `/init`、`/tasks`）
- 位置：
  - 命令表：`src/features/commands/registry.ts`
  - 渲染：`src/components/chat/InputBar.tsx`
  - 交互：`src/screens/REPL.tsx`

## tools-copy.json 还缺什么（未实现）

来自 `proxy/tools-copy.json`（对齐目标）但目前仍缺：
- `EnterPlanMode` / `ExitPlanMode`（计划模式：状态机 + UI + prompt 策略）
- `SlashCommand`（`/` 命令面板/补全/解释；目前只有 `/init`、`/tasks` 是本地命令）
- `Skill`（技能执行：需要定义“skill 是什么/从哪里来/是否允许访问哪些能力”）

## 后续建议路线（按价值/依赖排序）

1. **命令系统统一（SlashCommand + 本地命令）**
   - 把 `/init`、`/tasks` 收敛到“命令注册表”
   - 本地实现 `/status`、`/doctor` 等（先做 stub 输出也行），避免落到模型乱跑
   - `SlashCommand` tool 先做最小闭环：列出可用命令/执行命令/返回说明（与 UI 下拉提示共用同一份命令源）

2. **Plan Mode（Enter/ExitPlanMode）**
   - 增加 “planMode state” + UI 标识
   - planMode 下修改 system prompt（偏规划、少执行），并可一键退出

3. **Skill 工具定义**
   - 明确 skill 的来源（本地文件？内置模板？远端？）
   - 给出最小可用实现（例如：skill=“code-reviewer” → 触发 Task 或载入预置 prompt）

4. **完善后台任务体验**
   - `/tasks` 输出更像 Claude Code：过滤、详情、默认排序、展示最近输出片段
   - 长输出分页/折叠策略统一（TaskOutput 与 Bash）
   - 任务持久化（可选）：重启后还能看到历史任务/输出（写入 logs）

5. **工具规范生成（长期）**
   - 逐步摆脱手写 `proxy/tools.json`：由 Tool Modules 生成/拼装 spec（保持唯一事实来源）
   - `tools-copy.json` 继续作为“对齐参考全集”，但最终运行时应以模块为准
