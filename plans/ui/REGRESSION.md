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
- Add directory：
  - 输入路径时 `←/→` 可移动光标并在中间插入字符。
  - `Enter` 提交；成功后立即影响 workspace roots（不用重启）。

## 4) Tool approval prompts（Bash/Write/Edit/Skill）

- 出现 approval prompt 时，REPL 不应抢键（`↑/↓` 只移动菜单）。
- 选择 “Type here …”：
  - 可直接输入（包括数字）；`↑/↓` 可跳出输入并保留草稿。
  - 回到该行后可继续编辑；`Enter` 提交 feedback。

