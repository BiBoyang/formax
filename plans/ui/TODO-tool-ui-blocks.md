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
- [x] 单一事实来源：`⏺` 后严格 1 个空格（避免 `⏺  Read` / `⏺Read`）
- [x] 单一事实来源：subline 前缀固定为 `  ⎿  `，且不会双缩进
- [x] 把 header 抽到 `src/components/tool/ToolHeaderLine.tsx`（pulsing dot + toolName + params）
- [x] 把 subline/缩进抽到 `src/components/tool/ToolSubline.tsx`（subline + indented lines）
- [x] 把 prefix/indent 常量集中到 `src/utils/toolUi.ts`（避免 presenter 私下拼空格）
- [x] 迁移 tool presenters 使用 `ToolHeaderLine` / `ToolSubline`（不改业务逻辑/上下文）
- [x] 回归测试：锁住 header 不出现 `⏺  Read`（见 `src/components/tool/ToolMessage.test.tsx`）
- [x] 回归测试：锁住 completed/error 具有 `⎿` 前缀（多处已有断言）
- [x] 记录 CC 事实：`Update` 是 **Edit 的 UI 展示名**（不是合并）（已记入 `plans/ui/tool-ui-blocks.md`）

### Phase B — 结构化 blocks（可选，暂不做）
说明：如未来确实需要 `ToolUiBlock`（比如想做“更强的稳定渲染/序列化/跨视图复用”），再回头按 `plans/ui/tool-ui-blocks.md` 落地。

---

## Backlog / Follow-ups（不阻塞 Phase A）

- [x] 去除 overlay 对 `src/tools/presenters/*` 的反向依赖：把 `ApprovalHeader` 抽到中立 UI 层（`src/components/ui/`），并由 tools/presenters 与 overlays 共用；原路径通过 re-export 过渡（见 `src/tools/presenters/ApprovalHeader.tsx`）。

---

### 验收点（你验收用）
- `⏺` 后空格：任何 tool header 必须是 `⏺ ToolName`（禁止 `⏺  ToolName` / `⏺ToolName`）
- `⎿` 缩进：subline 必须可复制为 `⎿` 前缀 + 单行 summary，且不会双缩进
- presenter：无需“改返回类型”，也不需要逐个 presenter 手工对齐空格
- 测试：新增/更新的测试能稳定通过（不依赖 timing 的 flaky）
