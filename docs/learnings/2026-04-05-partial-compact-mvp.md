# 2026-04-05 partial compact MVP

## 背景

在 `CCA-022` / `CCA-023` / `CCA-070` / `CCA-071` 都补齐之后，Formax 已经具备了做 partial compact 的最小协议地基：

- boundary-first continuation view
- preserved segment metadata
- app-server compact boundary event
- boundary-aware session restore

但如果直接把 partial compact 理解成“只压 latest boundary 之前那段”，在 Formax 当前结构里其实不会产生真实收益。

原因很简单：

- live prompt 本来就只看 latest boundary 后的 continuation view
- boundary 之前那段已经不会再进入模型

所以真正有价值的 MVP，不是去动“已经不可见的旧前缀”，而是：

> 当当前 history 已经有 latest boundary 时，auto compact 只重新压缩 **latest boundary 后的 continuation 段**，并保留这段里最新的 working set。

## 这次的 MVP 做了什么

这轮 partial compact MVP 很克制：

1. **只对 auto compact 生效**
2. **只在已有 latest boundary 时生效**
3. **只做单段 partial compact**
4. **手动 `/compact` 不改**

实现上，系统会：

1. 先识别 latest boundary 后的 continuation
2. 让 compact summary 只针对这段 continuation 生成
3. 重新选取 preserved tail
4. 用新的 boundary + summary + tail 替换旧 continuation

## 一个关键细节

旧 compact summary 仍然应该参与“要总结什么”，否则新 summary 可能丢掉前面的压缩上下文。  
但旧 compact summary **不应该再被当作 preserved tail 保留下来**，不然 partial compact 看起来就没有真正替换掉旧 summary。

所以这次专门把两件事分开了：

1. `history`：作为本轮 partial compact 的总结输入
2. `tailSourceHistory`：作为 preserved tail 的候选来源

在 partial 模式下：

- `history` 仍然包含旧 compact summary
- `tailSourceHistory` 则从旧 compact summary 之后开始

这样既保住语义连续性，又避免旧 summary 被继续钉在尾巴里。

## 当前边界

这还是 MVP，不是 Claude Code 完整版 partial compact：

1. 不支持用户指定 `from` / `up_to` pivot
2. 不支持多段 partial compact
3. 不引入新的 compact event 类型
4. 不改变 manual `/compact`
5. 还没有和 reactive compact 组合

## 为什么这一步值得

这轮的收益是实打实的：

1. 已经 compact 过的会话，再次 auto compact 时不会总是把整个 continuation 重压一遍
2. 旧 compact summary 不会再被 keep 策略误保留成尾巴
3. partial compact 终于从“依赖图上的目标”变成了一个真的 runtime 能力
