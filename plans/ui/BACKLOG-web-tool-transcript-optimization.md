# Backlog: Web Tool Transcript Component Architecture

目标：把 Web 端 Tool 展示改成“可插拔组件体系”。  
核心约束（你强调的）：
- 特殊功能可独立扩展，不影响其他 Tool 组件。
- 公共 UI 改动集中在少量基元，不再每次改动都触碰每个 Tool。

范围：
- 关注组件边界、渲染协议、复用策略、回归风险控制。
- 不重点讨论背景色差异。

## 设计原则（Architecture First）

1. 公共与特化分层
- 公共层只负责统一结构与视觉语法（状态点、header、summary、details、折叠、复制按钮、IN/OUT 容器）。
- 特化层只负责“某个 Tool 的业务语义与自定义 UI”。

1.1 Tool 外层采用行流式，不用整卡包裹
- Tool item 不再使用整块 Card 容器包住整条记录（当前实现痛点）。
- 结构改为：header 行 + summary 行 + 可选 details 行的“列表流”。
- 允许仅在局部细节区使用轻量边框（例如 Bash 的 IN/OUT），但不能把整条 Tool 当卡片。

2. 协议先行，不直接拼 JSX
- Tool 先产出结构化数据（blocks/model），再由统一 renderer 渲染。
- 避免每个 Tool presenter 手写一套 DOM/样式。

3. 必须保留逃生舱
- 对复杂 Tool（Write/Edit/Task/Approval）允许挂载 `custom block/slot`。
- 复杂功能可以独立进化，但不反向污染公共层。

4. 双轨迁移
- 旧组件可继续跑，新增走新协议。
- 通过 registry/router 按 Tool 渐进迁移，不一次性重写。

5. 事件语义不在本次改动范围
- Thinking/Tool/Assistant 的出现位置由上游事件类型决定（LLM 返回事件语义）。
- Tool UI 只负责“如何显示”，不改变消息归类与顺序。

## 借鉴 TUI，但不照搬

可借鉴点：
- `blocks presenter + centralized renderer + fallback` 的组合。
- 公共间距/前缀/状态在单点定义。

Web 需要增强点：
- 更强的 layout slot（summary 右侧 meta、details actions、sticky controls）。
- 更强的可访问性（keyboard/focus/aria）与交互一致性。
- 与右侧审批面板联动（pending 状态映射）而不是仅文本渲染。

## 目标组件模型（Web）

建议目录（草案）：
- `packages/web-reference-react/src/components/tool/ToolTranscriptItem.tsx`
- `packages/web-reference-react/src/components/tool/ToolUiBlocks.tsx`
- `packages/web-reference-react/src/components/tool/toolUiBlocksTypes.ts`
- `packages/web-reference-react/src/components/tool/ToolRegistry.ts`
- `packages/web-reference-react/src/components/tool/shared/*`

公共基元（全局改动入口）：
- `ToolHeaderRow`：状态点 + ToolName + params + 右侧 meta
- `ToolSummaryRow`：一行摘要（成功/失败/空结果）
- `ToolDetailsFrame`：可折叠容器 + 统一内边距/行高
- `ToolIoBlock`：IN/OUT 双区块模板（Bash/command 类复用）
- `ToolActionBar`：copy/expand 按钮统一位置与行为

Tool 专用 renderer（独立扩展入口）：
- `renderBashTool`
- `renderGlobTool`
- `renderReadTool`
- `renderWriteTool`
- `renderEditTool`
- `renderTaskTool`
- 默认 `renderFallbackTool`

状态点规范（对齐 TUI 已有语义）：
- `running`：呼吸灯（pulsing）
- `completed`：成功态（如绿色）
- `error`：失败态（红色）
- 禁止把 Tool 状态简化成单一固定颜色

## 变更隔离规则（必须满足）

Rule A：公共 UI 改动只改共享层
- 示例：header 间距、状态点尺寸、details 折叠图标样式。
- 允许改动文件：`shared/*` + `ToolUiBlocks.tsx`。
- 不应改动每个 `renderXxxTool`。

Rule B：Tool 专属能力只改对应 renderer
- 示例：Write 的预览块、Task 的 nested 工具树、Bash 的 IN/OUT 展示增强。
- 允许改动文件：对应 `renderXxxTool` 和其私有子组件。
- 不应影响其他 Tool snapshot/行为。

Rule C：协议字段新增不破坏旧 renderer
- 新增 block 类型时必须有 fallback 渲染或忽略策略。
- Router 不因单个 Tool 升级导致全局渲染失败。

Rule D：参数展示来自真实 schema，不硬套截图文案
- Tool header/params 必须从真实 tool input 做格式化映射（如 `pattern`、`path`、`file_path`）。
- 可借鉴 CC 展示风格，但不能假设所有工具都固定 `Glob pattern: ...` 模板。
- 当 schema 演进时，只调整参数格式化层，不改每个 tool renderer。

Rule E：禁止 Tool 全量 Card 化
- 禁止给每条 Tool 外层套统一 Card 背景/边框容器。
- Tool 的层级靠排版、缩进、状态点、分隔节奏表达，而不是大块卡片。
- 仅允许局部结构（如 IN/OUT、patch preview、approval block）使用子容器。

### Rule D-1：`formatToolParams` 细分规范（Web）

目标：把“参数展示逻辑”收敛到一个 formatter 层，避免散落在各 tool renderer 里。

建议文件（草案）：
- `packages/web-reference-react/src/components/tool/formatToolParams.ts`
- `packages/web-reference-react/src/components/tool/formatToolParams.test.ts`

统一输出结构（建议）：
```ts
type ToolParamsDisplay = {
  label: string // 例如 "pattern", "path", "file", "query"
  value: string // 已格式化/截断/脱敏后的展示值
}
```

统一规则（所有 tool 适用）：
- 字段顺序固定：先主参数，再上下文参数（如 path/cwd），最后模式参数（如 output_mode）。
- 字符串裁剪：单字段最大 80 字符，总 params 文本最大 180 字符，超出用 `...`。
- 空值处理：`null/undefined/''` 不展示。
- 路径处理：优先相对路径（基于 cwd），失败则回退原值。
- 机密处理：命中 `token/key/password/secret` 键名时显示 `[REDACTED]`。
- 未知 tool：回退为安全 JSON 摘要（裁剪后）。

Tool 级映射表（v1）：

1. `Glob`
- 输入优先级：
  - `pattern`: `input.pattern ?? input.glob`
  - `path`: `input.path`（可选）
- 展示模板：
  - `pattern: "<pattern>"`
  - `path: "<path>"`（存在时）

2. `Grep` / `Search`
- 输入优先级：
  - `pattern`: `input.pattern`
  - `path`: `input.path`（Grep 为空时可回退 `"."`）
  - `output_mode`: `input.output_mode`（可选）
- 展示模板：
  - `pattern: "<pattern>", path: "<path>", output_mode: "<mode>"`

3. `Read`
- 输入优先级：
  - `file`: `input.file_path ?? input.path`
- 展示模板：
  - `<file>`

4. `Write`
- 输入优先级：
  - `file`: `input.file_path ?? input.path`
  - `content`: 仅用于计算 metadata，不直接全文展示
- 展示模板：
  - `<file>`
  - 可选 meta：`(<n> lines)`（来自 content 行数）

5. `Edit`
- 输入优先级：
  - `file`: `input.file_path ?? input.path`
  - `old_string/new_string`: 不直接进 header 参数
- 展示模板：
  - `<file>`
  - diff/patch 信息放 details/custom block，不放 params

6. `Bash`
- 输入优先级：
  - `command`: `input.command`
  - `cwd`: `input.cwd`（可选）
- 展示模板：
  - `<command>`
  - 可选 `cwd: "<cwd>"`

7. `WebSearch`
- 输入优先级：
  - `query`: `input.query`
- 展示模板：
  - `query: "<query>"`

8. `WebFetch`
- 输入优先级：
  - `url`: `input.url`
- 展示模板：
  - `<url>`

9. `Task`
- 输入优先级：
  - `subagent_type`: `input.subagent_type`
  - `description`: `input.description`
  - `prompt`: `input.prompt`（description 缺失时）
- 展示模板：
  - `<subagent_type>(<description|prompt>)`

10. `AskUserQuestion`
- 输入优先级：
  - `questions`: `input.questions`
- 展示模板：
  - `<n> questions`

11. `TodoWrite`
- 输入优先级：
  - `todos`: `input.todos`
- 展示模板：
  - `<n> items`

12. unknown tool
- 输入：整个 `input`
- 展示模板：
  - `JSON.stringify(input)`（裁剪 + 脱敏）

### Rule D-2：参数层与渲染层职责分离

- `formatToolParams` 只负责“把 input -> 展示字段”。
- `renderXxxTool` 只负责“排版和交互”，不自行拼参数字符串。
- 如需新增字段，只改 formatter + formatter test，不批量改 renderer。

### Rule D-3：参数格式化测试矩阵

`formatToolParams.test.ts` 至少覆盖：
- 每个高频 tool（Glob/Read/Bash/Write/Edit/Task）各 1 个正常用例。
- 空输入/字段缺失回退策略（不崩溃）。
- 超长字符串裁剪。
- 机密字段脱敏。
- 路径相对化与失败回退。
- 未知 tool 的 JSON 摘要路径。

## 分阶段计划

## P0（先把架构搭起来）

1. 定义 `ToolUiBlock` 协议与 renderer
- 先支持：`header | summary | details | lines | custom`
- `custom` 作为复杂场景逃生舱

2. 建立 registry/router
- `toolName -> renderer` 映射
- 未注册 Tool 走 fallback

3. 迁移高频简单 Tool（Read/Glob/Bash）
- 先覆盖截图中高频路径
- Bash 统一走 `ToolIoBlock` 模板

4. 锁定公共层测试
- `ToolUiBlocks` 结构快照测试
- 交互测试：expand/collapse/copy/focus
- 状态测试：running/completed/error 三态点样式与动画
- 参数测试：同一 tool 在不同 input 结构下展示稳定且可回退

## P1（把复杂 Tool 接进来）

1. 迁移 Write/Edit
- 使用 `custom block` 注入 patch/preview
- 保证不破坏 Read/Glob/Bash

2. 迁移 Task/Approval 关联展示
- transcript 内给出 pending 状态
- 保持与右侧 `PendingInputPane` 的关联提示

3. 统一详情区操作条
- 控件位置、hover/focus、快捷键一致

## P2（可选优化）

1. 长会话性能
- details 惰性渲染
- 长输出虚拟化或渐进展开

2. 语义增强
- turn 级分组/跳转锚点
- tool 结果模板统一（found/read/wrote/error）

## 验收标准（针对你的痛点）

1. 公共改动单点生效
- 修改 header 间距后，Read/Glob/Bash/Write 同步变化。
- MR 中不需要同时改多个 `renderXxxTool` 文件。

2. 特殊能力局部演进
- 给 Write 新增预览交互，只改 `renderWriteTool` 相关文件。
- 其他 Tool 的 DOM 结构与交互测试不变。

3. 渐进迁移安全
- 新旧 renderer 可并存，未迁移 Tool 不回归。
- fallback 路径在未知 Tool 上稳定可见。

4. 截图场景通过
- `/init` 后连续 Tool 流可快速扫读。
- Bash 长输出默认可控高度并可展开。
- Write 审批能看出与对应 Tool 的关联关系。

6. 非卡片化达成
- 连续 5+ 条 Tool 时不出现“一条一个大卡片”的视觉堆叠。
- Transcript 主流是行流式阅读，仅局部细节块有轻量容器。

5. 语义边界不回归
- Tool UI 重构后，Thinking 插入时机与顺序不变化（仍由事件类型决定）。
- 不因组件改造导致 Thinking/Tool 混并或错位。

## 对当前文档的执行建议

1. 先实现协议、共享层和 registry，再做视觉细化。
2. 每次只迁 1~2 个 Tool，避免“全量迁移 + 全局回归”风险。
3. 每次迁移都补：公共层测试 + 对应 Tool 渲染测试。

## 输入区审批双形态（与 Tool 展示并行）

1. `ask_user_question`
- 输入区锚定面板展示。
- 同一个 input 的 `questions` 按 `1 of N` 分页。
- 支持 `Dismiss/ESC` 收起；再次打开保留草稿。
- 最后一页统一 `Submit` 全量 answers。

2. `approval`
- 输入区锚定面板展示。
- 不显示 `1 of N`。
- 不提供 `Dismiss/ESC` 路径。
- 仅允许通过 `Submit` 完成审批。

3. 布局职责
- 右栏仅保留 workspace diff，不再承载 pending input 表单。
- Tool 行只展示与审批相关的状态，不承载完整审批交互。
- 审批面板激活期间隐藏 composer；resolved 后恢复。

## 已完成进度（2026-02-12）

1. 输入区审批双形态与布局改造
- `ask_user_question` 输入区分页面板（`1 of N`、`Dismiss/ESC`、`Continue/Submit`）已落地。
- `approval` 输入区面板（仅 `Submit`）已落地。
- 右栏已切为 diff-only，pending 表单从右栏移除。
- 审批激活时 composer 锁定，resolved 后恢复。

2. Tool 渲染组件化（非卡片化）
- Tool 渲染已切到 `ToolTranscriptItem + ToolUiBlocks + toolBlocksRegistry` 协议层。
- 公共 header/details 结构复用，Tool 行保持流式，不再整卡包裹。
- 工具状态点支持运行态呼吸灯、错误态红点、输入态联动点色。

3. Tool 参数格式化集中层
- 已新增 `formatToolParams` + `stringifyToolParams`，参数解析/排序/脱敏/裁剪收敛到单点。
- 已覆盖：`Bash`、`Glob`、`Grep/Search`、`Read/Write/Edit`、`WebSearch`、`WebFetch`、`Task`、`AskUserQuestion`、`TodoWrite`。

4. Tool 专用 renderer 覆盖
- `Bash`：`command` 提升为标题，余参保留。
- `Glob`：`pattern` 提升为摘要，保留 found/no files 语义。
- `Read/Write/Edit`：`file` 提升为标题。
- `WebSearch/WebFetch`：`query/url` 提升为标题。
- `Task`：`subagent_type + description/prompt` 提升为标题。
- `AskUserQuestion/TodoWrite`：数组项计数提升为标题。

5. 回归保障
- `ToolTranscriptItem.test.tsx`、`formatToolParams.test.ts`、`App.test.tsx`、`store.test.ts` 持续补齐。
- CI 已补充 web-reference-react 专属 `type-check + test`，避免仅跑根目录 `packages/core/src/**` 漏检。

6. Mode 语义统一（TUI / app-server / web）
- 新增共享 `replModeTransition` 语义层（规范化 + transition 判定）。
- app-server turn 执行期支持运行时 mode 切换并发出 `turn/modeChanged`。
- web 端消费 `turn/modeChanged` 与 replay `state.mode`，并修复切线程 mode 串用窗口期。
- TUI `setReplMode` 已改为同一 transition 语义，不再各自分叉。
