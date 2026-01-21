# TODO：/permissions（仅保留未完成项）

证据与现状：`plans/_archive/iam/index.md`（Claude Code 文档）+ 终端实测（抓包/复制）。

## Pending（未完成/需抓包确认）

- [ ] local command 的 permissions key 形式（Claude 里到底落在什么 ToolName/spec）
- [ ] Settings 字段名/更多权限类型：如需继续对齐 Claude，再补齐（当前最小 schema 已可用）

## Notes（已落地的基座能力）

- 已支持 `Skill` / `Bash` 的 permissions allow/ask/deny 基座（落盘到 `<projectRoot>/.formax/settings.local.json`，并在运行时合并 user/project/projectLocal 三层）。
- 规则语义按 Claude 文档：评估顺序 `deny → ask → allow`；规则格式为 `Tool` 或 `Tool(specifier)`；匹配全部 Bash 用 `Bash`（不是 `Bash(*)`）。
- Bash 通配符语义按 Claude 文档：`:*`（仅末尾，带单词边界的前缀匹配）与 `*`（任意位置，无单词边界的 glob 匹配）。
- permissions 写入后 **同进程内立即生效**（不跨 tool call 缓存权限文件）。
- Workspace 的 `additionalDirectories` 目前是**会话态（in-memory）**：写入后立刻影响 workspace roots，但不会写入 `.formax/settings*.json`，进程退出即消失。
- sub-agent 子会话内不允许进入“需要审批”的交互提示（避免后台/子会话卡住）；如触发将返回 `Error: Approval required`。
