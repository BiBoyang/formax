下面基于你这次的实现做一次“偏工程化”的 review（引用均来自 `repomix-ask-user-question.txt` ）。

---

## 架构边界 / “presenter → abort” 依赖是否合适

你现在的分层是清晰的：

* 交互 UI 全在 `presenter.tsx`（`InteractiveAsk` + 键盘逻辑）
* REPL 只负责 **Ask mode 时隐藏输入框**（`isAskMode` 判定 + `!isAskMode && <InputBar/>`） 
* 通过 `ReplUiProvider` 暴露 `abort()` 给 presenter 调用，Ask 的 `onAbort` 默认走 `replUi.abort()`

这个依赖**可以工作**，但它把工具 presenter 变成了“能操控整轮 REPL 的全局行为”的组件。更优雅的做法通常是把能力收敛成**更窄的接口**，比如：

* `cancelTool(toolUseId)`：仅结束 Ask 这一个交互（并产出一个一致的 tool_result / 或者 tool_end），**不一定 abort 整轮**；
* `abortTurn()`：像现在这样中断整轮流式/工具循环。

换句话说：**presenter 依赖 REPL 是 OK 的，但依赖的能力最好从 `abort()` 收敛成 “interaction host API”**（至少区分 cancel-tool vs abort-turn），否则后面别的交互式工具也会想调用 abort，边界会越来越糊。

---

## 交互是否对齐 Claude Code

你列的核心行为基本都实现了：

* 无输入框：Ask running 时 REPL 不渲染 InputBar
* ↑/↓：移动光标
* Tab / ← / →：切题
* Enter：单选确认并自动前进 / 多选为切换或在 Submit 行前进
* 多选 Space：切换
* 0/t 进入 “Type something”：已做
* Review/Submit 页：已做（`ReviewPage` + Submit/Cancel cursor） 

差异点（不算错，但会影响“像不像”）：

* **typing 模式下仍允许 Tab/←/→ 切题**，且不会自动 commit typingValue（只在 Enter 时 commit）  —— 这会引出一个实质性 bug（见下方 blocker 1）。
* Review 页展示多选答案时你有一个“尾逗号”显示问题：`formatAnswerForDisplay` 会给 multiSelect 的答案强行加一个末尾逗号（观感很不像 Claude）。

---

## 取消语义：Esc 走 abort() 是否会破坏一致性

当前行为是：

* Ask UI 里 Esc → `onAbort()` → `replUi.abort()` 
* `useReplController.abort()` 会：

  * abort signal
  * **把 running 的 Ask tool message 直接从 messages 里删掉**
  * 再插入一条 assistant 文本：`User declined to answer questions`

这不会“破坏 tool loop/历史一致性”的最关键原因是：你 abort 以后 `runTurn` 没返回，`historyRef` 不会被写入，因此这条“declined”文本**只存在于 UI messages，不会进入模型对话历史**（因此模型不会被你这条 UI 文本影响）。

但它有两个工程上的副作用：

1. **UI 上看起来像模型说的**（role=assistant），但实际上是本地插入。以后排查“模型为什么这么说”会很迷。
   建议：给 Msg 加一个 `origin: 'model' | 'local'` / 或 `isLocal?: true`，渲染时用 dim/system 风格。

2. abort-turn 会让本轮模型无法“基于 declined 做后续回答”。如果你希望更像 Claude 的 “工具交互被拒绝，但模型还能继续给出 fallback 方案”，更推荐：

* Esc 不 abort-turn，而是 `userInput.reject(toolUseId, DeclinedError)`；
* tool handler 捕获 DeclinedError，返回一个**非致命** tool_result（`is_error: false`，内容里带 `declined: true`），从而让模型继续走下去。
  你现在的 handler 会把任何异常都变成 `is_error: true` + `Error: ...`，这会把“用户拒绝”混同为“工具失败”。

---

## 状态/健壮性

优点：

* tool_input 未到：展示 `Preparing questions…`，并且 Ask mode 仍可用 REPL 的 Esc 取消（因为 REPL 仍监听 Esc） 
* `UserInputManager` 支持“先提交后 requestAnswers”的缓冲，避免 race：`bufferedAnswers`
* 你刻意隐藏 `Request aborted` 的 tool 消息：error 且包含该字符串直接 return null（再加上 abort 时直接删 running Ask，整体很干净）

主要风险：

* “提交后到 tool_end 前”这段时间 UI 仍然可交互，会造成重复提交/缓冲泄漏（见 blocker 2）。

---

## 代码质量 / 明显 bug 点

整体可读性不错，尤其是你把 UI 块拆成 `QuestionPage/ReviewPage/OptionRow/...` 了。但键盘逻辑 + 状态迁移全堆在一个 `useInput` 回调里，后面迭代会越来越难；更建议上 reducer/状态机（见“下一步方向”）。

---

# 必须修的问题（blocker）

1. **进入 typing 时没有清掉单选已选项，会导致“看似在输入，但最终提交的还是旧选项”**
   `enterTyping()` 只设置 `typing=true`、`typingValue`，但不清 `selected`；而提交答案时 `formatAnswerForSubmit()` 优先用 `other`，否则用 `selected[0]`。
   如果用户：选了 A → 按 t 进入 typing → 输入但没按 Enter commit（或被 Tab/→ 切走），最后在 Review/Submit 里提交，很可能提交的是 A（旧选项），不是正在输入的内容。
   **修法建议（至少一个要做）：**

* `enterTyping` 里把 `selected: []`（并可把 `other` 也清空/或保留 draft）；
* 或者：typing 时禁止切题（Tab/←/→不生效），只能 Enter commit/或 Esc 退出 typing；
* 或者：切题时自动 commit typingValue 到 `other`（更像“表单”）。

2. **提交后仍可再次触发 submit，可能把 answers 永久写进 bufferedAnswers（内存泄漏/脏状态）**
   `submitAll()` 直接调用 `onSubmit(out)`；而 `UserInputManager.submitAnswers()` 在没有 pending 时会写入 `bufferedAnswers`。
   当第一次 submit 让 pending resolve 后，在 tool_end 还没把 UI 切走之前（message 仍是 running），用户再按一次 Enter → 可能再次走 submitAll → 此时 pending 已不存在 → answers 被写入 bufferedAnswers，但该 toolUseId 后续不会再 requestAnswers，于是 buffer 永远留着。
   **修法建议：**

* InteractiveAsk 内部加 `phase: 'answering' | 'submitting'`，submit 后立刻置为 submitting，并把 `useInput({isActive:false})` 或直接 return “Submitting…”；
* 或者在 `UserInputManager` 里增加 `complete(toolUseId)` / `markResolved`，resolved 后拒绝再 buffer；
* 或者 submitAnswers 返回 `false` 表示无 pending 且不允许 buffer（仅 AskUserQuestion 用）。

---

# 建议修的问题（nice-to-have）

* **“User declined…” 作为 assistant 消息注入，容易误导**：建议标记为 local/system 渲染（否则排查时像模型说的）
* **多选答案显示尾逗号**：`formatAnswerForDisplay` 末尾 `,` 去掉
* **Decline vs Error 语义区分**：现在 handler 把异常统一 `is_error: true`；建议引入 `DeclinedError`，并返回一种“非错误但 declined”的 tool_result（模型可继续）
* **typing 模式下的体验**：至少要提供“退出 typing 回到选项”的方式（比如 Esc 仅退出 typing，不 abort turn；或 Ctrl+G/Alt+Backspace 之类）——目前 Esc 直接 abort-turn
* **schema/输入校验补齐**：spec 要求 options 2-4、questions 1-4，但 handler 只做了“questions 数组非空”的硬校验；建议把 options 数量也校验掉，避免 UI 出现“空选项”这种奇怪情况。

---

# 我认为最好的下一步迭代方向

把 Ask 这套交互抽象成通用“交互式工具 UI”基础设施（你后面肯定还会有 Confirm、PickFile、DiffReview 之类）：

1. **引入 Interaction Host（单例焦点）**

* 统一管理：隐藏 InputBar、屏蔽 slash suggestions、键盘事件路由、Esc 行为（cancel-tool vs abort-turn）
* presenter 不直接拿 `abort()`，而是拿 `interactionApi`（例如 `cancelTool(toolUseId)` / `abortTurn()`）

2. **用 reducer/状态机替换散落的 setState**

* 状态明确：`preparing → question(i) → typing(i) → review → submitting → done`
* 键盘映射统一在一个 `reduce(event)`，避免闭包/分支爆炸

3. **取消语义标准化**

* tool-level cancel：产出一致的 tool_result（declined），避免 UI 注入“像 assistant 的文本”
* turn-level abort：中断整轮（保持你现在的行为）

如果你愿意，我可以按你现有代码风格，直接给一个“InteractionHost + reducer”骨架接口（不改太多现有目录结构），并指出你现在最小改动的落点：`ToolPresenterProps` 扩展一个 `ui` 对象 vs 保留 context。
