# TODO：/permissions（仅保留未完成项）

证据与现状：`plans/_archive/iam/index.md`（Claude Code 文档）+ 终端实测（抓包/复制）。

## Pending（未完成/需抓包确认）

- [ ] local command 的 permissions key 形式（Claude 里到底落在什么 ToolName/spec）
- [ ] Allow 是否也会走“保存位置选择”（目前我们按 `src/entrypoints/permissions.tsx` 的交互：仅 Ask/Deny 需要）
- [ ] Settings 字段名/更多权限类型：如需继续对齐 Claude，再补齐（当前最小 schema 已可用）
