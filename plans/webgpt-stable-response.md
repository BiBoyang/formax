A. 高风险问题清单（P0/P1）

> 说明：以下定位均基于你提供的 repomix 包 `formax-ui-refactor-pack.plus.txt`。行号以“该文件内的源码行号”为主（不同分支可能有偏移）。我优先挑“会直接导致交互崩坏 / 难排查连锁失败”的结构性点，并给出**最小可回滚**的修复路径。

## P0（最高优先级：会导致体验直接崩坏/危险误操作/连锁失败）

### P0-1 工具结果被追加 `<system-reminder>`，会污染历史 & 破坏工具输出契约（尤其 JSON 工具）

* **现象（用户感知）**

  * 会出现“工具输出看起来被插入了一段系统提示/提醒”，甚至模型突然开始“读不懂工具输出”，出现反复重试、走偏、或某些工具结果解析失败的连锁问题。
  * 长会话里上下文膨胀更快，模型表现突然退化（莫名其妙开始忘事/乱改）。
* **根因猜测（结合代码）**

  * `chat/engine` 在某些条件下会把 todo stale reminder **直接拼接到每个 tool_result 的 content 字符串末尾**，用 `<system-reminder>...</system-reminder>` 包住。这样：

    1. **任何原本是 JSON 的 tool_result 会被拼接后变成非法 JSON**（模型/后续逻辑若期望 JSON，就会崩）。
    2. 这个 reminder 不是 `cache_control: ephemeral` 的 block，而是混在字符串里；后续 history 里会被永久保存，造成“本该一次性的提示”变成“历史污染”。
  * 另一方面，`stripInjectedBlocksFromHistory` 只会剥离 user 消息里那些 **以 block + ephemeral 方式注入**的内容；对 tool_result 字符串里塞进去的 `<system-reminder>` **无能为力**，导致污染一直留在 history。
* **具体定位（文件 + 函数/组件名）**

  * `src/chat/engine.ts`

    * `buildTodoStaleReminder()` / `appendReminderToToolResultContent()` / `amendedToolResults = toolResults.map(...)`（大约 engine.ts 180~230 行附近）
  * `src/features/repl/useReplController.ts`

    * `stripInjectedBlocksFromHistory()`（大约 1231 行附近）
* **最小修复思路**

  1. **不要**对所有 tool_result 盲目拼接 reminder：

     * 最小方案：加一个 `shouldAppendReminder(toolName, content)`：

       * 对明显 JSON 工具（例如 `Task`, `TaskOutput` 等）直接 **skip**；
       * 或者 `content` 看起来像 JSON 且 `JSON.parse` 成功 → skip。
  2. **把“tool_result 内的 `<system-reminder>`”视为一次性内容**：

     * 在回写 `historyRef` 前，对每个 tool_result 内容做一次 `stripTrailingSystemReminderBlock()`（你们已有同名函数，但现在存在**重复实现**，见 P1-6），把尾部 `<system-reminder>` 去掉后再持久化进 history。
* **验收方式（单测/手测）**

  * 单测：

    * 新增一个 engine 相关测试：当 tool_result 内容是 `{"status":"ok"}` 时，todo reminder 不应被拼接导致 JSON 失效；且最终持久化 history 不包含 `<system-reminder>`。
  * 手测：

    1. 造一个“多轮工具调用”触发 todo stale reminder 的场景；
    2. 再触发 `TaskOutput`（或任何返回 JSON 的工具）；
    3. 观察：工具结果不出现被拼接的 `<system-reminder>`；模型不出现“解析失败/反复重试”。

---

### P0-2 Plan 模式下展示的“带行号片段”格式与 Edit 的“去前缀逻辑”不一致，极易导致 `old_string` 匹配失败

* **现象（用户感知）**

  * 在 plan 模式里，模型照着 UI 展示的 plan 文件片段复制 `old_string`，却频繁报“找不到 old_string / match failed”，然后陷入反复 edit/重试，体验崩坏且难定位。
* **根因猜测（结合代码）**

  * `edit` handler 里 `stripCatNPrefixes()` 只处理 `cat -n` 常见的 **数字+Tab** 前缀（`/^\s*\d+\t/gm`），但 plan snippet 用的是 **数字+箭头 `→`** 的格式（`formatCatNArrowLine`）。
  * 结果：模型复制的 `old_string` 带 `→` 前缀，strip 不掉，最终匹配失败。
* **具体定位（文件 + 函数/组件名）**

  * `src/tools/modules/edit/handler.ts`

    * `stripCatNPrefixes()`（约 97 行）
    * `formatCatNArrowLine()` / `formatPlanSnippet()`（约 111 行附近）
* **最小修复思路**

  * 保持 UI 不动的最小补丁：把正则扩展为同时支持 `\t` 和 `→`：

    * `^\s*\d+(?:\t|→)\s?`（注意 `gm`）
  * 并补一条注释：这是“从 plan snippet/`cat -n` 复制粘贴”的兼容逻辑。
* **验收方式（单测/手测）**

  * 单测：给 `old_string` 传入带 `→` 的行号前缀，确保 edit 能成功找到并替换。
  * 手测：进入 plan 模式 → 让模型按 snippet 复制 `old_string` 做 edit → 不再出现匹配失败。

---

### P0-3 输入焦点/事件路由没有统一机制：多个 `useInput({isActive:true})` 并存时，方向键/数字键/ESC 行为不可预测

* **现象（用户感知）**

  * 弹出审批 prompt/overlay 时，方向键有时移动 prompt 光标，有时影响底部输入框/其他 UI；
  * ESC 可能同时触发“退出 typing / 取消 prompt / 关闭 overlay / 清空输入”中的多个动作；
  * 造成“明明按了取消却批准了”等高风险误操作。
* **根因猜测（结合代码）**

  * 多个 prompt 组件（如 bash/fsWrite/exitPlanMode）内部各自 `useInput`，且常见写法是 `isActive: true`；Overlay manager 也只是记录 overlay 状态，并不参与 input focus 仲裁。
  * 当**overlay + tool approval prompt + 其他输入源**同时存在时，没有单一“输入路由器/焦点栈”，Ink 的 input 分发就容易变成“谁都在抢”。
* **具体定位（文件 + 函数/组件名）**

  * `src/tools/presenters/fsWriteApprovalPrompt.tsx`（`useInput`）
  * `src/tools/presenters/bashApprovalPrompt.tsx`（`useInput`）
  * `src/tools/modules/exitPlanMode/presenter.tsx`（`useInput`）
  * `src/features/repl/overlays/overlayManager.ts`（只有 open/close/getCurrent，没有 focus 概念）
* **最小修复思路**

  * 不做大重写：新增一个极小的 **InputGate（焦点锁）**：

    * `requestFocus(id, priority)` / `releaseFocus(id)` / `activeId`
    * 规则：优先级高者（overlay > modal > approval prompt > base input）获得焦点；同优先级按“最近请求”获胜。
  * 逐步迁移：先把所有 approval prompt 的 `useInput({isActive})` 改为 `isActive = (activeId === myId)`。
* **验收方式（单测/手测）**

  * 手测：同时打开 overlay（如 agents/permissions）+ 出现一个 approval prompt → 方向键只影响 overlay；关闭 overlay 后 prompt 恢复。
  * 单测（ink-testing-library）：挂两个 prompt，发按键序列，断言只有 active 的 prompt 响应。

---

### P0-4 Ctrl+C/Abort 清理不完整：可能留下“悬挂的 pending prompt/运行中 tool 消息”，导致 UI 卡住或后续输入串台

* **现象（用户感知）**

  * 用户按 Ctrl+C 后，有时 prompt 仍在屏幕上、无法继续输入；或某些 tool 仍显示 running；下一次 prompt 可能被“自动回答/串台”。
* **根因猜测（结合代码）**

  * `abort()` 会 `abortController.abort()`，并且只对 `AskUserQuestion` 的 running tool message 做了特殊处理（过滤/追加“User declined…”），但：

    * 没有统一地 reject 全部 `userInputManager` 的 pending；
    * 没有把其他 running tool message 统一标记为 aborted/error。
  * 一旦 tool 的后续事件没再到达（或顺序异常），就会留下“半状态”。
* **具体定位（文件 + 函数/组件名）**

  * `src/features/repl/useReplController.ts`

    * `abort = useCallback(...)`（约 605 行附近）
  * `src/tools/runtime/userInputManager.ts`

    * pending/bufferedAnswers 的维护逻辑（见 P1-4）
* **最小修复思路**

  1. 在 `userInputManager` 增加 `rejectAllPending(reason)` + `clearBuffered()`；
  2. `abort()` 中调用它们；
  3. 同步把所有 `toolInfo.status==='running'` 的 tool message 改为 `status:'error'`，content 写成统一的 `Error: Request aborted`（配合 P1-1 的错误格式统一）。
* **验收方式（单测/手测）**

  * 单测：`rejectAllPending` 会让所有 pending 的 promise reject；buffered 被清空。
  * 手测：触发一个需要审批的工具 → Ctrl+C → prompt 消失、工具标记 aborted、底部可继续输入。

---

### P0-5 Bash 审批 prompt 存在“光标状态竞态”：快速按方向键 + 回车，可能按到旧选项（危险误批准）

* **现象（用户感知）**

  * 用户“↓ + Enter”想选 Cancel/No，但实际触发了 Approve（或反之）。这是终端交互里最危险的一类问题。
* **根因猜测（结合代码）**

  * `BashApprovalPrompt` 用 `cursor` state 决策，未像 `FsWriteApprovalPrompt` 那样用 `cursorRef` 同步写入；在快速按键时，Enter 可能读到旧的 `cursor` 闭包值。
* **具体定位（文件 + 函数/组件名）**

  * `src/tools/presenters/bashApprovalPrompt.tsx`

    * `useInput(... key.return ... switch(cursor) ...)`
* **最小修复思路**

  * 引入 `cursorRef`，在 `setCursor` 时同步更新；
  * Enter 决策只读 `cursorRef.current`；
  * （可选）对 `typing` 也用 ref，避免 ESC/Enter 的竞态。
* **验收方式（单测/手测）**

  * 单测（ink-testing-library）：连续发送 `downArrow` + `return`（不等待 re-render），断言走到正确 decision。
  * 手测：重复快速操作 20 次，确保不出现误选择。

---

### P0-6 `<system-reminder>` 的“注入/剥离”实现出现重复版本，容易导致“一处修了另一处没修”的幽灵 bug

* **现象（用户感知）**

  * 你修了“UI 不显示 reminder”，但 history 里仍污染；或者反过来。不同路径下表现不一致，难排查。
* **根因猜测（结合代码）**

  * 代码里存在至少两份 `stripTrailingSystemReminderBlock`（一个在工具格式化相关文件，一个在 `useReplController` 附近）。一旦未来对 marker 规则或剥离策略调整，容易漏改。
* **具体定位（文件 + 函数/组件名）**

  * `src/features/repl/useReplController.ts`：`stripTrailingSystemReminderBlock()`（靠后位置）
  * `src/utils/toolFormatting.ts`：`stripTrailingSystemReminderBlock()`（靠后位置）
* **最小修复思路**

  * 只做最小去重：选一个作为**唯一实现**（建议放 `src/utils/toolFormatting.ts`），另一个改成 re-export/调用同一个实现，避免行为漂移。
* **验收方式（单测/手测）**

  * 单测：给定包含 `<system-reminder>` 的字符串，两个入口剥离结果一致（或仅保留一个入口）。
  * 手测：工具结果显示与 history 清理同时生效。

---

## P1（高优先级：会导致难解释/难调试/一致性差，或在边界条件下崩）

### P1-1 错误输出格式不统一：模型/上层逻辑难以稳定解析，用户也难理解“下一步怎么做”

* **现象（用户感知）**

  * 有时报错是 `Error: ...`，有时是 `Tool use rejected by user.`，有时是 `Request aborted`；模型难以形成稳定恢复策略。
* **根因猜测**

  * 各 handler/preflight/approval 路径自行拼字符串，只有部分路径带 `ErrorCode:`，且错误的“结构化字段”缺失。
* **具体定位**

  * `src/tools/executor/policyPreflight.ts`、`src/tools/executor/skillPreflight.ts`、`src/chat/engine.ts` 的 abort/reject 文案等
* **最小修复思路**

  * 新增 `formatToolError({ code, message, hint, detail })`（不引入新框架）：

    * 第 1 行保持 `Error: ...`（兼容现有逻辑）
    * 固定追加 `ErrorCode: <Enum>`
    * 可选追加 `Hint:`（给模型/用户的下一步）
  * 先覆盖最关键路径：policy deny / user reject / aborted / invalid input。
* **验收方式**

  * Golden test：对关键 error case 做字符串快照；
  * 手测：触发 deny/reject/abort，输出字段稳定。

---

### P1-2 权限/审批体系分散在多个层（policy rules / permissionsStore / replMode），同名“remember”语义不一致，难解释

* **现象**

  * “Approve & remember”在不同工具上效果不同：有的持久化，有的只是本会话，有的影响范围不清楚；用户难以预测，bug 难复现。
* **根因猜测**

  * bash 类通过 project permission key 持久化；fs.write 的 remember 走 replMode `acceptEdits`；其他 action 可能落 policy rule。决策源头分裂。
* **具体定位**

  * `src/commands/registry.ts`：`handleToolApprovalDecision(...)` 分支处理 remember/allowlist
  * `src/tools/executor/policyPreflight.ts`：把 policy decision 与 permissionsStore decision 混合裁决
* **最小修复思路**

  * 不重构权限体系，只做“**解释统一**”：

    * 在 tool_result（或日志）补 `DecisionSource:` / `Scope:`（session/project/global）
    * UI prompt 文案显示“Remember (this session)” vs “Remember (this project)”
  * 同时补一个 `/permissions` 或增强现有权限对话框输出：列出当前有效规则与来源（不新增复杂功能）。
* **验收方式**

  * 手测：对同一 tool 连续两次触发，remember 后第二次不再问（或明确说明仍会问）。
  * 单测：对 `handleToolApprovalDecision` 的不同 action 断言 scope 标记一致。

---

### P1-3 `userInputManager` 的 `bufferedAnswers` 没有 TTL/全局清理，存在“答案串台/内存增长”的隐患

* **现象**

  * 极端情况下会出现：没看到 prompt 但系统“自动做了选择”；或长会话内存上升。
* **根因猜测（结合代码）**

  * `submitAnswers()` 若找不到 pending，会把 answers 存到 `bufferedAnswers`；只有后续 `requestAnswers` 命中同 toolUseId 才会消耗。若 toolUseId 生命周期异常（abort/重试/不再请求）会残留。
* **具体定位**

  * `src/tools/runtime/userInputManager.ts`：`bufferedAnswers` 的 set/get/delete 路径
* **最小修复思路**

  * 加“最小防护”而不改变主流程：

    1. buffered 存入时带 `timestamp`
    2. 每次 `requestAnswers`/`submitAnswers` 时顺便清理过期（例如 >60s 或 size>50）
    3. `abort()` 时清空 buffered
* **验收方式**

  * 单测：过期 buffered 会被清理；abort 后不会复用旧答案。

---

### P1-4 JSON 输出型工具（如 Task/TaskOutput）成功时返回 JSON、失败时返回纯文本，契约不稳定

* **现象**

  * 模型若对 JSON 工具做结构化处理，遇到错误会突然拿到纯文本，容易写出“解析失败→重试→更乱”的链式行为。
* **根因猜测**

  * handler catch 分支直接返回 `"Error: ..."` 字符串（`is_error: true`），与成功分支 `JSON.stringify(...)` 不一致。
* **具体定位**

  * `src/tools/modules/taskOutput/handler.ts`（以及类似 JSON 工具的 handler）
* **最小修复思路**

  * 保持对用户友好但让契约稳定：

    * **错误也返回 JSON**：`{"status":"error","error_code":"...","message":"..."}`（同时保持 `is_error: true`）
* **验收方式**

  * Golden test：成功/失败都能 `JSON.parse`，且字段齐全。

---

### P1-5 Plan 模式限制逻辑在多处重复（policyPreflight + handler 内），长期容易出现“有的拦住、有的漏拦、有的文案不同”

* **现象**

  * 同样是 plan 模式禁止某些写操作：有时在 preflight 拦住，有时在 handler 拦住；输出文案/错误码不同。
* **根因猜测**

  * 规则分散导致未来修改时难以一致更新。
* **具体定位**

  * `src/tools/executor/policyPreflight.ts`（plan mode 分支）
  * `src/tools/modules/write/handler.ts` / `src/tools/modules/edit/handler.ts`（plan mode 相关特殊处理）
* **最小修复思路**

  * 不做大重构：至少把“plan mode 拒绝”的输出统一走 `formatToolError`，并把重复的文字/逻辑抽成一个共享 helper（保持行为一致）。
* **验收方式**

  * 单测：同样输入在不同入口触发 deny 时，`ErrorCode` 一致。

---

### P1-6 “工具契约核验”目前主要是 spec/handler parity，缺少“tool output contract（golden）”层，容易回归

* **现象**

  * 你修复了某个工具输出格式，后续又被另一个改动（如提醒注入、truncate）悄悄破坏。
* **根因猜测**

  * 现有 `tools:parity` 更偏“schema 是否一致”，对“输出字符串是否可解析/是否被插入垃圾”覆盖不足。
* **具体定位**

  * `package.json` 有 `tools:parity`，但缺少输出 golden。
* **最小修复思路**

  * 给关键工具加 golden tests（详见 D），先覆盖 JSON 工具 + 常用编辑类工具。
* **验收方式**

  * 跑 `bun run tools:parity` + `bun run test`，确保输出约束被锁住。

---

### P1-7 streaming/tool_update 频繁 setState 可能导致闪烁/卡顿（尤其任务/工具输出密集）

* **现象**

  * 工具输出刷屏时 UI 卡顿、光标/输入响应延迟。
* **根因猜测**

  * assistant_delta 有 200ms 缓冲，但 tool_update / nested task events 可能无节制 setState。
* **具体定位**

  * `src/features/repl/useReplController.ts`：tool_update 处理分支
  * `src/tools/modules/task/presenter.tsx`：订阅 task events
* **最小修复思路**

  * 参考 assistant_delta：对 tool_update 做轻量节流（例如 50~100ms 合并一次 middleLines）。
* **验收方式**

  * 手测：跑一个产出大量日志的工具，输入仍能流畅响应。

---

## P2（中优先级：不会立刻炸，但会拖慢定位/增加不确定性）

### P2-1 Overlay manager 只有“单槽位 current”，没有 stack；打开/关闭链路复杂时容易丢状态（且与输入焦点未绑定）

* **现象**

  * overlay 互相打开/关闭时，状态丢失或关闭顺序不直观。
* **根因猜测**

  * `createOverlayManager` 仅 `open(kind)/close()`，没有栈语义，也不参与 input focus。
* **具体定位**

  * `src/features/repl/overlays/overlayManager.ts`
* **最小修复思路**

  * 不做 stack（避免大改），但把 overlay 的 open/close 接入 InputGate（P0-3），保证“overlay 开启时底层输入一定不消费事件”。
* **验收方式**

  * 手测：overlay 打开期间，底层 prompt/输入框不响应按键。

---

### P2-2 prompt budget prune 截断 tool_result 可能破坏结构化内容（JSON/标签），会导致模型误解

* **现象**

  * 长会话里模型突然“理解错工具结果”（尤其结构化输出被截断后变成半截）。
* **根因猜测**

  * `prune` 对 tool_result 做纯字符截断，无法保证结构完整。
* **具体定位**

  * `src/chat/context/prune.ts`
* **最小修复思路**

  * 最小改善：对“疑似 JSON”输出做字段级裁剪（只保留顶层 meta），不要在中间截断。
* **验收方式**

  * 单测：JSON tool_result 被裁剪后仍可 parse，或至少明确标识 `TRUNCATED_JSON`.

---

### P2-3 spec/handler mismatch 已有文档但缺少“阻断式”保障，容易长期背债

* **现象**

  * 工具 schema 微调后，模型继续按旧 spec 调用，产生“间歇性错误”。
* **根因猜测**

  * mismatch 文档存在，但流程上不一定强制修复/锁住。
* **具体定位**

  * `SPEC_HANDLER_MISMATCHES.md`
* **最小修复思路**

  * 让 `bun run tools:parity` 在 CI 中硬失败（如果你们 CI 已有就算），并把 mismatch 列表设成“必须注明原因/owner”。
* **验收方式**

  * CI 必须通过 parity 才能合并。

---

B. “最小可行稳定底座”方案（MVP Stability Layer）

目标：**不大重构**的前提下，建立一个“系统边界”，做到——即便模型犯错，也能被系统拦住，并给出明确下一步提示；同时输入/overlay 行为可预测、可回滚。

## 1) 统一错误输出/错误码（面向用户 + 面向模型）

**最小 API：**

* `formatToolError({ code, message, hint?, detail? }) -> string`
* `enum ToolErrorCode`（先覆盖最关键的 6~10 个）

  * `InvalidInput`, `PolicyDenied`, `ApprovalRequired`, `UserRejected`, `Aborted`, `InternalError`, `NotFound`, `PlanModeRestricted`
    **输出格式（建议）：**

```
Error: <message>
ErrorCode: <ToolErrorCode>
Hint: <one actionable next step>
Detail: <optional, debug gated>
```

**原则：**

* 第 1 行始终 `Error:`（保持兼容）
* 第 2 行固定 `ErrorCode:`（可解析稳定）
* Hint 给“下一步应该怎么做”（例如“请重新发起工具调用并提供 file_path”）

## 2) 统一输入路由/overlay 管理（最小 API）

**最小实现：InputGate（焦点锁）**

* Provider 保存 `{activeId, activePriority}`，暴露：

  * `requestFocus(id, priority)` / `releaseFocus(id)`
  * `useInputGate(id, enabled, priority) -> isActive`
    **优先级建议：**
* overlay/dialog：100
* tool approval prompt：50
* base input：0
  **收益：**
* 不需要把所有 useInput 重写成“中央路由器”，只要把 `isActive` 交给 gate，就能立刻减少冲突。

## 3) 统一工具契约核验（最小检查/测试）

**运行时最小核验：**

* 对“JSON 输出型工具”（Task/TaskOutput/…）：

  * 成功与失败都必须 `JSON.parse` 成功（失败 JSON 也要 parseable）
* 对“会被 engine 注入提醒”的路径：

  * tool_result 不得被注入破坏 JSON（或干脆不注入）
    **测试最小集合：**
* golden tests（见 D）锁住关键工具输出格式 + “history 不被 reminder 污染”。

## 4) 最小诊断能力（doctor/status/permissions 的必要输出）

不加新大功能，只补“定位必需信息”：

* `/status` 输出（纯文本即可）：

  * 当前 mode / promptProfile
  * active focus（InputGate.activeId）
  * pending approvals 数量 + toolUseId 列表
  * overlay 当前 kind
  * 最近一次 policy 决策摘要（allow/deny/prompt + source）
* `/permissions`（或强化现有 permissions dialog 输出）：

  * 列出：project permissionsStore 决策、policy rules、当前 replMode（acceptEdits 等）
  * 每条规则显示 source/scope

---

C. 可执行 TODO（按 PR 分阶段，细拆）

> 要求：每个 PR 都能独立合并，不破坏现有行为；并且可回滚（revert 单 PR 即可）。

## PR-1：修复 tool_result reminder 注入导致的契约破坏 + history 污染（最高收益、最可控）

* **目标**

  * 任何 tool_result **不再因为 reminder 注入而变成“不可解析/不可预测”**；
  * `<system-reminder>` 不会永久写入 history（只影响当轮，不污染后续）。
* **改动文件清单**

  * `src/chat/engine.ts`
  * `src/features/repl/useReplController.ts`
  * （可选）抽一个共享 util：`src/utils/systemReminder.ts`
  * 新增测试：`src/chat/engine.test.ts`（或就近放现有 test 目录）
* **关键实现步骤**

  1. 在 `engine.ts` 给 reminder 注入加 guard：

     * `if (isJsonLike(content) && canParseJson(content)) return original;`
     * 或 toolName denylist（Task/TaskOutput 等）
  2. 在 `useReplController.ts` 回写 `historyRef` 前，遍历 history：

     * 找到 user role 的 `tool_result` block → 对其 `content` 做 `stripTrailingSystemReminderBlock`
  3. 去重 `stripTrailingSystemReminderBlock`（或至少保证两处行为一致，见 PR-5）
  4. 加 2~3 条 golden：

     * JSON tool_result 不被注入破坏
     * 普通文本 tool_result 会注入（当轮），但存入 history 后被剥离
* **风险点 + 回滚策略**

  * 风险：todo stale reminder 在 JSON 工具场景不再出现（但这是为了稳定，且影响面可控）。
  * 回滚：revert 本 PR，不影响其他改动。
* **验收（bun 命令 + 手动步骤）**

  * `bun run type-check`
  * `bun run test`
  * 手测：触发多轮工具调用后再触发 TaskOutput，确认输出保持 JSON、history 不污染。

---

## PR-2：Plan 模式 `old_string` 兼容（支持 `→` 行号前缀）

* **目标**

  * 显著降低 plan 模式 edit 的“old_string 找不到”概率，提升可预测性。
* **改动文件清单**

  * `src/tools/modules/edit/handler.ts`
  * 新增测试：`src/tools/modules/edit/handler.test.ts`（或同目录）
* **关键实现步骤**

  1. 扩展 `stripCatNPrefixes` 正则：支持 `\t` 与 `→`
  2. 单测覆盖：

     * `\t` 前缀仍可用
     * `→` 前缀可用
     * 普通文本不被误伤（至少覆盖一个数字开头但不是行号前缀的例子）
* **风险点 + 回滚策略**

  * 风险：对“行首数字+箭头”的真实文本可能被误 strip（概率低，且该函数只对 old/new string 做预处理）。
  * 回滚：revert 本 PR。
* **验收**

  * `bun run test`
  * 手测：plan 模式下照 snippet 复制 old_string 做 edit，成功。

---

## PR-3：Abort 清理完善（pending prompts + running tools 状态收敛）

* **目标**

  * Ctrl+C / abort 后**不会留下悬挂 prompt**，不会出现“输入串台/卡死”。
* **改动文件清单**

  * `src/tools/runtime/userInputManager.ts`
  * `src/features/repl/useReplController.ts`
  * 新增测试：`src/tools/runtime/userInputManager.test.ts`
* **关键实现步骤**

  1. `userInputManager` 增加：

     * `rejectAllPending(reason)`
     * `clearBuffered()`
     * （可选）`cleanupExpiredBuffered(ttlMs)`
  2. `abort()` 中调用上述清理
  3. 把所有 running tool message 统一标记为 aborted/error（仅 UI 状态，不改 tool 执行）
* **风险点 + 回滚策略**

  * 风险：abort 后 UI 展示会更“强硬”地结束 running tool（更符合预期）。
  * 回滚：revert 本 PR。
* **验收**

  * `bun run test`
  * 手测：出现审批 prompt 时 Ctrl+C，prompt 消失且可继续输入。

---

## PR-4：输入焦点最小化治理（InputGate，先覆盖最危险的 approval prompts）

* **目标**

  * 解决“多个 useInput 抢事件”的核心不确定性，至少保证：**同一时刻只有一个 prompt 消费输入**。
* **改动文件清单**

  * 新增：`src/features/repl/inputGate.ts`（或 `src/ui/inputGate.ts`）
  * 修改：

    * `src/tools/presenters/bashApprovalPrompt.tsx`
    * `src/tools/presenters/fsWriteApprovalPrompt.tsx`
    * `src/tools/modules/exitPlanMode/presenter.tsx`
    * （后续可扩）其他 prompt/overlay
* **关键实现步骤**

  1. 实现 InputGate Provider + `useInputGate()`
  2. 将上述 prompts 的 `useInput({isActive:true})` 改为 `isActive = gate.isActive(myId)`
  3. 约定 id 命名：`prompt:<toolUseId>` / `overlay:<kind>`
  4. 增加 debug：`/status` 打印 activeId（可放到 PR-6）
* **风险点 + 回滚策略**

  * 风险：若某 prompt 未正确 releaseFocus，可能导致输入被锁死 → 必须在 `useEffect` cleanup release。
  * 回滚：revert 本 PR。
* **验收**

  * `bun run test`
  * 手测：overlay 打开时 approval prompt 不响应；关闭 overlay 后恢复。

---

## PR-5：BashApprovalPrompt 光标竞态修复（cursorRef）

* **目标**

  * 彻底消除“↓ + Enter 误选择”的风险。
* **改动文件清单**

  * `src/tools/presenters/bashApprovalPrompt.tsx`
  * 新增/补：`src/tools/presenters/bashApprovalPrompt.test.tsx`（ink-testing-library）
* **关键实现步骤**

  1. 增加 `cursorRef`，每次 setCursor 同步写 ref
  2. Enter 决策改读 `cursorRef.current`
  3. 用 ink-testing-library 加一个“快速按键”测试
* **风险点 + 回滚策略**

  * 风险极低（只修竞态）。
  * 回滚：revert 本 PR。
* **验收**

  * `bun run test`
  * 手测：快速多次操作不再错选。

---

## PR-6：统一错误输出与错误码（先覆盖 policy/approval/abort）

* **目标**

  * 模型与用户都能稳定解析错误原因与下一步，减少连锁失败与“黑盒感”。
* **改动文件清单**

  * 新增：`src/tools/runtime/toolError.ts`（或 `src/utils/toolError.ts`）
  * 修改：

    * `src/tools/executor/policyPreflight.ts`
    * `src/tools/executor/skillPreflight.ts`
    * `src/features/repl/useReplController.ts`（abort 文案）
* **关键实现步骤**

  1. 引入 `ToolErrorCode` enum + `formatToolError`
  2. 逐步替换关键路径的纯字符串 error
  3. 保持第一行 `Error:` 不变（兼容现有启发式）
* **风险点 + 回滚策略**

  * 风险：错误字符串变长；但第一行兼容，整体可控。
  * 回滚：revert 本 PR。
* **验收**

  * `bun run type-check`
  * `bun run test`
  * 手测：deny/reject/abort 输出格式一致。

---

## PR-7：最小诊断输出（/status + /permissions 的“解释能力”补齐）

* **目标**

  * 出问题时不用抓包就能定位“现在系统处于什么状态、为什么会这样”。
* **改动文件清单**

  * `src/commands/registry.ts`（扩展现有 command 输出）
  * （如有）`src/core/diagnostics/*`
* **关键实现步骤**

  1. `/status`：mode、active focus、overlay kind、pending prompts、最近 policy decision 摘要
  2. `/permissions`：列出 policy rules + permissionsStore + replMode（acceptEdits）
* **风险点 + 回滚策略**

  * 风险：只影响输出文本；回滚简单。
* **验收**

  * 手测：运行 `/status` `/permissions` 能直接看懂系统状态。

---

D. 建议新增/补齐的测试（只列你最值的）

> 优先级从高到低；尽量用现有 `vitest + ink-testing-library`（项目已包含）

1. **P0：tool output contract 的 golden test（防 reminder 注入回归）**

   * 覆盖：

     * `TaskOutput` 成功输出必须 `JSON.parse` 成功
     * “触发 todo stale reminder 后”也不能把 JSON 破坏
     * 持久化 history 不包含 `<system-reminder>`
   * 价值：直接锁住最危险的连锁失败源头。

2. **P0：Plan 模式 Edit 的 `old_string` 匹配回归（→/tab 前缀）**

   * 用例：

     * old_string 含 `→` 行号
     * old_string 含 `\t` 行号
   * 价值：显著降低 edit 失败率，减少“模型不断重试”。

3. **P0：输入冲突/overlay 优先级（InputGate）**

   * 用 ink-testing-library：

     * 同时渲染两个 prompt（或 overlay+prompt）
     * 发送方向键/ESC/Enter
     * 断言只有 active 的组件收到 decision
   * 价值：把“不可预测”变成可验证的契约。

4. **P0：BashApprovalPrompt 快速按键竞态测试**

   * `downArrow` + `return`（不等待）
   * 断言 decision 与 UI 高亮一致
   * 价值：直接消除高危误批准。

5. **P1：permissions/policy 的 explain/decision 测试**

   * 给定：

     * policy rule allow/deny
     * permissionsStore allow/deny
     * replMode acceptEdits
   * 断言输出包含 `DecisionSource/Scope`，且结果一致可解释。

6. **P1：Abort 清理测试**

   * `requestAnswers` 后调用 `rejectAllPending`
   * 断言：promise reject + pending 清空 + buffered 清空

7. **P2：prune 的结构化输出保护（如果你们要动 prune）**

   * JSON tool_result 被裁剪后仍可 parse（或至少明确标识 `TRUNCATED_JSON`）
   * 价值：长会话稳定性。

---

如果你愿意按“最小改动可验收”的优先级推进，我建议先做 **PR-1（reminder 注入 + history 清理）+ PR-2（plan snippet 前缀兼容）+ PR-5（bash prompt 竞态）**：这三块往往能立刻把“体验崩坏/难排查”的大头压下去，然后再上 InputGate 与错误码统一，把系统边界补齐。
