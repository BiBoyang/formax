# 2026-05-12 - Working-set selector v4

## 背景

`CCA-130` 之后，auto compact 已经能把最近成功的 `Read` / `Grep` / `Glob` filesystem cluster 识别成 working-set anchor。

但 selector 仍然把所有 anchor 都当成“最多只允许回卷 1 个 extra user turn”。

这会导致一个问题：

- 用户先做 filesystem exploration
- 然后连续进行两轮轻量迭代
- 当前任务其实还明显依赖那组文件 / grep / glob 结果
- 但 selector 会把这组 filesystem cluster 过早判成 stale

## 这轮调整

working-set selector 现在按 anchor kind 区分 backtrack window：

1. `read`
   - 继续保持 `1` 个 extra user turn 的回卷窗口
2. `filesystem_cluster`
   - 提升为 `2` 个 extra user turn 的回卷窗口

同时，`/context` diagnostics 现在会显式暴露：

1. `anchorBacktrackTurns`
2. `anchorMaxBacktrackTurns`

这样可以区分：

- 这次实际回卷了多少
- 当前策略最多允许回卷多少

## 为什么这样做

这不是在“无限保留旧上下文”，而是在更接近 task-minimal working set：

- 单一 `Read` anchor 仍然保持保守
- multi-tool filesystem cluster 获得更宽一点的任务延续窗口

这样能减少“刚做完 grep/glob/read 的文件探索，只因为多了一轮产品文案/命名迭代就把上下文整段丢掉”的情况。

## 边界

这轮仍然不是最终 working-set selector：

1. 还没有做更广义的任务相关 working-set 识别
2. 还没有把 session-memory / restore artifacts 直接并入 anchor 选择
3. 还没有改变 compact protocol / persisted semantics

它只是 working-set v4 的第一刀。
