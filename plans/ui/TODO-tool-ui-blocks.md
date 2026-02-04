## Tool UI Blocks (方案 C-lite) — TODO

目标：把 Tool transcript 的“公共展示规则”从每个 `src/tools/modules/*/presenter.tsx` 收敛到一个统一 renderer，避免“改一个空格要改 20 个文件”。

约束：
- 渐进迁移：允许旧 presenter 继续返回 ReactNode，新 presenter 可以返回 blocks（双轨并存）。
- 不中断功能：先做“渲染层收敛”，不做 Phase B（如 Read+Edit 合并成 Update）。
- 测试：只跑涉及文件的测试；不跑 `bun run test:coverage`。

---

### Phase C0 — 定义 schema（文档 + 类型）
- [ ] 定义 `ToolUiBlock` 最小 schema（见 `plans/ui/tool-ui-blocks.md`）
- [ ] 加 `ToolUiBlocks` 类型：`header` / `subline` / `lines` / `custom`（`custom` 允许 ReactNode 逃生舱）
- [ ] 定义 “indent/spacing 规则” 的唯一来源：renderer（`⏺` 后单空格、`  ⎿  ` 前缀、`TOOL_SUBLINE_INDENT`）
- [ ] 记录 CC 事实：`Update` 是 **Edit 的 UI 展示名**（不是合并）；先仅记入 spec，暂不实现（避免影响主线）

### Phase C1 — 落地 renderer（不迁移业务逻辑）
- [ ] 新增统一 renderer：`renderToolBlocks(blocks)`（只负责 Ink UI，不改消息/上下文）
- [ ] 把 “dot + toolName + params” 统一到 `header` block 的渲染里（避免 whitespace node 再次引入 `⏺  `）
- [ ] 把 “tool result subline（⎿）” 统一到 `subline` block 的渲染里（避免双重缩进）

### Phase C2 — 双轨接入（先迁 2–3 个最简单工具）
- [ ] 修改工具 presenter 类型：允许 `present(message) => ReactNode | { blocks: ToolUiBlock[] }`
- [ ] 先迁移：`Read` / `Grep` / `Search`（最少特例）到 blocks（不动其余工具）
- [ ] 在 `ToolRouter`/presenter 选择处：若返回 blocks 就走 renderer，否则走旧 ReactNode

### Phase C3 — 回归测试（锁住“公共规则”）
- [ ] 新增 renderer 单测：`⏺` 后只有 1 个空格（避免回归到 `⏺  Read`）
- [ ] 新增 renderer 单测：`subline` 前缀为 `  ⎿  `，且没有额外 paddingLeft 造成双缩进
- [ ] 新增至少 1 个集成测试：某个迁移工具（如 Read）输出与旧快照一致（除公共规则修正外）

### Phase C4 — 逐步迁移剩余工具（后续）
- [ ] 迁移普通工具（TaskOutput/WebFetch/WebSearch/Glob/KillShell…）
- [ ] 最后迁移特殊工具：Bash/Edit/Write/AskUserQuestion/Task（大量使用 `custom` block 兜底）

---

## Backlog / Follow-ups（不阻塞 Phase A）

- [ ] 去除 overlay 对 `src/tools/presenters/*` 的反向依赖：把 `ApprovalHeader` 抽到中立 UI 层（`src/components/ui/` 或 `src/ui/common/`），并由 tools/presenters 与 overlays 共用；原路径可先 re-export 过渡。

---

### 验收点（你验收用）
- `⏺` 后空格：任何 tool header 必须是 `⏺ ToolName`（禁止 `⏺  ToolName` / `⏺ToolName`）
- `⎿` 缩进：subline 必须可复制为 `⎿` 前缀 + 单行 summary，且不会双缩进
- 双轨：迁移的工具走 blocks，未迁移工具不受影响
- 测试：新增/更新的测试能稳定通过（不依赖 timing 的 flaky）
