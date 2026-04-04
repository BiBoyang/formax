# 2026-04-04 Explicit Compact Boundary

## What changed

- compact 后的 persisted history 不再只有 summary user message。
- `rebuildHistoryAfterCompaction(...)` 现在会在 summary 之前插入一个 metadata-only compact boundary message。
- boundary 现在会携带最小 metadata：
  - `trigger`
  - `preTokens`
  - `summaryKind`
  - `keepStrategy`
- `keepStrategy` 不再只能表达固定 `keep_last_turns`。
  - 当前 auto compact 已开始使用 `keep_combo`
  - 形态是 `keepLastTurns + keepMinTokens + keepMinUserTurns`
  - 手动 `/compact` 仍保持 `keep_last_turns`
- `keep_combo` 现在又多了一层最小 working-set 保护：
  - 会把最近成功 `Read` 所在的 turn 当成 working-set anchor
  - 只允许回卷最近 1 个额外 user turn，避免很早以前的 `Read` 把 tail 永久钉住
  - 这样可以避免最后一轮聊天文本已经够长时，把刚读过文件的那轮上下文整段裁掉
- boundary 现在还可以携带一个轻量 `rehydrationPlan`，先声明 compact 后哪些状态需要优先补回：
  - `recent_files`
  - `plan_state`
  - `mode_state`
- 当前第一批真正落地的 rehydration 是 `recent_files`：
  - compact summary 会附带最近成功 `Read` 的文件路径清单
  - boundary 里的 `recent_files` 状态会从 `planned` 升成 `applied`
- 当前第二批落地的 rehydration 是 `plan/todos/mode`：
  - compact summary 会附带当前 mode 文本
  - 有 plan path 时会附带 plan path + plan excerpt
  - 有 todo 列表时会附带精简后的 todo summary
  - boundary 里的 `plan_state`、`todo_state`、`mode_state` 会在对应内容真正注入后升成 `applied`
- 当前 `/context` 还能直接读到 `rehydrationCost`：
  - `sectionCount`
  - `estimatedTokens`
  - 这样 compact 后恢复层本身的成本不再是黑盒
- `ChatEngine` 与 token estimation 会在真实 prompt 组装时忽略这类 boundary message。
- `/context --json` 与 app-server `local.diagnostics` 现在会暴露 `latestCompactBoundary`，方便直接检查最近一次 compact 的边界元信息。

## Why this shape

- 这是把 compact 从“消息技巧”往“协议事件”推进的第一步。
- 如果 boundary 直接靠 summary user message 文本语义识别，后续加 metadata、resume slicing、partial compact 都会越来越别扭。
- 如果 boundary 直接作为文本消息发送给模型，又会污染 prompt。
- 所以第一步选择 metadata-only event：
  - session / replay 看得见
  - 后续协议升级有锚点
  - 对现有 transcript 和模型上下文影响最小
- 第二步补最小 metadata，是为了让 boundary 真正开始承担协议职责，而不只是“有一个占位点”。
- 第三步补最小 `rehydrationPlan`，是为了先把“compact 后要补什么”协议化，而不是等真正注入 rehydrate blocks 时再临时发明形状。

## Follow-ups

- 下一步是 `CCA-041`：在 `keep_combo` 起点之上继续演进最小工作集选择器，不只盯着 token 数和 user turn 数，还要更接近“继续工作真正需要的上下文”。
