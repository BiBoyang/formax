下面是基于你给的 repomix 单文件包中**现状代码**（REPL.tsx / useReplController.ts / inputScopeContext.tsx / TextInput.tsx / 既有测试与 pitfalls/TODO）拆出来的、可在 **Ink + React 不换框架、不改任何用户可见 UI 文案/颜色/间距/交互** 前提下，把 OpenCode 那套“稳定/可预测”的 **TUI Runtime 设计思路**迁移到 Formax 的**分阶段超细 checklist**。
（你在 TODO 里写的 S9 目标与约束我按原意展开成可执行步骤：输入抢键、prompt.clear vs session.new、禁直写 ANSI、全局快捷键 suspend/resume、以及 `/agents` `/permissions` `/hooks` 关键路径测试覆盖。）

---

## 现状关键点（作为后续步骤的“锁定对象”）

* Formax 已有一个 **InputScopeProvider + stack** 的输入域机制：`useScopeActivation(push/pop)` + `useScopedInput(activeScope 才触发)`；并且已有 scope 测试覆盖 out-of-order pop 与基础导航键路由。
* REPL 的全局快捷键/输入路由目前集中在一个 `useScopedInput('repl', ...)` 里处理：`Ctrl+O`、`Esc`、`Shift+Tab`、slash suggestion 上下/Tab 等。这里 **Esc 只 guard 了 agents/permissions，没有 guard hooks**；同时 `isPromptMode` 虽然把 `state.hooksDialogOpen` 视为 prompt mode，但 **useMemo deps 漏了 hooksDialogOpen**，有潜在“prompt mode 判定不刷新”的稳定性隐患。
* TextInput 明确约束：**Tab 不当作文本输入（reserved for higher-level navigation）**。但它对 left/right/backspace/delete 的处理是“只有在可移动/可删除时才 return”，在边界时会落到 handler 末尾不返回；在 Ink 的多 handler 模型下容易造成外层 list/快捷键误触（你在 S9-1/S9-2 里明确要治理的那类问题）。
* `/clear` 的“清屏/重绘”顺序坑已经在 pitfalls 写得很明确：`instance.clear()` 需要配合 `clearTerminal()`，并且要避免 raw ANSI 到处散落。

---

# Phase 0 — 先用测试锁住“输入抢键/PromptMode”的关键契约（不重构，只补回归网）

> 目标：在动 runtime 之前，把**你要迁移的稳定契约**用 tests 先钉住；同时修两个“明显会破契约”的小点（hooks promptMode deps、Esc hooks guard），这两个修复不改 UI 文案/颜色/间距/交互，只修 **稳定性**。

---

## 0.1（45–60min）REPL：补齐 hooksPromptMode 的回归测试，并修复 deps 漏项 + Esc hooks guard

* **改动文件列表**

  * `src/screens/REPL.test.tsx`（新增用例）
  * `src/screens/REPL.tsx`

* **具体改动点**

  * `REPL.tsx`

    1. `isPromptMode` 的 `useMemo` deps：把 `state.hooksDialogOpen` 加入依赖数组，避免 hooks dialog 打开/关闭时 promptMode 不刷新。
    2. `useScopedInput('repl', ...)` 内 `if (key.escape)` 分支：补一行 `if (state.hooksDialogOpen) return`，与 agents/permissions 对齐，防止 hooks dialog 打开时底层 REPL 抢 Esc。
  * `REPL.test.tsx`

    * 加一个专门用例：模拟 hooks dialog 打开时，REPL 不应触发 Esc abort，且 InputBar 被隐藏（即 promptMode 生效）。
    * 推荐做法：用 `vi.mock('./features/repl/useReplController')` 返回可控的 `{state, actions}`，通过 `view.rerender()` 切换 `hooksDialogOpen: false -> true`，验证 `isPromptMode` 不会因为 deps 漏项而保持旧值。

* **风险点**

  * mocking hook 可能导致测试与真实 wiring 有差异；因此只用于“契约钉住”（promptMode 与 Esc 抢键），后续 Phase 4 会加真实 overlay 的集成测试兜底。
  * `Esc` 行为在 hooks dialog 打开时从“abort”变成“无动作/由 overlay 处理”，属于**稳定性契约修复**，但确实是行为改变（从 bug 行为变成契约行为）。

* **测试策略（vitest + ink-testing-library）**

  * 新增用例：`it('does not handle ESC when hooks dialog is open (prompt mode)')`

    * 初始渲染：`hooksDialogOpen=false`，断言 `Try "fix typecheck errors"` 存在（InputBar 可见）。
    * rerender：`hooksDialogOpen=true`

      * 断言 InputBar 区域消失（frame 不含 `Try "fix typecheck errors"`）。
      * `stdin.write('\u001b')`（Esc）
      * 断言 `actions.abort` **未被调用**。
  * 同一用例里再加：`stdin.write('\r')`（Enter）应当也不触发 `actions.send`（因为 InputBar 不在）。

* **验收方式**

  * 自动：`vitest src/screens/REPL.test.tsx` 通过；全量 `vitest` 通过。
  * 手动：本地跑 REPL，打开 hooks dialog 时按 Esc 不应中断底层运行（若 overlay 有自己的 Esc 关闭逻辑，应由 overlay 接管）。

* **回滚策略**

  * 若 hooks dialog 内确实需要 Esc 触发 abort（极不建议），回滚该 commit，并改为 Phase 4 里把 Esc 路由交给 overlay scope；绝不在 REPL 层“抢” overlay 的 Esc。

---

## 0.2（30–45min）InputScope：把 ESC / Enter / 数字键的路由契约补进现有 scope 测试

* **改动文件列表**

  * `src/features/repl/inputScopeContext.test.tsx`

* **具体改动点**

  * 扩展现有 `it('routes navigation keys only to the active scope')`（当前已覆盖 up/down/tab/1 + esc 记录，但没实际发送 esc；也没 enter）：

    * 在 repl scope 下追加：

      * `stdin.write('\u001b')` 期望只进入 repl handler（`replEvents` 加 `esc`，`overlayEvents` 不变）。
      * `stdin.write('\r')` 期望只进入 repl handler（你可在 NavProbe 里加 `if (key.return || input === '\r') onReplEvent('enter')`）。
    * 切换到 overlay scope 后同理，且断言 replEvents 长度不变。

* **风险点**

  * 不同终端/Ink 对 Enter 的解析可能是 `\r` 或 `\n`，测试要兼容两者（建议写两个断言分支，或写 helper：如果 `input === '\n'` 也算 enter）。

* **测试策略**

  * 修改 NavProbe：

    * 加 `enter` 采集：`if (key.return || input === '\r' || input === '\n') onX('enter')`
  * 用例按键序列（repl scope）：

    * `\u001b[A`、`\t`、`1`、`\u001b`、`\r`
    * 期望：`replEvents` 包含 `up/tab/1/esc/enter`；`overlayEvents=[]`
  * 切到 overlay scope（`O` 打开 overlay）后：

    * `\u001b[B`、`\t`、`1`、`\u001b`、`\r`
    * 期望：`overlayEvents` 增长；`replEvents` 长度不变

* **验收方式**

  * 自动：`vitest src/features/repl/inputScopeContext.test.tsx` 通过。
  * 手动：无（纯 runtime 基础测试）。

* **回滚策略**

  * 若 Enter/ESC 在 CI 上解析不一致导致波动，先回滚该用例的 enter 断言，保留 ESC；再用更稳的 ink key 标记（`key.return`）补回。

---

## 0.3（30–45min）TextInput：锁住“Tab 不插入文本”的工程约束

* **改动文件列表**

  * `src/components/chat/InputBar.test.tsx`

* **具体改动点**

  * 新增一个用例：当 InputBar（内含 TextInput）聚焦时，输入 `'\t'` 不应改变 value（因为 TextInput 明确把 Tab 视为非文本输入）。
  * 该用例不引入任何 UI 变更，只锁住“不要把 Tab 当字符”这一稳定约束。

* **风险点**

  * 如果未来某个 overlay 想用 Tab 作为表单切换焦点，本用例不冲突，因为它只针对当前 TextInput 行为。

* **测试策略**

  * 渲染 InputBar，onChange=vi.fn
  * `stdin.write('a')` -> 期望 onChange last `'a'`
  * `stdin.write('\t')`

    * 期望 onChange **不新增** `'a\t'`
    * 期望 last still `'a'`
  * （可选）再输入 `'b'` -> 期望 `'ab'`

* **验收方式**

  * 自动：`vitest src/components/chat/InputBar.test.tsx` 通过。
  * 手动：无。

* **回滚策略**

  * 若未来决定在 REPL 输入框支持 Tab 插入（这会改变交互，需用户批准），回滚该用例并更新 TextInput 注释与行为。

---

## 0.4（30–60min）新增 “ANSI 直写”审计测试：把工程约束变成红线

* **改动文件列表**

  * 新增：`src/features/repl/ansiAudit.test.ts`（或 `src/utils/ansiAudit.test.ts`）
  * （可能需要）更新 `src/utils/terminal.ts` 的注释/导出名，不改行为

* **具体改动点**

  * 参照现有 `useInputAudit` 的思路（扫描源码、维护 allow-list）：

    * 扫描 `src/**` 非 test 文件，匹配常见 ANSI 片段：`\x1b[`、`\u001b[`、`'\x1b'` 等（按你们 repo 实际写法调 regex）。
    * **允许列表**：仅 `src/utils/terminal.ts`（因为你们已有 `clearTerminal()` 集中入口）。
    * 若命中其它文件：测试失败，强制把 ANSI 迁移到 terminal utils。

* **风险点**

  * 误报：比如 tests 里写了 `\u001b[A`（arrow seq）用于模拟按键；所以一定要排除 `*.test.*`（像 useInputAudit 那样）。

* **测试策略**

  * 新增 `describe('ANSI audit')`

    * 用例：`it('keeps raw ANSI escape codes behind src/utils/terminal.ts')`
    * 输出 unexpected 列表用于定位。

* **验收方式**

  * 自动：全量 `vitest` 通过；且新增审计不会引入 flake。
  * 手动：无。

* **回滚策略**

  * 若短期内需要在某处临时写 ANSI（强烈不建议），只能**临时扩 allow-list**并写 TODO 追踪；否则回滚该改动。

---

# Phase 1 — 输入 Runtime 基座：在 Ink 语义下实现“优先级 + 消费(consumed) + 可测试”

> 目标：把 OpenCode 的“稳定输入路由”落到 Ink：**同一 scope 内也能做到“谁先消费谁赢”**，从而实现你 S9-1 里写的“输入框聚焦只消费 left/right/backspace/delete；外层 list 不误触”等规则。
> 现有 `useScopedInput` 只做 activeScope gating，不支持 stop propagation，因此需要 runtime 层做“路由器”。

---

## 1.1（45–60min）在 InputScopeProvider 内引入“输入路由器注册表”，但暂不改现有 useScopedInput 行为

* **改动文件列表**

  * `src/features/repl/inputScopeContext.tsx`
  * `src/features/repl/inputScopeContext.test.tsx`（新增 router 的最小单测）

* **具体改动点**

  * `inputScopeContext.tsx`

    * 在 `InputScopeController` context 中增加（不破坏现有字段）：

      * `registerHandler(scope, handler, opts) -> unsubscribe`
      * `hasRouter: boolean`
    * `InputScopeProvider` 内新增 `handlersRef: Map<InputScopeId, HandlerRegistration[]>`
    * 在 Provider 内部引入一个**单一**的 `useInput((input,key)=>dispatch)`（集中读取 stdin）：

      * 根据 `activeScope` 找到该 scope 的 handlers
      * 按 `priority desc`、再按注册顺序调用
      * 暂时忽略 “consumed”，先把注册/分发跑通
  * `useScopedInput` 暂时不接入 register，保持现状（这样这一条改动风险小、易回滚）。

* **风险点**

  * Provider 级 `useInput` 可能与现有各处 `useInput` 并存（REPL 里还有 ctrl+c 的 useInput）。这在 Ink 是允许的，但需要后续阶段用 audit/规则确保不乱用。

* **测试策略**

  * 新增最小 router 测试（不改现有测试）：

    * 在 harness 里直接调用 `controller.registerHandler('repl', ...)`
    * `stdin.write('x')` 后期望 handler 被调用
    * activeScope 切换后期望只调用新的 scope handler

* **验收方式**

  * 自动：`vitest src/features/repl/inputScopeContext.test.tsx` 通过 + 新增用例通过。
  * 手动：无。

* **回滚策略**

  * 若集中 useInput 导致意外重复触发，直接回滚 router 引入，把注册表代码删除，不影响现有 `useScopedInput`。

---

## 1.2（45–60min）把 useScopedInput 接入路由器：默认仍“全部 handler 都会收到”，先不启用 consumed

* **改动文件列表**

  * `src/features/repl/inputScopeContext.tsx`
  * `src/features/repl/useInputAudit.test.ts`（如必要，更新 allowed 的理由注释，但不改列表）
  * 可能需要调整：`src/screens/REPL.test.tsx`（若有依赖未包 Provider 的渲染，需要在测试里包一层 InputScopeProvider；但推荐用“fallback”模式避免大面积改）

* **具体改动点**

  * `useScopedInput(scope, handler, opts)`

    * 增加 router path：`useEffect(() => registerHandler(...))`
    * 同时保留“无 Provider 时的 fallback”：

      * 通过 context `hasRouter` 判断：若 `hasRouter=false`，继续用 Ink 的 `useInput(handler, {isActive})` 走老路径；若 `hasRouter=true`，则 `useInput` 的 `isActive=false`（避免重复触发），只走 router 分发。
    * 这样不会破坏当前 REPL.test 里未包 Provider 的用例（如果你们确实存在这种情况）。
  * `InputScopeProvider` 标记 `hasRouter=true`。

* **风险点**

  * 需要非常小心 hook 调用顺序（不能条件调用 useInput）；“fallback + router 并存”必须用 `isActive` gate 解决，不能 if/else 包裹 hooks。
  * 如果某些组件依赖 `useScopedInput` 在无 Provider 场景下可用，fallback 必须保留。

* **测试策略**

  * 复跑现有 scope 测试与 InputBar 测试（它们本来就包 Provider）。
  * 新增一个用例：在**没有 InputScopeProvider**时，useScopedInput 仍能工作（保证 fallback）。

* **验收方式**

  * 自动：全量 `vitest`。
  * 手动：无。

* **回滚策略**

  * 若 router 接入导致事件重复触发/丢失，回滚此步骤，保留 1.1 的“未接入 useScopedInput 的 router 预埋”。

---

## 1.3（30–60min）引入 “consumed” 语义：同一 scope 内实现 stop-propagation（核心稳定性基座）

* **改动文件列表**

  * `src/features/repl/inputScopeContext.tsx`
  * `src/features/repl/inputScopeContext.test.tsx`（新增 consumed 用例）

* **具体改动点**

  * 扩展 handler 返回类型：`void | boolean`

    * `true` 表示 **consumed**：后续 handler 不再收到该按键
  * Provider dispatch 循环中：`if (handler(...) === true) break`
  * 这里先不要求现有 handler 返回值，默认 void -> 不 consume（保持兼容）

* **风险点**

  * 一旦某 handler 误返回 true，可能吞掉其它功能（例如 REPL 的 slash suggestion 导航）。
  * 为降低风险：先用测试把“谁应该 consume 哪些键”钉住，再改具体 handler（TextInput/overlay list）。

* **测试策略**

  * 新增 `it('stops dispatch when a handler consumes the event')`

    * 注册两个 handler 到同一 scope：

      * handler A：遇到 `input === 'X'` 返回 true，并 push 记录 `A`
      * handler B：遇到 `input === 'X'` push 记录 `B`
    * `stdin.write('X')`
    * 期望：只记录 `A`，不记录 `B`
  * 再加一条：A 返回 void 时，B 也会收到（锁住兼容性）。

* **验收方式**

  * 自动：相关测试 + 全量 vitest。
  * 手动：无。

* **回滚策略**

  * 若 consumed 引入导致大量行为不一致，回滚该步骤；优先保留 router 但不启用 consumed。

---

## 1.4（45–60min）TextInput：把 left/right/backspace/delete/enter/newline 标为“已处理（consume）”，即使在边界也要 consume

* **改动文件列表**

  * `src/components/ui/TextInput.tsx`
  * 新增：`src/components/ui/TextInput.consume.test.tsx`（或放到 inputScopeContext.test.tsx 的 harness 里）

* **具体改动点**

  * `TextInput.tsx` 内 `handler`：

    * 当前逻辑：leftArrow/rightArrow/backspace/delete 在边界时不会 return，从而可能让同 scope 的外层 list 接收到。
    * 修改为：当识别到这些键时，无论是否改变 value/cursor，都返回 `true`（consume），从而实现你要的“输入框聚焦时仅输入框消费左右/Backspace/Delete”契约。
    * Enter/newline：

      * `wantsNewline` 和 `isSubmit || isNewline` 分支也返回 `true`
    * Tab 分支保持 `return false/undefined`（不 consume），继续遵守 “Tab reserved”。
  * 不改任何渲染、文案、颜色、间距。

* **风险点**

  * 如果某些 overlay 的 list 依赖 left/right/backspace/delete 做快捷操作（不常见，但可能），会被 input 吞掉；不过这正符合“输入框聚焦优先”的契约。

* **测试策略**

  * Harness 组件（同 scope）：

    * 一个 `TextInput scope="overlay:test" focus value="ab"`
    * 一个 `ListProbe` 用 `useScopedInput('overlay:test', ...)` 监听 left/right/backspace/delete/up/down，并把命中的键写到数组
  * 按键序列与期望：

    * `stdin.write('\u001b[D')` x3（left arrow）
      期望：ListProbe **不记录** `left`
    * `stdin.write('\x7f')`（backspace）
      期望：ListProbe **不记录** `backspace`
    * `stdin.write('\u001b[3~')`（forward delete 常见序列）
      期望：ListProbe **不记录** `delete`
    * `stdin.write('\u001b[A')`（up arrow）
      期望：ListProbe **记录** `up`（因为 TextInput 不处理 up/down）
  * 同时保证：Tab 不改变 value（由 Phase 0.3 已锁住）。

* **验收方式**

  * 自动：新增测试通过 + 全量 vitest。
  * 手动：打开任一带输入框 + 列表的 overlay（如 hooks/agents），在输入框里狂按 left/right/backspace/delete 不应让列表选中项乱跳。

* **回滚策略**

  * 若发现某 overlay 需要这些键（极端情况），回滚此改动，并改为在 overlay 层显式 suspend list handler（但这会扩大改动面，不建议）。

---

# Phase 2 — 全局快捷键 suspend/resume：把 OpenCode CommandProvider 思路落在 Ink Router 上

> 目标：实现你 S9-2 的“全局快捷键挂起/恢复可测试”，并让 overlay/dialog/selector 能显式暂停底层快捷键（而不是 REPL 里到处写 if guard）。

---

## 2.1（45–60min）InputRouter：实现 group-based suspension（可 refcount），并加单测

* **改动文件列表**

  * `src/features/repl/inputScopeContext.tsx`
  * `src/features/repl/inputScopeContext.test.tsx`（新增 suspend 用例）

* **具体改动点**

  * 给 `registerHandler` 增加 `opts.group?: 'text'|'command'|'selector'|'nav'|string`（默认 `'default'`）
  * Provider 增加：

    * `suspendGroup(group: string): token`
    * `resumeGroup(token)` 或 `unsuspendGroup(group)`（建议 token/refcount，避免嵌套 overlay 互相踩）
  * dispatch 时跳过被 suspend 的 group 的 handler。

* **风险点**

  * 如果 suspend 是全局而非 per-scope，需要明确：**是“全局 suspend 该 group”还是“仅对某 scope suspend”**。建议先做全局（最简单），后续若需要再扩展为 per-scope。
  * token/refcount 实现不当会造成“永久挂起”（输入失效）。

* **测试策略**

  * 新增用例：`it('can suspend and resume a group')`

    * 注册 command handler（group=command），输入 `K` -> 记录
    * suspend command group
    * 再输入 `K` -> 不记录
    * resume
    * 输入 `K` -> 再记录
  * 再加嵌套：suspend 两次、resume 一次仍挂起，resume 完才恢复（refcount 锁定）。

* **验收方式**

  * 自动：测试通过 + 全量 vitest。
  * 手动：无。

* **回滚策略**

  * 若 token/refcount 不稳定，回滚到“无 token 的 boolean suspend”，但必须同步减少使用点，避免嵌套场景。

---

## 2.2（45–60min）REPL：把“命令快捷键”与“autocomplete/selector 导航”拆分成不同 group，并上优先级

* **改动文件列表**

  * `src/screens/REPL.tsx`
  * `src/screens/REPL.test.tsx`（新增/调整用例）

* **具体改动点**

  * 目前 REPL 把 ctrl+o / esc / shift+tab / slashNav 混在同一个 `useScopedInput('repl', ...)`。
  * 拆为两段（仍不改 UI）：

    1. `useScopedInput('repl', handleReplCommands, { group: 'command', priority: 10 })`

       * 只处理：`Ctrl+O` / `Esc` / `Shift+Tab`（以及你认为属于“全局快捷键”的）
    2. `useScopedInput('repl', handleSlashSelectorNav, { group: 'selector', priority: 20 })`

       * 只处理：当 `slashSuggestions.length>0` 时的 Up/Down/Tab（选择/补全）
  * TextInput 自身建议 group='text' priority=100（在 TextInput 内部或注册时设置），保证输入编辑键永远先拿到。

* **风险点**

  * 拆分后如果 priority 设错，可能导致 selector 接不到 Up/Down（被别的 handler consume）；但 Phase 1 的 consumed 规则应确保只有相关键 consume。
  * 这一步是“重构”，必须先用测试锁住 REPL 热键行为（0.x 已部分锁定，仍建议补 coverage）。

* **测试策略**

  * 新增 REPL.test 用例（无需依赖真实 overlay）：

    * 当输入 `/` 并出现 suggestions 时：

      * `stdin.write('\u001b[B')`（down）会移动选中项（可通过输出中的 suggestion 高亮变化断言，或更稳地 mock commandRegistry.suggest 返回固定列表并检查最终 `preferredSlashSpecId` 选择）
      * `stdin.write('\t')` 会补全到 selectedSlash.command（已存在逻辑）
    * 同时验证 `Shift+Tab` 在没有 suggestions 时仍切 mode（不改交互）。

* **验收方式**

  * 自动：REPL.test 通过 + 全量 vitest。
  * 手动：在真实 REPL 中测试 `/cl` -> suggestion 上下、Tab 补全仍如旧。

* **回滚策略**

  * 若拆分导致任何一个热键失效，回滚此步骤，保留 Phase 1/2.1 的 runtime 能力，稍后再拆分。

---

## 2.3（30–60min）落地 suspend：当 overlay/dialog 打开时挂起 REPL command（防抢键），并用测试覆盖

* **改动文件列表**

  * `src/screens/REPL.tsx`
  * 新增：`src/screens/REPL.overlays.suspend.test.tsx`（或合入 REPL.test.tsx）

* **具体改动点**

  * 在 REPL 内部，基于现有 `isPromptMode`（dialog/tool prompt 时为 true）：

    * 当 `isPromptMode === true` 时调用 `useInputSuspend('command', true)`（你在 2.1 实现的 hook）。
    * 这样即使某些情况下 activeScope 仍是 'repl'（例如 overlay 未正确 push scope），REPL command handler 也不会抢键（防御式）。
  * 注意：`Ctrl+C` 的 `useInput({isActive:true})` 仍保留（这是“强退出/强 abort”，通常不应被 suspend）。

* **风险点**

  * 如果 overlay 依赖某些 REPL command（例如 Ctrl+O）在 overlay 中仍可用，会被挂起；但你给的契约是 overlay 打开时底层 REPL 不得抢键，且“全局快捷键可挂起可恢复”，这里符合方向。
  * 需要确认 suspend 仅影响 REPL 的 command handlers，不影响 overlay 自己的 command handlers（通过 scope 或 group 区分）。

* **测试策略**

  * 用 `vi.mock` 把 AgentsDialog/PermissionsDialog/HooksDialog 替换为**测试桩组件**（不改生产 UI），测试桩会：

    * 渲染一个固定 sentinel 文本（如 `HOOKS_DIALOG_OPEN`）
    * 在 mount 时触发 `useScopeActivation('overlay:hooks', true)`（如果你希望同时验证 scope）
  * 用例按键序列：

    1. 让 `state.hooksDialogOpen=true`（通过 mock controller 或通过触发 `/hooks` 命令打开）
    2. `stdin.write('\u001b')`（Esc）、`\t`、`1`、`\r`、`\u001b[A` 等
    3. 期望：REPL 的 `actions.abort` / `setMode` / `Ctrl+O` 逻辑均不触发（用 spy 断言）；overlay sentinel 仍在，直到 overlay 自己处理关闭。
  * 关闭 overlay 后：

    * 期望 `Try "fix typecheck errors"` 恢复出现（InputBar 回来）

* **验收方式**

  * 自动：该测试文件 + 全量 vitest。
  * 手动：打开任意 overlay（agents/permissions/hooks），狂按 Esc/Enter/数字/Tab/方向键，不应触发底层 REPL 的模式切换/面板切换/abort。

* **回滚策略**

  * 若 suspend 导致 overlay 内关键按键不可用，回滚此步骤，并改为“仅 suspend REPL command handlers”（确保 overlay handlers 使用不同 group 或不同 scope）。

---

# Phase 3 — prompt.clear vs session.new：把语义拆开、可测试、可维护

> 目标：你 S9-4 写的是“对话/会话清理”与“输入框清理”分离。Formax 现在是：session 清理由 `/clear` 走 controller；输入框清理主要在 REPL 层 `setInput('')`（发送前清空）。我们要做的是：**把这两类清理明确成独立函数/动作，并用测试锁住**，避免未来互相污染。

---

## 3.1（45–60min）useReplController：抽出 `newSession()`（session.new），并让 `/clear` 只调用它

* **改动文件列表**

  * `src/features/repl/useReplController.ts`
  * `src/features/repl/useReplController.test.tsx`
  * （可选）`plans/stability/pitfalls.md`（仅补注释，不改 UI）

* **具体改动点**

  * 在 `useReplController` 内部新增一个内部函数或 action：

    * `actions.newSession()` / `actions.resetSession()`
      内容：清 messages、清 historyRef/assistantBuffer、`setTranscriptSeq(+1)`、触发 `deps.onClearTerminal?.()`（沿用现有 `/clear` 行为与 pitfalls 的清屏顺序约束）。
  * `/clear` 命令处理改为调用 `newSession()`（逻辑集中，避免未来“清 session 但漏清某块”）。

* **风险点**

  * 不小心改变 `/clear` 的时序会引发滚动/Static 重绘异常；因此只做“抽函数”，不改逻辑顺序（pitfalls 已写过顺序坑）。

* **测试策略**

  * 在 `useReplController.test.tsx` 新增用例：

    1. 发送普通消息 `hi` -> engine 收到 history 含 1 条
    2. 再发送 `hello` -> history 增加
    3. 调用 `/clear`（或直接 `actions.newSession()`）
    4. 再发送 `after` -> 断言 engine 收到的 history **不含** 之前内容（等价于 session.new 生效）
  * 断言 `deps.onClearTerminal` 被调用一次（可用 spy）。

* **验收方式**

  * 自动：controller tests + 全量 vitest。
  * 手动：运行 `/clear`，确认屏幕清理、对话清空如旧（不改 UI）。

* **回滚策略**

  * 若 `/clear` 行为出现回归（比如 header 重叠/滚动错乱），立即回滚该抽函数 commit，并重新以“复制现有逻辑不动顺序”方式实现。

---

## 3.2（30–60min）REPL：抽出 `clearPrompt()`（prompt.clear），并用测试锁住“只清输入，不动 session”

* **改动文件列表**

  * `src/screens/REPL.tsx`
  * `src/screens/REPL.test.tsx`

* **具体改动点**

  * 在 REPL 内部新增 helper：

    * `clearPrompt()`：`setInput('') + setSlashIndex(0) + setSlashSelectionTouched(false)`（现在 `handleInputChange` 会做后两项，但 `handleSend` 只做 `setInput('')`）。
  * 在 `handleSend` 成功分支使用 `clearPrompt()`（行为不变：仍然发送后清空输入；只是更明确、避免未来漏重置 slash 状态）。

* **风险点**

  * 如果有人依赖“发送后保留 slashIndex/touched”这种内部状态（不太可能），会改变内部行为，但用户可见交互应不变。

* **测试策略**

  * 新增用例：

    * 输入 `hello` + Enter：断言发送后 input 为空（frame 再次出现 placeholder `Try "fix typecheck errors"`）。
    * 同时断言消息仍在 transcript（session 未被清）。
  * 再加：输入 `/cl` 出现 suggestions，按 down 改变选中，再 Enter 发送 `/clear`：发送后再次输入 `/` 时，选中应从 index 0 开始（slash 状态被 reset）。

* **验收方式**

  * 自动：REPL.test 通过。
  * 手动：连续用 slash 命令操作，观察补全默认选中正常。

* **回滚策略**

  * 若发现任何可见交互变化（比如补全默认选中不符合旧习惯），回滚此步骤并只保留 prompt.clear helper 不使用。

---

# Phase 4 — `/agents` `/permissions` `/hooks` 关键路径：scope + suspend + consume 的真实接入与回归

> 目标：完成你 S9-5 要求的覆盖：三类 overlay 的关键路径 + 输入抢键规则 + HooksDialog 的 scope flicker bug（pitfalls 已明确指出依赖项要用 `view.kind`，否则会丢字）。

---

## 4.1（45–60min）为三个 overlay 定义“规范 scope id”并接入 useScopeActivation（稳定 deps）

* **改动文件列表**

  * `src/ui/agents/AgentsDialog.tsx`
  * `src/ui/permissions/PermissionsDialog.tsx`
  * `src/ui/hooks/HooksDialog.tsx`
  * （若 hooks 有子 view）`src/ui/hooks/*` 内部 view 组件

* **具体改动点（到组件/状态字段层级）**

  * `AgentsDialog`

    * 组件根部：`useScopeActivation('overlay:agents', true)`（或基于 `open` prop）
    * 所有输入/列表导航 handlers 使用 `useScopedInput('overlay:agents', ..., { group, priority })`
  * `PermissionsDialog`

    * scope：`overlay:permissions`
  * `HooksDialog`

    * scope：`overlay:hooks`
    * 若内部有 view 切换状态 `view`（pitfalls 提到 `useScopeActivation('overlay:hooks', view)` 的错误依赖）：

      * 把依赖从 `view` 改为 `view.kind`（或 `open` boolean），避免每次输入导致 effect cleanup/pop + push，从而 activeScope flicker 丢键。

* **风险点**

  * 如果 overlay 里已有 scope activation，重复调用需要确认不会 pop 掉别人的 scope（当前 push 会去重 top，但 pop 可能移除栈中间元素；好在你们已有 out-of-order pop 测试覆盖）。
  * HooksDialog view.kind 修复可能改变极少数边界时序，但属于“输入不丢字”的稳定性修复。

* **测试策略**

  * 新增/修改 overlay 相关测试（Phase 4.2 详细列）来验证：

    * 打开 overlay 后 activeScope 变为 overlay scope
    * 关闭后回到 repl

* **验收方式**

  * 自动：新增 overlay tests 通过。
  * 手动：打开 hooks dialog，在输入框里快速输入长串字符，不应掉字/卡键。

* **回滚策略**

  * 若 overlay 输入完全失效，回滚 scope activation 接入；先用 Phase 2 的 suspend 方案挡住 REPL 抢键，再重新梳理 overlay 内部 input handlers。

---

## 4.2（45–60min）新增 `/agents` `/permissions` `/hooks` 的“输入抢键契约”集成测试（可先用测试桩 overlay）

* **改动文件列表**

  * 新增：`src/screens/REPL.s9.overlays.test.tsx`
  * （可选）`src/screens/REPL.tsx`（若需要注入更可测的依赖，例如把 dialog 组件 import 抽到可 mock 的路径；但不改 UI）

* **具体改动点**

  * 测试中 `vi.mock('./ui/agents/AgentsDialog')` 等，把三个 dialog 替换为 test-double：

    * 渲染 sentinel 文本：`AGENTS_DIALOG` / `PERMISSIONS_DIALOG` / `HOOKS_DIALOG`
    * 内部放一个 `TextInput scope="overlay:xxx"` + 一个 list probe（用 `useScopedInput` 监听 up/down/enter 等）用于断言“输入消费 vs 列表导航”的稳定性契约

* **风险点**

  * mock overlay 无法覆盖真实 overlay 的 UI 细节；但它能覆盖**最关键的 runtime 契约：输入路由、consume、suspend**。真实 UI 的细节留给 4.3。

* **测试策略（按键序列与期望输出写清）**

  * 用例 1：`/hooks` 打开时底层 REPL 不抢键

    1. render REPL（务必包 `InputScopeProvider`）
    2. `stdin.write('/hooks') + '\r'`
    3. 期望：frame 包含 `HOOKS_DIALOG`，且 **不包含** placeholder `Try "fix typecheck errors"`（说明进入 prompt mode）
    4. 在 overlay 打开期间依次写入：

       * `'\u001b'`（Esc）
       * `'\r'`（Enter）
       * `'\t'`（Tab）
       * `'1'`（数字）
       * `'\u001b[A' '\u001b[B' '\u001b[C' '\u001b[D'`（方向键）
    5. 期望：

       * REPL 的 `actions.abort` / `actions.send` / mode 切换等 spy **不被调用**
       * overlay 内部的 probe 能收到预期的键（例如 up/down 走 list，left/right/backspace/delete 被 TextInput consume）
  * 用例 2：`Esc` 关闭 overlay 后，REPL 恢复输入

    * overlay 内部实现：收到 Esc 调用 `onExit`
    * 关闭后断言 placeholder 回来（InputBar 恢复）

* **验收方式**

  * 自动：`vitest src/screens/REPL.s9.overlays.test.tsx` + 全量。
  * 手动：同上，用真实 overlay 做一次冒烟（不用改 UI）。

* **回滚策略**

  * 若 mock 测试与真实行为偏差大，回滚 mock 方式，改为 4.3 直接测真实 overlay（成本更高但更贴近）。

---

## 4.3（45–60min）用真实 overlay 做“关键路径”回归：至少覆盖 hooks 的“快速输入不丢字”

* **改动文件列表**

  * 新增：`src/ui/hooks/HooksDialog.e2e.test.tsx`（或 `src/screens/REPL.hooks.integration.test.tsx`）
  * 可能需要：为 hooks dialog 的输入框提供可断言的输出位置（但不能改 UI 文案/颜色/间距；只能利用已有文本渲染或增加 test-only probe）

* **具体改动点**

  * 尽量不引入 test-only UI；优先通过现有渲染内容断言输入值是否完整显示。
  * 若 hooks UI 目前不显示输入值（例如只是内部状态），可以：

    * 在 test 环境下（`process.env.NODE_ENV==='test'`）额外渲染一个不可见/不影响布局的 debug text —— **但这属于 UI 输出变更，慎用**。更推荐通过公开的 state/UI 已有文本完成断言。

* **风险点**

  * hooks overlay 的真实依赖（文件系统、配置、数据源）可能让测试脆弱；需要用依赖注入/mock（但不改运行时 UI）。

* **测试策略**

  * 打开 hooks dialog，聚焦其输入框，快速输入：

    * `stdin.write('abcdefghijklmnopqrstuvwxyz')`
  * 期望：最终 frame 能看到完整字符串，且没有缺字符（回归 pitfalls 中“scope flicker 丢键”问题）。

* **验收方式**

  * 自动：该集成测试通过。
  * 手动：同样在真实终端操作复现一次（快速输入、观察不掉字）。

* **回滚策略**

  * 若真实 overlay 测试过于脆弱影响 CI，回滚 4.3 测试文件，保留 4.2 的 runtime 契约测试；待 hooks 依赖可 mock 后再恢复。

---

## 4.4（30–45min）把 S9 新契约写回 docs（不改 UI，只补工程规范）

* **改动文件列表**

  * （已完成并归档）`plans/_archive/stability/COMPLETED-2026-01-26.md`（S9 拆分后的 checklist 与回归点索引）
  * `pitfalls.md`（补“禁止 ANSI 直写审计”“TextInput consume 契约”“suspend group 约束”等）

* **具体改动点**

  * 在 TODO S9 下补：

    * “哪些 keys 属于 command group / selector group / text group”
    * “overlay 必须 push overlay:xxx scope”
    * “什么时候 suspend command（overlay/prompt/selector）”
  * 在 pitfalls 增补：

    * hooks view.kind 依赖的原因与测试链接

* **风险点**

  * 无运行风险；唯一风险是文档与实现不同步（所以这条放在最后）。

* **测试策略**

  * 无（文档）。
  * 但验收时要求：文档引用的测试文件/用例名在仓库可搜索到。

* **验收方式**

  * 手动：review 文档与实现一致。
  * 自动：无。

* **回滚策略**

  * 若文档误导实现，回滚文档 commit（不影响代码）。

---

## 明确不做的事（避免违反“不改 UI/交互”的强约束）

* pitfalls 里提到的“overlay 打开闪一下、消息区域 margin/scroll region 调整”属于 UI 行为/布局层面改动，需要用户批准；本计划**不碰**这些布局调整，只做 runtime + 测试加固。

---

如果你希望我把上述 checklist **映射成你们 repo 的实际 PR 切分顺序**（例如每个 PR 包含哪几条、如何保证每个 PR 都是 green、以及哪些测试先落地更稳），我也可以在不需要额外上下文的情况下直接给出“PR 级别切分版”。
