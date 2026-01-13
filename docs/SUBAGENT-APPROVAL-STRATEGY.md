# Sub-agent 审批与“只读约束”策略（Claude Code / Formax / Kode-cli 对比）

目标：让新人只读完这一份文档，就能理解：
- 为什么会出现“sub-agent 不该改文件却又可能触发写入/确认”的冲突
- Formax 目前采用的解决方案（向上审批作为最后防线）与代码落点
- Claude Code 和 Kode-cli 的思路差异（基于抓包/日志与本地代码观察）

---

## 1) 背景：我们在解决什么问题？

在 CLI 里引入 `Task`（sub-agent）后，会出现一个典型矛盾：

1. **产品期望**：Explore / Plan 这类 sub-agent “应该只探索/设计”，最好不要改文件、不要弹确认，最终返回一个结果即可。
2. **现实能力**：工具体系里存在 `Write/Edit/Bash(WebFetch...)` 等可能触发写入或审批的工具；如果 sub-agent 有权限调用这些工具，就可能：
   - 触发审批，导致 UI 需要用户交互
   - 触发后台任务死锁（后台没有 UI 可以交互）
   - 产生“sub-agent 叫主 agent 代执行”的怪流程（下一轮对话可能被污染/误执行）

我们希望达到的体验（对齐 Claude Code）：
- Explore/Plan sub-agent **尽量不触发审批**，更像“拿结果/报告”的黑盒执行。
- 如果真的触发了写入/高风险 Bash：**主会话兜底**（向上审批），作为“最后防线”，而不是把 sub-agent 逼成“请你回到主会话再跑一遍”。

---

## 2) Claude Code 观察：它是怎么避免这个问题的？

> 结论先讲：Claude Code 的 `Task` 描述里虽然写着 Explore/Plan “Tools: All/*”，但从抓到的交互与日志看，**它在实践上把 Explore/Plan 当作“只读探索/规划”来用**：写入与关键交互发生在主会话，而不是 sub-agent 内部。

证据（来自本仓库记录）：
- `plans/sub_agent_detail/2.txt`：主会话进入 plan mode 后，先并行跑多个 Explore agent，然后启动 `Plan(Design ...)`。
- `plans/sub_agent_detail/2-detail.txt`：展开 `Plan` 的详细 tool uses 后，可以看到它主要在做 `Search/Read/Bash(find...)` 等探索动作；**没有出现 Write/Edit**。
- 同批次记录中，“问用户问题 / 进入 plan mode / 退出 plan mode 的确认”均表现为主会话 UI 流程，而不是在 Plan/Explore 子任务里直接弹交互。

这意味着 Claude Code 的“只读约束”主要靠两层：
1. **prompt/流程约束（软约束）**：告诉 Explore/Plan 该做什么、不该做什么（例如只探索，只给出方案/报告）。
2. **产品层执行编排（主会话掌控）**：需要交互/确认/写入时，由主会话工具来做（例如 plan mode 的进入/退出与最终写 plan 文件）。

---

## 3) Formax 当前策略：向上审批作为最后防线

我们最终选择的策略（与你达成一致）：
- **不引入“sub-agent 写入硬 deny”**（避免未来能力扩展受限、且 Claude Code 的工具宣称是 `*`）。
- **把“向上审批”当作最后防线**：sub-agent 如果触发了需要审批的工具（典型是 `fs.write` 或高风险 `bash.exec`），让主会话 UI 来承接确认。
- **避免后台死锁**：后台 sub-agent（`run_in_background: true`）不允许进入交互审批；遇到需要审批直接返回稳定错误（`APPROVAL_REQUIRED`）。

### 3.1 关键规则（硬约束）

Formax 仍然有一类“必须禁用”的工具：**会改变会话状态或需要复杂交互的“会话型工具”**。这些工具在 sub-agent 中不可控/不可恢复，容易造成嵌套 UI 混乱。

当前在 `src/subagents/runner.ts` 里有硬 deny（`NESTED_DENY_TOOLS`），例如：
- `Task`（防止无限嵌套）
- `AskUserQuestion` / `EnterPlanMode` / `ExitPlanMode`（需要主会话 UI 协调）
- `SlashCommand` 等

这和“禁止写入”不是一回事：我们不禁止 sub-agent 调用 `Write/Edit`，但会让它们走审批与 policy。

### 3.2 审批流（前台 Task：允许向上弹确认）

当 `Task` 是前台运行（`run_in_background: false`）时：
- `src/tools/executor/handlers/taskSubAgent.ts` 会把 `interactive: true` 传入 sub-agent runner（见 `interactive: opts?.emitUi ?? true`）。
- sub-agent 若触发了需要审批的工具，`src/tools/executor/policyPreflight.ts` 会走 `approval.ensureApproved(...)`。
- `Task` presenter 会收到 nested 的 `tool_update`/`tool_end` 等事件，主 UI 可以进入 prompt mode，完成确认/拒绝。

这样 sub-agent 不需要“叫主会话重跑命令”，而是主会话直接接管审批。

### 3.3 审批流（后台 Task：禁止交互，返回稳定错误）

后台任务（`run_in_background: true`）没有 UI 来处理审批，否则会卡死（你之前遇到的 “Loading 很久” 就属于这类风险）。

因此我们引入了 `interactive` 语义：
- `Task` 后台执行：`src/tools/executor/handlers/taskSubAgent.ts` 传 `emitUi: false`，从而让 runner 拿到 `interactive: false`。
- `src/tools/executor/policyPreflight.ts` 检测到 `ctx.interactive === false` 时，不会调用 approval UI，而是返回：
  - `ErrorCode: APPROVAL_REQUIRED`
  - 以及完整的 policy explain（命中规则、原因、建议）

这保证后台任务“要么完成、要么明确失败”，不会挂住。

### 3.4 代码入口索引（新人从哪看/改）

建议按“从外到内”的路径读代码：
1. `src/tools/modules/task/*`：Task 工具输入/输出与 nested tool uses 展示
2. `src/tools/executor/handlers/taskSubAgent.ts`：前台 vs 后台（`interactive`）如何传递
3. `src/subagents/runner.ts`：sub-agent 允许哪些工具、deny 哪些工具
4. `src/chat/engine.ts` + `src/tools/executor/index.ts`：`ExecutionContext` 如何携带 `interactive`
5. `src/tools/executor/policyPreflight.ts`：policy 判定与审批/错误分支（`APPROVAL_REQUIRED` 的来源）
6. `src/tools/modules/bash/policy.ts`：哪些 Bash 会被判定为 confirm/deny（影响“为什么 tree/find 会弹确认”）

---

## 4) Kode-cli 的思路（对照）

（基于本机仓库 `/Users/david/Documents/github/Kode-cli` 的阅读结论）

Kode-cli 更偏“强约束/安全模式”：
- `TaskTool` 更像“只读 agent”：强调返回报告/结果，不鼓励修改工程；tool 集合可按 `safeMode` 切到只读集合。
- `BashTool` 的 prompt 会写得更严格：明确哪些命令/写文件方式（例如重定向 `>`）不允许；并通过权限/策略层做更强的拦截。

和 Formax 的主要差异：
- **Formax 更 Claude-like**：倾向把工具契约对齐到 tools-copy 的“宣称能力”（`tools: ['*']`），再用 policy + UI 兜底。
- **Kode 更 SafeMode-like**：倾向在工具集合层面直接限制可调用工具，减少“触发审批/写入”的可能性。

---

## 5) 三者策略对比（总结表）

| 维度 | Claude Code（观察） | Formax（当前） | Kode-cli（观察） |
|---|---|---|---|
| Explore/Plan 能否“理论上写入” | 描述上“All/*”，但实践上不写 | 描述/allowlist 允许写入，但期望不写 | 更倾向只读（safeMode/只读工具集合） |
| 需要审批时怎么处理 | 主会话处理（sub-agent 很少触发） | 前台：向上审批；后台：`APPROVAL_REQUIRED` | 更偏向前置限制/权限 gate |
| sub-agent 能否弹复杂交互（AskUserQuestion 等） | 交互多在主会话 | sub-agent 禁用会话型工具（hard deny） | 通常主会话统一交互 |
| 失败表现 | 明确输出错误/结果 | 明确输出 policy explain / error code | 明确拒绝/提示 |

---

## 6) 当前已知限制 & 后续改进方向

1. **“为什么 Claude Code 的 Explore 不会频繁 confirm，而 Formax 会？”**  
   这通常不是 Task 本身的问题，而是 Bash 风险分类（`src/tools/modules/bash/policy.ts`）与 policy 规则默认值的差异。  
   下一步想对齐体验：应该把 “tree/find/ls/cat/rg/head” 等只读命令更偏向 `allow`，并把真正危险的写入/破坏命令分到 `confirm/deny`。

2. **“soft only” 的风险**  
   我们现在依赖 prompt/流程约束让 Explore/Plan 不写文件。它不是强保证；真正的安全保证来自 policy + 审批兜底。  
   如果未来要更严格，可以再引入：sub-agent 默认只读 allowlist（SafeMode），但这会偏离 tools-copy 的“宣称能力”。

