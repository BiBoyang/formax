### A. 结论（先给）

* **是否推荐采用：虚拟列表 + isScrolling 降级渲染 + idle 后精细渲染**
  **推荐**。对“超长聊天记录（长文本/markdown、thinking、tool/diff）+ 流式更新”来说，这是目前工程上最稳的组合：

  1. 虚拟列表把 DOM 上限锁死；2) `isScrolling`/速度阈值触发“滚动中轻渲染”；3) 停止/空闲后补齐重渲染与精确测量，最终让总高度收敛稳定。

* **你观察到的“滚动中间区域短暂空白、停下补齐”**
  可以是**合理策略的一种副作用**（overscan 太小 / 渲染被节流 / 主线程忙导致来不及 commit），但**不应表现为明显白屏**。正确做法是：即使降级，也要用“占位骨架/轻量快照”保持视觉连续。

* **推荐的默认参数（MVP 起步值）**

  * **overscan（像素优先）**：`overscanPx = 1.5 * viewportHeight`（上下各 0.75 屏）

    * 如果用 item 数：`overscanItems = 10~20`（取决于平均高度；聊天通常高度方差大，建议像素 overscan）
  * **scroll idle debounce**：`120ms`（VS Code WebView/中端机可到 `150~200ms`）
  * **滚动速度阈值（进入“降级渲染”）**：`velocity > 2.0 px/ms` 或 `> 2000 px/s`
  * **高度估算策略（按类型分桶 + 行数估计）**

    * `estimateHeight(type, contentMeta)`：

      * text/markdown：`base + lineCount*lineHeight`（lineCount 可用“粗略换行估计”）
      * code/diff/tool：`base + min(maxLines, lineCount)*monoLineHeight`（先 clamp，停下后再展开精算）
  * **测量提交频率**：高度变更合并到 `requestAnimationFrame`，并做 **delta 累积**，避免一条消息多次抖动。

---

### B. 实现方案（可直接开发）

#### 1) 数据结构设计（item 类型、height cache、measured map、anchor）

**核心目标：**“可估算、可测量、可收敛、可锚定（不跳）”。

* `MessageItem`

  * `id: string`（稳定、全局唯一，**禁止用 index**）
  * `type: 'user' | 'assistant' | 'thinking' | 'tool' | 'diff' | 'system'`
  * `content: string | richASTRef`
  * `meta`（尽量在生成阶段就带上，便于估算）

    * `approxLineCount`
    * `hasCodeBlock`
    * `hasMarkdown`
    * `hasImage`
    * `tokenCount` / `charCount`
    * `streaming: boolean`（流式增量）
    * `collapsed: boolean`（tool/diff/thinking 默认可折叠）
* `HeightCache: Map<id, { height: number, version: number, measured: boolean }>`
* `EstimateCache: Map<id, number>`（首次估算值；测量后可保留用于回退）
* `PrefixSumIndex`（V2 推荐；MVP 可先不用）

  * 用于快速求任意区间高度和与总高度更新
* `AnchorState`

  * `anchorId: string`（当前视口顶部或某个“稳定锚点”的消息 id）
  * `anchorOffsetPx: number`（锚点距离视口顶部的偏移）
  * `stickToBottom: boolean`（是否自动吸底）

> **机制解释（对应你关心的问题 2）**
> 虚拟列表并不需要“真实总高度”一开始就准确，它用的是：
> **总高度 = 已测量高度 + 未测量项的估算高度**（所以你说的“假长度”本质成立，但会逐步收敛为真）。

#### 2) 渲染流程（初始估算 -> 实测修正 -> 增量收敛）

**MVP 流程（最小可落地）：**

1. **初始化**：对每条消息生成 `estimateHeight`，写入 `HeightCache(measured=false)`
2. **计算可视区**：根据 `scrollTop` + `viewportHeight` + `overscanPx` 计算 `startIndex/endIndex`
3. **渲染**：仅渲染窗口内 items；用 `paddingTop/paddingBottom`（或 translateY）撑开滚动条
4. **测量**：对已渲染的 item 容器挂 `ResizeObserver`（或 `useLayoutEffect` 读 `getBoundingClientRect().height`）
5. **修正**：测得新高度 `hNew`，与缓存 `hOld` 做 `delta`：

   * 更新缓存
   * 如果该 item 在视口**上方**：`scrollTop += delta`（保持锚定不跳）
   * 合并多次 delta，在 `rAF` 里一次性提交（避免抖动）
6. **收敛**：随着滚动覆盖更多 item，估算逐步被真实测量替代，总高度趋稳

**V2（增强，适合 5w+ messages / 高动态内容）：**

* 用 **Fenwick Tree/Segment Tree** 维护高度前缀和：

  * `getOffsetByIndex(i)`、`findIndexByOffset(y)` 都是 `O(logN)`
  * 解决“超长列表 + 频繁高度更新”下的线性扫描成本
* 估算值按类型分桶维护 **滑动平均**：例如 `avgHeightByType['tool']`，新 item 估算更准、收敛更快

#### 3) 滚动策略（auto-stick、用户上翻、恢复到底部）

**建议策略：**

* 默认 `stickToBottom=true`（聊天常态）
* 当用户上滚超过阈值（例如离底部 > `120px` 或 scrollTop 方向向上持续 `> 200ms`）：`stickToBottom=false`，显示“回到底部”按钮
* 新消息到来：

  * `stickToBottom=true`：保持吸底（但要走锚定逻辑，避免高度更新导致抖）
  * `stickToBottom=false`：不抢滚动，只增加“新消息 N 条”提示
* 恢复到底部：点击按钮 -> `stickToBottom=true` -> 滚到最大 offset（用总高度或最后一条 offset）

#### 4) 降级策略（滚动中显示什么，停止后恢复什么）

> **对应你关心的问题 4：避免白屏感的关键**不是“别降级”，而是“降级也要有连续占位”。

**滚动中（isScrolling/velocity 高）渲染：**

* markdown：不做复杂排版（不跑语法高亮/数学公式/嵌套组件），只渲染**纯文本预览 + 轻量换行**
* code/diff/tool：

  * 默认折叠为“头部摘要 + 前 N 行”（例如 N=12）
  * 不做 diff 逐行着色、不做 tokenization
* thinking：显示“thinking 标题 + 1~2 行摘要”，内容延迟
* 图片/异步内容：一律显示固定比例占位（或固定高度占位），不解码/不加载（可等 idle）
* **绝不空白**：最差也渲染 skeleton（灰条/块）占据正确高度

**停止滚动后（idle debounce 命中）：**

* 触发“精细渲染”：

  * markdown 完整渲染
  * code/diff 恢复完整 + 高亮（可分片/idle 分批）
  * thinking/tool 展开到用户上次状态
  * 图片开始加载与解码

---

### C. 动态高度细节

#### 1) markdown/代码块/diff/thinking 的高度测量策略（对应问题 3）

* **统一容器测量**：每个 item 外层一个 `div[data-id]`，测量容器最终高度即可（避免测内部节点导致频繁变化）
* **按阶段测量**：

  * 阶段 A（滚动中）：用估算高度（或已测量高度）+ 轻量渲染
  * 阶段 B（停止后）：完整渲染后再测一次，更新 cache
* **流式消息**：

  * streaming 时高度会不断增长：把测量更新节流到 `rAF` + `max 10~15Hz`（否则会“无限重算”）

#### 2) 图片或异步内容导致高度变化时如何校正

* 图片加载前就给**占位尺寸**（通过消息 meta 携带 width/height 或默认比例 16:9/1:1）
* 图片 decode/load 完成后：

  * ResizeObserver 捕获高度变化 -> 更新 cache delta
  * 若该消息在视口上方：`scrollTop += delta` 保持视口稳定
* 对“未知尺寸图片”：V2 才建议做“预取尺寸”（解析 header/metadata），MVP 可统一固定占位高度减少跳变

#### 3) 如何避免“滚动跳动”（scroll jump）

**核心：锚定（anchor）+ delta 补偿。**

* 每次要应用高度 delta 时：

  * 记录当前锚点（通常取“视口顶部第一个可见 item”）
  * 更新高度树/缓存
  * 重新计算锚点的新 offset
  * 调整 `scrollTop += (newOffset - oldOffset)`，使锚点视觉位置不变
* 对吸底模式：锚点换成“底部”，即：如果 `stickToBottom=true`，高度变化后保持 `scrollTop = maxScrollTop`

---

### D. 风险与反模式

#### 典型坑

* **测量抖动**：同一 item 因为字体加载/高亮/图片 decode 发生多次高度变化，导致频繁 setState -> 掉帧

  * 解决：合并 delta（rAF），并限制每 item 每秒更新次数
* **无限重算**：渲染导致高度变，高度变又触发渲染（特别是 markdown 里有自适应组件）

  * 解决：滚动中锁定“轻渲染模式”，停止后一次性切换；对高度变更做去抖
* **key 不稳定**：用 index 当 key -> 插入/流式更新时缓存错位，表现为高度乱跳/空白

  * 必须：稳定 id
* **缓存污染**：同一个 id 复用不同内容（例如复用消息对象）

  * 必须：内容变更时递增 `version`，缓存结构里存 `version`
* **overscan 太小**：快速滚动时窗口内尚未渲染，出现你看到的“短暂空白”

  * 解决：提高 overscan（像素）、或做“scroll seek placeholders”

#### 不建议做法

* **全量渲染**（超长历史直接爆内存/布局时间）
* **每帧强制测量**（scroll 过程中频繁 `getBoundingClientRect`/强制同步布局）
* **滚动中做语法高亮/markdown AST 大量计算**（主线程被占，直接掉帧 + 空白）
* **在一个巨大 DOM 树里做 diff 高亮**（尤其是长 diff）

---

### E. 验收标准

#### 1) 可量化指标（建议目标）

* **滚动流畅度**：快速滚动时主线程长任务（>50ms）占比 < 1%（或明显低于当前）
* **FPS**：常见机器滚动维持接近 60fps（允许波动，但不出现连续“卡死”）
* **输入延迟**：滚动过程中键入/点击的响应延迟 P95 < 50ms
* **首屏耗时**：首次渲染可见区（含估算）< 200ms（WebView 可放宽到 300ms）
* **内存上限**：DOM 节点数量稳定（例如 200~400 条 item 以内，取决于 overscan），内存不随历史长度线性增长

#### 2) 手工验收脚本（3~5 条）

1. **超长历史压测**：加载 50,000 条混合消息（短文/长文/代码/diff/thinking），从顶部拖动滚动条到底部再回顶部，观察是否出现“白屏/大面积空洞”。
2. **极速滚动**：按住 PageDown/滚轮高速滚动 5 秒，松手后 200ms 内内容补齐并进入精细渲染；过程中应至少看到 skeleton/摘要而非空白。
3. **流式更新**：在吸底模式下连续流式输出 30 秒（thinking + code），不应明显掉帧；停止输出后 500ms 内完成精细渲染与高度收敛。
4. **上翻阅读**：用户上翻到中段（stickToBottom=false），此时有新消息到来，不抢滚动，仅提示“新消息”；点击提示后回到底部准确定位。
5. **异步内容**：含图片消息加载/解码后，不应把用户视口顶走（无明显 jump）。

#### 3) 回归测试建议（单测/集成/E2E）

* **单测**

  * `estimateHeight` 对各类型 meta 的输出范围
  * 高度 delta 应用后 anchor 补偿正确性（给定 old/new 高度，scrollTop 调整应一致）
* **集成测试**

  * 1k 条消息随机高度更新（模拟图片/高亮完成），scroll 不跳
  * stickToBottom 状态切换逻辑（上翻阈值、回到底部）
* **E2E（Playwright）**

  * 脚本化高速滚动 + 截图对比：确保不出现大面积空白（允许 skeleton）
  * 流式更新期间的可交互性（输入框可持续输入、按钮可点击）

---

## 逐条回答你关心的问题（对应 1~5）

1. **“滚动中空白、停下补齐”是不是标准做法？机制是什么？**

   * **机制**：虚拟列表只渲染窗口 + overscan。快速滚动时，scrollTop 变化过快，而渲染更新（JS 计算 + React commit）跟不上，就会出现“当前视口没有任何已挂载 item”的瞬间；停下后下一帧/几帧渲染完成，内容补齐。
   * **结论**：这在一些实现里“会发生”，但**不是理想体验**。标准做法是配合更大的 overscan 或“滚动中占位（scroll seek）”，让用户看到的是 skeleton/摘要，而不是空白。

2. **虚拟列表如何知道“总高度”？是不是“假长度”？**

   * 是“**估算总高度**”：`total = sum(measured) + sum(estimated)`。一开始确实是“假”的，但随着滚动覆盖与测量增加会**收敛**。V2 用高度树能让总高度更新更高效、更稳定。

3. **动态高度消息如何让总高度稳定收敛？**

   * **分阶段渲染 + 节流测量 + 缓存版本化**：滚动中用轻渲染锁住复杂性；停止后完整渲染再测量；高度变化用 rAF 合并、限制频率；内容变化递增 version 防止缓存错配。对图片等异步内容用占位减少二次跳变。

4. **如何设计“滚动中降级渲染”避免白屏感？**

   * **降级也要渲染“有高度的东西”**：摘要/前 N 行/纯文本/骨架屏 + 固定占位，确保任何时刻视口都有可见内容；停止后再补高亮/完整 markdown/diff 展开。

5. **如何在性能和体验之间取舍？**

   * **优先级建议**：

     1. 交互不中断（输入/滚动不被卡死）
     2. 不白屏（占位连续）
     3. 停止后高质量可读（精细渲染）
   * 手段：把重活（markdown AST、syntax highlight、diff colorize、图片 decode）从“滚动路径”移到“idle 路径”，并把 DOM 数量用虚拟化封顶。

---

## 两档方案总结

* **MVP（最小可落地）**

  * 变量高度虚拟列表（缓存估算 + ResizeObserver 实测）
  * overscanPx ≈ 1.5 屏
  * `isScrolling/velocity` 触发轻渲染（摘要/骨架/前 N 行）
  * idle 120ms 后恢复精渲染 + 再测一次
  * anchor delta 补偿避免 jump

* **V2（增强版）**

  * 高度前缀和树（Fenwick/Segment Tree）+ `findIndexByOffset` O(logN)
  * 类型分桶自适应估算（滚动平均）
  * 更精细的 scroll seek（按速度分级：骨架 -> 摘要 -> 完整）
  * 异步资源（图片/高亮）按优先级 idle 分批调度（避免一次性抢主线程）

如果你愿意把你们现在的“虚拟滚动实现方式/库（react-window? tanstack/virtual? 自研?）”、以及“空白时 DOM 是否真的为 0（还是渲染延迟/paint 问题）”简单描述两句，我可以直接按你们的技术栈把 overscan、scroll seek、测量节流这几块落成更贴近代码级的改造清单。
