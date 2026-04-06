# 2026-04-06 context lifecycle markers

`CCA-011` 这轮把 `/context` diagnostics 从单点快照推进成了 staged lifecycle 视图。

## 为什么要做

之前我们已经能看：

- snapshot 总量
- next-turn fixed total
- microcompact impact
- top contributors

但还看不到“在真正进入 compact 之前，中间几层分别省了多少”。

这会让我们很难回答：

1. 这轮主要是 `microcompact` 起作用，还是 `prune` 起作用？
2. 如果走到 compact，和前两层相比还能再省多少？
3. 目前 staged pipeline 里的哪一层最值得继续优化？

## 这轮怎么做

这轮没有真的执行 compact，而是做了 **non-destructive staged projection**：

1. `snapshot`
2. `post_microcompact`
3. `post_prune`
4. `post_compact`

其中：

- 前三层直接复用当前 diagnostics / microcompact / prune 规则
- `post_compact` 使用 session-memory compaction 路径做本地模拟
- 所有阶段都只用于 diagnostics，不会回写 history，也不会触发真实 compact lifecycle

## 一个重要取舍

`post_compact` 不是模型真实摘要结果，而是本地可重现的 compact projection。

这样做的原因是：

- `/context` 必须是本地 diagnostics，不应该为了看报告去触发一次模型 compact
- staged 比较的目标是“看趋势和差异”，不是精确预测真实模型摘要文本

所以这轮 lifecycle markers 的定位是：

- 用来比较压缩阶段效果
- 不是用来替代真实 compact runtime 结果

## 当前输出位置

这轮新增的 markers 当前挂在：

- text diagnostics：`Lifecycle markers before future user text`
- JSON / app-server payload：`nextTurnFixed.lifecycleMarkers`

每个 marker 当前至少包含：

- `stage`
- `label`
- `totalTokens`
- `historyTokens`
- `fixedTokens`
- `deltaFromSnapshot`
- `remainingToEffectiveLimit`
- `remainingToAutoCompactLimit`
- `shouldAutoCompact`
