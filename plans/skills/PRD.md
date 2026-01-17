# PRD：Skills（技能）机制 + 权限 allowList（对齐 Claude Code）

状态：草案（以抓包事实为准，迭代补齐）

## 1. 背景与目标

Formax 希望对齐 Claude Code 的 skills 机制，让“可用技能列表 → 模型选择技能 → 本地加载技能指令 →（可选）二次确认并记住”形成闭环。

本 PRD 聚焦两件事：

1) **Skill 工具的行为**（模型如何“看到” skills、如何调用、tool_result 如何注入）
2) **Skill 的本地审批与 allowList 落盘**（包含“don’t ask again”与作用域）

约束：
- 只支持 `.formax`（不做 `.claude` 兼容读取）
- 不确定的能力不默认做，必须显式列为 Optional 或待验证

## 2. 术语

- **Skill**：一个目录下的 `SKILL.md`，含 frontmatter + 指令正文（instructions）。
- **Skill tool（工具名：`Skill`）**：模型调用的工具，用于“启动一个技能（加载其 instructions 并注入到会话）”。
- **available_skills**：注入到 `Skill` 工具 description 的动态片段，列出当前会话可用技能。
- **allowList / permissions.allow**：用于“记住允许使用某个 skill”的权限白名单。

## 3. 抓包事实（Claude Code 对标结论）

> 本节是“对齐依据”。实现以事实为准，不依赖猜测。

### 3.1 skills 列表的暴露位置

Claude Code 并不是把 skills 列表写进 system prompt，而是把 `<available_skills>...</available_skills>` 拼进 **Skill 工具的 description**。

### 3.2 Skill tool 的执行/注入方式

当模型决定使用 skill，会输出 `tool_use name="Skill"`，随后客户端回注：

- `tool_result: "Launching skill: <skillName>"`
- 紧跟一段长文本：包含 base directory + skill 指令全文（instructions）

### 3.3 “是否允许使用 skill”的确认框不在抓包里

Claude Code 会弹出本地 UI（Yes / Don’t ask again / No+feedback），但该确认不会出现在 API 请求 JSON 中。

### 3.4 “Don’t ask again” 会落盘，且运行时实时读取

用户选择 “don’t ask again” 后，会把 `Skill(<skillName>)` 写入项目的 `settings.local.json`（repo 级别），后续同目录不再弹确认；
移除该条目后，当前会话再次调用 skill 会重新弹确认，说明是 **运行时读取 allowList**，而非启动时缓存。

## 4. 用户故事（User Stories）

### US1：模型能够“看到”可用 skills 并正确选择

- 作为用户，我希望模型在需要某类任务时能自动调用正确 skill（例如 `frontend-design` 用于 UI/HTML/Tailwind 相关任务）。

### US2：第一次使用 skill 时需要我确认，避免误触

- 作为用户，我希望首次调用某 skill 时弹出确认框；
- 我可以一次性允许该 skill，并可选择“在当前 repo 永久不再询问”。

### US3：拒绝 skill 时能把反馈传回模型（让它换方案）

- 作为用户，我拒绝后可以输入“请不用 skill，直接普通回答”等说明；
- 模型接到反馈后继续完成任务（而不是卡住）。

## 5. 功能范围（Scope）

### P0（必须做）

1) **技能扫描**
   - Project：`<repoRoot>/.formax/skills/**/SKILL.md`
   - User：`~/.formax/skills/**/SKILL.md`（或 `FORMAX_CONFIG_DIR/skills/**/SKILL.md`）
   - 同名 skill：project 覆盖 user（项目优先）

2) **Skill tool spec 的动态 description 注入**
   - `<available_skills>` 里输出技能清单（含 `name + description`；是否带 argument-hint 视现有数据）
   - 保证每次请求都根据当前磁盘内容生成（支持热更新）

3) **Skill tool handler（不含 UI）**
   - 接收 `skill: string`
   - 加载对应 `SKILL.md` 的 instructions，并按 Claude Code 风格生成 tool_result 文本（至少包含：Launching skill + base directory + instructions）
   - 需要有体积控制（char budget），避免把超长指令塞爆上下文

4) **权限审批（UI gating）+ allowList 落盘**
   - 当模型调用 `Skill(<name>)` 且当前 repo 未允许该 skill 时，弹出确认 UI：
     1. Yes
     2. Yes, and don’t ask again for `<skill>` in this repo
     3. No, and tell the model what to do differently
   - 选择 2 后写入 `<repoRoot>/.formax/settings.local.json`（或等价文件）：
     - `permissions.allow` 增加一条 `Skill(<skill>)`
   - **运行时实时读取**：下一次调用立刻生效（不要求重启）

### P1（建议做）

5) `/skills` 或 `/help` 中展示“可用 skills 列表”和来源（user/project）
6) allowList 的 UI 管理（列出/移除/重置）

### Optional（待抓包/后续）

- 全局 settings（类似 `~/.claude/settings.json`）：支持默认 permissions.allow + `env` 覆盖层
- per-skill 的更细粒度范围：按 cwd / repoRoot / workspace group 的差异（需继续验证）

## 6. 数据设计（存储与合并）

### 6.1 Skill 文件结构

目录：`<scopeDir>/skills/<skillName>/SKILL.md`

frontmatter（示例）：
- `name`（可选；默认从目录推导）
- `description`
- `argument-hint`（可选）
- `disable-model-invocation`（可选；true 则不出现在 available_skills，或标记不可用）

### 6.2 权限配置（repo 级）

文件：`<repoRoot>/.formax/settings.local.json`

最小结构（建议）：
```jsonc
{
  "version": 1,
  "permissions": {
    "allow": ["Skill(frontend-design)"]
  }
}
```

合并规则（建议）：
- repo settings 覆盖 global settings
- `permissions.allow` 做并集（若未来需要“显式禁用”，再引入 `permissions.deny`，deny 优先级最高）

> 备注：Formax 已有 `~/.formax/config.json` + `auth.json`。本 PRD 不要求改名；建议维持 auth 独立文件以降低泄露风险。

## 7. UX 交互（必须对齐的关键细节）

### 7.1 “允许使用 Skill”确认框

- 这是本地 UI（不出现在抓包 JSON）
- 选择 3 时，需要能输入一段自由文本反馈

### 7.2 拒绝后的模型继续策略

拒绝后需要向模型返回一个 tool_result（或等价事件）来“解除等待”，否则可能出现模型继续重复调用 Skill 或卡住。

建议返回（示意）：
- `Error: User did not approve Skill(frontend-design). Feedback: <user text>`（是否 is_error 需结合现有 tool loop 机制决定）

## 8. 安全与隐私

- 不建议把 API key 放进 settings/env；密钥仍建议放在 `auth.json` 或 env vars。
- `settings.local.json` / `auth.json` 可能包含敏感信息：任何 debug bundle/repomix/export 必须默认脱敏或排除。

## 9. 验收标准（DoD）

P0 必须满足：
- 在 `.formax/skills/frontend-design/SKILL.md` 存在时，模型请求里 `Skill` 工具 description 含 `<available_skills>` 且列出 `frontend-design`
- 模型调用 `Skill(frontend-design)` 时：
  - 首次会弹确认框
  - 选择 “don’t ask again” 后写入 `<repoRoot>/.formax/settings.local.json`
  - 不重启进程，下次同 repo 再次调用该 skill 不再弹确认
  - 删除 allow 条目后，同会话再次调用会重新弹确认（证明运行时读取）

## 10. 实施拆解（高层）

- 实现 SkillRegistry（扫描 + merge + 输出可用技能）
- Skill tool spec 动态注入 `<available_skills>`
- Skill tool handler 输出对齐 Claude Code 的注入文本
- permissions store（读/写 settings.local.json；支持热更新/mtime 缓存）
- Skill 调用时 UI gating + “拒绝/反馈”回注

