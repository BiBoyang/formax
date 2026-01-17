# Skills（技能）对齐笔记

这篇笔记回答一个核心问题：
**Claude Code 的 skills 是怎么“让模型用起来”的，以及 Formax 如何对齐。**

目标读者：想把 Formax 的技能系统做得更像 Claude Code 的同学（不要求非常熟悉 prompts/tool-loop）。

## 1) 抓包能确定的事实（重要）

1. **skills 列表不是写进 system prompt 的正文里**  
   Claude Code 会把可用 skills 列表，拼进 `Skill` 工具的 `description` 里（`<available_skills>...</available_skills>`），让模型“看到可用技能”。

2. **Skill 的本地确认 UI 不会出现在请求 JSON 中**  
   是否允许某个 skill、以及“don’t ask again”，属于本地 UI 交互；抓包里看不到该确认步骤。

3. **“don’t ask again” 会落盘，并且运行时实时读取**  
   从实验现象看，允许项写入 `settings.local.json` 后会立即生效；移除后不重启也会重新弹确认，说明不是启动时缓存。

4. **Skill tool_result 会把 skill 指令注入到会话**  
   tool_result 里能看到类似：
   - `Launching skill: frontend-design`
   - `Base directory for this skill: ...`
   - 后面跟随 skills 的 instructions 文本

## 2) Formax 的实现映射（.formax 目录）

Formax 只对齐机制与行为，目录以 `.formax` 为准（不读取 `.claude`）。

- skills 扫描/元数据：`src/skills/SkillStore.ts`
  - projectRoot 解析：`src/adapters/fs/projectRoot.ts`
  - 扫描目录：`<projectRoot>/.formax/skills`（project 覆盖 user）
  - 进程内缓存：per-projectRoot TTL（`FORMAX_SKILL_STORE_CACHE_TTL_MS`，默认 5s；无 `/skills reload`）
- `Skill` tool spec（含 `<available_skills>`）：`src/tools/modules/skill/spec.ts`
- 每轮按 cwd 动态注入 `<available_skills>`：`src/tools/modules/skill/index.ts` + `src/features/repl/useReplController.ts`
- `Skill` tool handler（tool_result 注入文本）：`src/tools/modules/skill/handler.ts`
- repo 级 allowList（落盘）：`src/adapters/permissions/skillAllowList.ts`
  - 文件路径：`<projectRoot>/.formax/settings.local.json`（projectRoot 规则见 `src/adapters/fs/projectRoot.ts`）
  - 记录格式：`permissions.allow` 包含 `Skill(frontend-design)` 这样的字符串
- Skill 调用前的本地确认（preflight + UI）：  
  - preflight：`src/tools/executor/skillPreflight.ts`
  - presenter：`src/tools/modules/skill/presenter.tsx`
  - 确认框 UI：`src/tools/presenters/skillApprovalPrompt.tsx`

## 3) 为什么要把 skills 列表放进 tool description？

因为模型在“决定要不要调用 Skill”之前，必须先知道“有哪些 skill 可用”。  
把列表放进 `Skill.description` 有两个好处：
- 不会把 skills 列表污染整个 system prompt（局部化在一个工具的定义里）
- 可以针对不同 cwd/repo 热更新：新增/删除 skill 后，下次请求就能看到变化

## 4) 手动验收（建议）

在一个空目录（或新 repo）里：
1. 放一个 `.formax/skills/frontend-design/SKILL.md`
2. 触发一个明显需要 UI 设计的任务，让模型调用 `Skill(frontend-design)`
3. 第一次：应弹确认框；选择 “don’t ask again”
4. 第二次：不应再弹
5. 手动编辑 `<repo>/.formax/settings.local.json` 删除 `Skill(frontend-design)` 后再触发：应重新弹确认

以上流程用来验证“落盘 + 热更新”是否对齐 Claude Code 的行为。
