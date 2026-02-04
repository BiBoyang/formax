# Backlog — Slash Command 子行输出（扩展范围）

说明：这不是“今日清空”的 TODO 文件，只用于记录后续扩展方向，避免把 `plans/ui/TODO-command-subline-output.md` 变成大而全的清单。

未来如果要“最终全对齐”，应把所有 `SlashCommandEffect.kind === local/local_async` 的 stdout 都统一走“命令子行输出”。

- 盘点所有 builtin / plugin slash commands 的输出路径（`registry.ts` / `CommandStore.ts` / `adapter.ts`）
- 统一策略：哪些写入 messages、哪些 UI-only、哪些两者都要
- 分批落地：先 builtin，再 plugin

