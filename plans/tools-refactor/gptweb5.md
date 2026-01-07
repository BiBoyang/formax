你这个判断（`message_delta.usage` 更像**最终快照**而不是逐步 delta）是对路的：你给的证据里 `message_delta` 同时带了 `usage: { input_tokens, output_tokens, cache_read_input_tokens, ... }`，看起来就是“到本次 /v1/messages 结束时的累计值”。

下面我给你两块建议：**计数口径（避免重复计）** + **展示口径（避免误导用户）**。

---

## 1) 计数口径：每次请求取“最后一次 usage 快照”，跨多次 streamOnce 再求和

### ✅ 单次 /messages（一次 `streamOnce`）内

由于 usage 是“快照”，**不要做累加**，而是：

* `usage_current = snapshot`（直接覆盖）
* 如果你担心同一个请求里会出现多条 usage（比如多次 `message_delta`），就做更稳的：

  * `usage_current[field] = max(usage_current[field], snapshot[field])`

这样不会因为多次 `message_delta` 重复算。你现在的 parser 在 `message_delta` 分支只读了 stop_reason，确实需要在这里把 usage 抛出来。

### ✅ 跨多次 streamOnce（同一回合 tool-loop 多次请求）内

在 `ChatEngine` 的 loop 里，每一次 `deps.client.streamOnce()` 结束后，把该次请求的 `usage_current` 加到 turn / task 聚合器里即可（你说的“跨多次 streamOnce 求和”就是这个）。

---

## 2) 展示口径：默认给一个“总 tokens”，同时明确 breakdown，**但不要暗示计费口径**

你们想复刻 Claude Code 的 `… · 66.6k tokens · …`，最容易误导用户的点在于：**cache tokens 到底算不算“我这次输入的 tokens”**、以及是否等同“计费 tokens”（你们通常拿不到严格计费规则）。

所以我建议你们的 UI 采取下面这个策略：

### A. 默认（最不误导）：“总 tokens + breakdown（in/out/cacheR/cacheC）”

* Done 行：**展示一个总数**（为了跟 Claude Code 观感一致）
* 但**括号里永远给 breakdown**，并把 cache 明确标成 “cache read/create（prompt cache）”，避免用户以为“我真的发了 66k 字”。

推荐格式（紧凑版）：

```
Done (N tool uses · 4.2s · 66.6k tok [in 12.3k | out 4.1k | cacheR 49.8k | cacheC 0.4k])
```

你给的样例 usage（input=1413, output=649, cache_read=19584）就可以显示为：

```
… · 21.6k tok [in 1.4k | out 0.6k | cacheR 19.6k]
```

证据里确实出现了这些字段名（`input_tokens/output_tokens/cache_read_input_tokens`）。

### B. 进阶（更清晰但更长）：同时展示 “active tokens” vs “with cache”

如果你们愿意多一丢丢字，我更推荐这个——因为它把“模型真正新处理的 tokens（in+out）”和“API 报告的 cache 读写”区分开：

* `active = input + output`
* `withCache = input + output + cache_read + cache_creation`

展示：

```
… · tok 66.6k (active 16.4k + cache 50.2k)
```

这样用户一眼就懂：**大头来自 cache**，不是“我这次提问突然变巨长”。

> 注意：这里不要叫 “billable”，就叫 “active / cache”，或者 “model / cache”，避免暗示计费。

### C. 小细节：单位、四舍五入、以及隐藏 0 值

* `66.6k` 用 1 位小数足够；小于 10k 可以不带小数（`980 tok`）
* `cacheC=0` 直接不显示，减少噪音
* 如果某些模型/请求没有 cache 字段，也不要补 0，直接略掉（让用户知道“这次没有 cache”）

---

## 建议你们最终选的“最稳妥默认”

**Done 行默认用 A（总 + breakdown）**，然后给一个“verbose 模式”或 debug 面板用 B（active vs cache）。

这样：

* 观感对齐 Claude Code（有 “66.6k tokens”）
* 同时又不误导（用户能看到 cacheR 占大头）
* 你们也不会背上“你这个 tokens 是不是计费 tokens”的坑

---

如果你愿意，我还可以按你们现有结构给一个非常小的改动点清单（不大改架构）：

* SSE parser：`message_delta` 里 detect `usage` → emit `StreamEvent('usage_snapshot')`
* StreamClient：把 snapshot 透传
* TaskSubAgentToolHandler：对每个子请求做 `max-per-field`，在 “Done” 时对所有请求 `sum`，并输出 `total + breakdown`
