## Tool UI Blocks (方案 C-lite) — Spec

目的：把 Tool transcript 的展示（⏺ 头、⎿ 子行、缩进、颜色）收敛为“结构化 blocks + 单一 renderer”，同时保留每个 tool 的特殊 UI 能力。

本 spec 只覆盖 **Phase A**（公共展示规则），暂不讨论：
- `Read + Edit => Update` 的聚合语义（Phase B）
- tooling “真实上下文注入”策略变化（messages/injected blocks 的策略不变）

补充澄清（已对齐）：
- Claude Code 的 `Update` **不是** “Read+Edit 合并”，而是 **Edit 的 UI 展示名**（UI-only label mapping）。
- 但该映射属于“后续优化”，不应阻塞当前 Phase A；实现时建议在 renderer 层做可控开关/小步落地。

---

## 术语

- **Tool header**：`⏺ ToolName(params)` 这一行（含 pulsing dot）
- **Subline**：tool result 第一行（带 `⎿` 前缀）
- **Indented lines**：tool result 的中间行/expandInfo（对齐 subline 的内容列）

---

## Schema

### `ToolUiBlock`（最小集合）

目标：足够覆盖 80% 工具的“通用渲染”，并通过 `custom` 保留逃生舱给复杂场景。

```ts
export type ToolUiBlock =
  | ToolUiHeaderBlock
  | ToolUiSublineBlock
  | ToolUiLinesBlock
  | ToolUiCustomBlock

export type ToolUiHeaderBlock = {
  kind: 'header'
  status: 'running' | 'completed' | 'error'
  toolName: string
  params?: string | null
}

export type ToolUiSublineBlock = {
  kind: 'subline'
  status: 'completed' | 'error'
  text: string
}

export type ToolUiLinesBlock = {
  kind: 'lines'
  lines: Array<{
    text: string
    tone?: 'default' | 'muted' | 'error'
  }>
}

export type ToolUiCustomBlock = {
  kind: 'custom'
  node: React.ReactNode
}
```

说明：
- `header` 必须是结构化的：避免在各处拼 `<PulsingDot />` 导致 Ink whitespace node 反复回归 `⏺  `。
- `subline` 的 `text` 只表示 “summary 内容”，前缀 `  ⎿  ` 由 renderer 统一加。
- `lines` 用于 middleLines / expandInfo / compactErrorDetail 等“缩进内容列对齐”的场景。
- `custom` 是逃生舱：Approval UI / MarkdownBlock / PatchPreview / AskUserQuestion 交互等，先塞进来，不被 schema 卡住。

---

## Renderer rules（唯一事实来源）

### Spacing / indent
- `header`：必须输出 `⏺␠ToolName`（严格 1 个空格），不得出现双空格或无空格。
- `subline`：必须输出 `  ⎿  ` + `text`（前缀内含 2 空格缩进）
- `lines`：必须以 `TOOL_SUBLINE_INDENT` 开头（与 subline 内容列对齐）

### Colors
- dot color：running=secondaryText（pulsing），completed=success，error=error
- tool name：始终 `theme.text` 且 `bold`
- params：`theme.secondaryText`
- subline text：
  - completed：默认色
  - error：`theme.error`
- lines.tone：
  - default：默认色
  - muted：`theme.secondaryText`
  - error：`theme.error`

---

## Integration（双轨）

### Presenter 返回值

短期允许两种输出：
- 旧：`ReactNode`
- 新：`{ blocks: ToolUiBlock[] }`

Router 逻辑：
- 若 presenter 返回 blocks：用 renderer 渲染 blocks
- 否则：直接渲染旧 ReactNode

迁移策略：
- 先迁 Read/Grep/Search
- 复杂工具（Bash/Edit/Write/Task/AskUserQuestion）最后迁移，初期大量使用 `custom`

---

## Testing strategy

优先写 “renderer unit test” 锁公共规则：
- `header` 必须是 `⏺ ToolName`（单空格）
- `subline` 必须含 `  ⎿  `
- `lines` 必须含 `TOOL_SUBLINE_INDENT`

再加一个最小集成测试：
- 某个迁移工具（Read）在常见输入下渲染输出不变（除了公共规则修正）。
