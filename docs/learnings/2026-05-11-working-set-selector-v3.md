# 2026-05-11 - Working-set selector v3

- auto compact 的 working-set anchor 不再只认最近成功的 `Read` turn，当前会把最近成功的 `Read` / `Grep` / `Glob` filesystem tool cluster 一起视为 working-set 候选。
- 这次没有放宽回卷窗口；仍然只允许很窄的额外 backtrack。先扩大 anchor 识别范围，再观察是否真的需要扩大回卷深度。
- `nextTurnFixed.workingSetSignals` 现在除了 recent files / plan / todo / mode boost，还会显式给出：
  - `anchorKind`
  - `anchorToolNames`
  - `anchorBacktrackTurns`
- 这样 `/context` 不再只能说“为什么 keep_combo 更激进”，还可以直接说“working-set anchor 是哪类 filesystem cluster，以及它实际把 tail 往前拉了几轮”。
