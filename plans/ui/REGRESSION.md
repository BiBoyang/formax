# UI 手动回归清单（稳定基座）

目的：在改 UI/键盘交互/输入路由后，用最少步骤确认“没有把别的地方弄坏”。

## 1) SetupWizard（首次设置）

- 进入 SetupWizard 后，`↑/↓` 在 provider 列表里可移动（即使选项 disabled 也能看出光标在动）。
- 在 Base URL 输入框：
  - 可输入/删除；`←/→` 可移动光标并在中间插入字符。
  - `Enter` 提交并进入下一步；`Esc` 退出并返回 REPL。
- 在 API Key 输入框：
  - `mask` 生效（显示 `•`）；`←/→` 仍可移动光标。

## 2) /agents（Agent 创建流程）

- `/agents` 打开列表页：
  - `↑/↓` 可移动；`Enter` 进入；`Esc` 返回/关闭。
- Create new agent：
  - Choose location：`↑/↓` 可移动；`Esc` 回到上一页。
  - Creation method：同上。
  - Generate with Claude：可输入描述；`Enter` 提交。

## 3) /permissions（Workspace roots）

- 打开权限页后，主菜单 `↑/↓/Enter/Esc` 正常。
- `/` 进入搜索后：
  - 可输入/删除；`←/→` 可移动光标并在中间插入字符。
  - `Tab` 切换 tab 后仍可继续操作；`Esc` 退出后 REPL 输入恢复正常。
- Add directory：
  - 输入路径时 `←/→` 可移动光标并在中间插入字符。
  - `Enter` 提交；成功后立即影响 workspace roots（不用重启）。

## 4) Tool approval prompts（Bash/Write/Edit/Skill）

- 出现 approval prompt 时，REPL 不应抢键（`↑/↓` 只移动菜单）。
- 选择 “Type here …”：
  - 可直接输入（包括数字）；`↑/↓` 可跳出输入并保留草稿。
  - 回到该行后可继续编辑；`Enter` 提交 feedback。

## 5) Tool error output（可解释 + 可解析）

目的：确认“关键错误”足够短（1–2 行为主）且包含关键信息，不出现重试指引/术语泄漏（sub-agent 等）。

- Workspace 越界（Read/Glob/Grep 任一）：
  - 触发：`Read(~/.codex/copy.json)`（或其它 workspace 外路径）
  - 期望：输出包含 `Error: Path is outside the workspace`，并至少包含 `Path: ~/.codex/copy.json`（不需要 Hint/roots 等长解释）。
- Bash deny：
  - 触发：`Bash(sudo ls)`
  - 期望：输出包含 `Error: Bash command denied`，并包含拒绝原因（至少一行可读原因）。
