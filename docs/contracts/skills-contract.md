# Skills 合同（唯一事实源）

最后更新：2026-03-02  
状态：规范性（Normative）

本文档定义 Formax `Skill` 能力的唯一事实来源（Single Source of Truth）。

范围：
- Skill 目录发现规则与优先级
- Skill 名称推导与合法性约束
- Skill 元数据（frontmatter）与可调用性约束
- `.agents/skills` 与 `.formax/skills` 的长期并行支持边界

不在范围内：
- Tool 审批 UI 视觉样式
- Skill 具体提示词内容质量
- 非 Skill tool 的通用工具执行语义

相关实现（规范锚点）：
- `packages/core/src/features/skills/SkillStore.ts`
- `packages/core/src/tools/modules/skill/index.ts`
- `packages/core/src/tools/modules/skill/handler.ts`
- `packages/core/src/tools/executor/skillPreflight.ts`

规范关键字约定：
- `MUST`、`SHOULD`、`MAY` 采用 RFC 2119 语义。

## 1. 权威模型

`SKILL-001`  
Skill 发现与解析的权威实现 MUST 位于 `packages/core/src/features/skills/SkillStore.ts`。

`SKILL-002`  
Skill 调用行为（unknown/missing/disabled、正文截断、返回结构）MUST 以 `packages/core/src/tools/modules/skill/handler.ts` 为准。

`SKILL-003`  
给模型注入 `<available_skills>` 的语义与预算行为 MUST 以 `packages/core/src/tools/modules/skill/index.ts` 为准。

## 2. 目录发现与优先级

`SKILL-PATH-001`  
项目根目录解析 MUST 使用 `resolveFormaxProjectRoot(cwd)`，而非直接假设 `cwd` 为项目根。

`SKILL-PATH-002`  
SkillStore MUST 扫描以下目录（按覆盖优先级从低到高）：
1. 用户目录：`<FORMAX_CONFIG_DIR>/skills/**/SKILL.md`
2. 项目历史目录：`<project>/.agents/skills/**/SKILL.md`
3. 项目标准目录：`<project>/.formax/skills/**/SKILL.md`

`SKILL-PATH-003`  
同名 skill 冲突时 MUST 使用“后写覆盖前写”规则，因此优先级为：
1. `.formax/skills`（最高）
2. `.agents/skills`
3. 用户目录 `skills`（最低）

`SKILL-PATH-004`  
`.agents/skills` 与 `.formax/skills` 同属受支持目录。  
实现 MUST 长期保持对 `.agents/skills` 的读取支持，不得将其视为临时 shim。

## 3. 文件与命名规则

`SKILL-FILE-001`  
仅文件名为 `SKILL.md`（大小写不敏感匹配）才会被识别为 skill 文件。

`SKILL-NAME-001`  
skill 名称来源规则：
1. 若 frontmatter 存在 `name`，优先使用该值。
2. 否则使用相对目录推导：`<baseDir>/<a>/<b>/SKILL.md -> a:b`。

`SKILL-NAME-002`  
名称合法性 MUST 满足：
1. 不得包含 `/`、`\`、`..`。
2. 每个段（`:` 分隔）必须匹配 `^[A-Za-z0-9][A-Za-z0-9_-]*$`。

`SKILL-NAME-003`  
当前名称规范化仅做 `trim`，MUST NOT 隐式改大小写。

## 4. 元数据与可调用性

`SKILL-META-001`  
frontmatter 可选字段：
1. `description`
2. `argument-hint`
3. `disable-model-invocation`

`SKILL-META-002`  
`description` 取值顺序 MUST 为：
1. frontmatter `description`
2. 正文第一条有意义文本
3. fallback `Custom skill`

`SKILL-META-003`  
当 `disable-model-invocation=true`（含 `1/yes`）时：
1. MUST 从 `<available_skills>` 注入列表中过滤。
2. MUST 在 `Skill` tool 执行时返回 disabled 错误，而不是继续执行正文。

## 5. 调用行为合同

`SKILL-CALL-001`  
`Skill.input` MUST 只接受 `skill` 字段；额外字段视为无效输入。

`SKILL-CALL-002`  
`skill` 缺失或空字符串 MUST 返回 `Missing skill` 错误。

`SKILL-CALL-003`  
请求未知 skill MUST 返回：
1. `Unknown skill: <name>`
2. `Available skills: ...`（若为空则 `(none)`）

`SKILL-CALL-004`  
读取 skill 正文后 MUST 去除 frontmatter，仅向执行层注入正文内容。

## 6. 目录支持策略（长期）

`SKILL-COMPAT-001`  
.agents/skills 目录支持是稳定业务能力，不得在重构中以“清理兼容层”为由移除。

`SKILL-COMPAT-002`  
无论是否新增其他目录规范，`.agents/skills` 的读取行为 MUST 保持向后兼容。

## 7. 一致性测试映射

主测试集：
1. `packages/core/src/features/skills/SkillStore.test.ts`
2. `packages/core/src/tools/modules/skill/handler.test.ts`
3. `packages/core/src/tools/modules/skill/index.test.ts`
4. `packages/core/src/tools/executor/skillPreflight.test.ts`

## 8. 变更流程

当改动 Skill 的目录规则、优先级、命名与调用行为时：
1. 先更新本文件。
2. 再更新实现与测试。
3. 在 `docs/runbooks/runbook.md` 增补对应排障项（若影响用户迁移路径）。

若实现与本合同冲突，应视为实现漂移并立即收敛修正。
