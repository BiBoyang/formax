## Tool UI Blocks (方案 C-lite) — TODO

目标：把 Tool transcript 的“公共展示规则”从每个 `src/tools/modules/*/presenter.tsx` 收敛到一个统一 renderer，避免“改一个空格要改 20 个文件”。

约束：
- 渐进迁移：允许旧 presenter 继续返回 ReactNode，新 presenter 可以返回 blocks（双轨并存）。
- 不中断功能：先做“渲染层收敛”，不做 Phase B（如 Read+Edit 合并成 Update）。
- 测试：只跑涉及文件的测试；不跑 `bun run test:coverage`。

### Status

已完成 Phase A（公共展示规则收敛），但实现上没有落地 `ToolUiBlock[]` + `renderToolBlocks(blocks)` 这套“结构化 blocks”。

原因：我们发现多数 tool presenter 会调用 React hooks（例如 `useUserInputManager()`），若把 presenter 改成“既可能是 React 组件又可能是普通函数”，很容易踩到 “hooks 只能在组件内调用” 的坑，导致迁移成本/风险上升。

替代方案：把公共规则收敛到两个**中立 UI primitives**（renderer 的最小形态）：
- `src/components/tool/ToolHeaderLine.tsx`：负责 `⏺ ToolName(params)` 的**唯一**拼接与空格规则
- `src/components/tool/ToolSubline.tsx`：负责 `  ⎿  ` subline 与后续缩进行的**唯一**规则

这样同样达成“改一个空格不需要改 20 个文件”的目标，并且不会破坏 hooks。

---

### Phase A — 公共展示规则收敛（DONE）
- 完成内容已落地；为减少噪音，这里不再逐条列出 `[x]`。
- 关键落点：`src/components/tool/ToolHeaderLine.tsx`、`src/components/tool/ToolSubline.tsx`、`src/utils/toolUi.ts`。
- 回归点：`src/components/tool/ToolMessage.test.tsx`（`⏺` 单空格）、以及各 tool presenter 测试中的 `⎿` 断言。

### Phase B — 结构化 blocks（可选，暂不做）
说明：如未来确实需要 `ToolUiBlock`（比如想做“更强的稳定渲染/序列化/跨视图复用”），再回头按 `plans/ui/tool-ui-blocks.md` 落地。

---

## Backlog / Follow-ups（不阻塞 Phase A）

- `ApprovalHeader` 已抽到 `src/components/ui/`，并通过 `src/tools/presenters/ApprovalHeader.tsx` re-export 过渡。

---

### 验收点（你验收用）
- `⏺` 后空格：任何 tool header 必须是 `⏺ ToolName`（禁止 `⏺  ToolName` / `⏺ToolName`）
- `⎿` 缩进：subline 必须可复制为 `⎿` 前缀 + 单行 summary，且不会双缩进
- presenter：无需“改返回类型”，也不需要逐个 presenter 手工对齐空格
- 测试：新增/更新的测试能稳定通过（不依赖 timing 的 flaky）
