# 2026-04-06 per-system-section diagnostics

`CCA-010` 这轮把 `/context` 里的 system prompt 视图从“单个黑盒 token 块”推进成了更细的 section breakdown。

## 为什么要做

之前 diagnostics 已经能看：

- system 总量
- history 总量
- tool-result slices
- top contributors

但 `top contributors` 里 system 仍然只会显示成一条 `System prompt`。这会带来两个问题：

1. 我们知道 system 很重，但不知道到底是哪一段重。
2. diagnostics 会把“历史太大”和“system 某个 section 太大”混在一起，不利于后续调 prompt exposure / reminders / output-style。

## 这轮怎么做

这轮没有去改 system prompt 组装逻辑，而是在 diagnostics 层增加了只读拆分：

- 第一块无 heading 文本会标成 `System section: Identity`
- heading 前正文会标成 `System section: Preamble`
- 顶层 `# section` 会各自作为独立 section
- `##` 子标题当前仍并入所属顶层 section

这样可以保持：

- prompt 行为不变
- diagnostics 视图更细
- top contributors 不再把 system 当成单个黑盒

## 一个实现上的取舍

`systemSectionBreakdown` 最开始我让它直接按 token 排序，但后来改成保留 prompt 原顺序。

原因是：

- `breakdown` 更像结构视图，按原顺序更好读
- `top contributors` 本身已经会按 token 重新排序

所以最后的规则是：

- `systemSectionBreakdown`：保留 prompt 顺序
- `topSnapshotContributors` / `topAssembledContributors`：按 token 排序

## 协议边界

这轮没有 bump `/context` diagnostics 的 `schemaVersion`。

新增的 `snapshot.systemSectionBreakdown` 目前作为 additive field：

- JSON diagnostics 会直接带出
- app-server `local.diagnostics` 也会带出
- Web parser 会在字段存在且 shape 合法时解析
- 字段缺失仍然保持兼容

这符合之前 `CCA-072` 里定下来的规则：`schemaVersion=1` 下允许附加字段，客户端必须忽略未知字段。
