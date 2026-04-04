# 2026-04-05 reactive compact MVP

## 背景

在 `microcompact`、memory-first auto compact、partial compact MVP 都补上之后，Formax 仍然缺一条很实际的兜底链：

> 估算没超，但 provider 真的报“上下文太长 / 请求太大”时，不能直接失败。

Claude Code 在这一层有 reactive compact。  
Formax 这次先补的是一个保守 MVP：

- 只在主 turn 的首次 provider 调用失败后触发
- 只匹配上下文超限类错误
- 只重试一次

## 这次做了什么

1. 新增了保守的错误检测器：
   - 匹配 `HTTP 413`
   - `prompt too long`
   - `maximum context length`
   - `context limit`
   - `too many tokens`
2. 对 auth / rate-limit 这类错误明确排除，避免误判。
3. `runMainSendTurn(...)` 现在在首次 provider 调用命中这类错误时，会：
   - 先尝试 `session memory` compact
   - 不行再 fallback 到 model-summary compact
   - compact 成功后重新组装 turn，并只 retry 一次
4. reactive compact 会写入自己的 compact lifecycle source / boundary trigger：
   - `reactive`

## 一个重要取舍

这次没有把 reactive compact 做成“递归重试直到成功”。

原因很简单：

1. 无限 retry 风险很高
2. 一次 reactive compact 之后如果还失败，问题通常已经不只是“差一点点”
3. 先把单次、可解释、可观测的 fallback 路径做稳更重要

所以这次的规则是：

- **最多一次 reactive compact**
- **最多一次 retry**

## 另一个细节

最开始实现时，abort-like 错误会在 reactive 分支判定里被读两次。  
测试先把这个问题炸出来了：第一次被内层判断消费，第二次外层 catch 就不再认为它是 abort。

后来改成：

- 内层一旦识别到 abort-like，就先记住
- 外层最终结算时优先使用这个记录

这样 reactive compact 不会把 abort 语义带歪。

## 当前边界

这还是 MVP：

1. 还没有 provider-specific structured error parsing
2. 还没有 richer diagnostics，暂时看不到“为什么这次 reactive compact 被触发/跳过”
3. 还没有和 app-server / richer telemetry 单独对齐
4. 还没有多次分段 retry 策略

## 为什么这一步值

这轮最大的价值不是“又加了一个功能点”，而是把 Formax 从：

- “估算型 auto compact”

推进到了：

- “估算型 auto compact + provider 实际失败后的受控 fallback”

这一步是向 Claude Code 后半段能力靠拢时非常关键的现实补丁。
