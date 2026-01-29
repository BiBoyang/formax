# TODO — Approval UI (Frame + Preview + Markdown)

目标：对齐 Claude Code 的 approval 结构与视觉层级（顶线 + 标题 + 可选预览 + 问句 + 选项），并在不引入 raw ANSI 的前提下，让“预览内容”支持 Markdown（至少 code block），后续再逐步补“代码高亮”。

> 约束：不改工具/权限的业务语义（只改 UI 输出）；不把 `<system-reminder>` 之类塞回 tool_result；优先加测试锁回归。

## A. 统一 Approval 的“框架结构”（先做）

- [ ] 抽一个可复用的 `ApprovalFrame`（或 `ApprovalBlock`）组件：**顶部分隔线 + Title + (children)**  
  - 现有参考：`src/tools/presenters/ApprovalHeader.tsx`
  - 输出结构对齐：
    1) 顶线（`theme.permission`）
    2) Title（`theme.permission`，bold），如 `Create file` / `Bash command` / `Read file`
    3) 可选 Preview（文件/命令/URL 等）
    4) 问句（如 `Do you want to create demo.js?`）
    5) ConfirmMenu（多选一）
    6) `Esc to cancel`

- [x] 解决“重复分隔线”问题：**带预览的 approval 只能有一条顶线**  
  - 现状：`src/tools/modules/write/presenter.tsx` 手动画线 + `ApprovalHeader` 再画线 → 两条线  
  - 调整方向：顶线只由 `ApprovalFrame` 提供；子组件不再重复画线

- [x] 清理无意义空行：例如 `Create file` 上下多余 margin/空行（对齐 CC 紧凑布局）

## B. 抽象 Preview（先做“结构”，后做“渲染”）

- [x] 定义 `ApprovalPreview` 组件（只管布局，不管语义）：  
  - 显示：文件名/标题行 + bordered box（建议 `borderStyle="round"` 对齐 CC）  
  - 预览区边框颜色：先保持 `theme.secondaryText`（后续再按截图逐项对齐）

- [x] 把 `Write` 的预览从 `src/tools/modules/write/presenter.tsx` 提取到 `ApprovalPreview`  
  - 现状：`WriteToolPresenter` 内部拼 preview（线 + Create file + border + 内容）
  - 目标：`WriteToolPresenter` 只负责“给 preview 数据”，不负责“画框/画线/空行”

## C. 预览内容的 Markdown 渲染（优先做 code block）

> 先不追求 100% 语法高亮；目标是能把预览统一渲染成“Markdown + code fence”，后续再加轻量高亮。

- [x] 新增一个纯 UI 的 `MarkdownText`（或 `MarkdownBlock`）组件：把 markdown 字符串渲染成 Ink `Text`/`Box`
  - 最小支持：
    - 段落换行
    - 无序列表（`- `）
    - code block（````` ``` `````）
    - inline code（`` `code` ``）
  - 约束：不要输出 raw ANSI（通过 Ink 的 `Text color/backgroundColor/bold` 实现）

- [x] 在 `ApprovalPreview` 里使用 `MarkdownBlock` 渲染预览内容：
  - 对于代码文件：包装为 code fence（根据扩展名推断语言标签可选）
  - 对于 `.md`：直接渲染 markdown（含 code blocks）

## D. “代码高亮”策略（先讨论后实现）

- [ ] 确认策略：
  - 方案 1（最稳）：只做 “code block 单色 + 少量 token 高亮（字符串/关键字）” 的轻量 tokenizer（不引入新依赖）
  - 方案 2（更像 CC）：引入高亮库（可能更重，需评估体积/性能/ANSI 审计影响）
- [ ] 若选方案 1：先针对 JS/TS 做最小高亮（strings/comments/keywords），其它语言退化为单色
- [ ] 若选方案 2：评估是否会引入 raw ANSI（需要通过 `src/utils/ansiAudit.ts` 的约束/测试）

## E. 回归测试（必须）

- [x] 为 `Write` approval 补/改 `ink-testing-library` 用例：锁定
  - 只有**一条**顶部分隔线（不再出现两条 `─` 分隔线）
  - `Create file` 紧凑（无多余空行）
  - `Do you want to create …?` 位于预览下方，且不会被额外分隔线隔开
- [ ] 为 `Read`/`Bash` approval 补一条最小用例，保证重构不会破坏其它 prompt

## F. 扩展范围（后置）

- [ ] 将同一套 `ApprovalFrame + ApprovalPreview + MarkdownBlock` 扩展到：
  - `Edit` / `NotebookEdit`（如果需要预览 diff/内容）
  - `WebFetch` / `WebSearch`（如果要预览 URL/摘要）
  - `Skill`（如果要预览 skill 指令/说明）
