# Claude Code Gap Snapshot (2026-04-08)

目标：基于当前 Formax 已落地实现，重新评估它与 Claude Code 在“上下文压缩 / 上下文治理”上的差距。

这份文档不再讨论“2026-04-03 调研时 Formax 很弱”的旧状态，而是只看 **现在**。

---

## 1. 一句话结论

如果把 Claude Code 在上下文压缩这块的成熟度看作 `100`，那么当前 Formax 大约已经走到：

- **80 ~ 85 / 100**

更准确地说：

- **前半段骨架已经补得比较扎实**
- **后半段系统化能力仍明显不足**

当前 Formax 已经不再是“只有 `/compact` + prune”的简单实现。  
它已经进入了：

- 分层压缩
- boundary 协议
- compact 后恢复
- session memory
- partial/reactive compact
- request-time collapse
- `/context` 可观测

这六个大方向。

但离 Claude Code 的主要差距，已经不再是“有没有这些能力”，而变成：

1. 这些能力是否已经足够成熟
2. 是否已经贯通整个 runtime / remote / restore / protocol
3. 是否已经形成真正稳定的中间层体系

---

## 2. 当前已经明显追上的部分

## 2.1 分层压缩不再缺席

Claude Code 的重要思想是：

- 不是只做 full compact
- 而是 query 前分层减压

当前 Formax 已经有：

1. `microcompact`
2. `prune`
3. full compact
4. partial compact MVP
5. reactive compact MVP

这意味着：

> Formax 现在已经具备“多层上下文治理”的骨架。

虽然具体成熟度还不如 Claude Code，但“只有 summary compact”这个时代已经过去了。

---

## 2.2 compact boundary 已经从概念变成协议起点

Claude Code 非常强的一点，是 compact 不是数组重写，而是协议事件。

当前 Formax 已经补到了这些：

1. persisted history 里有显式 compact boundary
2. prompt/history 视图会以 latest boundary 后 continuation 为基线
3. diagnostics 能看到 latest boundary
4. session restore / SDK resume 已经认 boundary-first continuation view
5. preserved-segment metadata 已有最小形态

这意味着：

> boundary 这条线已经不是空白，而是一个真正可工作的协议起点。

---

## 2.3 compact 后恢复已经不再只是“留一段 summary”

Claude Code 的 compact 强，不只是摘要 prompt，而是 compact 后仍能继续工作。

当前 Formax 也已经开始这样做：

1. rehydrate 最近成功 `Read` 的文件
2. rehydrate 当前 mode
3. rehydrate `planPath` / `planExcerpt`
4. rehydrate `todoSummary`
5. 这些恢复项会进入 boundary metadata 的 `rehydrationPlan`
6. `/context` 里还能看到 `rehydrationCost`

这意味着：

> Formax 已经理解了“compact 之后不能失忆”这个核心原则。

---

## 2.4 session memory 已经从 0 走到可用起点

这是近期最重要的进展之一。

当前 Formax 已经有：

1. session memory draft schema
2. rolling session memory sidecar
3. memory-first auto compact

这很关键，因为它说明：

> Formax 已经不只是“历史一大就重新总结”，  
> 而是开始具备“持续维护一层会话工作记忆”的能力。

这条线虽然还没完整，但已经不再是差距黑洞。

---

## 2.5 `/context` 已经从 meter 进化成 diagnostics 系统

当前 Formax 的 `/context` 已经能做这些：

1. snapshot diagnostics
2. next-turn fixed projection
3. top contributors
4. per-system-section breakdown
5. lifecycle markers
6. compact/prune trigger reason
7. contributor drill-down identity
8. JSON diagnostics
9. app-server `local.diagnostics`
10. Web 严格 parser 契约

这说明：

> Formax 现在已经有了一个真正“能用于调系统”的上下文诊断面。

它还不是 Claude Code 那种最终级控制台，但已经远远超过“只有一个 context meter”。

---

## 2.6 partial compact 和 reactive compact 已经有 MVP

这两个过去是明显短板，现在已经不是“完全没有”。

当前 Formax 已有：

### partial compact

- 只在已有 boundary 的 auto compact 下生效
- 对 continuation 段做新的 compact scope
- 旧 compact summary 参与再总结，但不会继续留在 preserved tail

### reactive compact

- provider 首次因上下文超限失败时触发
- 先试 session-memory compact
- 再 fallback model-summary compact
- 只做一次受控 retry

所以在“有没有这类能力”这个问题上，Formax 已经明显追上不少。

---

## 2.7 request-time collapse 已经进入系统状态层

这是 2026-04-07 之后最值得更新的一块。

当前 Formax 已经有：

1. request-time collapse MVP
2. collapse impact diagnostics
3. `collapse_recap` contributor identity
4. recap metadata
5. runtime-visible `collapseState`
6. session persistence `request_collapse_applied`
7. latest / inspection helpers
8. `thread/read` / `thread/messages` / `/context` 都能暴露最近一次 collapse 摘要
9. Web header 已经真实显示最近一次 request collapse
10. thread surfaces 现在也会暴露 `latestCompactBoundary`

这意味着：

> collapse 在 Formax 里已经不再只是一个 prompt 技巧，  
> 而是开始变成 runtime、session persistence、app-server、diagnostics 都能消费的系统状态。

---

## 3. 当前和 Claude Code 仍然差距明显的部分

## 3.1 最大差距：中间层仍然不够成熟

Claude Code 的真正强项之一，是它在 `microcompact` 和 full compact 之间还有更成熟的中层治理：

- tool-result budget replacement
- snip
- context collapse
- 更深的 query-time projection

当前 Formax 的中间层仍然比较薄：

- `microcompact`
- `prune`
- request-time collapse MVP
- compact

尤其是：

- 当前 collapse 还没有：
  - persisted archived spans
  - collapse commits / store
  - replay-time projection rebuild
  - richer client surface consumption

这意味着：

> Formax 现在已经有了可工作的 collapse 起点，  
> 但还没有像 Claude Code 那样形成真正成熟的“中间层减压体系”。

这是目前最显眼的结构性差距之一。

### 这条差距现在的实现结论

`CCA-140 ~ 142` 已经把这条差距推进到了一个新阶段：

1. `CCA-140` middle-layer strategy stack scaffolding 已完成
2. `CCA-141` tool-result budget replacement v1 已完成
3. `CCA-142` cache-aware microcompact v3 已完成

所以当前最合理的下一阶段主线，不再是继续优先加新的压缩技巧，而是先把 stack 本身的协调与控制面补成熟：

1. `CCA-144` middle-layer stage contract / terminal prune fallback v1
2. `CCA-145` strategy coordination facts v1
3. `CCA-146` middle-layer control-plane diagnostics v1
4. `CCA-143` snip boundary + MVP v1

原因是：

- 当前 Formax 已经有 `microcompact` / `collapse` / `prune` / tool-result budget
- 真正剩下的核心结构性差距，是 stage semantics、execution order、coordination facts 仍然不够明确
- 如果不先补这层，`snip` 或 time-aware `microcompact` 很容易再次长成 send-path 特殊分支，而不是更成熟的中间层体系

---

## 3.2 `microcompact` 还只是较强 MVP，不是成熟系统

Claude Code 的 `microcompact` 更成熟的地方包括：

1. 更细的 compactable-tool 策略
2. cache-aware / time-based 路径
3. 与 API 层和 collapse 层更深协作

当前 Formax 虽然已经不弱，但仍然属于：

- 工程上可用
- 策略上保守
- 覆盖面有限

还缺：

1. 更丰富的 tool family 策略
2. 缓存感知路径
3. 更强的收益/风险平衡逻辑
4. 更接近 provider/query 层的协同

所以这里可以总结成：

> Formax 已经有 `microcompact`，但还没有 Claude Code 那种“成熟微压缩系统”。

---

## 3.3 compact 协议仍然是“起点”，不是“全贯通”

当前 Formax 的 compact 协议确实已经有了：

- boundary
- preserved segment metadata
- restore 对齐
- diagnostics / app-server 起点

但还缺这些更成熟的部分：

1. preserved segment relink 的更完整语义
2. remote thread restore 的 compact 协议对齐
3. 更强的 cross-surface compact event 贯通
4. 更像 Claude Code 那样把 compact 当成 transcript / remote / SDK 的一等公民

也就是说：

> Formax 已经有 compact protocol，  
> 但还没有 compact protocol ecosystem。

---

## 3.4 compact 后恢复范围还不够宽

当前 Formax 已经能恢复：

- recent files
- mode
- plan state
- todo state

但 Claude Code 那边更成熟的恢复层还包括：

- skills
- async agent 状态
- deferred instructions
- MCP / remote 相关上下文
- 更多 continuation 级工作态

所以这里的差距不是“有没有恢复”，而是：

> 恢复层还不够宽，也还不够深。

---

## 3.5 keep strategy 仍然比较早期

当前 Formax 已经从固定 `keepLastTurns` 升级到：

- `keep_combo`
- 最近成功 `Read` 的 working-set anchor

这是好事，但和 Claude Code 相比还不够：

1. 当前最小工作集只覆盖很窄的 `Read` 场景
2. manual compact 还没共享更高级 keep 策略
3. 还没有更广义的“任务相关工作集”识别

所以这里差距不在“有没有 keep strategy”，而在：

> 是否已经真正从“保留最后几轮”升级成“保留当前任务最小工作集”。

现在还没完全做到。

---

## 3.6 session memory 仍然缺少更宽的 restore consumption

当前 Formax 的 session memory 已经接进：

- turn completion sidecar 刷新
- auto compact fallback chain
- restore 后 sidecar refresh
- REPL / CLI 的 one-turn restore reminder injection

这意味着：

> session memory 已经不只是“被刷新”，而是开始进入 restore 消费链。

但和 Claude Code 相比仍然缺：

- 更宽的 cross-surface restore consumption
- richer thread / remote 恢复协同
- 更成熟的长期 working-memory surface

---

## 3.7 reactive compact 还属于最小版

当前 Formax 的 reactive compact 已经够用了，但还只是 MVP。

和 Claude Code 相比，仍然缺：

1. 更细的 provider-specific shaping
2. 更丰富的错误分类
3. richer diagnostics / telemetry
4. 与中间层减压更深的联动

所以这里可以理解成：

- 已有 reactive compact
- 但还没到“成熟恢复策略层”

---

## 3.8 `/context` 仍然不是 Claude Code 那种完整控制台

虽然 Formax `/context` 已经很强了，但和 Claude Code 仍有差距：

1. 还不够贴近最终 assembled API payload 的完整账本
2. 还没有更丰富的 cross-layer diagnostics 面板
3. 还没有 collapse / cache-aware 层相关可观测
4. app-server / Web 虽然有 payload 契约，但还没形成真正成熟的 diagnostics UI 生态

这意味着：

> `/context` 这条线已经追得很近了，但还没到 Claude Code 的“上下文控制台”级别。

---

## 4. 当前差距的优先级排序

如果只看“还差哪些”，容易显得很多。  
但如果看“下一步最值得补什么”，优先级其实已经比较清楚：

### P0：最值得继续补

1. **更接近真实最终 payload 的 diagnostics ledger**
2. **更成熟的 `microcompact`**
3. **更强的 reactive compact shaping**

### P1：继续补齐剩余体系差距

4. **更丰富的 collapse client consumption / parity**
5. **更宽的 session-memory restore consumption**
6. **更深的 compact protocol ecosystem**

### P2：谨慎推进，不要硬上

7. **更丰富的 collapse client consumption / optional future store**

这条线不是不重要，而是当前依赖仍不成熟，不能为了“追平 CC”就硬接 runtime。

---

## 5. 当前最诚实的总体评价

如果一定要用一句最短的话总结：

> **Formax 现在已经把 Claude Code 上下文压缩体系的“前半段”补得很像了；**
> **真正剩下的差距主要在“中间层成熟度、协议生态完整度、以及后半段工作记忆/恢复体系的深入贯通”。**

所以现在的差距已经不是：

- 有 / 没有

而更多是：

- 强 / 还不够强
- 通 / 还没完全贯通
- 系统化 / 还只是局部实现

---

## 6. 对主线的建议

如果下一轮还继续沿着“向 Claude Code 靠拢”这条主线走，我建议优先顺序是：

1. **升级 keep strategy / working-set selector**
2. **让 session memory 进入更深的 restore 消费**
3. **继续补 compact protocol 的 remote / restore 贯通**
4. **richer collapse client consumption 保持在“消费层”范围内继续补齐**

而不是马上上完整 persisted collapse store。

因为当前最大收益，已经不在“先做一个酷的新层”，  
而在“把已经补上的这些层真正贯通成系统”。
