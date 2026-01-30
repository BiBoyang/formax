# TODO — Slash Command “子行输出”对齐（/agents /permissions /hooks /todos）

目标：把这些命令产生的“本地信息/提示/关闭提示”在 UI 上对齐为 **命令的子行**（`⎿ ...`），避免被渲染成 assistant 消息导致出现 `⏺`、assistant margin、以及额外空行。

关键原则（必须保持）：

- **UI 展示** 与 **是否写入下次 messages** 正交：
  - “写不写入下次 messages”仍由现有链路 `recordForNextTurn -> pendingInjectedBlocksRef` 决定。
  - 本 TODO 只改 UI 渲染语义，不擅自改变“是否写入 messages”的业务逻辑。
- 先只做 4 个命令：`/agents`、`/permissions`、`/hooks`、`/todos`（其它命令只记录为后续扩展）。

---

## P0 — 对齐规格锁定（最小化）

- [ ] 在本文档里补一段“对齐示例”（参考 `plans/features/diff.txt`）：
  - [ ] `/permissions` dismissed：应显示为 `  ⎿  Permissions dialog dismissed`（不出现 `⏺`）
  - [ ] `/agents` dismissed：同样为 `  ⎿  Agents dialog dismissed`
  - [ ] `/hooks` dismissed：同样为 `  ⎿  Hooks dialog dismissed`
  - [ ] `/todos` 输出：仍作为命令子行展示（但 **仍保留写入 messages**）

---

## P1 — 建立“命令子行输出”通道（UI-only）

（已完成，见 git 历史）

---

## P2 — Overlay dismissed：/agents /permissions /hooks

目标：关闭 overlay 时的 “... dialog dismissed” 不再通过 assistant Msg 输出。（已完成，见 git 历史）

边界（必须覆盖）：

- [ ] 连续打开/关闭多次，不会把 dismissed 挂到错误的命令上
- [ ] 在 overlay 打开后，如果用户又输入了别的命令/消息，再关闭 overlay，仍能正确归属（或给出可接受的降级策略并测试锁定）

---

## P3 — “Usage/误用参数”输出：/agents /permissions /hooks

目标：误用参数时的 Usage 输出也要作为命令子行，不出现 assistant `⏺`。

- [ ] 识别：`src/features/commands/registry.ts` 里这三个命令的参数校验/Usage 输出
- [ ] 改造：把 Usage 文本走 `commandSubLines` 渲染（不再作为 assistant Msg）

验收：

- [ ] `/agents x`、`/permissions x`、`/hooks x` 的 Usage 输出为命令子行

---

## P4 — /todos 输出对齐为命令子行（但仍写入 messages）

目标：UI 上 /todos 的输出结构对齐 Claude Code（命令子行），同时不改变它“写入下次 messages”的既有行为。

（已完成，见 git 历史）

---

## P5 — 测试：锁定 UI 语义（防回归）

优先只锁 4 个命令，避免 scope 过大：

- [ ] `/agents|/permissions|/hooks` Usage：同上（命令子行，不出现 `⏺`）
（`/permissions`/`/agents`/`/hooks` dismissed + `/todos` 关键路径已完成，剩余项见上）

建议落点（可按实际选用）：

- `src/features/repl/controller/overlays.test.tsx`
- `src/screens/REPL.*.test.tsx`
- `src/features/repl/injectedBlocks.test.ts`

---

## Backlog — 扩展到其它 commands（先记录，暂不做）

说明：未来如果要“最终全对齐”，应把所有 `SlashCommandEffect.kind === local/local_async` 的 stdout 都统一走“命令子行输出”。

- [ ] 盘点所有 builtin / plugin slash commands 的输出路径（`registry.ts` / `CommandStore.ts` / `adapter.ts`）
- [ ] 统一策略：哪些写入 messages、哪些 UI-only、哪些两者都要
- [ ] 分批落地：先 builtin，再 plugin
