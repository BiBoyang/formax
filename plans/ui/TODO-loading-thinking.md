# Loading / Thinking status — parity plan

目标：把 Formax 的 loading/thinking 状态定义、切换规则、展示方式对齐 Claude Code（以 `plans/ui/loading-and-thinking.md` + `plans/ui/cladue-code-ctrlo-think.md` 为准），并避免“按耗时推断 thinking”的伪状态。

核心原则（先对齐）

- **不硬造 thinking**：只在模型真实输出 thinking（`thinking_delta` / `thinking` block）时显示 `∴ Thinking…`。
- **thinking 严格跟随 stream**：只在 thinking block 活跃期间显示 `ThinkingStatusLine`；thinking 结束立即消失（不展示 paused/累计），并且每段 thinking 计时从 0 开始。
- **默认 transcript 低噪音**：默认对话列表不展示 thinking 内容；但提供一个入口（`Ctrl+O` 面板）回看“更丰富的对话视图”（包含 thinking）。
- **官方路径优先**：Anthropic thinking 先按官方请求字段开启；不为了“compatible provider”发明新的参数体系。

---

## Phase 0 — 锁定现状（防跑偏）

- [x] 复核当前基线：无 `thinking_delta` 就不显示 thinking（不推断）。
- [x] 写 2 个“准入测试”（先锁现状，再改实现）：
  - [x] 无 `thinking_delta`：不展示 `ThinkingStatusLine`（只展示 loading）。
  - [x] 有 `thinking_delta`：展示 `ThinkingStatusLine`（并进入 `∴ Thinking…` → `∴ Thought for Ns` 的自然过渡）。

验收：
- 发送“你好”，如果 provider 没输出 `thinking_delta`，UI 不出现 `∴ Thinking…`（符合“不硬造”）。

---

## Phase 1 — 让 Anthropic 真的输出 thinking（数据源正确）

说明：目前 “看不到 thinking” 很可能是请求层没有开启 thinking，导致根本收不到 `thinking_delta`。

- [x] `src/streaming/anthropic/StreamClient.ts`：在 request payload 中按官方方式开启 thinking（Anthropic-only）。
  - [x] 使用安全默认值（`budget_tokens`），可配置项留到 Phase 4。
- [x] 补/改单测（不依赖真实网络）：
  - [x] request body 包含 `thinking` 字段（并保持现有 `anthropic-beta` header）。
  - [x] provider 不支持 thinking 时自动重试（去掉 `thinking` + `anthropic-beta`）。
  - [x] `thinking_delta` 能正确触发 `onThinkingDelta` → `StreamEvent.thinking_delta`。

验收：
- Anthropic provider（支持 thinking 的模型/账户）下，发“你好”能看到 `∴ Thinking…`（来源于真实 `thinking_delta`）。

---

## Phase 2 — thinking 计时与切换规则（不再 100+ 秒）

目标：thinking 计时只覆盖 thinking block 活跃段；thinking 结束立即隐藏；并保持 UI 规则可预测。

- [x] `src/features/repl/controller/streaming.ts`：明确计时规则并补测试：
  - [x] `thinking_delta` 首次出现时开始计时。
  - [ ] thinking block stop (`content_block_stop`) 触发 `thinking_stop` 事件，并停止计时 + 隐藏状态行。
  - [ ] 回退兜底：遇到 `tool_start` / `assistant_delta` / `complete` 时也会停止计时（防 provider 不发 stop）。
- [ ] 处理边界：
  - [ ] 多段 thinking（think → tool → think）应每段从 0 开始（不累计），并补一个回归测试钉死。

验收：
- 一个“think → tool（长时间）→继续”流程中，thinking 状态行会在 thinking 结束后立即消失；且再次 thinking 重新从 0 开始。

---

## Phase 3 — Ctrl+O：回看“更丰富的对话视图”（包含 thinking）

目标：默认 transcript 仍低噪音；但用户可回看 thinking（类似 Claude Code 的 Ctrl+O 视图），且不是只看裸文本。

- [ ] 设计“回看视图”的数据模型（建议二选一，先做最稳的）：
  - A) 在 `Msg` 上保存本轮 thinking 片段（更易与 transcript 绑定）
  - B) 独立保存 “thinking transcript blocks”，并在面板里与消息列表合并渲染
- [ ] 新增面板组件（建议放 `src/screens/repl/panels.tsx` 同类位置）：
  - [ ] “Detailed transcript (with thinking)”：展示与默认 transcript 相同的对话顺序，但插入 thinking 段（样式低调、可折叠可后置）。
- [ ] `src/screens/repl/hotkeys.ts`：
  - [ ] `Ctrl+O` 在 `thinkingText` 存在时可以打开/关闭该面板（即使 `!isLoading`）。
  - [ ] 不破坏已有的 task transcript / explore agents 逻辑（明确优先级：thinking > task transcript > explore）。
- [ ] 补 UI 测试：
  - [ ] 结束后仍可 `Ctrl+O` 打开 thinking 回看面板。

验收：
- 请求结束后，默认 transcript 不展示 thinking；但 `Ctrl+O` 能打开回看视图（包含 thinking）。

---

## Phase 4 — 配置闭环（可后置）

- [ ] 提供开关（默认开启 thinking）：
  - [ ] `FORMAX_THINKING=1/0` 或 settings 配置（以后再决定最终形态）。
- [ ] thinking budget 可配置（但保持默认“无需配置也能用”）。
