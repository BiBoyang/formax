## A. 现状诊断

### A1. 现有 UI 分层/目录清晰度（按 primitives / domain components / flows / glue 对标）

整体结论：**“UI 代码确实存在，但分层不稳定、边界不清晰，导致组件复用率低、键盘交互容易互抢、风格不一致”**。同类职责分散在 `src/screens/*`、`src/ui/*`、`src/components/*`、`src/tools/presenters/*`、`src/features/repl/*` 多处，且很多文件同时承担了 **渲染 + 状态机 + 键盘路由 + 业务拼装**。

下面按你要求把当前代码（以 pack 为准）归类：

#### 1) primitives（基础组件：不懂业务，只做“可复用 UI 原子”）

* `src/components/ui/TextInput.tsx`：通用文本输入/编辑器，自己处理光标、Backspace、左右移动等，并且**支持 focus 控制**（`useInput(..., { isActive: focus })`）。
* `src/components/ui/Select.tsx`：通用选择列表（上下/回车/ESC），但 **内置键盘处理且无统一 focus 管控**、并且颜色硬编码。
* `src/components/ui/LoadingStatusLine.tsx`、`ThinkingStatusLine.tsx`、`PulsingDot.tsx` 等：状态/动效类基础 UI（使用 `getTheme`）。

> 评价：primitives 这一层**已经存在雏形**（尤其 `TextInput`），但 `Select` 这种“组件自带键盘”又缺少统一 focus 路由，反而放大了冲突风险。

#### 2) domain components（领域组件：懂 REPL/工具域，依赖业务类型）

* `src/components/chat/InputBar.tsx` / `HeaderBanner.tsx` / `ModeIndicator.tsx`：REPL 专用顶部/底部 UI（从 `REPL.tsx` import 可见）。
* `src/components/tool/ToolRouter.tsx` + `src/tools/presenters/*`：Tool message 渲染与交互提示（`ToolRouter` 选择 presenter）。

> 评价：这层基本合理，但它们与 flows/glue 的依赖方向没被约束（“谁能 import 谁”不清晰），导致屏幕层很容易直接拉进大量业务依赖。

#### 3) flows（流程页面/对话框：用户交互流程本体）

* `src/ui/AgentsDialog.tsx`：/agents overlay，内含多视图 state（`list | manualText | generateDesc | draft` 等）+ 键盘处理 + UI 子组件混写。
* `src/ui/permissions/PermissionsDialog.tsx`：/permissions overlay，含多 view（MAIN/ADD_RULE/…/DELETE_CONFIRM 等）+ 搜索模式 + 列表滚动 + 选择确认等复杂交互，并且大量内部组件/常量写在同文件。
* `src/ui/SetupWizard.tsx`：setup 向导，自己实现 provider/model 选择列表与键盘逻辑（上下/数字/ESC）。
* `src/tools/presenters/*ApprovalPrompt.tsx`：工具审批类 prompt（Bash / FS write / Edit / Web search …），每个 prompt 自己 useInput，菜单/输入/记忆选择等模式重复出现。

#### 4) glue（接线：把 controller/state 与 UI 组装到一起）

* `src/screens/REPL.tsx`：典型 glue（渲染 Header/Static/messages/InputBar + overlay + prompt），同时还负责**全局键盘处理**（ctrl+c/ctrl+o/esc/tab/shift+tab/模式切换等）。
* `src/features/repl/useReplController.ts`：把 overlay manager 映射成 `agentsDialogOpen/permissionsDialogOpen` 等 UI 状态，REPL 再据此渲染对话框。
* `src/features/repl/overlays/OverlayManager.ts`：overlay 状态存储/订阅，仅管理 “当前 overlay spec”。
* `src/features/repl/replUiContext.tsx`：目前只提供 `abort()`，没有输入焦点/路由能力。

---

### A2. 主要结构性坏味道（10 个，逐一引用文件并说明影响）

> 你强调“对标式诊断 + 行为不变 + 分 PR 可合并”，所以这里每个坏味道都尽量落在“结构问题”而非功能问题。

#### 1) **键盘事件路由无统一优先级/焦点：多处 `useInput` 并行活跃，冲突只能靠“侥幸”**

* REPL 全局 `useInput` 处理大量快捷键与导航。
* AgentsDialog 内也有自己的 `useInput`（同样监听 esc/enter/up/down 等）。
* PermissionsDialog 有更复杂的 `useInput` + 多 view 分支。
* SetupWizard 甚至 `useInput(..., { isActive: true })` 固定激活。
* Approval prompts 同样固定激活（`isActive: true`）。

**坏在什么地方**

* Ink 的 `useInput` 不会帮你做“事件冒泡阻断”，多个 handler 可能同时响应同一按键。
* 结果是：**overlay/对话框打开时，底层 REPL 仍可能响应方向键/Tab/数字键**，必须在每个 handler 里手写防守式 `return`。

**带来的问题**

* 行为不一致、难以预测；任何新增 overlay 都要“去所有 useInput 找一遍加 if”。（维护成本指数上升）

#### 2) **REPL 用零散 `if (dialogOpen) return` 做“临时隔离”，覆盖不完整且不可扩展**

在 REPL 的 key handler 中，仅对部分操作做了 `if (state.agentsDialogOpen) return` / `if (state.permissionsDialogOpen) return` 防守，例如 ctrl+o 与 esc。

**坏在什么地方**

* 这是“点状补丁”而不是架构：你永远不知道还有哪些键没挡住（比如方向键、数字键、Tab 在 overlay 下是否还会动到别的状态）。
* 新增交互页时很容易漏挡，形成“隐形耦合”。

#### 3) **Overlay 基础设施只负责“渲染开关”，不负责“输入焦点”：OverlayManager 是半成品**

* OverlayManager 只存 `currentOverlay` + subscribe，无任何输入策略。
* useReplController 只是把 overlay 映射成布尔值给 UI 渲染。
* REPL 里根据 `state.agentsDialogOpen` / `state.permissionsDialogOpen` 直接渲染 overlay。

**坏在什么地方**

* 你已经有“Overlay 的中心状态”，但输入管理仍是散装 if-return。
* 这恰好错过了最自然的分层点：**overlay 打开 => 输入焦点切到 overlay**。

#### 4) **超大单文件：UI 子组件 + 状态机 + 键盘路由混写，导致复用困难且改动风险高**

* AgentsDialog：一个文件里定义 view 类型、内部 UI 片段、键盘映射逻辑等。
* PermissionsDialog：颜色常量、内部组件（Separator/TabHeader/ListItem…）、多 view 分支键盘处理都在同文件。
* SetupWizard：同文件内包含多 step、多输入路径与键盘处理。

**带来的问题**

* 很难“只改 UI 结构而不碰行为”，因为任何微小调整都会触碰同文件中的多处逻辑与渲染。
* 也阻碍了你想要的 “可逐步合并”：单文件改动大 => PR 容易爆炸。

#### 5) **重复的“可选择列表/菜单”实现：`Select.tsx` 存在，但 flows/prompt 又各自实现一套**

* `src/components/ui/Select.tsx` 已经实现了 up/down/enter/esc 与渲染。
* SetupWizard 自己实现 provider/model 列表与键盘逻辑（含数字快捷键）。
* PermissionsDialog 自己实现 ListItem、scrollIndicator、搜索模式等渲染与键盘分支。
* Approval prompts（FsWrite/Bash/Edit）各自实现 MenuRow/光标/输入行/记忆选项等。

**坏在什么地方**

* 同一类交互（上下选择、数字选择、回车确认、ESC 取消）在 5+ 处重复。
* “行为一致性”无法靠 review 保障，必须靠抽象。

#### 6) **主题/样式系统不统一：硬编码颜色与 theme 并存，导致 UI 风格割裂**

* PermissionsDialog 硬编码 `MAIN_COLOR/GRAY_COLOR/DELETE_COLOR`，并在多处直接使用。
* Select 直接用 `color="cyan"/"gray"` 硬编码。
* 但 LoadingStatusLine 等则使用 `getTheme`（统一 theme 体系）。

**问题**

* 交互页风格不一致（你提到的痛点），且很难整体换肤或统一语义色（danger/secondaryText 等）。

#### 7) **文本输入与菜单导航的冲突处理分散：有的靠 `focus`，有的靠手写 `typing` + refs**

* `TextInput` 是一个较“正统”的 primitive：用 `focus` 控制 input handler 激活。
* 但 BashApprovalPrompt 自己维护 `typing` 状态来决定是否把字符送进输入框，逻辑复杂且每个 prompt 都写一遍。
* EditApprovalPrompt 为避免闭包问题使用 `cursorRef/typingRef/feedbackRef` 等 refs，再手写 shift+tab 行为与输入切换。
* PermissionsDialog 在 AddRule 里直接 `TextInput focus`，但其它 view 仍是手写键盘分支。

**问题**

* 同类需求（“输入中不要被外层列表抢方向键/数字键”）每处实现不同，易出 bug。
* 也使你无法在一处修复 key 冲突。

#### 8) **Key hints/帮助条分散且文本不一致：维护成本高，用户学习成本也高**

* PermissionsDialog 主界面提示：`Press ↑↓ ... / to search ... Esc to cancel`。
* AddRule 提示：`Enter to submit · Esc to cancel`。
* 其它 prompt 也各自输出 Esc/Enter 说明（不同用词/不同符号间隔）。

**问题**

* 改一个 key 绑定，需要改 N 个页面；很容易漏，导致“说的不对”。

#### 9) **工具审批（EditApprovalPrompt）决策提交 glue 重复：每个 presenter 都写一遍 if/else**

* 在 tool presenter 中，对 `EditApprovalPrompt` 的 decision 做 if/else 分发到 `userInput.submitAnswers`，属于重复 glue。

**问题**

* 交互页（prompt）API 一旦调整，N 个 presenter 一起改，风险大。
* 明明是“同构行为”，应该集中成一个 helper（不改变功能，仅消除重复）。

#### 10) **REPL 屏幕承载过多：既做 UI，又导入大量业务/adapter/diagnostics**

REPL.tsx import 列表包含 tool/ui/config/diagnostics/fs/workspace 等多种职责。

**问题**

* REPL 变成“万物入口”，UI 改动很容易牵扯业务依赖，导致 PR 扩散。
* 也让 UI 层级不清晰：哪些是 UI glue、哪些是业务 side-effect 不好分辨。

---

## B. 目标目录树（建议的 UI 层级）

> 只针对 **UI/REPL glue 相关**，不扩展到全项目。目标是：**依赖方向明确、可逐步迁移、可局部替换**。

### B1. 建议目标结构

```txt
src/
  components/
    ui/
      primitives/
        TextInput.tsx
        PulsingDot.tsx
        RotatingStar.tsx
        (…纯展示、无业务…)
      layout/
        OverlayFrame.tsx        # 标准对话框/overlay 框架（标题/边框/间距/区域）
        Panel.tsx               # BoxPanel（统一 borderStyle/padding）
        Divider.tsx             # Separator/FrameDivider
        KeyHintBar.tsx          # 底部键位提示统一渲染
      forms/
        SelectList.tsx          # 可选列表（光标/滚动/数字快捷键，可配置）
        TabBar.tsx              # 左右 tab（不含业务）
        InlineTextEditorRow.tsx # “列表中的可编辑行”（统一 typing/focus 行为）
        ConfirmMenu.tsx         # 确认/取消/记忆范围（组合 SelectList）
      keyboard/
        scopes.ts               # InputScopeId 类型 + scope 常量
        useScopedInput.ts       # useInput 的统一封装（isActive = scope）
        focusStore.ts           # 轻量 focus/active 管理（可堆栈）
  ui/
    repl/
      components/
        HeaderBanner.tsx
        ModeIndicator.tsx
        InputBar.tsx
      overlays/
        agents/
          AgentsDialog.tsx
          (AgentsListView.tsx / AgentDraftView.tsx / …)
        permissions/
          PermissionsDialog.tsx
          (Tabs.tsx / RulesList.tsx / AddRuleView.tsx / …)
    setup/
      SetupWizard.tsx
  screens/
    REPL.tsx                    # 只做“组装”：controller + flows + domain components
    ToolExamplesScreen.tsx
    LoadingExampleScreen.tsx
```

### B2. 每层“做什么/不做什么”（对标约束）

#### `src/components/ui/primitives/*`

* ✅ 做什么：纯展示/纯交互原子（TextInput、Dot、Spinner），**不依赖业务类型**。
* ❌ 不做什么：不 import `features/*`、不读 config、不读 fileStore、不知道 “/agents” “permissions” 这些概念。

#### `src/components/ui/layout/*`

* ✅ 做什么：布局骨架（OverlayFrame、Panel、Divider、KeyHintBar），只依赖 primitives/theme。
* ❌ 不做什么：不处理具体键盘语义（“按 1 选择 WebFetch” 这种属于 forms/flows）。

#### `src/components/ui/forms/*`

* ✅ 做什么：可复用交互件（SelectList、TabBar、InlineTextEditorRow、ConfirmMenu），**可包含通用键盘语义**（up/down/enter/esc/数字）。
* ❌ 不做什么：不写 “permissions 的 SAVE_OPTIONS/Workspace 目录删除” 这些业务内容。

#### `src/ui/**`

* ✅ 做什么：业务 flow（/agents、/permissions、setup wizard），可以组合 forms/layout/primitives，并实现状态机。
* ❌ 不做什么：不直接做全局键盘路由；不直接 import controller 的底层实现细节（尽量通过 props）。

#### `src/screens/**`

* ✅ 做什么：REPL glue / screen 容器，负责把 controller 状态映射成“该渲染哪些 flows + 传什么 props”。
* ❌ 不做什么：不再写大量“overlay 打开时 return”式的分散防守逻辑；应把输入优先级交给统一 keyboard/scopes。

### B3. 依赖方向强调（你要求的重点）

* `primitives` **不依赖** `forms/flows/glue`
* `layout/forms` **只能依赖** `primitives`（可依赖 theme/utils）
* `flows` 可以依赖 `layout/forms/primitives`
* `screens(glue)` 负责组装 `flows + domain components + controller`
  （glue 是唯一允许 “上层业务依赖”大量出现的地方，但要尽量薄）

---

## C. 组件抽离表格（最关键）

> 重点围绕“键盘交互/输入冲突/一致性”，并且每个抽离都能被 **按 PR 渐进接入**。

| 抽离组件名                             | 目标路径                                                            | 从哪些文件抽出                                                                      | 复用点                                                   | API 草案（props）                                                                                                                  | 风险点                                                    |
| --------------------------------- | --------------------------------------------------------------- | ---------------------------------------------------------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------ |
| `useScopedInput`                  | `src/components/ui/keyboard/useScopedInput.ts`                  | 从多处 `useInput` 的“isActive 控制缺失”抽象（REPL/Dialogs/Prompts）                      | 全项目所有交互件                                              | `useScopedInput(scopeId, handler, opts?)`，内部 `useInput(handler, {isActive})`                                                   | Ink 多 handler 并行的问题需要靠 isActive 彻底收敛；接入顺序不当会“按键失灵”     |
| `FocusScopeStore`（轻量 active 管理）   | `src/components/ui/keyboard/focusStore.ts`（或扩展 `replUiContext`） | 结合 `OverlayManager` + `replUiContext` 现状                                     | REPL/overlay/prompt 之间的输入互斥                           | `activeScope: InputScopeId` + `pushScope(id)`/`popScope(id)`/`setActive(id)`/`isActive(id)`                                    | “堆栈恢复”做不好会造成 scope 泄漏（关闭对话框后按键仍无效）                     |
| `OverlayFrame`（统一对话框框架）           | `src/components/ui/layout/OverlayFrame.tsx`                     | AgentsDialog/PermissionsDialog 内部的“边框/标题/间距/分隔”样式                            | /agents、/permissions、后续所有 overlay                     | `title`, `subtitle?`, `children`, `footer?`, `borderStyle?`, `theme?`                                                          | 轻微布局变动可能影响快照/文案对齐；需保持原文案不变                             |
| `KeyHintBar`（统一键位提示）              | `src/components/ui/layout/KeyHintBar.tsx`                       | PermissionsDialog 底部提示、AddRule 提示、各 ApprovalPrompt 的提示文字                     | 所有对话框/提示页                                             | `hints: Array<{ keys: string; label: string }>`（渲染成 `keys · label`）                                                            | 文案变更会破坏“行为不变”的预期；建议先“复用渲染”，不改文案                        |
| `SelectList`（统一列表选择：光标/滚动/数字）     | `src/components/ui/forms/SelectList.tsx`                        | 现有 `Select.tsx` + SetupWizard 列表逻辑 + Prompt 菜单行模式                            | SetupWizard、PermissionsDialog 主列表、各种 approval menus   | `items: T[]`, `renderItem`, `selectedIndex`, `onChangeIndex`, `onSubmit(index)`, `onCancel?`, `enableNumbers?`, `visibleRows?` | 列表/滚动细节最容易“行为漂移”；要用现有 PermissionsDialog.test 覆盖滚动/搜索行为 |
| `TabBar`（左右 tab）                  | `src/components/ui/forms/TabBar.tsx`                            | PermissionsDialog 的 `TabHeader/TabDescription` 与左右切换键逻辑                      | PermissionsDialog（Workspace/Allow/Ask/Deny 等）         | `tabs: {id,label,desc?}[]`, `activeId`, `onChange(id)`                                                                         | tab 切换键（← →）与列表上下键组合要谨慎；需要与搜索模式互斥                      |
| `InlineTextEditorRow`（列表中的文本输入行）  | `src/components/ui/forms/InlineTextEditorRow.tsx`               | BashApprovalPrompt / EditApprovalPrompt 的 feedback 输入行模式（typing + TextInput） | 各类 prompt “自定义原因/反馈”行；PermissionsDialog 搜索/规则输入也可逐步复用 | `label`, `value`, `onChange`, `onSubmit`, `active`, `placeholder?`, `startTypingOnChar?`                                       | 最容易引入方向键/数字键冲突；必须把“输入时外层列表不响应”封装清楚                     |
| `ConfirmMenu`（确认/取消/记忆范围）         | `src/components/ui/forms/ConfirmMenu.tsx`                       | EditApprovalPrompt 的 approve/remember/scope + FsWrite/Bash 的确认分支             | 所有“是否允许 + 是否记住”类 prompt                               | `options`, `selected`, `onDecision`, `rememberScopes?`, `defaultScope?`                                                        | 各 prompt 的选项顺序/快捷键要保持一致，否则算行为变化                        |
| `submitApprovalDecision`（集中 glue） | `src/tools/presenters/helpers/submitDecision.ts`（或同目录）          | tool presenters 重复的 if/else 提交逻辑                                             | Search/Edit/Bash/Write 等 presenter 都会用                | `submitApprovalDecision(userInput, toolUseId, decision)`                                                                       | 改动范围广但改动很机械；需要先做“引入 helper 不改行为”                       |

### C2. 建议的“最小公共组件集合”（先解决一致性/冲突）

按优先级（先做对整体收益最大、接入成本最低的）：

1. **`useScopedInput` + FocusScopeStore（输入焦点/优先级）**
2. **`SelectList`（统一列表选择）**
3. **`InlineTextEditorRow`（统一“可编辑行”与冲突处理）**
4. **`OverlayFrame` + `KeyHintBar`（统一外观骨架与提示）**
5. `TabBar`（PermissionsDialog 需要）

### C3. 哪些页面先接入（建议顺序）

1. **REPL + overlays（/agents、/permissions）**：先把“overlay 打开时 REPL 不抢键盘”彻底解决。
2. **PermissionsDialog**：它有测试覆盖（搜索、光标移动），适合做“基准用例”。
3. **Approval prompts（Edit/Bash/FsWrite）**：重复最严重，且最需要统一“输入 vs 列表”冲突策略。
4. **SetupWizard**：把选择列表统一成 SelectList，减少未来再扩散一套交互规则。

---

## D. 分阶段 TODO（按 PR）

> 每个 PR 都以“可合并、行为不变、最小 churn”为目标。
> 验收命令按 README：`bun run test`、`bun run type-check`、`bun run dev` 等。

### D0. 键盘交互统一方案（落地策略：接口 + 状态流转）

#### 核心目标

* **同一时刻只允许一个“输入层（scope）”消费方向键/Tab/数字/Enter/Esc**
* overlay / prompt 打开时，REPL 与 InputBar **必须彻底停止抢键盘**（除了 ctrl+c 这种全局退出）

#### 设计：InputScope（输入层）与优先级

定义 `InputScopeId`（建议 string union，便于渐进）：

```ts
type InputScopeId =
  | 'repl'          // 常规 REPL
  | 'prompt'        // AskUserQuestion / approvals 等交互 prompt
  | `overlay:${string}` // overlay:agents / overlay:permissions / ...
  | 'global';       // 仅用于 ctrl+c 等不该被屏蔽的键
```

优先级（从高到低）：

1. `global`（永远 active：ctrl+c 退出等）
2. `overlay:*`（打开 overlay 时）
3. `prompt`（用户输入 prompt 时）
4. `repl`（默认）

#### 状态来源（结合现有实现）

* overlay 是否打开：你已经有 `OverlayManager` + controller 映射出的 `agentsDialogOpen/permissionsDialogOpen`
* prompt mode：REPL 里已有 `isPromptMode` 概念（REPL handler 里也已经 `if (isPromptMode) return`）。

因此 **activeScope 可以在 REPL glue 层“纯计算”出来**：

* 若 `state.agentsDialogOpen` => `overlay:agents`
* else 若 `state.permissionsDialogOpen` => `overlay:permissions`
* else 若 `isPromptMode` => `prompt`
* else => `repl`

#### 事件消费策略（关键点：Ink 没有 stopPropagation）

* 不能依赖“谁先注册 useInput 就先消费”，因为多个 handler 都会跑。
* 只能用 `useInput(..., { isActive })` 做硬互斥。

落地方式：

1. 扩展 `ReplUiProvider`（目前仅 abort）让它携带 `activeScope`（不新增 provider，只扩字段）。
2. 提供 `useScopedInput(scopeId, handler)`：内部自动 `isActive = (ctx.activeScope === scopeId)`。
3. REPL 自身的全局 handler 拆成两层：

   * `global` handler：只处理 ctrl+c（永远 active）
   * `repl` handler：其余快捷键都放到 `useScopedInput('repl', ...)` 中

#### 文本输入状态下如何避免外层 list 抢键（局部策略）

* `TextInput` 已经支持 focus 来决定是否激活自己的 useInput。
* 统一规则：**只要 TextInput focus=true，则同 scope 内其它 list/menu 的 handler 必须直接 return**。
* 通过抽象 `InlineTextEditorRow` 实现“输入时屏蔽外层键”的通用模板（取代 prompt 里手写 typing/ref）。

#### 如何渐进接入（不大改 UI）

* 第一步只改 REPL：让 overlay/prompt 打开时 REPL handler 彻底 inactive（不再靠零散 if-return）。
* 第二步改 InputBar：当 `activeScope !== 'repl'` 时，TextInput `focus={false}`，避免底部输入框抢字母/数字。
* 第三步逐个把 prompts/dialogs 的 `useInput({isActive:true})` 改为 `useScopedInput('prompt' / 'overlay:xxx')`（可以一个文件一个 PR）。

---

### PR1 — 引入 keyboard scopes 基础设施（不改任何现有行为）

**改动范围（文件列表）**

* 修改：`src/features/repl/replUiContext.tsx`（扩展 context value，但保持兼容）
* 新增：

  * `src/components/ui/keyboard/scopes.ts`
  * `src/components/ui/keyboard/useScopedInput.ts`
  * `src/components/ui/keyboard/focusStore.ts`（或把 store 内联到 replUiContext）
* （可选）新增一个小测试：`src/components/ui/keyboard/useScopedInput.test.tsx`

**关键实现点**

* `ReplUi` 增加字段：`activeScope: InputScopeId`（默认 `'repl'`），不破坏现有 `abort` 使用方。
* `ReplUiProvider` 支持 `activeScope` prop（可选），不传则默认 `'repl'`。
* `useScopedInput(scope, handler)`：读取 ctx.activeScope，决定 `useInput` 的 `isActive`。

**风险与回滚策略**

* 风险低：只新增/扩字段，不改现有 UI 路径。
* 回滚：直接 revert 本 PR；不会影响其他代码。

**验收方式**

* `bun run test`
* `bun run type-check`

---

### PR2 — REPL 接入 activeScope：overlay/prompt 打开时 REPL 不抢键盘（最小可见风险）

**改动范围**

* 修改：`src/screens/REPL.tsx`（把 REPL 的 useInput 拆分为 global/repl 两层，并计算 activeScope）
* 修改：`src/features/repl/replUiContext.tsx`（让 Provider 接受 activeScope）
* 修改（很可能需要）：`src/components/chat/InputBar.tsx`（增加 `active?: boolean` 或 `focus?: boolean` 传给 TextInput）
* 修改（可选）：`src/ui/AgentsDialog.tsx` / `src/ui/permissions/PermissionsDialog.tsx`（暂时不必改 useInput，只要 REPL 不抢即可）

**关键实现点**

1. 在 REPL 渲染层计算：

   * `const activeScope = state.agentsDialogOpen ? 'overlay:agents' : state.permissionsDialogOpen ? 'overlay:permissions' : isPromptMode ? 'prompt' : 'repl'`
   * Provider：`<ReplUiProvider abort={actions.abort} activeScope={activeScope}>...`
2. REPL 的 `useInput` 拆成：

   * `useInput`（global）：只处理 ctrl+c（保持现在的“随时退出”行为）。
   * `useScopedInput('repl', ...)`：把原先 handler 中除 ctrl+c 外的逻辑搬过去（Tab/Shift+Tab/Esc/ctrl+o/Slash nav 等）。
3. InputBar：

   * 当 `activeScope !== 'repl'` 时，底部 TextInput 不应 focus（避免 overlay 搜索/输入时字母进入 InputBar）。
   * 这一步属于“消除冲突”，符合你要的“其他地方不要抢键盘事件”。

**风险与回滚策略**

* 风险：如果某些页面依赖 REPL handler 在 overlay 下仍工作（理论上不应），会出现“快捷键失效”。
* 回滚：

  * 保留旧 handler（临时注释掉 `useScopedInput`，回退为原逻辑）是最小回滚；
  * 或 revert 本 PR。

**验收方式**

* 自动：

  * `bun run test`（尤其 PermissionsDialog tests）
  * `bun run type-check`
* 手动（必须做）：

  1. `bun run dev`
  2. 在 REPL 中打开 `/agents`（出现 AgentsDialog）与 `/permissions`（PermissionsDialog）
  3. 验证：overlay 打开时，按方向键/Tab/数字键只作用于 overlay，不会影响底层 slash suggestion / mode 切换等。

---

### PR3 — 抽离 `KeyHintBar`（不改文案）+ `OverlayFrame`（先做壳子），优先接入 PermissionsDialog

**改动范围**

* 新增：`src/components/ui/layout/KeyHintBar.tsx`
* 新增：`src/components/ui/layout/OverlayFrame.tsx`
* 修改：`src/ui/permissions/PermissionsDialog.tsx`（仅替换结构/布局组件，不改任何文案与键位绑定）
* （可选）修改：`src/ui/AgentsDialog.tsx`（仅替换边框/分隔）

**关键实现点**

* `KeyHintBar` 只负责渲染（比如 `Press ↑↓ …` 这种字符串仍由页面传入），确保输出文本保持一致（避免测试与“行为不变”风险）。
* `OverlayFrame` 先只统一：

  * borderStyle / paddingX
  * title 区域渲染位置
  * footer 区域（KeyHintBar）
* PermissionsDialog 里目前大量 `Box borderStyle="single" borderColor={MAIN_COLOR}` 的片段先不动颜色逻辑，只把“框架结构”抽出来，颜色仍由外层传入（避免主题改动带来的视觉变化）。

**风险与回滚策略**

* 风险：布局结构变化导致测试匹配文本位置/换行变化（PermissionsDialog.test 主要是 `toContain`，风险较低）。
* 回滚：逐文件回退（只回退 PermissionsDialog 的替换），新组件可保留不影响。

**验收方式**

* `bun run test`（重点看 PermissionsDialog tests）
* `bun run type-check`
* 手动：`bun run dev`，进入 `/permissions`，确认 UI 文案完全一致、Esc/Enter/↑↓/`/` 搜索行为一致。

---

### PR4 — 抽离 `SelectList`（从 Select.tsx 演进而来），先不替换任何 flow（只提供新组件 + 兼容导出）

**改动范围**

* 新增：`src/components/ui/forms/SelectList.tsx`
* 修改：`src/components/ui/Select.tsx`（改为薄封装/重导出到 SelectList，保持原 API 不变）
* 新增（可选）：`src/components/ui/forms/useCursorNavigation.ts`

**关键实现点**

* 不在这个 PR 改任何使用方（避免 churn）。
* `SelectList` 增加可配置项，但默认行为完全等价于旧 Select：

  * up/down 改 index（wrap or clamp 需与旧一致）
  * Enter submit
  * Esc cancel
* 保留旧 `Select` 导出路径，内部调用 `SelectList`，这样后续 flow 改动可以“只改逻辑，不改 import 路径”。

**风险与回滚策略**

* 风险：Select 是基础组件，一旦行为变了会影响所有使用方（目前看使用方不多，但仍谨慎）。
* 回滚：保留旧 Select 实现（新组件不启用），或 revert 此 PR。

**验收方式**

* `bun run test`
* `bun run type-check`

---

### PR5 — SetupWizard 接入 `SelectList`：删除自写列表键盘逻辑（保持原行为：↑↓/数字/Enter/Esc）

**改动范围**

* 修改：`src/ui/SetupWizard.tsx`（将 provider/model 选择列表替换为 SelectList）
* 可能新增：`src/components/ui/forms/SelectList` 增强（支持数字选择、显示 index label 等）

**关键实现点**

* 对齐 SetupWizard 现有行为：

  * 上下箭头移动 `providerIndex` / `modelIndex`
  * 数字键直接选择（SetupWizard 现在支持）
  * Esc：回退/退出（保持现有逻辑分支）
* 把 `handleProviderInput/handleModelInput` 中“通用列表键逻辑”收敛到 SelectList：

  * 仅保留“选择后做什么”的业务（setProvider / setModel / next step）

**风险与回滚策略**

* 风险：数字键选择的边界（0/大于长度）与旧逻辑不一致。
* 回滚：保留旧 `ChoiceListView` 与 handler（用 git revert 或把 SelectList 替换回原来组件）。

**验收方式**

* `bun run test`
* `bun run type-check`
* 手动：触发 setup wizard（按你项目现有入口），逐步验证：

  * provider 列表 ↑↓、按 1/2/3、Enter
  * model 列表同样行为
  * Esc 回退/退出

---

### PR6 — Approval prompts 统一：抽离 `InlineTextEditorRow` + `ConfirmMenu`，并接入 `useScopedInput('prompt')`

**改动范围**

* 新增：

  * `src/components/ui/forms/InlineTextEditorRow.tsx`
  * `src/components/ui/forms/ConfirmMenu.tsx`
* 修改：

  * `src/tools/presenters/fsWriteApprovalPrompt.tsx`
  * `src/tools/presenters/bashApprovalPrompt.tsx`
  * `src/tools/presenters/editApprovalPrompt.tsx`（含 shift+tab scope 切换与 feedback 输入）
* 修改（可选，降低 glue 重复）：

  * 新增 `src/tools/presenters/helpers/submitDecision.ts`
  * 然后在各 presenter 内替换重复 if/else（如 web search presenter）

**关键实现点**

* **行为保持**（关键）：

  * 选项顺序、数字编号、Esc/Enter 语义保持
  * EditApprovalPrompt 的 shift+tab 轮换 scope 逻辑保持（只是把 UI 行渲染抽出来）
* `InlineTextEditorRow` 统一处理：

  * 进入 typing 的触发（例如选中该行后输入任意字符）
  * typing=true 时，外层菜单不处理数字/上下键（或按现有 prompt 行为：上下键退出 typing 并移动光标）
* 把 prompts 的 `useInput(..., { isActive: true })` 替换为 `useScopedInput('prompt', ...)`（避免未来 prompt 叠在 overlay 上时键互抢）。

**风险与回滚策略**

* 风险最大点：输入行与菜单行的切换（typing 状态）——这正是你要统一的地方，但也最容易引入细微行为变化。
* 回滚：

  * 先做一个 prompt（例如 FsWrite）验证稳定后再批量改 Bash/Edit；
  * 每个 prompt 单独提交/单独 PR 也可（如果你更想控风险）。

**验收方式**

* `bun run test`
* `bun run type-check`
* 手动：

  * 触发一次 Bash/Write/Edit approval
  * 验证：↑↓移动选项、数字键直选、Enter 提交、Esc 取消
  * 重点验证：在 feedback 输入行里输入文本时，数字键不会“跳选项”，左右键只移动输入光标（与 TextInput 行为一致）

---

### PR7 — PermissionsDialog 深度结构拆分：把“状态机/键盘路由/视图渲染”分文件，并接入 SelectList/TabBar（用现有测试做护城河）

**改动范围**

* 重构（拆文件）：

  * `src/ui/permissions/PermissionsDialog.tsx` → `src/ui/repl/overlays/permissions/PermissionsDialog.tsx`
  * 新增子文件：

    * `Tabs.tsx`（TabBar wrapper）
    * `RulesListView.tsx`
    * `AddRuleView.tsx`
    * `DeleteDirectoryFlow.tsx`
    * `types.ts`（view enum、数据模型）
* 修改 import：`src/screens/REPL.tsx` 渲染引用保持不变或通过 re-export 过渡。

**关键实现点（保持行为不变的拆法）**

1. **第一步只拆文件，不改逻辑**：把现有 `renderMain/renderAddRule/...` 原样搬到独立组件文件，props 透传 state/setState。
2. **第二步再局部替换为 SelectList/TabBar**：优先替换 MAIN 列表（因为有测试覆盖）。
3. 搜索模式 `/`：保持原触发与渲染（`Search:` 文案不要变），确保测试继续通过。

**风险与回滚策略**

* 风险：拆文件带来 props 透传较多，容易漏传 setXxx。
* 回滚：先合并“只拆文件不改逻辑”的 PR（可回滚成本低），后续“替换为 SelectList”另开 PR。

**验收方式**

* 自动：PermissionsDialog.test 必须全绿（它覆盖搜索与 cursor 基本行为）。
* 手动：`bun run dev` → `/permissions`

  * ↑↓/Enter/ESC
  * `/` 搜索输入过滤
  * 删除目录流程（如果你常用）

---

### PR8 — AgentsDialog 深度结构拆分：统一 OverlayFrame/KeyHintBar/SelectList，并逐步接入 focus/scoped input

**改动范围**

* 拆分：

  * `src/ui/AgentsDialog.tsx` → `src/ui/repl/overlays/agents/AgentsDialog.tsx`
  * 子文件：

    * `AgentsListView.tsx`
    * `AgentManualTextView.tsx`
    * `AgentDraftView.tsx`
    * `layout.tsx`（如果有大量 DialogFrame/Divider/Spacer 片段）
* 修改 `src/screens/REPL.tsx` 引用（同 Permissions 一样可通过 re-export 过渡）。

**关键实现点**

1. 同 PermissionsDialog：先“拆文件不改逻辑”，把 `useInput` 与 view 状态机保留原样。
2. 再引入共用组件：

   * 列表视图：接入 `SelectList`
   * 框架：接入 `OverlayFrame`
   * 底部提示：接入 `KeyHintBar`
3. 如果 AgentsDialog 内部有文本编辑（manualText），优先改为复用 `TextInput` 或 `InlineTextEditorRow`（看现有实现，但原则是：**输入 focus=true 时，列表键不应响应**）。

**风险与回滚策略**

* AgentsDialog 可能比 Permissions 更“多步骤”（generateDesc/draft/save），拆分时更容易漏状态。
* 回滚：同样分两步 PR：

  * PR8a：拆文件不改逻辑
  * PR8b：接入通用组件

**验收方式**

* `bun run test`
* `bun run type-check`
* 手动：`bun run dev` → `/agents`

  * 列表选择、进入详情/编辑、Esc 返回/退出
  * 若有生成草稿/保存路径，完整跑一遍

---

### PR9（可选收尾）— 目录清理与过渡 re-export：把旧路径保留为薄转发，逐步清空重复代码

**改动范围**

* 新增 `src/ui/repl/overlays/*` 后：

  * 保留旧文件 `src/ui/AgentsDialog.tsx` / `src/ui/permissions/PermissionsDialog.tsx` 作为 `export * from 'new/path'` 的转发层
* 清理：

  * 当所有使用方迁移完毕，再删旧文件与重复 internal components

**关键实现点**

* 这是为了实现“可以逐步合并”：**先搬家不破坏 import**，最后再集中删旧入口。

**风险与回滚策略**

* 风险很低（纯路径与 re-export）。
* 回滚：删掉 re-export 层，回到旧路径。

**验收方式**

* `bun run test`
* `bun run type-check`
* 手动 smoke：`bun run dev`，打开 `/agents` `/permissions` 走一遍

---

## E. 验收清单（每阶段）

> 这里给你一个“按 PR 直接执行”的 checklist（避免漏项）。

### PR1 验收

* [ ] `bun run test`
* [ ] `bun run type-check`
* [ ] 确认没有任何 UI 文案变化（此 PR 不触碰 UI）

### PR2 验收

* [ ] `bun run test`（至少包含 PermissionsDialog tests）
* [ ] `bun run type-check`
* [ ] 手动：`bun run dev` → 打开 `/permissions`，按 ↑↓ `/` 搜索输入，确认 REPL 不再响应 Tab/Shift+Tab/模式切换等全局键
* [ ] 手动：打开 `/agents`，确认方向键只作用于 dialog，不会动到底部输入条

### PR3 验收

* [ ] `bun run test`（重点 PermissionsDialog）
* [ ] `bun run type-check`
* [ ] 手动：`/permissions` 确认文案完全一致（尤其底部提示），交互不变

### PR4 验收

* [ ] `bun run test`
* [ ] `bun run type-check`
* [ ]（若 Select 被使用）手动跑一下涉及 Select 的页面，确认 ↑↓/Enter/Esc 行为一致

### PR5 验收

* [ ] `bun run test`
* [ ] `bun run type-check`
* [ ] 手动：setup wizard provider/model 选择

  * [ ] ↑↓ 移动
  * [ ] 数字键直选
  * [ ] Enter 确认
  * [ ] Esc 回退/退出

### PR6 验收

* [ ] `bun run test`
* [ ] `bun run type-check`
* [ ] 手动：触发 Bash/Write/Edit/Search 等 approvals

  * [ ] ↑↓/数字/Enter/Esc 行为一致
  * [ ] 在 feedback 输入行里输入时：数字键不会误触菜单跳转、左右键移动光标

### PR7 验收

* [ ] `bun run test` 必须包含并通过 PermissionsDialog tests（搜索过滤、光标移动）
* [ ] `bun run type-check`
* [ ] 手动：`/permissions` 走完整流程（搜索、添加规则、删除目录）

### PR8 验收

* [ ] `bun run test`
* [ ] `bun run type-check`
* [ ] 手动：`/agents` 全流程（列表 → 详情/编辑 → 返回/退出，若有生成草稿/保存也走一遍）

### PR9 验收

* [ ] `bun run test`
* [ ] `bun run type-check`
* [ ] 手动 smoke：`bun run dev`，打开 `/agents` `/permissions`，确认路径迁移不影响渲染与按键

---

如果你希望我把 **“PR2 中 REPL activeScope 的计算规则”**进一步对齐你当前 overlay 种类（不仅 agents/permissions，还包括其它 overlay），我可以直接基于 `OverlayManager` 的 overlay kind 枚举（pack 里已有相关类型/用法痕迹）给你一份更精确的 `InputScopeId` 列表与映射表，确保 scope 不会“写死两个对话框”。
