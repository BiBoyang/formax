# CCA-060 Partial Compact Go/No-Go Checklist

更新时间：2026-04-04
状态：当前结论 = `NO-GO`

## 目的

这份清单不是 partial compact 的实现方案本身，而是用来判断：

1. 现在能不能安全开始做 `CCA-061`
2. 如果还不能，最先该补哪些前置依赖
3. 哪些项是 blocker，哪些项只是加分项

这里的 partial compact，特指：

> 只替换某个 compact boundary 之前的旧段，而不是每次把整段历史重新压成一条 summary。

## 当前结论

当前 Formax **还不适合直接实现 partial compact**。

原因不是“压缩逻辑不够多”，而是**协议和恢复层还不够稳**：

- boundary 已存在，但 prompt 组装还不是 boundary-first continuation view
- 还没有 preserved segment metadata
- session persistence / resume 还没有 boundary-aware restore 合同
- app-server / Web 还没有 compact boundary 事件级协议

如果在这些条件没补齐前直接做 partial compact，很容易把问题从“上下文压缩”升级成：

- history relink 错位
- resume 后 continuation view 不一致
- Web/TUI replay 分叉
- session restore 恢复不出正确的 compact 语义

## Go/No-Go 总表

| 项目 | 当前状态 | 结论 | 备注 |
| --- | --- | --- | --- |
| `CCA-022` boundary-first prompt view | 未完成 | Blocker | partial compact 必须先能稳定拿到“最近 boundary 之后的 continuation view” |
| `CCA-023` preserved segment metadata | 未完成 | Blocker | 没有 preserved segment，partial compact 后很难做 relink / resume |
| `CCA-070` app-server compact boundary protocol | 未完成 | Blocker | 跨端看不到 compact 事件级语义时，partial compact 很难做 parity |
| `CCA-071` session persistence / resume boundary-aware restore | 未完成 | Blocker | resume 如果不认 boundary，partial compact 会把恢复链条搞乱 |
| diagnostics 已能看到 latest boundary | 已完成 | Supportive | 有助于调试，但不是单独 blocker 的解除条件 |
| memory-first auto compact | 已完成 | Supportive | 说明 compact 协议可复用，但不等于 partial compact 已具备条件 |
| reactive compact | 未完成 | Non-blocker | 可以后做，不是 partial compact 的前置条件 |

## Blockers（必须先满足）

### 1. `CCA-022`：Prompt View 必须切到 boundary-first continuation view

**为什么是 blocker**

partial compact 的前提不是“会插 boundary”，而是：

> 系统必须已经能稳定地把“最近 boundary 之后的 continuation view”当成真实 prompt 视图来使用。

否则 partial compact 只是多插了几个 boundary / summary message，
但主路径仍然按“全 history + summary user message”来理解上下文，后面会出现：

- boundary 前旧段其实还在逻辑上被重复看见
- partial compact 的收益难以真实生效
- boundary slicing 和 UI / replay 的解释不一致

**当前判断**

- 已有 explicit compact boundary
- 但主路径还没有完全切到 boundary-first continuation view
- 所以仍然是 blocker

**解除条件**

- 主路径 prompt 组装明确以最近 boundary 后的 continuation view 为基线
- 有针对 boundary slicing 的定向测试
- `/context` 或 equivalent diagnostics 能看出 boundary-first 视图

---

### 2. `CCA-023`：必须先有 preserved segment metadata

**为什么是 blocker**

partial compact 的真正难点不是“再做一次 summary”，而是：

> 被保留的 tail / rehydrated state / compact summary 之间如何建立可恢复的关系。

如果没有 preserved segment metadata，未来会很难回答这些问题：

- 哪一段是原样保留的
- 哪一段是被 partial compact 替换的
- resume / replay 时如何重新建立语义边界
- diagnostics 如何解释 compact 结构

**当前判断**

- boundary metadata 已有
- preserved segment metadata 还没有
- 所以仍然是 blocker

**解除条件**

- compact output 中能标识 preserved segment
- metadata 足够支撑 relink / replay / diagnostics
- 至少有最小恢复测试

---

### 3. `CCA-071`：resume / session restore 必须先 boundary-aware

**为什么是 blocker**

partial compact 一旦上线，session 文件里就不再只是“summary + tail”的单层形态，
而会出现更复杂的边界和被替换段。

如果 resume / continue 仍然只把这些内容当普通消息重放，风险很高：

- continuation view 可能和 live turn 时不一致
- boundary 前后的旧段可能重复或缺失
- app-server stale recovery / restore 可能拿错历史基线

**当前判断**

- session persistence 已保存 boundary metadata
- 但 resume / continue 还没有 boundary-aware restore 合同
- 所以仍然是 blocker

**解除条件**

- session restore 流程明确识别 compact boundary
- resume 后 continuation view 与 live turn 一致
- 有 boundary-aware session restore 回归测试

---

### 4. `CCA-070`：compact boundary 必须先升级成跨端协议事件

**为什么是 blocker**

partial compact 不应该只在 TUI 里成立。
如果它上线后只有 TUI 知道 compact 发生了什么，而 app-server / Web 看不到对应语义，后果通常是：

- Web replay 看起来“历史怪怪的”
- diagnostics payload 不足以解释 compact 结构
- 未来客户端想做 richer visualization 时只能猜

**当前判断**

- `/context` diagnostics 已能看到 latest boundary
- 但 compact boundary 本身还不是 app-server 事件级协议
- 所以仍然是 blocker

**解除条件**

- app-server / Web 能识别 compact boundary 事件
- boundary metadata 有明确的跨端消费契约
- 至少有一条 compact event parity 回归链路

## Non-Blockers（可以后补）

### 1. Reactive compact

不是 partial compact 的前置条件。

它当然值得做，但 reactive compact 解决的是：

- provider 侧真正超限时如何 fallback/retry

而 partial compact 解决的是：

- 如何更细粒度地替换旧段

两者相关，但不是严格先后依赖。

### 2. 更细 diagnostics drill-down

message/tool contributor drill-down 很有价值，
但它不是 partial compact 的 blocker。

只要 boundary / preserved segment / restore 这几个协议点没稳，
再细的 diagnostics 也只能帮助观察，不能解决结构不稳定问题。

## 推荐推进顺序

在 `CCA-060` 之后，建议顺序改成：

1. `CCA-022`：boundary-first prompt view
2. `CCA-023`：preserved segment metadata
3. `CCA-070`：app-server compact boundary protocol
4. `CCA-071`：session persistence / resume boundary-aware restore
5. `CCA-061`：partial compact MVP
6. `CCA-062`：reactive compact

## Partial Compact 最小可行范围（供未来 `CCA-061` 参考）

等 blockers 解除后，`CCA-061` 的最小范围建议是：

1. 只允许替换“最近 boundary 之前的最旧一段”
2. 不改 manual `/compact`
3. 不一次做多段 partial compact
4. 先不引入新的 UI 行为
5. 先复用现有 compact boundary / rehydration 协议

也就是说，第一版 partial compact 应该更像：

- 在协议稳定的前提下，对旧段做一次受控替换

而不是：

- 一次性上线多层片段重写系统

## 当前动作结论

`CCA-060` 的输出结论是：

- **当前 partial compact = NO-GO**
- **最先该补的是 `CCA-022` 和 `CCA-023`，然后是 `CCA-070` / `CCA-071`**
- **在这些条件没完成前，不建议直接进入 `CCA-061` runtime 实现**
