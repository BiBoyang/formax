# WebGPT 审查与增强 Prompt（Formax App Server）

你将收到 **6 个平铺文件**（同级上传，不带目录前缀）。请先理解每个文件的作用，再开始分析：

1. `repomix-app-server-gui-mvp-extended.txt`
- 主要代码包（源码+关键测试），是你做技术判断的核心证据来源。

2. `DESIGN.md`
- 当前 app-server 方案设计稿（目标架构、协议、分期、约束）。

3. `TODO.md`
- 当前执行清单（phase 拆分、验收标准、实施顺序）。

4. `repomix-bundles-tree.txt`
- 打包目录树说明，用于快速核对代码包覆盖范围与缺口。

5. `repomix_extract.py`
- 针对repomix打包的文件做提交的脚本文件。

5. `repomix-lookup.md`
- 如何使用 repomix 文件。

你拿到的是 **repomix 打包代码 + 方案/TODO 文档**，不是可执行仓库。
请先做静态分析，不要假设你能运行任何本地命令。

## Inputs

1. 代码包（源码与相关测试）
- `repomix-app-server-gui-mvp-extended.txt`

2. 方案设计
- `DESIGN.md`

3. 执行清单
- `TODO.md`

4. 打包范围树
- `repomix-bundles-tree.txt`

## 背景与目标

我们正在把 Formax 从纯 TUI（Ink REPL）扩展为可供 GUI 驱动的 app-server。

已确定约束：
- 借鉴 Codex 架构分层，但**不做 Codex 协议兼容**。
- 一期传输固定为 **子进程 + stdio JSONL + JSON-RPC 2.0**。
- 一期要做可用闭环：thread/turn、流式事件、approval、AskUserQuestion、session resume。
- 线程持久化复用现有 `sessionSave`。

我们希望你重点“改进与充实”现有方案，特别是 **approval/用户输入交互链路**，把边界和失败模式补完整。

## Hard Constraints

1. 不要建议运行任何命令（包括测试、构建、lint、coverage）。
2. 不要依赖 bundle 之外的文件或事实。
3. 先给分析与决策，再给改进方案；避免泛泛建议。
4. 优先最小改动可落地，不要把范围扩大成重写项目。
5. 保持既有产品约束：一期不做 overlay 类 slash command GUI 对齐。

## 重点审查问题（必须覆盖）

### A. Protocol/Transport 完整性
- `initialize/initialized` 握手是否足够稳健？
- `thread/*` 与 `turn/*` 方法是否缺少关键字段（例如 trace id、timestamps、status enums）？
- `turn/event` 事件模型是否需要拆分/补充（如统一 item id、event seq、event source）？
- 错误模型是否可调试（typed error codes + recoverability）？

### B. Approval + AskUserQuestion 交互链路（重点）
- 如何定义 `turn/inputRequested` 的统一 schema（approval / ask_user_question）？
- 如何处理以下场景：
  - 客户端重复提交答案（幂等）
  - 客户端超时未答复
  - turn 被 interrupt 时仍有 pending input
  - 服务端重启后 pending input 的恢复/失效策略
- 如何避免“UI pending 但 server 已结束”的竞态？
- 需要哪些状态机与状态字段才能让 GUI 端实现稳定？

### C. 执行与并发语义
- 单线程单 in-flight turn 规则是否还缺冲突细节？
- 多线程并发下的资源/锁粒度建议。
- `turn/interrupt` 的语义边界（可中断点、不可中断点、最终状态）。

### D. 持久化与可恢复性
- `sessionSave` 复用是否会丢失 app-server 必需信息（turn 状态、pending input、event 序列）？
- 是否应补充轻量 app-server 元事件（不破坏现有 reader/writer）？
- `thread/list/read/resume` 在大规模会话下的可扩展性建议。

### E. 安全/边界
- stdio JSONL 下的输入校验与消息大小限制建议。
- 防止恶意或错误客户端导致的资源泄漏（无限 pending、无界队列、超长 payload）。

## Required Output（严格按这个结构）

### 1. Root Cause Model
- 用“主因 + 次因”描述当前方案潜在短板。
- 每条都要引用输入材料中的证据点（文件路径/片段描述）。

### 2. 方案增强版（Design v2 Addendum）
- 输出一个“增量补丁式设计”：只写新增/修改点，不重写整份设计。
- 必须包含：
  - 协议字段补充
  - approval/input 状态机
  - 错误码与恢复策略
  - 持久化补充建议

### 3. TODO 增强版（必须是可打勾清单）
请基于我们现有 TODO 输出一份“补充后的 TODO v2”，要求：
- 保留原有阶段结构（Phase 0..N），在其上补充。
- 对“你判断已完成”的项标记 `[x]`，并给一句证据说明。
- 新增项标记 `[ ]`，粒度要细到可直接执行（函数/模块级别）。
- 每个 phase 增加“验收标准（可观察断言）”。
- 单独增加 `Approval Hardening` 小节（至少 12 个可执行子项）。

### 4. Option Comparison
至少给 2 个版本：
- 最小改动版（优先）
- 稍高改动版（结构更优）

并说明取舍：复杂度、风险、一致性、可迭代性。

### 5. 最终推荐与实施顺序
- 给出推荐方案。
- 给出“按 PR 粒度”的顺序（每个 PR 的目标、改动面、风险点）。

## 输出风格要求

- 中文输出。
- 先决策，后细节。
- 列表清晰，避免空泛建议。
