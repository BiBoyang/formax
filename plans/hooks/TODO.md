# Hooks TODO（事件清单 & matcher 规则）

目标：把“哪些 hook 已实现/未实现、哪些需要 matcher/可省略 matcher”统一落在一处，避免重复确认。

信息来源：
- `plans/hooks/hooks.md`（Claude Code 文档）
- Formax 现状：`src/hooks/types.ts`、`src/hooks/store.ts`、`src/hooks/runtime.ts`、`src/chat/engine.ts`、`src/ui/hooks/*`

## 0) 约定（matcher 怎么算）

- **需要 matcher（必填）**：没有 matcher 就无法区分触发范围（例如某个 tool 或某类通知）。
- **可选 matcher（可省略）**：省略表示“match all”（等价于 `*`）。
- **无 matcher（不适用）**：该事件语义与具体 tool 无关，UI 应隐藏 matcher 页面，存盘 JSON 不写 `matcher` 字段。

> Formax 现状：`eventUsesMatcher()` 目前只对 `PreToolUse/PermissionRequest/PostToolUse` 认为“需要 matcher”。其他事件在 Formax 中目前都按“无 matcher”处理（即便 Claude 文档里可能有 matcher，见下方 TODO）。

## 1) 已实现（Formax）

- [x] `PreToolUse`（需要 matcher）
  - UI：有 `Tool Matchers` 页面
  - 存盘：`hooks.PreToolUse[].matcher` 必须存在
- [x] `PermissionRequest`（需要 matcher）
  - UI：有 `Tool Matchers` 页面
  - 存盘：`hooks.PermissionRequest[].matcher` 必须存在
- [x] `PostToolUse`（需要 matcher）
  - UI：有 `Tool Matchers` 页面
  - 存盘：`hooks.PostToolUse[].matcher` 必须存在
- [x] `UserPromptSubmit`（无 matcher / 不适用）
  - UI：跳过 matcher 页面（直接进入 hooks 列表）
  - 存盘：`hooks.UserPromptSubmit[]` 的 rule **不写** `matcher`
- [x] `SessionStart`（Formax 目前按“无 matcher”处理；Claude 文档有 matcher）
  - UI：当前会跳过 matcher 页面
  - 存盘：当前 rule **不写** `matcher`
  - 触发点（Formax 现状）：`src/chat/engine.ts` 在**进程内首次** `runTurn()` 时调用一次 `runSessionStart()`（后续 turn 不再触发）
  - 现状差异：Claude 文档的 `startup/resume/clear/compact` matcher **尚未实现**
- [x] `Stop`（无 matcher / 不适用）
  - UI：跳过 matcher 页面（直接进入 hooks 列表）
  - 存盘：`hooks.Stop[]` 的 rule **不写** `matcher`

## 2) 未实现（来自 Claude 文档，Formax 还没接线）

- [ ] `Notification`（可选 matcher：省略=match all；文档 matcher 例：`permission_prompt`、`idle_prompt`…）
- [ ] `SubagentStop`（无 matcher / 不适用）
- [ ] `PreCompact`（需要 matcher：`manual` / `auto`）
- [ ] `SessionEnd`（无 matcher / 不适用；有 `reason` 字段）

## 3) 待对齐/待决策（不急，但要记着）

- [ ] **SessionStart matcher 对齐**（Claude 文档：`startup` / `resume` / `clear` / `compact`）
  - 现状：Formax 目前仅有“startup（进程内首次 turn）”的语义，但**没有 matcher 字段/区分**
  - `/compact`：Formax **已实现**（见 `src/features/repl/useReplController.ts` + `src/features/commands/registry.ts`），且有 auto-compact；但当前不会触发 `SessionStart`（`didAttemptSessionStart` 只跑一次）
  - `/clear`：Formax **目前没有**内置 `/clear`（在代码里搜不到 builtin spec），所以也不存在 `clear` matcher 的落点
  - 需要先决定是否要对齐这组 matcher：如果要，需要明确“哪些动作触发 SessionStart/PreCompact/SessionEnd”等事件，以及 matcher 从哪里来
- [ ] **Non-command hooks（prompt hooks）是否支持**
  - Claude 文档：`Stop` / `SubagentStop` 允许 `type: "prompt"` 的 hooks
  - Formax Phase 1：仅 `type: "command"`（更稳、更可控）
