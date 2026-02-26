# REPL Transcript (Ink Static) 重复/乱序/trans 堆积：根因取证

日期：2026-02-18

## 背景与现象（可复现）
- 工具行重复显示：同一条 tool header 会出现两次，且 suffix 内的 `message.id` 完全一致。  
  例：`Bash(static#0e2c@0e2c:canonical:turn-1:tool:call_xxx)(pwd)` 出现两次。
- 时序错乱：assistant 文本与 tool 行偶发反序（应先说明再 tool，实际 tool 在前）。
- transient 行过多导致卡顿：一轮内出现大量 trans 工具行（同一轮内多次重复打印导致 scrollback 暴涨）。

## 复现输入
- 输入：`pwd`
- 观察：tool header 是否重复、assistant/tool 顺序是否稳定、trans 行是否堆积。

## 根因（代码证据 + 可复现现象）
### 1. Ink `<Static>` 是 append-only（按长度推进的只追加渲染面）
- 证据：`node_modules/ink/build/components/Static.js`
  - 仅渲染 `items.slice(index)`
  - 每次 `items.length` 变化后，把 `index` 设为 `items.length`
- 含义：
  - 终端上已由 `<Static>` 打印的内容，不支持在其前面“插入新行”。
  - 如果上游把新稳定行插入到旧尾部之前，会导致：
    - 插入的新行无法打印（在 `index` 之前）
    - 旧尾部行可能再次被切片到并重打（表现为重复，且 `message.id` 一致）

### 2. 语义化后，稳定行可能在 turn 末尾才落盘，形成“非尾部插入”
- canonical 投影是按事件流逐步累积 `segments`。
- 若 UI 侧延迟到 finalize 才把稳定行合并进静态 transcript，就会把稳定行插到已有 tool 行之前，违反 `<Static>` 合约。

## 关键调用链（重复/反序/trans 堆积触发链）
### A. 事件进入 canonical 投影
`src/features/repl/controller/streaming/streaming.ts`  
`handleEvent(ev)`  
→ `src/features/repl/controller/streaming/streamBridge.ts`  
→ `src/features/semantics/adapters/streamCanonicalAdapter.ts`  
→ `src/features/semantics/adapters/streamEventCanonicalMapper.ts`

### B. canonical event 到 transient/static 行投影
`src/features/repl/useReplController.ts`  
`onCanonicalEvent(event)`  
→ `src/features/repl/controller/canonical/canonicalEventOrchestration.ts`  
→ `src/features/semantics/projection/transcriptProjection.ts`  
→ `src/features/repl/controller/canonical/canonicalTurnMessageMapping.ts`

### C. 渲染面（Static）与分区
`src/features/repl/controller/ui/messages.ts`  
`isTransientMessage / partitionMessages`  
→ `src/screens/repl/transcript.tsx` (`<Static items=[header, ...staticMessages]>`)  
→ `node_modules/ink/build/components/Static.js`

### D. 历史止血尝试（已回滚，不作为长期方案）
`src/screens/repl/mergeMessages.ts`  
`mergeStaticAndTransientMessages({ staticMessages, transientMessages })`

## 结论（基于代码）
- 性能：`mergeStaticAndTransientMessages` 在 static/transient 高频变化时会放大渲染与计算成本（对应卡顿）。
- 语义：该层只能合成/隐藏重复，不能修复 `<Static>` append-only 约束。
- 稳定性：按 `toolUseId` 的跨 id 合并会导致同一工具行在不同帧切换来源，引发闪烁与错位。

## 历史触发点（旧实现）
- finalize 时插入/重排 turn 尾部：  
  `src/features/repl/useReplController.ts`  
  `finalizeCanonicalTurn(...)`  
  → `src/features/repl/controller/canonical/canonicalTurnMerge.ts`  
  `appendCanonicalTurnFinalRows(...)` / `mergeCanonicalTurnIntoMessages(...)`
- 该路径会把 `thinking/system/assistant` 稳定行插到 tool 之前（非 append-only），触发重复/乱序。

## 修复原则（面向根因）
1. 主 transcript 的 `staticMessages` 必须 append-only：只能尾部追加，不可在旧尾部前插入。
2. 稳定行要在“变稳定的时刻”落 static：
   - `thinking_stop / thinking_finalized`：落 `thinking_block`
   - `system_message`：落 static
   - `tool_end`：同 `toolUseId` 从 transient 迁移为 static
   - `assistant`：段关闭即 static；仅 open 段允许 transient
3. finalize 只做清 transient 与不变式校验，不再做 static 插入/重排。

## 本轮实现落点（对应原则）
- `src/features/repl/controller/canonical/canonicalTurnMessageMapping.ts`
  - transientOnly 也会输出稳定 assistant/finalized thinking/system（`surfaceOwner=static`）
  - tool：`running=transient`，`completed/error=static`
- `src/features/repl/controller/canonical/canonicalEventOrchestration.ts`
  - transientOnly 投影 `includeUserSystem=true`
- `src/features/repl/useReplController.ts`
  - `onCanonicalEvent` 将 `surfaceOwner=static` 增量合并到 `messages`
  - abort/finalize 通过 canonical `turn_footer` 收口终态
- `src/features/repl/controller/ui/messages.ts`
  - `partitionMessages` 优先尊重 `surfaceOwner`
- 回归：`src/screens/repl/surfaceSmoke.test.tsx`
  - forced Static + buffered 下，`Bash(pwd)` 仅出现一次，且顺序稳定

## 备注
- Tool UI debug suffix（`FORMAX_HOOKS_DEBUG`）用于观测 `surfaceOwner/message.id/toolUseId`，用来区分“渲染面重复”与“数据层重复”。
