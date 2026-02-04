把两个 tool 的 presenter 迁移到 Tool UI Blocks（C-lite）路径：减少以后改通用 tool UI 时需要改一堆 presenter 的成本，同时也验证 blocks 路径能覆盖“有 approval / 有多行输出 / 有交互”的 tool。

目标迁移（只做这两个，不要碰别的 tool）：
- `bash`（approval + 多行输出）
- `askUserQuestion`（交互式 tool / questions UI）

背景（你可以直接用现有实现作为模板，不要重新发明架构）：
- Blocks presenter helper：`createToolBlocksPresenter` in `src/tools/presenters/types.ts`
- Blocks renderer：`src/components/tool/ToolUiBlocks.tsx`
- 现成 blocks presenter 样例（已迁移完成，可参考结构/测试写法）：`src/tools/modules/read/presenter.tsx` / `src/tools/modules/grep/presenter.tsx` / `src/tools/modules/glob/presenter.tsx` / `src/tools/modules/todoWrite/presenter.tsx`
- 现成 bridge 样例（blocks presenter 里返回 custom node，node 内可以用 hook）：`src/tools/presenters/FsReadApprovalToolBlock.tsx`
- 现有 bash/askUserQuestion presenter（当前还是 React presenter）：
  - `src/tools/modules/bash/presenter.tsx`
  - `src/tools/modules/askUserQuestion/presenter.tsx`

硬约束（必须遵守）：
- 禁止跑 `bun run test:coverage`（不要 coverage）。
- 只跑“你改动文件相关的测试”（最多几个 test 文件），不要全量跑。
- 不要做 UI 文案/颜色/间距 的“顺手优化”，除非迁移后为了保持现状一致不得不做。
- 不要升级依赖、不要大重构、不要顺手清理无关代码。
- 每个 commit 前必须跑：`codex review --uncommitted`（不要加 `2>&1` 或管道）。
- commit 尽量小：建议 bash 一次 commit，askUserQuestion 一次 commit。
- 质量约束（从 edit/write 迁移踩坑里总结的，必须遵守）：
  - **不允许**在实现/测试里使用 `(xxx as any)`、`as any`、`// @ts-ignore` 来“糊过去”
    - blocks presenter / 测试如果需要区分类型：用 `isToolBlocksPresenter(...)` 做 type guard
  - **避免 duplicate header**：ToolUiBlocks 负责统一渲染 header
    - 如果 blocks 里已经有 `{ kind: 'header', ... }`，custom node 里就不要再渲染 `ToolHeaderLine`
    - 反过来，如果整个 tool 用 custom node 自己渲染 header，那么 blocks 就不要再输出 header（两者只能选一种）
    - 迁移后请用测试锁住：plan/特殊分支只出现一次 header（例如 `Updated plan` 出现一次，且不出现 `Edit(` 这种旧 header）
  - blocks presenter 本体（`createToolBlocksPresenter(...)` 传入的函数）里不要调用 hook；需要 hook 的地方只能放到 custom node 组件里

实现要求（迁移后行为必须一致）：
1) **把 BashToolPresenter 改成 blocks presenter**
   - 将 `export const BashToolPresenter` 从 React presenter 改为 `createToolBlocksPresenter(({ message }) => ({ blocks: [...] }))`
    - 保持现有逻辑分支与文案/布局：
     - running + pending approval：沿用现有 approval UI（如果内部需要 hook，请用 custom node 组件包起来）
     - completed/error：沿用现有 stdout/stderr 展示结构（多行输出用 `lines` 或 custom node；不要改变用户看到的内容）
   - 关键点：
     - blocks presenter 里不要直接调用 hook；需要 hook 的地方请用 custom node 组件（参考 `FsReadApprovalToolBlock.tsx`）。
     - 不要改动 bash 的 policy/handler 行为（比如 `2>&1` 之类的策略、stdout/stderr 的 sanitize）——这次只做 “presenter 迁移”。

2) **把 AskUserQuestionToolPresenter 改成 blocks presenter**
   - 同样迁到 blocks presenter（`createToolBlocksPresenter`）。
   - 保持现有交互/文案/布局（questions 列表、选择、退出提示等）。
   - 同样：hook 只能在 custom node 组件里用（必要时新增一个小 bridge 组件文件，但只为这两个 tool 服务，不要扩 scope）。

3) 测试（先改/补测试钉住行为，再实现迁移）
   - 目标测试文件（优先复用现有；缺什么就补什么，但只补 bash/askUserQuestion 相关）：
     - `src/tools/modules/bash/presenter.test.tsx`
     - `src/tools/modules/askUserQuestion/presenter.test.tsx`
   - 测试重点（只锁行为，不写冗长断言）：
     - bash:
       - completed 时：header 不为 “Unknown tool”，且能看到输出内容至少一行
       - running pending 时：能看到 bash approval 的关键文案（与迁移前一致）
     - askUserQuestion:
       - running/pending 时：能看到问题 header/选项（与迁移前一致）
   - 测试里不要写 `(Presenter as any)`：用 `isToolBlocksPresenter` 分支拿 `blocks`（参考已迁移工具的测试写法）。

4) 执行步骤（建议）
   - Step A：只迁移 bash（含必要测试调整）→ 跑 targeted tests → `codex review --uncommitted` → commit
   - Step B：只迁移 askUserQuestion（含必要测试调整）→ 跑 targeted tests → `codex review --uncommitted` → commit

只跑 targeted tests（示例，按你实际改动调整）：
- `bun run test -- src/tools/modules/bash/presenter.test.tsx`
- `bun run test -- src/tools/modules/askUserQuestion/presenter.test.tsx`

Commit message 建议（按实际情况微调）：
- `refactor(tools): migrate bash to tool ui blocks`
- `refactor(tools): migrate askUserQuestion to tool ui blocks`

完成后汇报给我：
- 改了哪些文件
- 跑了哪些测试命令（只列你实际跑的）
- 两个 commit hash
- 你观察到的 tool transcript UI 是否有变化（如果有，贴关键片段）
