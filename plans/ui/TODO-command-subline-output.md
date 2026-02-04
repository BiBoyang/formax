# TODO — Slash Command “子行输出”对齐（/agents /permissions /hooks /todos）

目标：把这些命令产生的“本地信息/提示/关闭提示”在 UI 上对齐为 **命令的子行**（`⎿ ...`），避免被渲染成 assistant 消息导致出现 `⏺`、assistant margin、以及额外空行。

关键原则（必须保持）：

- **UI 展示** 与 **是否写入下次 messages** 正交：
  - “写不写入下次 messages”仍由现有链路 `recordForNextTurn -> pendingInjectedBlocksRef` 决定。
  - 本 TODO 只改 UI 渲染语义，不擅自改变“是否写入 messages”的业务逻辑。
- 先只做 4 个命令：`/agents`、`/permissions`、`/hooks`、`/todos`（其它命令只记录为后续扩展）。

---

## 已完成（不再在此维护细节）

以下能力已经落地（见 git 历史），本文件只保留“未完成的缺口”：

- 命令子行输出通道（UI-only）
- `/agents`、`/permissions`、`/hooks` 的 overlay dismissed 走命令子行（不出现 assistant `⏺`）
- `/todos` 的 UI 输出走命令子行（且仍保留“写入下次 messages”的既有行为）

---

## P0 — 补齐 `/agents` `/permissions` `/hooks` 的 Usage 输出（命令子行）

目标：误用参数时的 Usage 输出也要作为命令子行，不出现 assistant `⏺`。

- [ ] 定位三条命令的参数校验/Usage 文本来源（`src/features/commands/registry.ts`）
- [ ] 改造：Usage 文本走 `commandSubLines` 渲染（不再作为 assistant Msg）

验收：

- [ ] `/agents x`、`/permissions x`、`/hooks x` 的 Usage 输出为命令子行（不出现 `⏺`）

---

## P1 — dismissed 归属边界：补回归测试锁定

目标：已经实现 dismissed 子行输出，但还缺少边界测试来防回归。

- [ ] 连续打开/关闭多次，不会把 dismissed 挂到错误的命令上
- [ ] overlay 打开后用户又输入了别的命令/消息，再关闭 overlay：仍能正确归属（或给出可接受降级策略，并测试锁定）

建议落点（可按实际选用）：

- `src/features/repl/controller/overlays.test.tsx`
- `src/screens/REPL.*.test.tsx`

---

## Backlog（更多 commands 扩展）

后置项已移到：`plans/ui/BACKLOG-command-subline-output.md`
