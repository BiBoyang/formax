# TODO：稳定性 / 可预测性（仅保留未完成项）

目标：不急着加新功能，优先把“会导致误操作/难排查/不稳定契约”的问题压下去，让后续扩展更可控。

约束：
- 不做大搬家/大重构（避免 churn）
- 每个小项完成就独立 commit（可回滚）
- TODO 只记录“未完成项”，完成后删除（有 git 不怕丢）

---

已完成项（仅定位参考）移动到：`plans/_archive/stability/COMPLETED-2026-01-26.md`

## S8 — 结构化输出保护（先写 TODO，等抓包确认后再动）

说明：Claude Code 有一类 `<system-reminder>` 会出现在 tool_result 的尾部（抓包能看到），但我们无法 100% 判断其“注入位置/注入时机/是否所有工具都这样”。为了避免误改业务逻辑，S8 先只做“测试设计/待确认”，等你抓包确认后再落地实现。

- [ ] S8-1：列出“需要抓包确认”的问题清单（不改代码）
  - [ ] 注入“位置/载体”
    - [ ] 是追加在 tool_result 的 `content` 末尾，还是作为**紧跟的 text content block**？
    - [ ] 是否只在“用户可见的 tool 输出”里出现，还是也会进入发送给模型的 messages？
    - [ ] 是否会被渲染层过滤（UI 不展示 `<system-reminder>`，但仍发送给模型）？
  - [ ] 注入“触发条件”
    - [ ] Read/Glob/Grep：是否只有特定安全场景才出现（例如 malware/敏感内容），还是每次都可能？
    - [ ] TodoWrite：是否只在“最近没用/列表为空/列表 stale”时出现，而不是任何时候都出现？
    - [ ] 是否与会话状态相关：plan mode / accept edits / tool 连续失败等会触发不同 reminder？
  - [ ] 注入“去重/频率/合并”
    - [ ] 同一种 reminder 在一个会话内会出现几次？是否有冷却时间/每 N 轮一次？
    - [ ] 同一轮里多次 tool_use，会不会合并成一次 reminder（或每次都追加）？
  - [ ] 与上下文管理的交互
    - [ ] `<system-reminder>` 是否参与 compact/prune 的截断与预算估算？
    - [ ] 这类文本是否会显著占用 token（社区反馈里常见的 10–15%）？
  - [ ] 我们的策略（先写共识，不改代码）
    - [ ] Formax **不把 reminder 注入到 tool_result**（避免污染结构化输出），只考虑“作为紧跟 text block”的方案
    - [ ] 如果将来要做 reminder：必须有去重/冷却/裁剪（避免 token 爆炸）

---

## S9 — 输入路由 / Overlay 稳定性（来自 `plans/stability/webgpt.txt`）

说明：把 `plans/stability/webgpt.txt` 的建议转成“可执行 + 可验收”的 TODO；并标注当前状态（未做/已做/后置）。

### P0（最高优先级）

### P1（高优先级）

- [x] S9-P1-3：split ESC arrow sequences 覆盖
  - 已有单测：`src/features/repl/keys/escapeSequences.test.ts`（覆盖分段 `\u001B` + `[` + `A/B` 等）
  - 统一消费入口：`consumeBufferedArrow` 已在 `ConfirmMenu` / `AgentsDialog` / `PermissionsDialog` / `HooksDialog` 复用

- [x] S9-P1-4：/clear flash hardening
  - 已有回归：`src/screens/REPL.test.tsx`、`src/features/repl/useReplController.test.tsx`
  - 备注：终端“闪屏”偏 manual/渲染时序问题；如后续复现再补更细粒度 frame 断言

- [x] S9-P1-5：防止 rogue `useInput`（绕过 scope routing）
  - 已有审计测试：`src/features/repl/useInputAudit.test.ts`

### P2（后置/可选）

- [ ] S9-P2-1：`REPL.tsx` 抽 prompt input + slash suggestions 为内部 hook（不改行为）
  - [ ] 仅重构：把 `input` / `slashIndex` / selection state / suggest logic 收敛到 `usePromptLine()`（或类似）
  - [ ] 主要回归：`src/screens/REPL.slashSuggestions.test.tsx`

- [ ] S9-P2-2：`useReplController.ts` DRY reset（不改行为）
  - [ ] 抽出 `resetStreamingRefs()` / `resetSessionState()` 供 abort/newSession/send 复用（减少重复 reset 漂移）

- [ ] S9-P2-3：router perf guardrail（不改行为）
  - [ ] 0/1 handler 快路径（避免每 key clone/sort）
  - [ ] （可选）缓存 ordered handlers 并在 register/unregister 失效

---
