# Backlog — Approval UI (post-alignment)

说明：Approval UI 的“对齐主干”（顶线/标题/预览/Markdown 渲染 + 回归测）已完成并合并到主分支。

这里仅记录后续可能值得做但不影响主线的增强项（后置，避免继续维护一个 `TODO-approval-preview.md`）。

## Potential follow-ups

- 抽取更中立的 `ApprovalFrame` 组件（如果未来 overlays 也要复用 approval 的结构）
  - 现状：已有 `src/components/ui/ApprovalHeader.tsx` / `src/tools/presenters/ApprovalPreview.tsx` / `src/components/ui/MarkdownBlock.tsx`
  - 目标：把“顶线 + Title + children”这层提升为更通用、可复用的框架组件

- 扩展到更多工具的 preview（按需）
  - `Edit` / `NotebookEdit`（diff/patch preview）
  - `WebFetch` / `WebSearch`（URL/摘要 preview）
  - `Skill`（指令/说明 preview）

- “代码高亮”策略（目前明确不做）
  - 轻量 tokenizer（无新依赖）vs 引入高亮库（需要评估体积/ANSI 审计/性能）
