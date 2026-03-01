# 目标目录结构（Target Directory Structure）

> 设计原则：**域优先、层校验** — 按功能领域组织目录，通过 `layer-contract.config.json` 强制执行层依赖方向。不做扁平化 `src/[types|repo|service|...]` 大杂烩。

## 层级模型

```
Types ─→ Config ─→ Repo ─→ Service ─→ Runtime ─→ UI
```

## 执行状态（Phase A）

- 状态：进行中（本轮只做合同与门禁，不进行目录搬迁）。
- 本轮目标：
  - 落地 `check:layer-coverage`（映射覆盖率 100%）。
  - 落地 `check:shared-types`（shared types 共享门槛）。
  - 将以上两项接入 `type-check` 与 runbook。
- 明确不做：
  - 不移动 `src/` 目录结构。
  - 不改变业务行为或 UI 语义。

## 执行状态（Phase B - Slice 1）

- 状态：进行中（类型抽离 + presenter contract 解耦，仍不搬目录）。
- 本轮已完成：
  - 新增 `src/shared/toolPresenterContracts.ts`，承接 `ToolPresenter` / `ToolBlocksPresenter` / `createToolBlocksPresenter` / `isToolBlocksPresenter` 作为共享合同。
  - `src/tools/presenters/types.ts` 降级为兼容 re-export，避免一次性大爆炸改动。
  - `ToolRouter`、`ToolRegistry`、以及各 `src/tools/modules/*/presenter*.tsx` 的 contract 类型导入改为指向 shared 合同层，减少对 `src/tools/presenters/` 的直接耦合。
  - 新增 `src/shared/toolPresenterContracts.test.ts`，锁定 blocks presenter 标记与类型守卫行为。
- 明确不做：
  - 不迁移 `src/tools/presenters/*` 到 `src/components/tool/*`。
  - 不改任何 tool UI 文案、交互逻辑、审批流语义。

## 执行状态（Phase B - Slice 2）

- 状态：进行中（继续类型抽离，不搬目录）。
- 本轮已完成：
  - 新增 `src/shared/approvalPromptContracts.ts`，统一承接 `ConfirmMenuOption` / `ConfirmMenuDecision` 与各类 `*ApprovalDecision`。
  - `src/tools/presenters/ConfirmMenu.tsx` 与 `src/components/ui/ConfirmMenu.tsx` 改为消费 shared 合同，并保留类型 re-export 兼容入口。
  - `bash/edit/fsRead/fsWrite/skill` 五个 approval prompt 统一改为 shared decision 类型输入，并保留原文件 `export type` 兼容。
  - 新增 `src/shared/approvalPromptContracts.test.ts`，锁定关键 union 合同。
- 明确不做：
  - 不修改审批菜单交互逻辑（键位、提交、取消、反馈）与文案。
  - 不移动任何目录或组件位置。

## 执行状态（Phase B - Slice 3）

- 状态：进行中（细化类型统一，不搬目录）。
- 本轮已完成：
  - `src/components/tool/ToolHeaderLine.tsx` 删除本地 `ToolHeaderStatus` 重复定义，改为复用并 re-export `src/shared/toolMessageTypes` 的同名类型。
  - `src/components/tool/ToolSubline.tsx` 删除本地 `ToolSublineStatus` 重复定义，改为复用并 re-export `src/shared/toolMessageTypes` 的同名类型。
- 明确不做：
  - 不调整 header/subline 的渲染逻辑、文案、缩进与配色。

## 执行状态（Phase B - Slice 4）

- 状态：进行中（继续抽离 interactive prompt 类型合同，不搬目录）。
- 本轮已完成：
  - 新增 `src/shared/interactivePromptContracts.ts`，集中定义 ask/plan-mode 交互提示的类型合同。
  - `askQuestions.ts`、`interactivePrompts.ts`、`planModeQuestions.ts` 改为消费 shared 合同并保留 type re-export，保持现有导入兼容。
  - 新增 `src/shared/interactivePromptContracts.test.ts`，锁定核心 union/结构类型。
- 明确不做：
  - 不修改任何问题文案、fallback 文案与 prompt 解析逻辑。
  - 不移动目录结构。

## 执行状态（Phase B - Slice 5）

- 状态：进行中（单实现收敛，不搬目录）。
- 本轮已完成：
  - `src/tools/presenters/ApprovalHeader.tsx` 改为转发 `src/components/ui/ApprovalHeader`。
  - `src/tools/presenters/MarkdownBlock.tsx` 改为转发 `src/components/ui/MarkdownBlock`（含 `parseMarkdown` / `renderInline`）。
  - 保留原导入路径，避免调用方改动。
- 明确不做：
  - 不改变 ApprovalHeader / MarkdownBlock 的渲染行为。
  - 不处理 ConfirmMenu 双实现（留到后续独立切片）。

## 执行状态（Phase B - Slice 6）

- 状态：进行中（继续单实现收敛，不搬目录）。
- 本轮已完成：
  - `src/tools/presenters/ConfirmMenu.tsx` 改为转发 `src/components/ui/ConfirmMenu`，并由 shared 合同导出类型。
  - 保留原 `src/tools/presenters/ConfirmMenu` 导入入口，避免调用方改动。
- 明确不做：
  - 不改 ConfirmMenu 任何键盘交互/焦点/提交语义。

## 执行状态（Phase B - Slice 7）

- 状态：进行中（fallback presenter 解耦，不搬目录）。
- 本轮已完成：
  - 新增 `src/components/tool/FallbackToolPresenter.tsx` 承接 fallback presenter 实现。
  - `src/tools/presenters/fallback.tsx` 降级为兼容 re-export。
  - `src/components/tool/ToolRouter.tsx` 不再依赖 `src/tools/presenters/fallback`，改为依赖本层组件实现。
- 明确不做：
  - 不修改 fallback 的展示逻辑、surface suffix 规则和错误详情渲染规则。

## 执行状态（Phase B - Slice 8）

- 状态：进行中（todo 类型合同统一，不搬目录）。
- 本轮已完成：
  - 新增 `src/shared/todoContracts.ts`，统一 `TodoStatus` / `TodoItem` / `TODO_STATUSES`。
  - `src/tools/modules/todoWrite/handler.ts` 与 `src/tools/runtime/todosFile.ts` 改为消费 shared todo 合同。
  - 保留 `todoWrite/handler.ts` 与 `todosFile.ts` 的类型导出兼容入口，避免调用方改动。
  - 新增 `src/shared/todoContracts.test.ts`。
- 明确不做：
  - 不修改 TodoWrite 业务校验、文件路径与写入行为。

## 执行状态（Phase B - Slice 9）

- 状态：进行中（继续去除 todoWrite 内部类型耦合，不搬目录）。
- 本轮已完成：
  - `src/tools/modules/todoWrite/presenter.tsx` 不再从 `./handler` 获取 `TodoItem`，改为直接使用 `src/shared/todoContracts`。
- 明确不做：
  - 不修改 todo 列表展示逻辑或状态文案。

## 执行状态（Phase C - Slice 1）

- 状态：进行中（目录迁移第一批，低风险）。
- 本轮已完成：
  - `src/skills/SkillStore.ts` 与 `src/skills/SkillStore.test.ts` 迁移到 `src/features/skills/`。
  - `src/tools/modules/skill/handler.ts` 与 `src/tools/modules/skill/index.ts` 改为引用 `src/features/skills/SkillStore`。
  - 在 `src/skills/SkillStore.ts` 保留兼容 re-export，降低一次性迁移风险。
  - `layer-contract.config.json` 增补 `src/features/skills` 的 Repo 层映射。
- 明确不做：
  - 不改 SkillStore 的扫描逻辑、缓存语义和 skill 工具行为。

## 执行状态（Phase C - Slice 2）

- 状态：进行中（目录迁移第一批，低风险）。
- 本轮已完成：
  - `src/commands/CommandStore.ts` 与 `src/commands/CommandStore.test.ts` 迁移到 `src/features/commands/`。
  - `src/commands/render.ts` 与 `src/commands/render.test.ts` 迁移到 `src/features/commands/`。
  - `src/features/commands/registry.ts` 与 `src/tools/modules/slashCommand/*` 改为引用 `src/features/commands/{CommandStore,render}`。
  - 在 `src/commands/CommandStore.ts` 与 `src/commands/render.ts` 保留兼容 re-export，降低一次性迁移风险。
  - `layer-contract.config.json` 增补 `src/features/commands/CommandStore.ts` 的 Repo 层映射。
- 明确不做：
  - 不改 slash command 的解析、派发与输出语义。
  - 不改 CommandStore 的扫描逻辑与命令覆盖优先级。

## 执行状态（Phase C - Slice 3）

- 状态：进行中（目录迁移第一批，低风险）。
- 本轮已完成：
  - `src/services/models.ts` 与 `src/services/models.test.ts` 迁移到 `src/core/models/`。
  - `src/services/modelContextCatalog.ts` 与 `src/services/modelContextCatalog.test.ts` 迁移到 `src/core/models/`。
  - 在 `src/services/models.ts` 与 `src/services/modelContextCatalog.ts` 保留兼容 re-export，避免一次性迁移上层调用方。
  - `layer-contract.config.json` 增补 `src/core/models/{models,modelContextCatalog}.ts` 的 Repo 层映射（过渡期）。
- 明确不做：
  - 不改模型拉取逻辑、catalog 缓存策略、错误映射与超时行为。
  - 不改 `adapters/setup/connectionTest` 的调用路径与用户可见输出。

## 执行状态（Phase C - Slice 4）

- 状态：进行中（目录迁移第一批，低风险）。
- 本轮已完成：
  - `src/invokables/{types.ts,charBudget.ts,charBudget.test.ts}` 迁移到 `src/shared/invokables/`。
  - `src/tools/modules/skill/{handler.ts,index.ts}` 改为引用 `src/shared/invokables/charBudget`。
  - 在 `src/invokables/{types.ts,charBudget.ts}` 保留兼容 re-export，确保旧导入路径仍可用。
- 明确不做：
  - 不改 `truncateByCharBudget` 行为和截断语义。
  - 不改 skill 工具的输出格式与命令拼接策略。

## 执行状态（Phase C - Slice 5）

- 状态：进行中（目录迁移第一批，低风险）。
- 本轮已完成：
  - `src/utils/catN.ts` 与 `src/utils/catN.test.ts` 迁移到 `src/shared/utils/`。
  - `edit` 工具与 `patchStartLineNumber` 改为引用 `src/shared/utils/catN`。
  - 在 `src/utils/catN.ts` 保留兼容 re-export，避免旧导入路径一次性失效。
- 明确不做：
  - 不改 `stripCatNPrefixes` 的解析规则与正则语义。
  - 不改 edit/patch 的业务流程与输出文案。

## 执行状态（Phase C - Slice 6）

- 状态：进行中（目录迁移第一批，低风险）。
- 本轮已完成：
  - `src/utils/paths.ts` 与 `src/utils/paths.test.ts` 迁移到 `src/shared/utils/`。
  - `tools/modules/{read,write,edit,notebookEdit}`、`tools/executor/*`、`adapters/permissions/permissionKeys.ts` 改为引用 `src/shared/utils/paths`。
  - `src/tools/utils/paths.ts` 改为桥接到 `src/shared/utils/paths`。
  - 在 `src/utils/paths.ts` 保留兼容 re-export，保证旧导入路径可用。
- 明确不做：
  - 不改绝对路径校验、路径归一化与显示格式语义。
  - 不改任意工具模块的业务逻辑与权限策略。

## 执行状态（Phase C - Slice 7）

- 状态：进行中（目录迁移第一批，低风险）。
- 本轮已完成：
  - `src/utils/planMode.ts` 与 `src/utils/planMode.test.ts` 迁移到 `src/shared/utils/`。
  - `tools/modules/{edit,write,exitPlanMode}`、`tools/executor/policyPreflight.ts`、`features/semantics/core/modeSemantics.ts` 改为引用 `src/shared/utils/planMode`。
  - 在 `src/utils/planMode.ts` 保留兼容 re-export，保证旧导入路径仍可用。
- 明确不做：
  - 不改 plan mode reminder 文案、拼接规则与路径显示语义。
  - 不改编辑权限约束（plan mode 限制）和执行流程。

## 执行状态（Phase C - Slice 8）

- 状态：进行中（目录迁移第一批，低风险）。
- 本轮已完成：
  - `src/utils/toolUi.ts` 迁移到 `src/shared/utils/toolUi.ts`。
  - `src/utils/toolErrorUi.ts` 与 `src/utils/toolErrorUi.test.ts` 迁移到 `src/shared/utils/`。
  - `components/tool/*` 与 `tools/modules/{bash,glob,grep,read,write}/presenter.tsx`、`tools/presenters/ToolUiPrimitives.tsx` 改为引用 `src/shared/utils/{toolUi,toolErrorUi}`。
  - 在 `src/utils/toolUi.ts` 与 `src/utils/toolErrorUi.ts` 保留兼容 re-export。
- 明确不做：
  - 不改 tool subline 缩进、前缀符号与渲染样式。
  - 不改 compact error detail 的过滤规则与文案策略。

## 执行状态（Phase C - Slice 9）

- 状态：进行中（目录迁移第一批，低风险）。
- 本轮已完成：
  - `src/utils/terminal.ts`、`src/utils/terminal.test.ts`、`src/utils/terminal.ansiAudit.test.ts` 迁移到 `src/shared/utils/`。
  - `entrypoints/*`、`legacy/runLegacyCli.tsx`、`screens/perf/TranscriptPerfScreen.tsx`、`features/commands/registry.ts` 改为引用 `src/shared/utils/terminal`。
  - `TranscriptPerfScreen` 与 `runLegacyCli` 对应测试的 `vi.mock` 路径同步到新位置。
  - ANSI audit 白名单路径更新为 `src/shared/utils/terminal.ts`。
  - 在 `src/utils/terminal.ts` 保留兼容 re-export。
- 明确不做：
  - 不改终端清屏时机、TTY 检测和 ANSI 样式定义。
  - 不改命令 registry 的输出语义与文案。

## 执行状态（Phase C - Slice 10）

- 状态：进行中（目录迁移第一批，低风险）。
- 本轮已完成：
  - `src/utils/inkStreams.ts` 与 `src/utils/inkStreams.test.ts` 迁移到 `src/shared/utils/`。
  - `services/runtimeUiBridge.tsx` 与 `legacy/runLegacyCli.tsx` 改为引用 `src/shared/utils/inkStreams`。
  - `runtimeUiBridge` 与 `runLegacyCli` 对应测试里的 `vi.mock` 路径同步到新位置。
  - 在 `src/utils/inkStreams.ts` 保留兼容 re-export。
- 明确不做：
  - 不改 Ink stdout 安全代理逻辑与默认行列回退策略。
  - 不改 static output reset 行为与异常吞掉策略。

## 执行状态（Phase C - Slice 11）

- 状态：进行中（目录迁移第一批，低风险）。
- 本轮已完成：
  - `src/utils/consoleLogger.ts` 与 `src/utils/consoleLogger.test.ts` 迁移到 `src/shared/utils/`。
  - `subagents/registry.ts` 改为引用 `src/shared/utils/consoleLogger`。
  - 在 `src/utils/consoleLogger.ts` 保留兼容 re-export。
- 明确不做：
  - 不改 console logger 的 WebSocket 服务、HTML 输出和序列化逻辑。
  - 不改 subagent 运行时日志的触发时机与日志内容。

## 执行状态（Phase C - Slice 12）

- 状态：进行中（目录迁移第一批，低风险）。
- 本轮已完成：
  - `src/utils/toolFormatting.ts` 与 `src/utils/toolFormatting.test.ts` 迁移到 `src/shared/utils/`。
  - `tools/modules/*/presenter.tsx`、`tools/executor/handlers/taskSubAgent.ts`、`features/repl/*`、`features/tools/presentation/*`、`features/semantics/selectors/*` 改为引用 `src/shared/utils/toolFormatting`。
  - 相关 `presenter.branches.test.tsx` 的 `vi.doMock`/`vi.importActual` 路径同步到新位置。
  - 在 `src/utils/toolFormatting.ts` 保留兼容 re-export。
- 明确不做：
  - 不改 tool call/result 格式化规则、计数规则与摘要文案。
  - 不改 task/tool message 映射语义。

## 执行状态（Phase C - Slice 13）

- 状态：进行中（目录迁移第一批，低风险）。
- 本轮已完成：
  - `src/utils/config.ts` 迁移到 `src/shared/utils/config.ts`。
  - 在 `src/utils/config.ts` 保留兼容 re-export。
- 明确不做：
  - 不改任何运行时配置加载逻辑（`src/env/config.ts` / `src/core/config/*`）。
  - 不改默认配置字段和值语义。

## 执行状态（Phase C - Slice 14）

- 状态：进行中（目录迁移第一批，低风险）。
- 本轮已完成：
  - `src/utils/theme.ts` 迁移到 `src/shared/utils/theme.ts`。
  - 在 `src/utils/theme.ts` 保留兼容 re-export。
- 明确不做：
  - 不改任何主题色值、主题字段和 `getTheme()` 返回语义。
  - 暂不改现有调用方导入路径（保持兼容入口以降低改动面）。

## 执行状态（Phase C - Slice 15）

- 状态：进行中（目录迁移第一批，低风险）。
- 本轮已完成：
  - `src/tools/**` 下所有 `utils/theme` 依赖切换为 `shared/utils/theme`（含 presenter 与相关测试 mock）。
- 明确不做：
  - 不改任意 presenter 的渲染逻辑、文案、样式规则。
  - 不改主题定义和颜色值，仅做导入路径收敛。

## 执行状态（Phase C - Slice 16）

- 状态：进行中（目录迁移第一批，低风险）。
- 本轮已完成：
  - `src/components/**`、`src/screens/**`、`src/ui/**` 下剩余 `utils/theme` 依赖切换为 `shared/utils/theme`（含相关测试 mock 与类型导入）。
- 明确不做：
  - 不改 UI 文案、布局、交互和样式行为。
  - 不改主题定义，仅做导入路径收敛。

## 执行状态（Phase C - Slice 17）

- 状态：进行中（目录迁移第一批，低风险）。
- 本轮已完成：
  - `src/adapters/setup/connectionTest.ts` 与对应测试对 `services/{models,modelContextCatalog}` 的导入切换为 `core/models/*`。
  - `connectionTest.test.ts` 的 `vi.mock` 目标路径同步到 `core/models/*`。
- 明确不做：
  - 不改连接测试逻辑、错误映射与模型 context 推断语义。
  - 不删除 `src/services/{models,modelContextCatalog}` 兼容 re-export 文件。

## 执行状态（Phase C - Slice 18）

- 状态：进行中（目录迁移第一批，低风险）。
- 本轮已完成：
  - `scripts/check-no-ansi.mjs` 的白名单与失败提示从 `src/utils/terminal.ts` 切换为 `src/shared/utils/terminal.ts`。
  - `scripts/surface-screen-model-smoke.tsx` 对 `inkStreams` 的导入切换为 `src/shared/utils/inkStreams.ts`。
  - `scripts/check-coverage-thresholds.mjs` 对 `planMode` 的覆盖率目标切换为 `src/shared/utils/planMode.ts`。
  - `CODEMAP.md` 与 `pitfalls.md` 中对应索引路径收敛到 canonical 位置（`shared/utils`、`features/commands`）。
- 明确不做：
  - 不改任何运行时行为、工具逻辑或 UI 交互。
  - 不删除旧 shim 文件，仅做索引与脚本路径收敛。

## 执行状态（Phase C - Slice 19）

- 状态：进行中（目录迁移第一批，低风险）。
- 本轮已完成：
  - 删除 `src/services/models.ts` 与 `src/services/modelContextCatalog.ts` 两个已无调用方的兼容 re-export shim。
  - `scripts/layer-contract.config.json` 移除上述两个过渡 Repo 映射条目，仅保留 `src/core/models/*` canonical 映射。
- 明确不做：
  - 不改 `src/core/models/*` 的实现逻辑、错误映射或网络请求行为。
  - 不改 `runtimeUiBridge` 等仍位于 `src/services/` 的模块职责。

## 执行状态（Phase C - Slice 20）

- 状态：进行中（目录迁移第一批，低风险）。
- 本轮已完成：
  - 删除 `src/commands/CommandStore.ts`、`src/commands/render.ts` 与 `src/skills/SkillStore.ts` 三个已无调用方的兼容 re-export shim。
  - `scripts/layer-contract.config.json` 移除上述三项过渡映射条目，仅保留 `src/features/{commands,skills}` canonical 映射。
- 明确不做：
  - 不改 custom commands 的扫描/渲染语义。
  - 不改 skill store 的扫描、缓存与加载行为。

## 执行状态（Phase C - Slice 21）

- 状态：进行中（目录迁移第一批，低风险）。
- 本轮已完成：
  - 删除 `src/utils/*` 下 11 个 legacy re-export shim 文件（已全量切换到 `src/shared/utils/*`）。
  - 删除 `src/invokables/{types.ts,charBudget.ts}` 两个 legacy re-export shim 文件（已切换到 `src/shared/invokables/*`）。
  - `scripts/layer-contract.config.json` 的 Types 映射移除 `src/utils` 与 `src/invokables` 过渡条目，仅保留 `src/shared` 作为 canonical 类型/纯工具入口。
- 明确不做：
  - 不改任何 shared utils/shared invokables 的实现逻辑与对外函数语义。
  - 不改工具执行流程、UI 渲染逻辑或命令行为。

## 执行状态（Phase C - Slice 22）

- 状态：进行中（目录迁移第一批，低风险）。
- 本轮已完成：
  - `src/tools/presenters/*ApprovalPrompt.tsx` 中对 `./ConfirmMenu` 与 `./ApprovalHeader` 的依赖切换为直接引用 `src/components/ui/{ConfirmMenu,ApprovalHeader}`。
  - 生产路径不再依赖这两个 wrapper 文件，降低 `tools/presenters` 与 UI 组件之间的中间层耦合。
- 明确不做：
  - 不改审批提示文案、键盘交互与 decision 映射语义。
  - 不删除现有 wrapper 文件（留待后续切片处理测试收敛）。

## 执行状态（Phase C - Slice 23）

- 状态：进行中（目录迁移第一批，低风险）。
- 本轮已完成：
  - `src/tools/modules/{webFetch,notebookEdit,task,exitPlanMode,skill,enterPlanMode,webSearch}/presenter.tsx` 中对 `../../presenters/fallback` 的依赖切换为直接引用 `src/components/tool/FallbackToolPresenter`。
  - `src/tools/modules/skill/presenter.interactions.test.tsx` 的 mock 目标同步到新路径。
- 明确不做：
  - 不改 fallback 渲染逻辑、surface suffix 规则和 tool summary 文案。
  - 不删除 `src/tools/presenters/fallback.tsx` wrapper（留待后续切片统一收口）。

## 执行状态（Phase C - Slice 24）

- 状态：进行中（目录迁移第一批，低风险）。
- 本轮已完成：
  - 删除 `src/tools/presenters/fallback.tsx`（已无生产调用方）。
  - `src/tools/presenters/fallback.test.tsx` 改为直接验证 `src/components/tool/FallbackToolPresenter`。
- 明确不做：
  - 不改 fallback 的渲染实现与行为，只移除中转 wrapper。
  - 不调整工具模块的 UI 展示文案和状态映射逻辑。

## 执行状态（Phase C - Slice 25）

- 状态：进行中（目录迁移第一批，低风险）。
- 本轮已完成：
  - 删除 `src/tools/presenters/{ApprovalHeader,ConfirmMenu,MarkdownBlock}.tsx` 三个已无生产调用方的 wrapper。
  - `src/tools/presenters/*` 与 `src/components/ui/*` 相关测试改为直接引用 `src/components/ui/*`。
  - 移除仅用于 wrapper 对齐的冗余基线断言，保留功能与交互断言。
  - `scripts/check-duplicate-presenters-parity.mjs` 清空已下线 wrapper 的对照项，消除已知结构下的长期假告警。
- 明确不做：
  - 不改 ConfirmMenu/ApprovalHeader/MarkdownBlock 的实现逻辑与交互语义。
  - 不改审批流程 decision 映射和 UI 文案。

## 执行状态（Phase C - Slice 26）

- 状态：进行中（目录迁移第一批，低风险）。
- 本轮已完成：
  - `CLAUDE.md` 的 Supporting Modules 索引从 `src/utils/` 同步为 `src/shared/utils/`，与当前目录事实一致。
- 明确不做：
  - 不改任何运行时逻辑与测试行为，仅修正文档索引路径。

## 执行状态（Phase C - Slice 27）

- 状态：进行中（目录迁移第一批，低风险）。
- 本轮已完成：
  - 删除 `src/tools/presenters/types.ts`（已无代码调用方，shared 合同已是唯一实现）。
  - `CODEMAP.md`、`CLAUDE.md`、`plans/ui/formax-tool-ui-migration-test-prompt.md` 中的 blocks presenter helper 索引统一切换到 `src/shared/toolPresenterContracts.ts`。
- 明确不做：
  - 不改 presenter contract 类型定义与运行时行为，仅删除中转 shim 并修正文档索引。

## 执行状态（Phase C - Slice 28）

- 状态：进行中（目录迁移第一批，低风险）。
- 本轮已完成：
  - `plans/ui/BACKLOG-approval-preview.md` 中 Approval 相关组件索引改为当前事实路径（`components/ui/ApprovalHeader`、`components/ui/MarkdownBlock`、`tools/presenters/ApprovalPreview`）。
- 明确不做：
  - 不改 Approval UI 任何实现，仅修正 backlog 文档路径。

## 执行状态（Phase C - Slice 29）

- 状态：进行中（目录迁移第一批，低风险）。
- 本轮已完成：
  - `ApprovalPreview` 实现迁移到 `src/components/tool/ApprovalPreview.tsx`。
  - `src/tools/modules/write/WriteApprovalToolBlock.tsx` 与对应测试改为直接依赖 `components/tool/ApprovalPreview`。
  - `src/tools/presenters/ApprovalPreview.tsx` 降级为兼容 re-export，避免一次性影响剩余调用方/测试。
- 明确不做：
  - 不改 preview 样式、文案与 remaining lines 展示语义。
  - 不触发 `PatchApprovalPreview`/`PatchPreview` 的迁移（留后续切片）。

## 执行状态（Phase C - Slice 30）

- 状态：进行中（目录迁移第一批，低风险）。
- 本轮已完成：
  - `PatchPreview` 实现迁移到 `src/components/tool/PatchPreview.tsx`。
  - `src/tools/modules/edit/presenter.tsx` 与 `src/tools/presenters/PatchApprovalPreview.tsx` 改为直接依赖 `components/tool/PatchPreview`。
  - `src/tools/presenters/PatchPreview.tsx` 降级为兼容 re-export，避免一次性影响既有测试入口。
- 明确不做：
  - 不改 patch diff 计算、行号渲染与高亮规则语义。
  - 不调整 edit tool 的文案和审批行为。

## 执行状态（Phase C - Slice 31）

- 状态：进行中（目录迁移第一批，低风险）。
- 本轮已完成：
  - `PatchApprovalPreview` 实现迁移到 `src/components/tool/PatchApprovalPreview.tsx`。
  - `src/tools/modules/edit/EditApprovalToolBlock.tsx` 与对应测试改为直接依赖 `components/tool/PatchApprovalPreview`。
  - `src/tools/presenters/PatchApprovalPreview.tsx` 降级为兼容 re-export，降低迁移风险。
- 明确不做：
  - 不改 patch approval 视觉样式与行号计算语义。
  - 暂不迁移 `useSnippetStartLineNumber`（当前通过兼容路径复用）。

## 执行状态（Phase C - Slice 32）

- 状态：进行中（目录迁移第一批，低风险）。
- 本轮已完成：
  - `snippetStartLine.ts` 与 `useSnippetStartLineNumber.ts` 实现迁移到 `src/components/tool/`。
  - `src/components/tool/PatchApprovalPreview.tsx` 改为直接依赖同层 hook/util，不再反向依赖 `tools/presenters`。
  - `src/tools/presenters/{snippetStartLine,useSnippetStartLineNumber}.ts` 降级为兼容 re-export，保证现有测试入口稳定。
- 明确不做：
  - 不改 snippet 匹配算法与行号推断行为。
  - 不改 patch approval UI 渲染逻辑。

## 执行状态（Phase C - Slice 33）

- 状态：进行中（目录迁移第一批，低风险）。
- 本轮已完成：
  - `src/features/repl/controller/streaming/patchStartLineNumber.ts` 改为直接依赖 `src/components/tool/snippetStartLine.ts`，移除对 `tools/presenters` 的反向耦合。
  - `src/features/repl/controller/streaming/patchStartLineNumber.test.ts` 的 spy 目标同步到新路径。
  - 删除 `src/tools/presenters/snippetStartLine.ts` 兼容 shim；相关单测改为直接验证 `components/tool` 实现。
- 明确不做：
  - 不改 `computeEditPatchStartLineNumber` 的匹配策略与 fallback 顺序。
  - 不改 patch preview/approval 的 UI 渲染逻辑。

## 执行状态（Phase C - Slice 34）

- 状态：进行中（目录迁移第一批，低风险）。
- 本轮已完成：
  - 删除 `src/tools/presenters/useSnippetStartLineNumber.ts` 兼容 shim（已无生产调用方）。
  - `src/tools/presenters/useSnippetStartLineNumber.test.tsx` 改为直接验证 `src/components/tool/useSnippetStartLineNumber.ts`。
- 明确不做：
  - 不改 hook 的异步读文件时序和错误兜底行为。
  - 不改 patch approval 的起始行推断语义。

## 执行状态（Phase C - Slice 35）

- 状态：进行中（目录迁移第一批，低风险）。
- 本轮已完成：
  - 删除 `src/tools/presenters/ApprovalPreview.tsx` 兼容 shim（已无生产调用方）。
  - `src/tools/presenters/ApprovalPreview.test.tsx` 改为直接验证 `src/components/tool/ApprovalPreview.tsx`。
  - `plans/ui/BACKLOG-approval-preview.md` 的现状索引同步到组件层真实路径。
- 明确不做：
  - 不改 Approval preview 的布局、文案与 remaining lines 计算规则。
  - 不改 approval 流程和交互语义。

## 执行状态（Phase C - Slice 36）

- 状态：进行中（目录迁移第一批，低风险）。
- 本轮已完成：
  - 删除 `src/tools/presenters/PatchPreview.tsx` 兼容 shim（已无生产调用方）。
  - `src/tools/presenters/PatchPreview.test.tsx` 改为直接验证 `src/components/tool/PatchPreview.tsx`。
- 明确不做：
  - 不改 patch diff 算法、行号显示策略与截断规则。
  - 不改 edit 审批流的 UI 文案与交互语义。

## 执行状态（Phase C - Slice 37）

- 状态：进行中（目录迁移第一批，低风险）。
- 本轮已完成：
  - 删除 `src/tools/presenters/PatchApprovalPreview.tsx` 兼容 shim（已无生产调用方）。
  - `src/tools/presenters/PatchApprovalPreview.test.tsx` 改为直接验证 `src/components/tool/PatchApprovalPreview.tsx`。
- 明确不做：
  - 不改 patch approval 的路径解析、宽度回退与 snippet 行号推断逻辑。
  - 不改 edit 审批流程的 UI 文案与交互语义。

## 执行状态（Phase C - Slice 38）

- 状态：进行中（目录迁移第一批，低风险）。
- 本轮已完成：
  - `ToolUiPrimitives` 实现迁移到 `src/components/tool/ToolUiPrimitives.tsx`。
  - `src/tools/presenters/ToolUiPrimitives.tsx` 降级为兼容 re-export，保证现有调用方与 mock 路径稳定。
- 明确不做：
  - 不改 Tool header/subline/indent 的视觉渲染与 pulse 行为。
  - 不改 `ToolUiBlocks` 的 block 渲染顺序和语义。

## 执行状态（Phase C - Slice 39）

- 状态：进行中（目录迁移第一批，低风险）。
- 本轮已完成：
  - `LocalBashPresenter` 实现迁移到 `src/components/tool/LocalBashPresenter.tsx`。
  - `src/tools/presenters/LocalBashPresenter.tsx` 降级为兼容 re-export，避免一次性改动全部调用方。
  - `src/legacy/bootstrap/tooling.ts` 与对应测试改为直接依赖 `components/tool/LocalBashPresenter`。
- 明确不做：
  - 不改 LocalBash 输出截断规则、状态渲染和 expanded 语义。
  - 不改 tooling 注册顺序与 runtime 初始化行为。

## 执行状态（Phase C - Slice 40）

- 状态：进行中（目录迁移第一批，低风险，批量路径收敛）。
- 本轮已完成：
  - 下列实现迁移到 `src/components/tool/`：`AskUserQuestionToolBlock`、`BashApprovalToolBlock`、`FsReadApprovalToolBlock`、`bashApprovalPrompt`、`editApprovalPrompt`、`fsReadApprovalPrompt`、`fsWriteApprovalPrompt`、`skillApprovalPrompt`。
  - `src/tools/presenters/` 同名文件降级为兼容 re-export，避免一次性修改全部测试入口。
  - `src/tools/modules/*` 中对以上 presenter 的生产导入与测试 mock 路径统一切到 `components/tool/*`。
  - 文档索引（`CODEMAP.md`、`docs/inventories/interactive-input-inventory.md`、`plans/ui/formax-tool-ui-migration-test-prompt.md`）同步到新事实路径。
- 明确不做：
  - 不改 approval/ask 交互语义与 payload 映射。
  - 不改 ConfirmMenu/ApprovalHeader 视觉与键盘交互规则。

## 执行状态（Phase C - Slice 41）

- 状态：进行中（目录迁移第一批，低风险，批量 shim 清理）。
- 本轮已完成：
  - 删除 `src/tools/presenters/` 下以下兼容 shim：`AskUserQuestionToolBlock`、`BashApprovalToolBlock`、`FsReadApprovalToolBlock`、`bashApprovalPrompt`、`editApprovalPrompt`、`fsReadApprovalPrompt`、`fsWriteApprovalPrompt`、`skillApprovalPrompt`。
  - 对应 `src/tools/presenters/*.test.tsx` 全部改为直接引用 `src/components/tool/*`。
  - `docs/contracts/interactive-input-contract.md` 的 AskUserQuestion 关联路径更新到组件层事实路径。
- 明确不做：
  - 不改 approval/ask 交互行为、键位语义、decision payload。
  - 不改测试断言语义，仅更新导入目标与兼容层收口。

## 执行状态（Phase C - Slice 42）

- 状态：进行中（目录迁移第一批，低风险，剩余 shim 清理）。
- 本轮已完成：
  - 删除 `src/tools/presenters/LocalBashPresenter.tsx` 与 `src/tools/presenters/ToolUiPrimitives.tsx` 兼容 shim。
  - `src/tools/modules/*` 中对 `ToolUiPrimitives` 的导入与相关测试 mock 路径统一切到 `src/components/tool/ToolUiPrimitives`。
  - `src/tools/presenters/{LocalBashPresenter,ToolUiPrimitives}.test.tsx` 改为直接验证 `src/components/tool/*` 实现。
- 明确不做：
  - 不改 LocalBash 呈现逻辑（输出截断、expanded、error 状态）。
  - 不改 ToolUiPrimitives 的渲染与 pulse 行为。

## 执行状态（Phase C - Slice 43）

- 状态：进行中（目录迁移第一批，低风险，测试目录收口）。
- 本轮已完成：
  - 将 `src/tools/presenters` 下剩余测试批量迁移到对应所有者目录：
    - tool 相关测试迁移至 `src/components/tool/*`
    - ui 兼容测试迁移至 `src/components/ui/*presenter-compat.test.tsx`
  - `src/tools/presenters` 目录内测试清空（目录层面完成收口）。
  - `docs/contracts/interactive-input-contract.md` 的 approval prompt 测试路径同步更新至 `src/components/tool/*approvalPrompt.test.tsx`。
- 明确不做：
  - 不改任何生产实现，仅做测试文件归位与导入路径修正。
  - 不删减既有断言语义，只修复迁移带来的路径/时序稳定性问题。

## 执行状态（Phase C - Slice 44）

- 状态：进行中（目录迁移第一批，低风险，文档与尾差清理）。
- 本轮已完成：
  - 删除空目录 `src/tools/presenters/`（代码与测试已全部归位到 `components` 层）。
  - `CLAUDE.md` Tool System 索引从 `src/tools/presenters/` 更新为 `src/components/tool/`。
  - `docs/runbooks/runbook.md` 中 `check:presenter-parity` 排障说明改为基于 `PAIRS` 配置的当前事实流程。
  - UI 兼容测试标题文案从历史 `tools/presenters/*` 更新为组件层语义，降低误导。
- 明确不做：
  - 不改任何运行时代码路径，仅清理迁移后文档与测试元信息尾差。

## 执行状态（Phase C - Slice 45）

- 状态：进行中（目录迁移第一批，低风险，导入路径一致性）。
- 本轮已完成：
  - `src/components/tool/*ApprovalPrompt*.tsx` 内对 UI 组件的导入由 `../../components/ui/*` 统一收敛为 `../ui/*`。
  - 对应 mapping/branches 测试中的 `vi.mock` 目标路径同步收敛到 `../ui/*`。
  - `src/components/ui/ConfirmMenu.presenter-branches.test.tsx` 组件导入路径收敛为同目录相对导入。
- 明确不做：
  - 不改 approval prompt 交互逻辑，仅做导入路径规范化。
  - 不改任意测试断言语义。

## 执行状态（Phase C - Slice 46）

- 状态：进行中（目录迁移第一批，低风险，tool block 归位）。
- 本轮已完成：
  - 将 `WriteApprovalToolBlock`、`EditApprovalToolBlock`、`EditPlanFileBlock` 及对应测试从 `src/tools/modules/{write,edit}/` 迁移到 `src/components/tool/`。
  - `src/tools/modules/{write,edit}/presenter.tsx` 切换为引用 `src/components/tool/*` 的新位置实现。
  - 迁移后组件与测试的相对导入统一按 `components` 层内路径修正（`../ui/*`、`./*`、`../../shared/*`、`../../features/*`、`../../tools/runtime/*`）。
- 明确不做：
  - 不改 write/edit approval 的交互逻辑、decision payload 与文案。
  - 不改 write/edit presenter 的渲染策略，仅变更模块归属与导入路径。

## 执行状态（Phase C - Slice 47）

- 状态：进行中（目录迁移第一批，低风险，测试类型依赖收敛）。
- 本轮已完成：
  - `src/tools/modules/*/presenter*.test.tsx` 中 `Msg` 类型导入由 `src/components/tool/ToolMessage` 统一收敛为 `src/shared/toolMessageTypes`。
  - 覆盖 ask/bash/edit/enterPlanMode/exitPlanMode/glob/grep/killShell/notebookEdit/read/search/skill/task/taskOutput/todoWrite/webFetch/webSearch/write 等模块测试，减少测试层对 UI 组件文件的反向类型耦合。
- 明确不做：
  - 不改任何 presenter 运行时代码与渲染行为。
  - 不改测试断言语义，仅做类型导入路径收敛。

## 执行状态（Phase C - Slice 48）

- 状态：进行中（目录迁移第一批，低风险，REPL 消息类型去 UI 依赖）。
- 本轮已完成：
  - `src/features/repl/**` 与 `src/screens/**` 中所有 `import type { Msg } from */components/tool/ToolMessage*` 统一切换为 `*/shared/toolMessageTypes*`。
  - 保留 `ToolMessage` 组件的运行时渲染导入路径不变，仅收敛类型来源，避免 Service/Runtime 层对 UI 组件路径产生类型耦合。
- 明确不做：
  - 不改任何消息投影、流式拼接、surface reset 或渲染分支逻辑。
  - 不改 `ToolMessage` 组件实现与展示行为。

## 执行状态（Phase C - Slice 49）

- 状态：进行中（目录迁移第一批，低风险，Config 目录启动）。
- 本轮已完成：
  - `src/env/modelTier.ts` 与对应测试迁移到 `src/config/modelTier.{ts,test.ts}`。
  - `src/env/modelTier.ts` 保留兼容 re-export（桥接到 `src/config/modelTier.js`），降低一次性迁移风险。
  - `features/commands`、`screens`、`tools/executor`、`ui/model` 的 `modelTier` 导入统一改为 `src/config/modelTier`。
  - `scripts/layer-contract.config.json` 的 Config 层映射新增 `src/config`。
- 明确不做：
  - 不改 model tier 解析、默认模型选择与 env 覆盖优先级语义。
  - 不改 REPL/TaskSubAgent 的业务流程，仅切换配置模块归属。

## 执行状态（Phase C - Slice 50）

- 状态：进行中（目录迁移第一批，低风险，Config 目录扩展）。
- 本轮已完成：
  - `src/env/configPaths.ts` 与对应测试迁移到 `src/config/configPaths.{ts,test.ts}`。
  - `src/env/configPaths.ts` 保留兼容 re-export（桥接到 `src/config/configPaths.js`）。
  - `features/commands/replDoctorService`、`core/diagnostics`、`core/config/show`、`cli/main` 等调用方导入统一改为 `src/config/configPaths`。
- 明确不做：
  - 不改配置路径计算逻辑、默认目录约定与环境变量解析语义。
  - 不改 replDoctor 的诊断输出行为，仅调整模块归属与导入路径。

## 执行状态（Phase C - Slice 51）

- 状态：进行中（目录迁移第一批，低风险，Config 目录扩展）。
- 本轮已完成：
  - `src/env/configFiles.ts` 迁移到 `src/config/configFiles.ts`。
  - `src/env/nodeFileStore.ts` 与测试迁移到 `src/config/nodeFileStore.{ts,test.ts}`。
  - `src/env/configFiles.ts` 与 `src/env/nodeFileStore.ts` 保留兼容 re-export。
  - `src/env/config.ts` 内部导入改为直接引用 `src/config/{configFiles,nodeFileStore}`。
- 明确不做：
  - 不改 runtime config 的解析与合并行为，仅调整模块归属与导入路径。
  - 不改 node file store 的文件写入/原子写/权限容错语义。

## 执行状态（Phase C - Slice 52）

- 状态：进行中（目录迁移第一批，低风险，Config 目录扩展）。
- 本轮已完成：
  - `src/env/runtimeFlags.ts` 与测试迁移到 `src/config/runtimeFlags.{ts,test.ts}`。
  - `src/env/runtimeFlags.ts` 保留兼容 re-export（桥接到 `src/config/runtimeFlags.js`）。
  - `chat/engine`、`runtime/createRuntime`、`screens/REPL`、`features/repl`、`legacy/bootstrap` 的 `runtimeFlags` 导入统一切到 `src/config/runtimeFlags`。
- 明确不做：
  - 不改 runtime flags 的解析规则与默认值，仅切换模块归属。
  - 不改 REPL/runtime 启动行为、chat engine 流程与 bash mode 逻辑。

## 执行状态（Phase C - Slice 53）

- 状态：进行中（目录迁移第一批，低风险，Config 目录扩展）。
- 本轮已完成：
  - `src/env/config.ts` 与测试迁移到 `src/config/config.{ts,test.ts}`。
  - `src/env/config.ts` 保留兼容 re-export（桥接到 `src/config/config.js`）。
  - `services/runtimeUiBridge`、`cli/main`、`screens/REPL`、`features/repl`、`legacy/bootstrap`、`tools/executor/taskSubAgent` 等调用方导入统一切到 `src/config/config`。
  - `CODEMAP.md` 的 runtime config 入口更新到 `src/config/config.ts`。
- 明确不做：
  - 不改 runtime config 解析/合并逻辑与默认值语义。
  - 不改 REPL/chat/taskSubAgent 的行为，仅调整配置模块归属与导入路径。

## 执行状态（Phase C - Slice 54）

- 状态：进行中（目录迁移第一批，低风险，Config 兼容层收口）。
- 本轮已完成：
  - 删除 `src/env/{config,configFiles,configPaths,modelTier,nodeFileStore,runtimeFlags}.ts` 兼容 re-export 文件。
  - `scripts/layer-contract.config.json` 的 Config 层映射移除 `src/env`，仅保留 `src/config` 与 `src/core/config`。
- 明确不做：
  - 不改任何配置加载行为与运行时逻辑，仅清理已无调用方的兼容层文件。
  - 不修改 `dotenv/config` 入口行为。

## 执行状态（Phase C - Slice 55）

- 状态：进行中（目录迁移第一批，低风险，core/config 向 config/settings 下沉）。
- 本轮已完成：
  - `src/core/config/{schema.ts,schema.test.ts,fileStore.ts,paths.ts}` 迁移到 `src/config/settings/`。
  - 在 `src/core/config/{schema,fileStore,paths}.ts` 保留兼容 re-export，避免一次性改动所有调用方。
  - `CODEMAP.md` 的配置 schema 事实路径更新到 `src/config/settings/schema.ts`。
- 明确不做：
  - 不改 config schema、file store、paths 的字段定义与行为逻辑，仅调整模块归属。
  - 不改 `core/config/resolve`、`persist`、`show`、`migrate` 的行为。

## 执行状态（Phase C - Slice 56）

- 状态：进行中（目录迁移第一批，低风险，core/config 向 config/settings 下沉）。
- 本轮已完成：
  - `src/core/config/{configFiles,resolve,persist,migrate,show}.{ts,test.ts}` 迁移到 `src/config/settings/`。
  - `src/core/config/{configFiles,resolve,persist,migrate,show}.ts` 保留兼容 re-export，避免一次性修改所有调用方。
  - `CODEMAP.md` 的 config resolve 事实路径更新到 `src/config/settings/resolve.ts`。
- 明确不做：
  - 不改配置解析/持久化/迁移/展示逻辑，仅变更模块归属与导入层次。
  - 不改 `cli`、`features/commands`、`config loader` 的行为。

## 执行状态（Phase C - Slice 57）

- 状态：进行中（目录迁移第一批，低风险，core/config shim 清理）。
- 本轮已完成：
  - 业务代码导入从 `src/core/config/*` 统一收敛到 `src/config/settings/*`。
  - 删除 `src/core/config/{schema,fileStore,paths,configFiles,resolve,persist,migrate,show}.ts` shim 文件（已无调用方）。
  - `scripts/layer-contract.config.json` 的 Config 层映射移除 `src/core/config`，仅保留 `src/config`。
  - `docs/environment-variables.md` 的 resolve 事实路径更新到 `src/config/settings/resolve.ts`。
- 明确不做：
  - 不改配置解析/迁移/持久化行为，仅做路径收敛与 shim 收口。
  - 不改 CLI/REPL/setup 的用户可见语义。

## 执行状态（Phase C - Slice 58）

- 状态：进行中（目录迁移第一批，低风险，文档路径对齐）。
- 本轮已完成：
  - `AGENTS.md` 与 `CLAUDE.md` 中 runtime config / config merge 的事实路径更新为 `src/config/{config.ts,settings/*}`。
- 明确不做：
  - 不改任何运行时代码，仅同步文档路径，避免后续排障误导。

## 执行状态（Phase C - Slice 59）

- 状态：进行中（目录迁移第二批，Runtime 合并线启动，低风险切片）。
- 本轮已完成：
  - `src/cli/exitCodes.ts` 迁移到 `src/runtime/cli/exitCodes.ts`。
  - `src/cli/exitCodes.ts` 保留兼容 re-export（桥接到 `src/runtime/cli/exitCodes.js`）。
- 明确不做：
  - 不改 CLI 参数解析/帮助文本/命令分发逻辑，仅迁移独立常量模块路径。

## 执行状态（Phase C - Slice 60）

- 状态：进行中（目录迁移第二批，Runtime 合并线，低风险切片）。
- 本轮已完成：
  - `src/cli/{args,help,json}.ts` 迁移到 `src/runtime/cli/{args,help,json}.ts`。
  - `src/cli/{args,help,json}.ts` 保留兼容 re-export（桥接到 `src/runtime/cli/*`）。
  - `src/cli/main.ts` 与 `src/entrypoints/cli.tsx` 改为直接导入 `src/runtime/cli/*`，减少 shim 跳转层。
- 明确不做：
  - 不改参数解析规则、help 文案、JSON envelope 结构，仅迁移模块归属路径。

## 执行状态（Phase C - Slice 61）

- 状态：进行中（目录迁移第二批，Runtime 合并线，低风险切片）。
- 本轮已完成：
  - `src/cli/main.ts` 迁移到 `src/runtime/cli/main.ts`。
  - `src/cli/main.ts` 保留兼容 re-export（桥接到 `src/runtime/cli/main.js`）。
  - `src/entrypoints/cli.tsx` 改为直接导入 `src/runtime/cli/main.ts`。
- 明确不做：
  - 不改 CLI 命令分发逻辑、返回结构、错误处理分支，仅迁移模块归属路径。

## 执行状态（Phase C - Slice 62）

- 状态：进行中（目录迁移第二批，Runtime 合并线，低风险切片）。
- 本轮已完成：
  - `src/cli/{args,help,main}.test.ts` 迁移到 `src/runtime/cli/{args,help,main}.test.ts`。
  - 迁移后测试内相对导入已对齐 `src/runtime/cli` 目录层级。
- 明确不做：
  - 不改测试断言与用例语义，仅调整测试文件归属与导入路径。

## 执行状态（Phase C - Slice 63）

- 状态：进行中（目录迁移第二批，Runtime 合并线，shim 收口切片）。
- 本轮已完成：
  - 删除 `src/cli/{args,help,json,main,exitCodes}.ts` 兼容 shim，彻底收口到 `src/runtime/cli/*`。
  - `src/cli/binWrapper.test.ts` 迁移到 `src/runtime/cli/binWrapper.test.ts`，并修正仓库根路径计算。
  - `README.md`、`CODEMAP.md`、`CLAUDE.md` 的 CLI 事实路径更新为 `src/runtime/cli/*`。
- 明确不做：
  - 不改任何 CLI 行为、命令语义与输出格式，仅做路径收口与文档同步。

## 执行状态（Phase C - Slice 64）

- 状态：进行中（目录迁移第二批，Runtime 合并线，命令解析器收拢）。
- 本轮已完成：
  - `src/serve/command.{ts,test.ts}` 迁移到 `src/runtime/cli/serveCommand.{ts,test.ts}`。
  - `src/web/command.{ts,test.ts}` 迁移到 `src/runtime/cli/webCommand.{ts,test.ts}`。
  - `src/runtime/cli/main.ts` 改为直接导入 `./serveCommand` 与 `./webCommand`。
  - `src/serve/command.ts` 与 `src/web/command.ts` 保留兼容 re-export shim。
  - `CODEMAP.md` 的 serve/web command 事实路径同步到 `src/runtime/cli/*`。
- 明确不做：
  - 不改 `serve/web` 参数语义、默认值、help 文案与错误消息，仅迁移模块归属与导入路径。

## 执行状态（Phase C - Slice 65）

- 状态：进行中（目录迁移第二批，Runtime 合并线，shim 收口）。
- 本轮已完成：
  - 删除 `src/serve/command.ts` 与 `src/web/command.ts` 兼容 shim。
  - `serve/web` 命令解析唯一事实源已收敛到 `src/runtime/cli/{serveCommand,webCommand}.ts`。
- 明确不做：
  - 不改 `formax serve` / `formax web` 的参数行为与 help 文案，仅收口路径层兼容文件。

## 执行状态（Phase C - Slice 66）

- 状态：进行中（目录迁移第二批，Runtime 合并线，network/serve/web 归拢）。
- 本轮已完成：
  - `src/network/runtime.{ts,test.ts}` 迁移到 `src/runtime/network/runtime.{ts,test.ts}`。
  - `src/serve/localServer.ts` 迁移到 `src/runtime/serve/localServer.ts`。
  - `src/web/localUi.ts` 迁移到 `src/runtime/web/localUi.ts`。
  - `src/entrypoints/cli.tsx`、`src/app-server/devBridge.ts`、`src/runtime/cli/{serveCommand,webCommand}.ts` 等调用方改为直连 `src/runtime/*`。
  - 旧路径保留最薄 shim：`src/network/runtime.ts`、`src/serve/localServer.ts`、`src/web/localUi.ts`。
  - `CODEMAP.md` 与 `CLAUDE.md` 的相关事实路径同步到 `src/runtime/{network,serve,web}`。
- 明确不做：
  - 不改 serve/web/network 运行逻辑、参数语义与对外行为，仅迁移模块归属与导入路径。

## 执行状态（Phase C - Slice 67）

- 状态：进行中（目录迁移第二批，Runtime 合并线，shim 收口）。
- 本轮已完成：
  - 删除 `src/network/runtime.ts`、`src/serve/localServer.ts`、`src/web/localUi.ts` 兼容 shim。
  - `scripts/layer-contract.config.json` 的 Runtime 映射移除 `src/cli`、`src/network`、`src/serve`、`src/web` 陈旧路径，仅保留现状入口。
- 明确不做：
  - 不改 runtime 行为与启动参数语义，仅删除无调用 shim 并同步门禁映射。

## 执行状态（Phase C - Slice 68）

- 状态：进行中（目录迁移第二批，Runtime 合并线，bootstrap 归拢）。
- 本轮已完成：
  - `src/legacy/bootstrap/*`（源码 + 测试）迁移到 `src/runtime/bootstrap/*`。
  - `src/runtime/createRuntime.{ts,test.ts}` 与 `src/legacy/runLegacyCli.tsx` 改为直接导入 `src/runtime/bootstrap/*`。
  - `src/legacy/bootstrap/*` 保留兼容 shim（桥接到 `src/runtime/bootstrap/*`），避免一次性改动潜在外部引用。
  - `CODEMAP.md` 的 runtime assembly slices 事实路径更新到 `src/runtime/bootstrap/*`。
- 明确不做：
  - 不改 REPL 启动逻辑、setup 流程与 runtime 组装行为，仅迁移模块归属与导入路径。

## 执行状态（Phase C - Slice 69）

- 状态：进行中（目录迁移第二批，Runtime 合并线，shim 收口）。
- 本轮已完成：
  - 删除 `src/legacy/bootstrap/*` 兼容 shim，`bootstrap` 唯一事实源收敛到 `src/runtime/bootstrap/*`。
  - `scripts/layer-contract.config.json` 的 Runtime 映射移除 `src/legacy/bootstrap` 陈旧路径，仅保留 `src/legacy/runLegacyCli.tsx`。
- 明确不做：
  - 不改 `runLegacyCli` 与 runtime 组装行为，仅删除无调用 shim 并同步门禁映射。

## 执行状态（Phase C - Slice 70）

- 状态：进行中（目录迁移第二批，Runtime 合并线，legacy 入口归拢）。
- 本轮已完成：
  - `src/legacy/runLegacyCli.{tsx,test.tsx}` 迁移到 `src/runtime/bootstrap/runLegacyCli.{tsx,test.tsx}`。
  - `src/entrypoints/cli.tsx` 改为直接导入 `src/runtime/bootstrap/runLegacyCli`。
  - `src/legacy/runLegacyCli.tsx` 保留兼容 shim（桥接到 `src/runtime/bootstrap/runLegacyCli.js`）。
  - `CODEMAP.md`、`CLAUDE.md` 的 runLegacyCli 事实路径同步为 `src/runtime/bootstrap/runLegacyCli.tsx`。
- 明确不做：
  - 不改 REPL 启动行为与错误处理语义，仅迁移入口模块归属与导入路径。

## 执行状态（Phase C - Slice 71）

- 状态：进行中（目录迁移第二批，Runtime 合并线，legacy 收口）。
- 本轮已完成：
  - 删除 `src/legacy/runLegacyCli.tsx` 兼容 shim。
  - 删除空目录 `src/legacy/`。
  - `scripts/layer-contract.config.json` 的 Runtime 映射移除 `src/legacy/runLegacyCli.tsx` 陈旧路径。
- 明确不做：
  - 不改 REPL 启动行为，仅删除无调用兼容层并同步门禁映射。

## 执行状态（Phase C - Slice 72）

- 状态：进行中（目录迁移第二批，文档路径一致性收口）。
- 本轮已完成：
  - `AGENTS.md` 的项目结构说明从 `src/cli`/`src/legacy` 更新为 `src/runtime/cli`/`src/runtime/bootstrap`。
  - `src/core/README.md` 的上层调用路径从 `src/legacy` 更新为 `src/runtime/bootstrap`。
- 明确不做：
  - 不改任何运行时代码与行为，仅同步文档事实路径。

## 执行状态（Phase C - Slice 73）

- 状态：进行中（目录迁移第二批，TUI 目录重命名收口）。
- 本轮已完成：
  - `src/ui/**` 迁移为 `src/tui/**`，并同步核心调用方导入：
    - `src/screens/REPL.tsx`
    - `src/features/repl/useReplController.ts`
    - `src/features/repl/controller/ui/overlays.ts`
    - `src/features/repl/controller/session/localCommandInjection.ts`
    - `src/services/runtimeUiBridge.tsx`
  - 对应测试 mock 路径切换为 `src/tui/**`（`src/screens/REPL.coverage.test.tsx`、`src/services/runtimeUiBridge.test.tsx`）。
  - 门禁脚本同步：
    - `scripts/check-ui-boundaries.mjs` 扫描根切换为 `src/tui`
    - `scripts/check-core-boundaries.mjs` 禁止依赖目标切换为 `src/tui/**`（并兼容拦截 legacy `src/ui/**` 字符串）
    - `scripts/layer-contract.config.json` Service 映射改为 `src/tui`
  - 文档路径事实同步：
    - `AGENTS.md`、`CLAUDE.md`、`CODEMAP.md`、`src/hooks/README.md`
- 明确不做：
  - 不改任何 overlay 行为与 UI 交互语义，仅迁移目录归属并收敛边界门禁。

## 执行状态（Phase C - Slice 74）

- 状态：进行中（目录迁移第二批，技能与辅助计划文档路径收口）。
- 本轮已完成：
  - `.codex/skills/formax-config-settings-workflow/SKILL.md` 中 ConfigDialog 路径与测试命令统一到 `src/tui/config/*`。
  - `.codex/skills/formax-permissions-workflow/SKILL.md` 中 PermissionsDialog 路径与测试命令统一到 `src/tui/permissions/*`。
  - `AGENTS.md` 的项目结构说明由 `ui/` 更新为 `tui/`。
  - `plans/config-settings/TODO.md` 与 `plans/hooks/TODO.md` 中的 `src/ui/*` 历史路径更新为 `src/tui/*`。
- 明确不做：
  - 不改任何运行时代码、边界规则或 UI 行为，仅收敛文档与技能指引路径事实。

## 执行状态（Phase C - Slice 75）

- 状态：进行中（目录迁移第二批，TUI 公共工具入口收口）。
- 本轮已完成：
  - 新增 `src/tui/{theme,toolFormatting,consoleLogger,inkStreams}.ts` 四个稳定入口（当前转发到 `src/shared/utils/*` 实现）。
  - 全仓 UI/Presenter/REPL 相关导入切换到 `src/tui/*` 入口：
    - 主题：`theme`
    - 工具文案格式化：`toolFormatting`
    - 浏览器日志桥：`consoleLogger`
    - Ink stdout 安全适配：`inkStreams`
  - `Repo` 层文件 `src/features/repl/sessionSave/reader.ts` 保持依赖 `shared/utils/toolFormatting`，避免跨层违规。
  - 相关门禁通过：`check:layer-contracts`、`check:layer-coverage`、`check:shared-types`。
- 明确不做：
  - 不搬动 `src/shared/utils/*` 实现文件本体，仅先收敛调用入口，后续再按层策略决定是否迁实现。

## 执行状态（Phase C - Slice 76）

- 状态：进行中（目录迁移第二批，死 shim / dead barrel 清理）。
- 本轮已完成：
  - 删除无调用 shim：`src/runtime/bootstrap/renderReplApp.tsx`。
  - `src/runtime/bootstrap/runLegacyCli.tsx` 改为直接依赖 `src/services/runtimeUiBridge` 的 `renderLegacyReplApp`。
  - `src/runtime/bootstrap/runLegacyCli.test.tsx` 的 mock 目标同步到 `src/services/runtimeUiBridge.js`。
  - 删除无调用 shim：`src/tools/utils/paths.ts`。
  - 删除无调用 barrel：`src/tui/config/index.tsx`、`src/tui/hooks/index.ts`。
  - 验证通过：`runLegacyCli.test.tsx`、`check:layer-contracts`、`check:layer-coverage`。
- 明确不做：
  - 不改 runtime 启动行为，不改路径解析逻辑实现，仅去除中间桥接层。

## 执行状态（Phase C - Slice 77）

- 状态：进行中（目录迁移第二批，TUI 工具实现实迁）。
- 本轮已完成：
  - `src/shared/utils/theme.ts` 实现迁移到 `src/tui/theme.ts`。
  - `src/shared/utils/consoleLogger.ts` 实现迁移到 `src/tui/consoleLogger.ts`。
  - `src/shared/utils/inkStreams.ts` 实现迁移到 `src/tui/inkStreams.ts`。
  - `src/shared/utils/consoleLogger.test.ts` 迁移到 `src/tui/consoleLogger.test.ts`。
  - `src/shared/utils/inkStreams.test.ts` 迁移到 `src/tui/inkStreams.test.ts`。
  - 删除 `src/shared/utils/` 下上述已迁实现文件，避免双事实源。
  - 验证通过：`tui/inkStreams.test.ts`、`runLegacyCli.test.tsx`、`runtimeUiBridge.test.tsx`、`check:layer-contracts`、`check:layer-coverage`。
- 明确不做：
  - 暂不迁移 `shared/utils/toolFormatting.ts`（`Repo` 层仍有合法依赖），避免引入跨层违规。

## 执行状态（Phase C - Slice 78）

- 状态：进行中（目录迁移第二批，脚本路径收口）。
- 本轮已完成：
  - `scripts/surface-screen-model-smoke.tsx` 对 `inkStreams` 的导入从 `src/shared/utils/inkStreams` 切换到 `src/tui/inkStreams`。
  - 全仓复扫 `shared/utils/inkStreams` 残留引用，确认仅该脚本存在旧路径依赖并已收敛。
  - 验证通过：`check:layer-contracts`、`check:layer-coverage`。
- 明确不做：
  - 不调整 smoke 脚本行为逻辑，仅做路径事实修正。

## 目标结构

```
src/
│
│  ════════════════════ Types 层 ════════════════════
│
├── shared/                          # 跨层类型、纯工具、合同
│   ├── frontmatter.ts
│   ├── inputContracts.ts
│   ├── toolContracts.ts
│   ├── toolMessageTypes.ts
│   ├── runtimeEventSource.ts
│   ├── invokables/                  # ← 合并原 src/invokables
│   │   ├── types.ts
│   │   └── charBudget.ts
│   └── utils/                       # ← 合并原 src/utils（纯函数）
│       ├── paths.ts
│       └── catN.ts
│
│  ════════════════════ Config 层 ════════════════════
│
├── config/                          # ← 合并原 src/env + src/core/config
│   ├── config.ts                    #   (原 env/config.ts)
│   ├── configFiles.ts               #   (原 env/configFiles.ts)
│   ├── configPaths.ts               #   (原 env/configPaths.ts)
│   ├── modelTier.ts                 #   (原 env/modelTier.ts)
│   ├── nodeFileStore.ts             #   (原 env/nodeFileStore.ts)
│   ├── runtimeFlags.ts              #   (原 env/runtimeFlags.ts)
│   └── settings/                    #   (原 core/config)
│       ├── engine.ts
│       ├── schema.ts
│       ├── store.ts
│       └── types.ts
│
│  ════════════════════ Repo 层 ════════════════════
│
├── adapters/                        # 持久化与外部 IO（不变）
│   ├── fs/
│   ├── permissions/
│   ├── audit/
│   ├── diagnostics/
│   └── setup/
│
│  ════════════════════ Service 层 ════════════════════
│
├── core/                            # 领域无关的 Service 基础设施
│   ├── app/                         #   createApp, eventBus
│   ├── approval/                    #   approval rules
│   ├── auth/                        #   认证
│   ├── audit/                       #   audit schema（纯 schema，不是 IO）
│   ├── diagnostics/                 #   doctor, debugBundle, status
│   ├── errors/                      #   error codes
│   ├── models/                      # ← 合并原 src/services/{models,modelContextCatalog}
│   │   ├── models.ts
│   │   └── modelContextCatalog.ts
│   ├── policy/                      #   policy engine
│   └── setup/                       #   session setup
│
├── chat/                            # LLM 引擎（不变）
│   ├── engine.ts
│   └── context/
│
├── streaming/                       # 流处理（不变）
│   ├── types.ts                     #   (同时归属 Types 层)
│   ├── index.ts
│   ├── anthropic/
│   └── openai/
│
├── prompts/                         # Prompt 构建（不变）
│   ├── types.ts                     #   (同时归属 Types 层)
│   ├── system.ts
│   ├── init.ts
│   ├── compact.ts
│   └── reminders/
│
├── hooks/                           # Hook 系统（不变）
│
├── subagents/                       # 子代理（不变）
│
├── tools/                           # 工具系统（Service 部分）
│   ├── modules/
│   ├── executor/
│   ├── catalog/
│   ├── specs/
│   ├── runtime/
│   ├── utils/
│   ├── patches/
│   ├── registry.ts
│   ├── loader.ts
│   └── types.ts
│   # ⚠️ presenters/ 移出 → 见 UI 层
│
├── features/
│   ├── semantics/                   # 语义核心（不变）
│   │   ├── core/                    #   (Types 层)
│   │   ├── adapters/                #   (Service 层)
│   │   ├── projection/              #   (Service 层)
│   │   ├── runtime/                 #   (Service 层)
│   │   ├── selectors/               #   (Service 层)
│   │   └── __tests__/
│   │
│   ├── repl/                        # REPL 领域
│   │   ├── controller/              #   [Service]
│   │   ├── sessionSave/             #   [Repo]
│   │   ├── mode.ts                  #   [Service]
│   │   ├── planSession.ts           #   [Service]
│   │   ├── injectedBlocks.ts        #   [Service]
│   │   ├── reminders/               #   [Service]
│   │   ├── useReplController.ts     #   [Service] 主控 hook
│   │   ├── useInputAudit.test.ts    #   [Service]
│   │   ├── keys/                    #   [UI]
│   │   ├── overlays/                #   [UI]
│   │   ├── inputScopeContext.tsx     #   [UI]
│   │   ├── replUiContext.tsx         #   [UI]
│   │   └── planContext.tsx           #   [UI]
│   │
│   ├── commands/                    # ← 合并原 src/commands + src/features/commands
│   │   ├── CommandStore.ts          #   [Repo]
│   │   ├── registry.ts              #   [Service]
│   │   ├── adapter.ts               #   [Service]
│   │   ├── configDialogService.ts   #   [Service]
│   │   ├── permissionsDialogService.ts
│   │   ├── replDoctorService.ts     #   [Service]
│   │   ├── replEnvironmentService.ts
│   │   ├── resumeDialogService.ts   #   [Service]
│   │   ├── contracts.ts             #   [Service]
│   │   └── render.ts               #   [UI]
│   │
│   ├── sessionTitle/                # 会话标题生成（不变）
│   │
│   └── skills/                      # ← 移入 features（原 src/skills）
│       ├── SkillStore.ts            #   [Repo]
│       └── SkillStore.test.ts
│
│  ════════════════════ Runtime 层 ════════════════════
│
├── app-server/                      # JSON-RPC 服务端（不变，独立 top-level）
│   ├── server.ts
│   ├── protocol.ts
│   ├── protocol/
│   ├── jsonrpc.ts
│   ├── threadStore.ts
│   ├── turnRunner.ts
│   ├── devBridge.ts
│   ├── replayStateSnapshot.ts
│   ├── threadStateReducer.ts
│   ├── index.ts
│   ├── store/
│   ├── transport/
│   └── turn/
│
├── runtime/                         # ← 合并原 runtime + cli + legacy + serve + web + network
│   ├── createRuntime.ts             #   (原 src/runtime/)
│   ├── cli/                         #   (原 src/cli)
│   │   ├── main.ts
│   │   ├── args.ts
│   │   ├── help.ts
│   │   ├── json.ts
│   │   └── exitCodes.ts
│   ├── bootstrap/                   #   (原 src/legacy/bootstrap)
│   ├── serve/                       #   (原 src/serve)
│   ├── web/                         #   (原 src/web)
│   └── network/                     #   (原 src/network)
│
├── entrypoints/                     # 入口文件（不变）
│
│  ════════════════════ UI 层 ════════════════════
│
├── screens/                         # Ink 屏幕（不变）
│   ├── REPL.tsx
│   ├── repl/
│   └── ...
│
├── components/                      # Ink 组件
│   ├── chat/
│   ├── tool/                        # ← 吸收原 tools/presenters
│   │   ├── ConfirmMenu.tsx
│   │   ├── AskUserQuestionToolBlock.tsx
│   │   ├── BashApprovalToolBlock.tsx
│   │   ├── PatchPreview.tsx
│   │   ├── MarkdownBlock.tsx
│   │   └── ...
│   └── ui/
│
├── tui/                             # ← 重命名原 src/ui
│   ├── toolFormatting.ts
│   ├── consoleLogger.ts
│   ├── inkStreams.ts
│   ├── theme.ts
│   └── ...
│
└── services/                        # ← 仅保留 UI 层桥接
    └── runtimeUiBridge.tsx           #   [UI] Runtime-UI 桥接
```

## Before → After 迁移对照

| #   | 原目录                       | 文件数 | 目标位置                 | 操作                               |
| --- | ---------------------------- | ------ | ------------------------ | ---------------------------------- |
| 1   | `src/shared`                 | 8      | `src/shared/`            | **保留** + 吸收 invokables、utils  |
| 2   | `src/invokables`             | 3      | `src/shared/invokables/` | **合并**                           |
| 3   | `src/utils`                  | 20     | `src/shared/utils/`      | **合并**                           |
| 4   | `src/env`                    | 11     | `src/config/`            | **合并**为 config 顶层             |
| 5   | `src/core/config`            | 14     | `src/config/settings/`   | **合并**为 config 子目录           |
| 6   | `src/core/{其余 8 个子目录}` | ~37    | `src/core/`              | **保留** + 吸收 services/models    |
| 7   | `src/adapters`               | 36     | `src/adapters/`          | **不变**                           |
| 8   | `src/chat`                   | 13     | `src/chat/`              | **不变**                           |
| 9   | `src/streaming`              | 11     | `src/streaming/`         | **不变**                           |
| 10  | `src/prompts`                | 14     | `src/prompts/`           | **不变**                           |
| 11  | `src/hooks`                  | 14     | `src/hooks/`             | **不变**                           |
| 12  | `src/subagents`              | 17     | `src/subagents/`         | **不变**                           |
| 13  | `src/tools`                  | 225    | `src/tools/`             | **保留** − presenters              |
| 14  | `src/tools/presenters`       | 45     | `src/components/tool/`   | **搬迁**                           |
| 15  | `src/features/semantics`     | 67     | 不变                     | **不变**                           |
| 16  | `src/features/repl`          | 121    | 不变                     | **不变**（内部层标注）             |
| 17  | `src/features/commands`      | 16     | `src/features/commands/` | **吸收** src/commands              |
| 18  | `src/commands`               | 4      | `src/features/commands/` | **合并**                           |
| 19  | `src/features/sessionTitle`  | 9      | 不变                     | **不变**                           |
| 20  | `src/features/tools`         | 19     | `src/features/tools/`    | **不变**                           |
| 21  | `src/skills`                 | 2      | `src/features/skills/`   | **移入** features                  |
| 22  | `src/services`               | 6      | 拆分                     | models→`core/models/`, bridge→保留 |
| 23  | `src/cli`                    | 9      | `src/runtime/cli/`       | **合并**                           |
| 24  | `src/runtime`                | 2      | `src/runtime/`           | **保留** + 吸收其他 Runtime 目录   |
| 25  | `src/legacy`                 | 17     | `src/runtime/bootstrap/` | **合并**                           |
| 26  | `src/serve`                  | 3      | `src/runtime/serve/`     | **合并**                           |
| 27  | `src/web`                    | 3      | `src/runtime/web/`       | **合并**                           |
| 28  | `src/network`                | 2      | `src/runtime/network/`   | **合并**                           |
| 29  | `src/app-server`             | 32     | `src/app-server/`        | **不变**                           |
| 30  | `src/entrypoints`            | 6      | `src/entrypoints/`       | **不变**                           |
| 31  | `src/screens`                | 39     | `src/screens/`           | **不变**                           |
| 32  | `src/components`             | 42     | `src/components/`        | **保留** + 吸收 tools/presenters   |
| 33  | `src/ui`                     | 54     | `src/tui/`               | **重命名**                         |

## 对应 `layer-contract.config.json`

```json
{
  "layerOrder": ["Types", "Config", "Repo", "Service", "Runtime", "UI"],
  "scanRoots": ["src", "apps/web-reference-react/src"],
  "layers": {
    "Types": [
      "src/shared",
      "src/prompts/types.ts",
      "src/streaming/types.ts",
      "src/features/semantics/core"
    ],
    "Config": ["src/config"],
    "Repo": [
      "src/adapters",
      "src/features/repl/sessionSave",
      "src/features/commands/CommandStore.ts",
      "src/features/skills"
    ],
    "Service": [
      "src/core",
      "src/chat",
      "src/streaming",
      "src/prompts",
      "src/hooks",
      "src/subagents",
      "src/tools",
      "src/features/commands",
      "src/features/sessionTitle",
      "src/features/semantics/projection",
      "src/features/semantics/adapters",
      "src/features/semantics/runtime",
      "src/features/semantics/selectors",
      "src/features/repl/controller",
      "src/features/tools"
    ],
    "Runtime": ["src/runtime", "src/app-server", "src/entrypoints"],
    "UI": [
      "src/tui",
      "src/screens",
      "src/components",
      "src/services/runtimeUiBridge.tsx",
      "src/features/repl/keys",
      "src/features/repl/overlays",
      "src/features/repl/inputScopeContext.tsx",
      "src/features/repl/replUiContext.tsx",
      "src/features/repl/planContext.tsx",
      "src/features/commands/render.ts",
      "apps/web-reference-react/src"
    ]
  }
}
```

## 变化统计

| 指标                 | 当前 | 目标                 |
| -------------------- | ---- | -------------------- |
| `src/` 顶层目录数    | 27   | 16                   |
| 未映射到层的目录     | 8    | 0                    |
| 跨层混放的目录       | 4    | 0                    |
| 需搬迁的文件（估算） | —    | ~100 个文件          |
| 不动的目录           | —    | 17 个（占总量 60%+） |
