# Backlog — Slash Command 子行输出（扩展范围）

说明：这不是“今日清空”的 TODO 文件，只用于记录后续扩展方向，避免变成大而全的清单。

## dismissed 归属边界（回归测试）

背景：目前 overlay dismissed（`Permissions dialog dismissed` 等）已经通过 `command_subline` 输出展示，但缺少“归属边界”的回归测试锁定。

建议测试（按实际实现取舍其一并锁定）：

- 连续打开/关闭多次，不会把 dismissed 挂到错误的命令/turn 上
- overlay 打开后用户又输入了别的命令/消息，再关闭 overlay：
  - 仍能正确归属；或
  - 明确一个可接受的降级策略，并用测试锁定（避免未来行为漂移）

建议落点：

- `packages/core/src/features/repl/controller/overlays.test.tsx`
- `packages/core/src/screens/REPL.*.test.tsx`

---

未来如果要“最终全对齐”，应把所有 `SlashCommandEffect.kind === local/local_async` 的 stdout 都统一走“命令子行输出”。

- 盘点所有 builtin / plugin slash commands 的输出路径（`registry.ts` / `CommandStore.ts` / `adapter.ts`）
- 统一策略：哪些写入 messages、哪些 UI-only、哪些两者都要
- 分批落地：先 builtin，再 plugin
