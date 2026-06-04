# 大型 Todo 过早定稿导致架构漂移

日期：2026-06-04

## 问题

大型跨层任务在架构语义还没完全对齐时就开始写完整 `docs/todolist.md`，容易把“还没验证的假设”包装成“待执行任务”。后续讨论中一旦发现权限、配置、入口、UI、SDK 或协议语义不对，todo 就会不断返工，甚至让实现计划带着错误模型往前滚。

典型信号：

- todo 里出现大量 `if practical`、`where needed`、`either`、`fallback`、`unless scoped`、`later`。
- 一个能力还没定义清楚属于 tool、slash command、SDK control、config、hook、renderer，todo 已经开始分文件写实现步骤。
- 关键规则写成 “Reference-style” 或 “parity”，但没有标明来自 Claude Code、SDK/spec、现有 Formax 行为，还是本地安全选择。
- 只按一个入口思考，例如 REPL，后来才补 SDK、app-server、Web、Electron。
- 权限相关内容先发明新 action / 新 matcher / 新 approval 语义，而不是先验证现有 Formax permission / policy / approval / hook 能不能表达。
- non-goal 只写“不做 X”，没写清上游是否有、Formax Phase 1 是否做、用户会看到什么行为。

## 复现

1. 任务跨越多个 Formax 边界，例如 runtime config、tools、permissions、SDK、REPL、app-server、Web、protocol transport、result mapping。
2. 直接生成完整 todo，包括文件路径、loop、测试、review checklist。
3. 后续才开始追问：
   - 配置到底存哪？
   - 哪些入口读取配置？
   - 哪些入口会启动 runtime？
   - 权限是否复用现有模型？
   - 动态能力到底和现有 tool / ToolSearch / renderer 是什么关系？
   - output cap、timeout、文件落盘阈值从哪来？
4. 每发现一个语义问题，就改一次 todo；旧任务项里残留的模糊词继续制造二次返工。

## 根因

大型 todo 不是实现清单优先，而是决策清单优先。

Formax 的关键能力通常不是单入口、单模块、单 UI：同一个能力可能同时影响 REPL、SDK、app-server、Web、Electron、配置系统、权限系统、hook、prompt exposure、tool runtime、transcript renderer 和测试矩阵。

如果先写实现清单，会发生几个问题：

- **假设被任务化**：还没确认的设计被写成 `[ ] Add ...`，看起来像已经决定。
- **来源被混淆**：reference-derived、Formax-existing、本地 safety choice 混在一起，后续很难判断该对齐谁。
- **入口被遗漏**：只设计主入口，其他入口后补，导致共享边界和空 overlay / unsupported behavior 不清楚。
- **权限被过度建模**：新能力一出现就想加新 policy action，而不是先映射到现有 tool permission flow。
- **非目标变成隐藏债务**：写“defer X”但没写用户实际看到什么，review 和实现时会反复重新讨论。
- **模糊词掩盖未决策**：`if practical`、`either`、`fallback` 让真正的产品决策延迟到实现阶段。

## 修复

大型跨层任务先写短的 **Decision Draft**，对齐后再生成最终 todo。

Decision Draft 至少要钉死：

- **Storage / config source**：数据存哪，谁读取，谁不能读取。
- **Schema / strictness**：支持哪些字段，默认值是什么，未知字段 fail-open 还是 fail-closed。
- **Startup / activation timing**：哪个入口允许产生 side effect，哪些阶段必须纯只读。
- **Permission model**：现有 Formax permission / policy / approval / hook 是否能表达，不能表达再加新概念。
- **Capability level**：这是 tool、dynamic tool、ToolSearch/deferred catalog、slash command、SDK control、hook、config setting，还是 transcript renderer。
- **EntryPoint Matrix**：REPL、SDK、app-server、Web、Electron 分别是否读配置、是否启动 runtime、是否暴露能力、是否有 UI/transcript、是否有测试。
- **Result / IO boundaries**：输出上限、timeout、文件路径、二进制/media、secret redaction、cleanup 策略及来源。
- **Non-goals**：上游/reference 是否有；Formax Phase 1 是否做；用户看到什么行为。

最终 todo 生成前跑模糊词扫描：

```sh
rg -n "where needed|if needed|if practical|either|or explicitly|fallback|unless scoped|later|may|might|optional|as needed|TBD|unresolved" docs/todolist.md
```

每个命中必须归类为：

- Phase 1 接受规则
- 明确 non-goal
- Phase 2 backlog
- stop condition
- 需要问用户的问题

Phase 1 主路径里不要留下“实现时再决定”的句子。

## 操作规则

- 大型跨层 todo 必须先完成 Decision Draft，再写 `docs/todolist.md`。
- 关键语义决策必须标来源：
  - `Reference-derived`
  - `Formax-existing`
  - `Formax-Phase-1 safety choice`
  - `User-aligned`
- 权限相关任务默认先复用现有 permission / policy / approval / hook flow。
- 动态能力先定义产品层级，再选择实现路径。
- threshold、timeout、byte cap、file-backed path、secret redaction、cleanup policy 必须标来源；如果是本地 safety choice，就明确写出来并加测试。
- non-goal 不能只写“不做”，必须写清用户可见行为。

## 相关文档

- `.codex/skills/write-task-todo/SKILL.md`
- `docs/contracts/permissions-policy-contract.md`
- `docs/contracts/prompt-tool-exposure-contract.md`
- `docs/contracts/tool-runtime-contract.md`
- `docs/contracts/config-settings-contract.md`

## 关键词

large todo, premature todo, architecture drift, Decision Draft, EntryPoint Matrix, vague language, permission over-modeling, reference attribution, non-goal, Formax Phase 1
