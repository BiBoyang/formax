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
