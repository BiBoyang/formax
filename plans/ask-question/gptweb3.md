看完你这版 `presenter.tsx`，整体方向是对的：**交互全在 presenter，REPL 只隐藏输入框**，并且你加了 `isSubmitting + submittedRef`，把我之前提到的“重复 submit → bufferedAnswers 泄漏”问题基本堵住了 👍

下面按你要的维度给 review（我会直指“会卡死/会错提交/会冲突”的点）。

---

## 必须修的问题（blocker）

### 1) `toolUseId` 推导方式很危险，可能直接导致 handler 永远 await（卡死）

你现在用：

```ts
const toolUseId = message.id.startsWith('tool-') ? message.id.slice('tool-'.length) : message.id
```

但 **真正能 resolve `requestAnswers({ toolUseId })` 的 id 必须和 handler 传进去的 call.id 一致**。如果 message.id 的命名规则哪天变了，或某条 tool message 不走 `tool-${call.id}`，就会出现：

* UI 调 `submitAnswers(toolUseId, ...)`
* `UserInputManager` 找不到 pending → 可能 buffer / 或啥也不发生
* handler 那边永远等不到 answers

✅ 建议改成“优先用 toolInfo 里的 tool_use_id / toolUseId”，没有再 fallback：

```ts
const toolUseId =
  (message.toolInfo as any)?.tool_use_id ??
  (message.toolInfo as any)?.toolUseId ??
  (message.id.startsWith('tool-') ? message.id.slice('tool-'.length) : message.id)
```

> 这是最“硬”的 blocker：错了就死锁。

---

### 2) `Esc` 在 `isSubmitting=true` 时仍然会 abort（可能把“已提交但未完成”的轮次打断）

你现在 `Esc` 在最前面处理，`isSubmitting` 不生效：

```ts
if (key.escape) { onAbort(); return }
if (isSubmitting) return
```

这会导致：用户在 Review 点了 Submit（已经 `submitAnswers` 了），但模型还没 tool_end 时，如果手滑按 Esc，你会 `abort()` 整轮 —— **既可能让本次 tool loop 变成 aborted，也可能让 UI 和内部状态出现“已提交但被打断”的怪态**。

✅ 建议：提交中把 Esc 改成 no-op 或只提示“Submitting…”（不 abort-turn）：

```ts
if (key.escape) {
  if (isSubmitting) return
  onAbort()
  return
}
```

---

### 3) `useInput` 的事件冲突：你这边永远 `isActive: true`，必须确保 REPL 的全局快捷键在 Ask mode 下不处理

你已经做了“隐藏输入框”，但**隐藏输入框 ≠ 禁用别处的 useInput**。如果 REPL（或别的组件）也 `useInput` 监听 Tab/方向键/Enter，就会出现：

* Ask UI 处理一次
* REPL 又处理一次（比如切 focus、触发快捷键、甚至触发 abort）

✅ 你需要在 REPL 的 `useInput` 回调里加“Ask mode 直接 return”，或者把 REPL 的 useInput `isActive` 绑到 `!isAskMode`。

---

## 建议修的问题（nice-to-have）

### 1) `presenter -> replUi.abort()` 这个依赖可以用，但建议“默认走 reject，abort 作为兜底”

你现在：

```ts
onAbort={() => (replUi ? replUi.abort() : userInput.reject(...))}
```

这等价于：只要有 replUi，就永远 abort-turn。

更像 Claude 的做法通常是：

* **Esc = decline 当前 Ask（tool-level cancel）**
* 只有在“整轮流式已经乱了/需要强制终止”时才 abort-turn

✅ 建议改成：

```ts
onAbort={() => userInput.reject(toolUseId, new Error('User declined'))}
```

然后 controller/handler 对这个 error 做“declined”分支（不要当 is_error）。
如果你暂时不想动 handler，也至少可以：reject + 同时 abort（但顺序要确保 pending 被 resolve/reject）。

---

### 2) multi-select 的“最后一行 Submit”样式与 Claude 还有一点差距

你现在 multi-select 最后一行是：

* 没编号
* 没 `[ ]/[✓]` 的视觉结构
* Enter 时相当于“下一题”

Claude 截图里更像是“最后一项也在列表中”（有编号/有勾选位/下面显示 Submit），你可以把它做成一个 `OptionRow` 的变体，观感更像。

---

### 3) `maxCursorForQuestion()` 可以简化/更语义化

现在：

```ts
return q.multiSelect ? q.options.length : q.options.length
```

直接改成 `lastRowIndex(q) { return q.options.length }`，否则以后你自己也会怀疑这里是不是写错了。

---

### 4) Space 检测建议同时用 `key.space`

你现在用 `input === ' '`，在不同终端/输入法下有时会不稳定。更稳：

```ts
if (currentQ.multiSelect && (key.space || input === ' ')) { ... }
```

---

### 5) “Preparing questions…” 只在 `questions.length===0` 时显示，建议区分两类

* input 还没到：Preparing…
* input 到了但不合法：Invalid questions…

否则排查数据协议问题时很痛苦。

---

## 交互对齐度结论（按你列的 checklist）

* ✅ 无输入框：OK（前提是 REPL 的 useInput 也禁用）
* ✅ ↑/↓：OK
* ✅ Tab/←/→：OK
* ✅ Enter：OK（单选会自动下一题，多选 Enter 切换/或在 Submit 行前进）
* ✅ 多选 Space：OK（但建议加 `key.space`）
* ✅ 0/t “Type something”：**目前只支持单选**（你自己也写了 Typing mode single-select only）。如果你目标就是“和你截图一致”（多选没有 type something），那 OK；如果要严格按最初 spec（多选也能 type something），那还差一块。
* ✅ Review/Submit：OK，并且你已经加了提交中锁输入 👍

---

## 我建议的“下一步迭代”（不做通用抽象的前提下）

1. **把键盘逻辑拆成一个纯函数 reducer（只在 Ask 内部）**
   不需要上“通用交互框架”，但至少把 `useInput` 那坨 if/return 变成：

* `state + action -> nextState`
* `effects`（submit / abort / commitTyping）集中在少数分支

这样你以后加“多选也能 Type something”“Esc 退出 typing 而不是 abort”等不会爆炸。

2. **取消语义先做到 tool-level cancel（reject），再考虑 abort-turn**
   你现在已经有 `userInput.reject(toolUseId, ...)` 的通道了，只差把 handler/controller 的错误分类做一下，就能更像 Claude：用户拒绝 ≠ 工具错误。

3. **补一个最小的“Ask mode 输入路由开关”**
   让 REPL 的快捷键监听在 Ask mode 下彻底禁用，保证不会出现“同一个 key 被处理两次”的幽灵 bug。

---

如果你愿意，我可以按你这份代码给你一份**最小 diff**（只改 10~20 行）把三个 blocker 都修掉：

* toolUseId 来源兜底
* submitting 时禁 Esc abort
* Space/REPL useInput 冲突处理的写法建议（你贴一下 REPL 的 useInput 片段就能精确对齐）


me: 好的 

好，那我直接给你一份**最小改动的 patch 方案**（不做通用抽象），把我上面提到的 3 个 blocker 全修掉，并顺手补两个稳定性小优化（Space 兼容、提交后彻底锁键盘）。

---

## 1) Blocker：`toolUseId` 必须优先从 `toolInfo` 拿

把你现在这行：

```ts
const toolUseId = message.id.startsWith('tool-') ? message.id.slice('tool-'.length) : message.id
```

替换为：

```ts
const toolUseId =
  (message.toolInfo as any)?.tool_use_id ??
  (message.toolInfo as any)?.toolUseId ??
  (message.toolInfo as any)?.id ??
  (message.id.startsWith('tool-') ? message.id.slice('tool-'.length) : message.id)
```

原因：`submitAnswers/reject` 必须命中 handler `requestAnswers({ toolUseId })` 的同一个 id，否则会直接卡死。

---

## 2) Blocker：提交中不要 Esc abort（避免“已提交但被打断”）

在 `useInput` 回调里，把 Esc 分支改成 **提交中 no-op**：

**原来：**

```ts
if (key.escape) {
  onAbort()
  return
}

if (isSubmitting) return
```

**改成：**

```ts
if (key.escape) {
  if (isSubmitting) return
  onAbort()
  return
}

if (isSubmitting) return
```

> 这能避免 submit 后还没 tool_end 的窗口期被 Esc 打断整轮。

---

## 3) Blocker：Ask mode 下必须禁用 REPL 的 `useInput`（否则键盘事件双处理）

你这份 `presenter.tsx` 已经 `useInput({ isActive: true })`，这是对的；但**REPL / 其它组件的 useInput 必须在 Ask mode 关掉**。

你现在 REPL 已经能判断 Ask mode（你 repomix 里就是 `isAskMode`）。做法二选一：

### A) 最稳：REPL 的 useInput 直接 gate（推荐）

在 REPL 的 `useInput` 回调开头加：

```ts
if (isAskMode) return
```

### B) 或者用 `isActive` 关掉

如果你的 REPL useInput 支持传 `isActive`：

```ts
useInput(handler, { isActive: !isAskMode })
```

> 这一步不做，方向键 / Tab / Enter 很容易被 REPL 快捷键“顺手”处理一次，出现幽灵 bug。

---

## 4) 稳定性：Space 检测同时支持 `key.space`

把：

```ts
if (currentQ.multiSelect && input === ' ') {
```

改成：

```ts
if (currentQ.multiSelect && (key.space || input === ' ')) {
```

---

## 5) 稳定性：提交后彻底禁用 Ask 的 useInput（更干净）

你已经有 `isSubmitting` return，但 `useInput` 仍然 active；可以让 Ink 在提交中直接不把事件发给这个 handler：

把：

```ts
useInput((input, key) => { ... }, { isActive: true })
```

改成：

```ts
useInput(
  (input, key) => {
    // 这里保持你的逻辑不变
  },
  { isActive: !isSubmitting },
)
```

> 然后保留 Esc 那段 `if (isSubmitting) return` 也没坏处，但此时就更保险。

---

## 额外一句（不强制）：`onAbort` 建议优先 reject，而不是 abort turn

你现在是：

```ts
onAbort={() => (replUi ? replUi.abort() : userInput.reject(toolUseId, new Error('Canceled')))}
```

如果你想更贴近 Claude 的语义，建议以后改成：

* Esc：`userInput.reject(toolUseId, new Error('User declined'))`
* 只有在流式真的需要强断时才 `replUi.abort()`

但你说暂时不做抽象，我就不要求你现在改 handler/controller 的分支了。

---

如果你把 **REPL 里 useInput 那段代码**贴出来（只要那个 hook + 10 行上下文），我可以给你一份完全对齐你项目的“精确替换片段”，确保 Ask mode 下不会再发生键盘冲突。
