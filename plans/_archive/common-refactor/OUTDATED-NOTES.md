# Notes / TODOs from gptweb docs

本文件用于跟踪 gptweb 输出的两份文档里：

- **已落地（Done）**：已经在代码中实现的建议
- **待落地（Pending）**：还没做、但后续可以继续做的建议
- **过时/不准确（Outdated/Inaccurate）**：当时的描述与当前代码不一致（暂不回改原文档，只在这里标注）

## Sources

- `plans/common-refactor/产品工程安全审计.md`
- `plans/common-refactor/ink_ts专家代码优化.md`

## Done（已落地）

- [x] Bash 二次确认必须来自用户交互（不再允许模型靠 `confirm:true` 自行放行）
  - `src/tools/modules/bash/handler.ts`
  - `src/tools/modules/bash/presenter.tsx`
  - `src/tools/presenters/bashApprovalPrompt.tsx`
- [x] StreamClient toolResults 不再静默丢失 + 顺序对齐 tool_use
  - `src/streaming/anthropic/StreamClient.ts`
  - `src/streaming/anthropic/StreamClient.sortToolResults.test.ts`
- [x] prompt mode 交互工具标记收敛到 ToolRegistry meta（REPL 不再完全依赖 hardcode）
  - `src/tools/registry.ts`
  - `src/tools/modules/{askUserQuestion,enterPlanMode,exitPlanMode}/index.ts`
  - `src/screens/REPL.tsx`
- [x] 工具 schema 内聚：以 `ToolModule.spec` 为唯一事实来源（`ToolDefinition` 或 “基于 base 合并”的 spec factory）
  - `src/tools/registry.ts`
  - `src/tools/modules/*/index.ts`
- [x] “工具执行 → 二次确认 → 执行/取消”的端到端链路已整理成流程文档
  - `docs/TOOL-EXECUTION-WITH-CONFIRMATION.md`

## Pending（待落地）

### 来自 `plans/common-refactor/产品工程安全审计.md`

#### P0（安全边界优先）

- [ ] Workspace root 路径边界：Read/Write/Edit/NotebookEdit/Glob/Grep 等默认限制在 workspace 内（repo 外二次确认或拒绝）
- [ ] 插件命令/子代理信任机制（trusted/untrusted）+ 插件命令执行前预览/二次确认
- [ ] WebFetch 的 SSRF 风险控制（域名 allowlist / 禁止内网 / 仅 https 等策略）
- [ ] ToolMessage/Bash 等 running 状态展示 tail 进度（统一“长输出折叠/分页”策略）

#### P1（交互一致性 + 可解释性）

- [ ] Mode UI 更强提示：accept-edits 强提示、模式徽标更常驻
- [ ] Edit/Write 审批前预览 diff/内容（提升可解释性）
- [ ] `/help` + `?` shortcuts 闭环（并默认隐藏 unimplemented 命令）
- [ ] Slash suggestions 显示来源（builtin vs plugin）+ 更好的错误提示（相近命令建议）
- [ ] 集中策略：把 mode/allow/deny/危险工具审批收敛到 executor 的统一 policy（避免新工具遗漏）
- [ ] `/tasks` 增强：watch/kill/preview output（更对齐 Claude Code）
- [ ] 流式节流/合批：减少 UI 抖动（stream 模式合批、buffered 模式更友好）

#### P2（工程化/生态/长期）

- [ ] 内置 commands 模块化（像 tools 一样“命令插件化/只加文件”）
- [ ] Console logger 安全化（仅 localhost + token + 默认 off）
- [ ] 测试补齐：路径 guard / plugin trust / 关键 policy 的单测与回归
- [ ] （需要补充信息）proxy 抓包/traffic logs 脱敏清单与默认落盘策略（取决于 proxy 实现）
- [ ] 其他：Shift+Tab 行为与 accept-edits 的关系（避免“误进免审批模式”）
- [ ] 其他：TodoWrite 的 plan-mode/审批策略对齐（避免模式越权）

### 来自 `plans/common-refactor/ink_ts专家代码优化.md`

#### P0（性能/正确性）

- [ ] 消息更新批处理：降低高频 re-render 与长文本闪烁（Msg[] → Map + order[]、事件合批）
- [ ] PR-3：buffered 模式“节流 flush”（避免长回答像卡死），引入 `assistantBufferedFlushMs` 配置并在 controller 合批更新

#### P1（接口收敛）

- [ ] PolicyEngine：把 mode/审批/工具权限矩阵从 handler/presenter/controller 收敛到 executor 入口
- [ ] Plan mode 注入块不再“塞进 history 再清理”（改成显式 TurnContext/ephemeral blocks，永不写入 history）
- [ ] ToolRegistry handler 冲突处理：priority/冲突检测（避免多个 handler 同时 canHandle 时“顺序赢”）
- [ ] Enter/Exit Plan Mode：补齐取消/超时/恢复语义（UserInputManager 增加 timeout/abortAll/resume 等）

#### P2（产品化/长期）

- [ ] WebSearch provider 抽象 + fallback（避免抓 HTML 结构变动即全挂）
- [ ] Engine 的 max iteration 等异常“产品化”：转换为可读的系统消息并给出自救建议
- [ ] 更进一步的性能优化：降低长文本/高频事件导致的 re-render（store 结构、事件合批、减少字符串拼接）

## Outdated / Inaccurate（过时/不准确，暂不修正原文）

### 1) `ToolMessage` 的 `Ctrl+O` 全局折叠问题

- 文档提到：`ToolMessage` 内部通过 `useInput` 监听 `Ctrl+O`，可能导致多张卡片同时 toggle。
- 当前代码现状：`src/components/tool/ToolMessage.tsx` 目前是纯展示组件，没有 `useInput`，也没有 `expanded` 状态切换逻辑，因此该问题在当前版本不成立。
- 后续如果要加“折叠/展开”：建议在 `src/screens/REPL.tsx` 做“选中消息/最新消息”的全局快捷键路由，而不是每个卡片各自监听键盘。

### 2) “specOverride” 命名已过时

- 两份文档中多处使用 `specOverride` 来表达“每个工具模块可覆盖/补全 schema”。
- 当前代码现状：`ToolModule` 使用 `spec?: ToolSpec`（`ToolDefinition` 或 spec factory），`ToolRegistry.listSpecs()` 会做合并 + patch 后处理；因此可把文档里的 `specOverride` 理解为 `spec`。
