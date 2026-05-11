# CCA Dependency Map

更新时间：2026-05-12
状态：Active

## 这份图解决什么问题

`CCA-*` 编号是**能力切片编号**，不是严格的施工顺序。

也就是说：

- `CCA-010` 不一定比 `CCA-050` 更早做
- `CCA-060` 也不一定比 `CCA-022` 更晚做

真正决定执行顺序的，是：

1. 依赖关系
2. 返工风险
3. 当前收益
4. 哪些能力是在补“骨架”，哪些能力只是补“表现层”

所以这份图的作用是：

- 帮我们区分“任务编号”与“执行顺序”
- 明确哪些项是 blocker
- 明确当前主线应该怎么走

---

## 一句话规则

> `CCA` 编号用于定位任务；真正的执行顺序由依赖图决定。

---

## 依赖总图

```mermaid
flowchart TD
    A["已完成地基<br/>编排层 + microcompact + diagnostics + boundary 起点"] --> B["CCA-050<br/>session memory draft schema"]
    B --> C["CCA-051<br/>rolling session memory sidecar"]
    C --> D["CCA-052<br/>memory-first auto compact"]

    A --> E["CCA-022<br/>boundary-first prompt view"]
    A --> F["CCA-023<br/>preserved segment metadata"]

    E --> G["CCA-070<br/>app-server compact boundary protocol"]
    E --> H["CCA-071<br/>session persistence / resume boundary restore"]
    F --> G
    F --> H

    E --> I["CCA-061<br/>partial compact MVP"]
    F --> I
    G --> I
    H --> I

    A --> J["CCA-010/011/012/013<br/>diagnostics phase 2"]
    J --> I

    D --> K["CCA-062<br/>reactive compact"]
    I --> K

    A --> L["CCA-063<br/>context collapse / cache-aware layer evaluation"]
```

---

## 分组理解

### 1. 地基组

这些项的作用是让整个上下文压缩系统“站起来”：

- 压缩编排层收敛
- `microcompact`
- `/context`
- compact boundary 起点
- rehydration 起点

它们已经基本完成。

如果没有这些地基，后面的：

- session memory
- partial compact
- reactive compact

都会很难做稳。

---

### 2. session memory 组

这组是我们最近已经完成的一条链：

1. `CCA-050`：session memory schema
2. `CCA-051`：rolling sidecar
3. `CCA-052`：memory-first auto compact

为什么这组可以先做？

因为它的依赖已经比较成熟：

- 已有 compact boundary
- 已有 rehydration
- 已有 diagnostics
- 已有统一压缩编排层

所以它虽然编号是 `05x`，但其实比 partial compact 更适合先做。

---

### 3. compact protocol 组

这组已经完成了最关键的前置主线：

1. `CCA-022`：boundary-first prompt view
2. `CCA-023`：preserved segment metadata

这两项是后续很多能力的 blocker。

尤其是：

- `CCA-061` partial compact
- `CCA-070` compact boundary app-server protocol
- `CCA-071` boundary-aware resume/restore

都依赖它们。

所以虽然编号是 `02x`，但在当前阶段它们比 `06x` 更应该先做。

---

### 4. higher-order compression 组

这组里最容易让人误会的是：

- `CCA-061` partial compact

它看起来像是“更高级的压缩策略”，
但本质上它其实是：

> compact 协议、history relink、resume restore、cross-surface parity 的综合题。

所以它不是一个能“先写个 MVP 看看”的小功能。

它的前置条件是：

1. `CCA-022`
2. `CCA-023`
3. `CCA-070`
4. `CCA-071`

这也是为什么 `CCA-060` 会先于 `CCA-061` 做。

`CCA-060` 本身不是 runtime 功能，而是：

> 明确 partial compact 现在是否能安全开工。

当前结论曾经是：`NO-GO`

参考：
- [CCA-060-partial-compact-go-no-go.md](./CCA-060-partial-compact-go-no-go.md)

---

## 当前主线顺序

当前推荐执行顺序不是按编号，而是按依赖：

1. `CCA-153` compact protocol remote / restore alignment

对应含义：

1. `CCA-140 ~ 146` 已完成，middle-layer stack 的第一阶段已经成型
2. `CCA-150` 已完成，working-set selector 已开始按 anchor kind 区分 backtrack window
3. 当前最大差距已经切回：
   - compact protocol 的 remote / restore ecosystem

## 新主线为什么这样排

### `CCA-151` 已先于 `CCA-152` 完成

`CCA-151` 的目标是继续让压缩后的 session-memory 在 restore 之后真正有用。

如果没有先做 `CCA-151`，就容易出现这种情况：

1. query-time stack 虽然已经更成熟
2. 但 restore 后真正延续任务语义的能力仍然偏窄
3. 用户实际感受到的“压缩后还能继续工作”改进不够明显

当前状态：

1. app-server `thread/resume` 已开始复用 canonical restore artifacts
2. session-memory reminder 已能在服务端作为 next-turn-only injected blocks 消费一次
3. `/context` diagnostics 也能解释这层 pending restore consumption

`CCA-152` 已完成，current mainline 现在可以继续切到 `CCA-153`。

### `CCA-152` 已为 `CCA-153` 清障

`CCA-152` 的目标是让 middle-layer stack 更接近 surrounding flow 的唯一 owner。

如果不先做这一步，就容易在 `CCA-153` 里继续把 compact protocol 的新语义散落到：

1. `contextCompressionService.ts`
2. app-server adapters
3. replay / restore 辅助路径

当前已完成的 owner convergence 意味着：

- post-compact/manual/reactive/finalize 不再各自手搓 persisted baseline
- `CCA-153` 可以直接在更干净的 canonical-owner 之上补 compact protocol 的 remote / restore 生态

## 已完成波段为什么可以收口

当前状态：

- `CCA-140` 已完成
- `CCA-141` 已完成
- `CCA-142` 已完成
- `CCA-143` 已完成
- `CCA-144` 已完成
- `CCA-145` 已完成
- `CCA-146` 已完成
- `CCA-150` 已完成
- `CCA-151` 已完成
- `CCA-152` 已完成

这意味着：

1. middle-layer stack 的 contract / coordination / control-plane / snip 已成型
2. working-set selector 也已从固定 1-turn rewind 推进到 anchor-kind-aware window
3. 当前已经没有必要继续围绕这条 reducer 主线做局部补丁

---

## 为什么 `CCA-060` 能先于 `CCA-061`

这是一个典型例子：

- `CCA-060` 编号更小一些，但它不是“实现功能”
- 它是“判断 `CCA-061` 现在能不能安全做”

也就是说：

- `CCA-060` 是 `CCA-061` 的决策前置
- `CCA-061` 是真正的 runtime 能力

如果不先做 `CCA-060`，就容易出现这种问题：

1. partial compact 写了一半
2. 才发现 boundary-first view 还没有
3. resume 也不认 compact boundary
4. app-server / Web 也解释不了 compact 结构
5. 最后只能返工

所以这里“先做 `060`”不是跳号，
而是为了避免 `061` 的高返工风险。

---

## 哪些项是 blocker，哪些项是 supportive

### Blockers

这些不完成，就不建议继续做 `CCA-061`：

- `CCA-022`
- `CCA-023`
- `CCA-070`
- `CCA-071`

### Supportive

这些不是严格 blocker，但做了以后能明显降低后续不确定性：

- `CCA-010`
- `CCA-011`
- `CCA-012`
- `CCA-013`
- `CCA-052`

比如：

- `CCA-052` 让 compact 已经开始具备 memory-first 结构
- diagnostics Phase 2 会让 partial compact 的验证更容易

但它们不能替代 blocker 本身。

---

## 当前结论

如果后面再看到“为什么不是按编号顺序做”，统一按这条规则理解：

1. `CCA` 是能力编号，不是施工顺序
2. 当前主线按依赖图推进，不按数字大小推进
3. 当前最该做的不是 `CCA-061`
4. 当前最该做的是：
   - `CCA-022`
   - `CCA-023`
   - 然后 `CCA-070`
   - `CCA-071`

只有这些条件成熟以后，partial compact 才值得真正开工
