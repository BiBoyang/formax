# TODO：/permissions（仅保留未完成项）

证据与现状：`plans/_archive/iam/index.md`（Claude Code 文档）+ 终端实测（抓包/复制）。

## Pending（未完成/需抓包确认）

- [ ] local command 的 permissions key 形式（Claude 里到底落在什么 ToolName/spec）
- [ ] Allow 是否也会走“保存位置选择”（目前我们按 `src/entrypoints/permissions.tsx` 的交互：仅 Ask/Deny 需要）
- [ ] Workspace roots 范围确认：是否允许包含 `~`、相对路径、符号链接；建议按“解析为绝对路径并做 realpath 对比”实现
- [ ] Settings 字段名/更多权限类型：如需继续对齐 Claude，再补齐（当前最小 schema 已可用）
