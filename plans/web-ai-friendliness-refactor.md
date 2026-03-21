# Web AI 友好性重构（执行版 TODOLIST）

> 目标：不改变产品语义和 UI 交互前提下，降低 AI 与人工协作修改成本。  
> 范围：`packages/web-reference-react/**`。  
> 备注：`codex.css` 视为本地外部参考文件，不作为仓内改造对象。

## 执行总则

- 每个切片只做一个主目标，避免 scope drift。
- 每个切片改动文件建议 2-6 个；超过 8 个必须拆分。
- 每个切片必须先有可验证的验收，再做代码重排。
- 每个切片执行前，先写清楚“本次只允许修改文件列表”。
- 任何行为不确定项先问需求，不猜测业务语义。
- 每个切片结束都执行：
  - `npm --prefix packages/web-reference-react run test -- src/App.test.tsx`
  - `npm --prefix packages/web-reference-react run test -- src/components/LeftRail.test.tsx`
  - `codex review --uncommitted -c model="gpt-5.3-codex" -c model_reasoning_effort="medium"`

## 现状基线（2026-03）

- `src/app/ui/AppShell.tsx`: 1222 行
- `src/components/TranscriptPane.tsx`: 1234 行
- `src/app/useAppRuntime.ts`: 662 行
- `src/App.test.tsx`: 4108 行
- 样式主文件：`src/styles.css`（仓内），`src/css/theme.css`（仓内）

## 任务看板（勾选）

- [x] WAF-00 建立包级 CODEMAP
- [x] WAF-01 建立重构任务索引
- [ ] WAF-10 提取 App 测试公共夹具
- [ ] WAF-11 拆分 App 集成测试（第一批）
- [ ] WAF-12 拆分 App 集成测试（第二批）
- [ ] WAF-20 提取 Header 组件
- [ ] WAF-21 提取桌面桥接 hook
- [ ] WAF-22 提取终端可见性与高度恢复 hook
- [ ] WAF-23 提取 panel drag 提交逻辑
- [ ] WAF-30 提取 TranscriptFeed
- [ ] WAF-31 提取 ComposerDock + Slash 菜单状态
- [ ] WAF-32 提取渲染窗口 hook
- [ ] WAF-40 样式按域拆分（不动视觉）
- [ ] WAF-D1 Context 化消除 props drilling（deferred）
- [ ] WAF-D2 runtime 目录大重排（deferred）

## Phase 0（低风险，先做）

### [x] WAF-00 建立包级 CODEMAP

- 允许修改：
  - `packages/web-reference-react/CODEMAP.md`（新建）
  - `packages/web-reference-react/README.md`（仅增加链接，最多 10-20 行）
- 步骤：
  1. 在 `CODEMAP.md` 写清目录职责、入口文件、关键数据流、常见改动入口。
  2. 在包 README 增加一行入口链接。
- 验收：
  - `rg -n "CODEMAP" packages/web-reference-react/README.md`
  - 人工检查：新增功能时可在 30 秒内定位目标目录。
- 完成标准：
  - 任何新对话可先读 `CODEMAP.md` 再开工，不必全局搜索猜入口。
- 最近一次执行：
  - 2026-03-22: 已完成。新增 `packages/web-reference-react/CODEMAP.md`，并在包 README 增加入口链接。

### [x] WAF-01 建立重构任务索引

- 允许修改：
  - `plans/web-ai-friendliness-refactor.md`
- 步骤：
  1. 把每个任务状态维护为 `todo/in_progress/done/blocked`。
  2. 每个任务记录最近一次执行日期和结果摘要。
- 验收：
  - 文档中每个任务都含状态与最近一次执行记录。
- 完成标准：
  - 后续执行可直接按任务 ID 继续，不需要重复梳理上下文。
- 最近一次执行：
  - 2026-03-22: 已完成。任务清单改为 checklist 形式，并维护 `todo/done/deferred` 可视状态。

## Phase 1（先拆测试，锁定行为）

### [ ] WAF-10 提取 App 测试公共夹具

- 允许修改：
  - `packages/web-reference-react/src/App.test.tsx`
  - `packages/web-reference-react/src/test/appTestHarness.tsx`（新建）
  - `packages/web-reference-react/src/test/appFixtures.ts`（新建，可选）
- 步骤：
  1. 抽出重复的 render/helper/mock 初始化。
  2. 保持现有测试命名和断言不变。
- 验收：
  - `npm --prefix packages/web-reference-react run test -- src/App.test.tsx`
- 完成标准：
  - `App.test.tsx` 可读性明显提升，重复模板减少。

### [ ] WAF-11 拆分 App 集成测试（第一批）

- 允许修改：
  - `src/App.test.tsx`
  - `src/__tests__/app-terminal.integration.test.tsx`（新建）
  - `src/__tests__/app-thread.integration.test.tsx`（新建）
  - `src/test/appTestHarness.tsx`
- 步骤：
  1. 迁移 terminal 与 thread 管理相关 describe 块。
  2. 保留原断言和数据，避免语义变更。
- 验收：
  - `npm --prefix packages/web-reference-react run test -- src/__tests__/app-terminal.integration.test.tsx`
  - `npm --prefix packages/web-reference-react run test -- src/__tests__/app-thread.integration.test.tsx`
  - `npm --prefix packages/web-reference-react run test -- src/App.test.tsx`
- 完成标准：
  - `App.test.tsx` 至少减少 25%-35% 行数。

### [ ] WAF-12 拆分 App 集成测试（第二批）

- 允许修改：
  - `src/App.test.tsx`
  - `src/__tests__/app-composer.integration.test.tsx`（新建）
  - `src/__tests__/app-approval.integration.test.tsx`（新建）
  - `src/__tests__/app-diff.integration.test.tsx`（新建）
- 步骤：
  1. 迁移 composer/approval/diff 相关测试块。
  2. 主文件保留 smoke 与跨域集成主链路。
- 验收：
  - 分别运行新增测试文件 + `src/App.test.tsx`
- 完成标准：
  - `App.test.tsx` 控制在 1000-1500 行内。

## Phase 2（拆 AppShell，收益最大）

### [ ] WAF-20 提取 Header 组件

- 允许修改：
  - `src/app/ui/AppShell.tsx`
  - `src/app/ui/AppShellHeader.tsx`（新建）
  - `src/app/ui/AppShellHeader.test.tsx`（新建，可选）
- 步骤：
  1. 把 header JSX 和纯展示逻辑提取到 `AppShellHeader`。
  2. 仅通过 props 传值，不变更交互语义。
- 验收：
  - `npm --prefix packages/web-reference-react run test -- src/App.test.tsx`
- 完成标准：
  - `AppShell.tsx` 首次降至 950 行以下。

### [ ] WAF-21 提取桌面桥接 hook

- 允许修改：
  - `src/app/ui/AppShell.tsx`
  - `src/app/ui/useDesktopBridge.ts`（新建）
  - `src/app/ui/useDesktopBridge.test.ts`（新建）
- 步骤：
  1. 抽出 desktop bridge 读取、appearance 同步、open targets 相关 effect。
  2. 保持原返回结构与调用路径稳定。
- 验收：
  - `npm --prefix packages/web-reference-react run test -- src/App.test.tsx`
  - `npm --prefix packages/web-reference-react run test -- src/app/ui/useDesktopBridge.test.ts`
- 完成标准：
  - `AppShell.tsx` 桌面桥接副作用显著减少。

### [ ] WAF-22 提取终端可见性与高度恢复 hook

- 允许修改：
  - `src/app/ui/AppShell.tsx`
  - `src/app/ui/useTerminalVisibility.ts`（新建）
  - `src/App.test.tsx` 或 `src/__tests__/app-terminal.integration.test.tsx`
- 步骤：
  1. 抽出终端 show/hide、thread 绑定、height 记忆逻辑。
  2. 保证“关闭再打开保持旧高度”行为不变。
- 验收：
  - terminal 相关测试全过。
- 完成标准：
  - 终端状态机逻辑从 `AppShell.tsx` 主体分离。

### [ ] WAF-23 提取 panel drag 提交逻辑

- 允许修改：
  - `src/app/ui/AppShell.tsx`
  - `src/app/ui/usePanelDragCommit.ts`（新建）
  - `src/app/ui/usePaneLayout.ts`（如需，仅适配）
- 步骤：
  1. 抽 sidebar/rightRail/terminal 拖拽提交函数和 refs。
  2. 保持拖拽交互与动画时序不变。
- 验收：
  - `npm --prefix packages/web-reference-react run test -- src/App.test.tsx`
- 完成标准：
  - `AppShell.tsx` 降至 700-800 行区间。

## Phase 3（拆 TranscriptPane）

### [ ] WAF-30 提取 TranscriptFeed

- 允许修改：
  - `src/components/TranscriptPane.tsx`
  - `src/components/transcript/TranscriptFeed.tsx`（新建）
  - `src/components/transcript/TranscriptFeed.test.tsx`（新建）
- 步骤：
  1. 抽 feed 列表、历史加载、错误展示的纯渲染层。
  2. 不改虚拟化/分页语义。
- 验收：
  - `npm --prefix packages/web-reference-react run test -- src/components/TranscriptPane.test.tsx`
- 完成标准：
  - `TranscriptPane.tsx` 明显缩短并变为容器角色。

### [ ] WAF-31 提取 ComposerDock + Slash 菜单状态

- 允许修改：
  - `src/components/TranscriptPane.tsx`
  - `src/components/composer/ComposerDock.tsx`（新建）
  - `src/components/composer/SlashCommandMenu.tsx`（新建）
  - `src/components/composer/useSlashCommandState.ts`（新建）
- 步骤：
  1. 把输入框和 slash 菜单交互从 TranscriptPane 拆出。
  2. 保持键盘交互（Enter/Esc/Up/Down）一致。
- 验收：
  - `npm --prefix packages/web-reference-react run test -- src/components/TranscriptPane.test.tsx`
- 完成标准：
  - 新命令扩展只需改 composer 子目录。

### [ ] WAF-32 提取渲染窗口 hook

- 允许修改：
  - `src/components/TranscriptPane.tsx`
  - `src/components/transcript/useRenderWindow.ts`（新建）
- 步骤：
  1. 抽出 render limit、history gap、滚动同步状态机。
  2. 保持现有回放与加载行为。
- 验收：
  - transcript 相关测试 + App 集成测试通过。
- 完成标准：
  - `TranscriptPane.tsx` 目标降至 500-700 行。

## Phase 4（样式组织优化，仓内文件为准）

### [ ] WAF-40 样式按域拆分（不动视觉）

- 允许修改：
  - `src/styles.css`
  - `src/css/index.css`（新建）
  - `src/css/layout.css`（新建）
  - `src/css/sidebar.css`（新建）
  - `src/css/transcript.css`（新建）
  - `src/main.tsx`（若需调整 import）
- 步骤：
  1. 先建立 `index.css` 统一导入顺序。
  2. 从 `styles.css` 迁移分段样式到子文件，保持选择器和变量不变。
  3. `theme.css` 保持原位置与职责不变。
- 验收：
  - `npm --prefix packages/web-reference-react run test -- src/App.test.tsx`
  - 人工 smoke：sidebar/transcript/terminal 视觉一致。
- 完成标准：
  - 样式修改可以按域定位，不再在单文件全局搜索。

## Deferred（当前不执行）

### [ ] WAF-D1 Context 化消除 props drilling（先做 spike）

- 原因：改动面大，容易引入渲染边界变化；待 Phase 1-3 完成后再评估。
- 只允许先做 1 个 spike 文档，不直接改生产链路。

### [ ] WAF-D2 runtime 目录大重排

- 原因：涉及路径迁移与依赖边界，回归成本高；需在行为稳定窗口执行。

## 切片模板（每次开工复制）

```md
### WAF-XX [todo|in_progress|done|blocked] 任务名
- 本次只允许修改：
  - <file-a>
  - <file-b>
- 实施步骤：
  1. ...
  2. ...
- 验收命令：
  - npm --prefix packages/web-reference-react run test -- <target-test>
  - codex review --uncommitted -c model="gpt-5.3-codex" -c model_reasoning_effort="medium"
- 最近一次执行：
  - YYYY-MM-DD: <结果>
```
