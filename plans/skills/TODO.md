# TODO：Skills（对齐 Claude Code 的最小落地清单）

基于 `plans/skills/PRD.md`（P0 必须做）拆分；默认只做 `.formax`。

## 决策（已确认）

- [x] **不做 pattern 匹配**（glob/prefix）：
  - `permissions.allow` 只支持精确 `Skill(<name>)`；
  - 不支持 `Skill(*)` / `Skill(frontend-*)` 等规则（复杂度收益比不划算）。
- [x] **权限语义对齐 Claude Code（忽略历史遗留）**：
  - `Write/Edit/NotebookEdit` 的 “remember/allow all edits” 仅对当前会话生效（切到 `acceptEdits`），不写入 `permissions.allow`
  - `Bash` 的 “don’t ask again” 才会写入 `<projectRoot>/.formax/settings.local.json` 的 `permissions.allow`
  - `Bash` 并不是“每条命令都要确认”：默认仍以策略引擎为准（`bash.exec` 默认 `allow`），仅当命令被判定为“可能产生副作用/需要二次确认”（例如重定向、`rm/mv/mkdir/...` 等）才会进入审批流程
- [x] **Project root 解析规则**（对齐 Claude/OpenCode 的“在子目录运行仍能发现项目配置”体验）：
  1. 从 `cwd` 向上查找最近的 `.formax/`；若找到，则以该目录为 projectRoot；
  2. 否则若能找到 git root，则以 git root 为 projectRoot；
  3. 否则退回 `cwd`。

## 0. 基线（现状盘点）

- [x] 已有 Skill 文件扫描：`src/skills/SkillStore.ts`（user + project，project 覆盖 user）
- [x] 已有 Skill tool handler 雏形：`src/tools/modules/skill/handler.ts`
- [x] 已有 Skill tool spec 雏形：`src/tools/modules/skill/spec.ts`
- [x] Skill 的 UI 审批（confirm / don’t ask again / feedback）：`src/tools/presenters/skillApprovalPrompt.tsx`
- [x] allowList 落盘 + 运行时实时读取（repo 级 settings.local.json）：`src/adapters/permissions/skillAllowList.ts`
- [x] Skill 工具 description 的 `<available_skills>` 动态生成（以当前 cwd 为准）：`src/tools/modules/skill/index.ts` + `src/features/repl/useReplController.ts`
- [x] tool_result 文本对齐 Claude Code（`Launching skill...` + `Base directory...` + instructions）：`src/tools/modules/skill/handler.ts`

## 1. 权限存储（repo 级 settings.local.json）

- [x] 定义 repo settings 文件位置：`<projectRoot>/.formax/settings.local.json`（按“Project root 解析规则”得到的 projectRoot）
- [x] 定义最小 schema：
  - `version: 1`
  - `permissions.allow: string[]`（含 `Skill(frontend-design)`）
- [x] 实现 PermissionsStore（最小可用：读/写/并发安全写入；不做 mtime 缓存）：
  - 读：每次判定时读取（保证“移除 allow 后不重启也会重新弹确认”）
  - 写：`writeJsonAtomic()` 原子写入，且保留 settings 其它字段（如 `env` / 其它 permissions）
- [x] 单测：写入/读取/保留其它字段/坏 JSON 保守为空（`src/adapters/permissions/skillAllowList.test.ts`）

## 2. Skill spec 的 `<available_skills>` 动态注入

- [x] 调整生成逻辑：由“模块初始化时 `process.cwd()`”改为“每次构建 tools spec 时按当前会话 cwd/repoRoot”
- [x] `<available_skills>` 产出格式对齐（最小可用）：
  - `name` + `description`
  - 不默认暴露绝对路径（除非你确认 Claude Code 在 tool desc 中也包含 path）
- [x] 单测：同进程切换 cwd（或模拟不同 repoRoot）时，`<available_skills>` 会变化

## 3. Skill tool handler 的输出对齐

- [x] tool_result 第一行：`Launching skill: <name>`
- [x] 追加：`Base directory for this skill: <dir>`
- [x] 追加：完整 instructions（按 char budget 截断）
- [x] Unknown skill：错误信息包含 available list（只列 name）
- [x] 单测：基础路径 + 输出对齐（`src/tools/modules/skill/handler.test.ts`）

## 4. UI gating（Skill 调用时确认 + 记住选择）

- [x] 在主会话执行 Skill tool 时加入 gating（`src/tools/executor/skillPreflight.ts` + `src/tools/modules/skill/presenter.tsx`）：
  - 若 `permissions.allow` 未包含 `Skill(<name>)` → 弹确认 UI
  - 选项：
    1. Yes
    2. Yes, and don’t ask again for `<name>` in this repo（写入 allow）
    3. No, and tell the model what to do differently（输入反馈）
- [x] 拒绝路径：把“拒绝 + 反馈”回注给模型（tool_result），确保不会卡住/重复调用
- [x] 交互细节：Esc 取消、支持输入反馈（含数字）
- [x] 单测：allow/remember/feedback/cancel + subagent 禁止弹窗（`src/tools/executor/skillPreflight.test.ts`）

## 5. 文档沉淀（最小）

- [x] 更新 `plans/skills/different.md`：补上“实时读取 allowList”的新实验结论（你这次的证据）
- [x] 新增 `docs/LEARNINGS/skills/README.md`：
  - skills 列表在哪暴露（Skill tool description）
  - Skill tool_use → tool_result 回注结构
  - UI confirm 不在抓包里
  - allowList repo 级落盘 + 热更新

## 6. 手动验收脚本（给抓包用）

- [ ] A（已手动验证，未抓包确认）：第一次触发 skill → 弹框 → 选 2 → 写入 settings.local.json → 再触发不弹
- [ ] B（已手动验证，未抓包确认）：删除 allow → 不重启 → 再触发应重新弹
- [ ] C（待抓包确认，最终结论以抓包为准）：
  - 抓包确认“Skill 被允许后”的后续请求里是否出现任何可观测差异（例如 tool list / system 注入 / 额外标记）
  - 抓包确认“移除 allow 后”的下一次请求里是否回到“需要确认”的路径（注意：确认 UI 本身不在抓包里）

---

## 下一步（P0 续作，建议尽快落地）

- [x] Progressive disclosure：SkillStore 扫描阶段只读 frontmatter，不读取/缓存全文 body（只在 Skill 执行时读 body）
- [x] Skill 索引缓存（Codex 风格）：对 `<available_skills>` 的索引结果做 per-projectRoot 的进程内缓存（带 TTL；先不做 `/skills reload`）
- [x] 将技能发现的 project 目录从 `cwd/.formax/skills` 改为 `<projectRoot>/.formax/skills`（按“Project root 解析规则”）

---

## 后续增强（对齐 Claude Code，分阶段做）

### 7. Permissions 统一机制（跨工具复用）

目标：把“允许/拒绝/记住选择/反馈”的逻辑沉淀成统一框架，覆盖更多需要审批的能力，避免每个工具各写一套。

- [x] 抽象通用 PermissionsStore（沿用 `.formax/settings.local.json` 的 `permissions.allow`）：
  - 统一 key 命名：`Skill(frontend-design)` 已有；后续扩展 `Bash(...)` / `Write(...)` / `Edit(...)` 等
  - 保持“运行时热读取”：移除 allow 后无需重启也会重新提示
  - 代码位置：`src/adapters/permissions/permissionsStore.ts`
- [ ] 把以下能力逐步迁移到统一权限/审批体系（按风险从高到低）：
  - [x] 执行命令（Bash）
  - [ ] 执行命令（local command；需要抓包确认 Claude Code 的 key 形式再做）
  - [x] 写文件/编辑文件（Write/Edit/NotebookEdit）
  - [ ] 其它需要“允许/拒绝/手动审批”的工具行为

### 8. Skill UI 对齐 Claude Code（噪音压缩）

目标：把 Skill 的展示压缩为 Claude Code 风格的一行，减少“JSON 输入/冗长 baseDir”噪音。

- [x] 调整 Skill 的 UI 展示结构，尽量对齐：
  - Claude Code：`⏺ Skill(frontend-design)`
  - Formax（实现）：同样只显示一行 `Skill(<name>)`；不再在 UI 中输出 tool_result 的 `Launching skill.../Base directory...` 等内容
- [x] `Base directory for this skill`：不在 UI 中展示（依据 `plans/skills/4.txt` 的终端输出）

### 9. Markdown 渲染支持（可后置）

- [ ] 支持基础 Markdown 渲染（标题/列表/代码块/强调），避免原样纯文本输出
- [ ] 明确范围：只用于 assistant 文本 / tool 输出 / 两者都支持

## 未决/不做（暂缓/需再确认）

- [ ] 全局 `~/.formax/settings.json`（对标 Claude 的 `~/.claude/settings.json`）——等你确认是否要引入
- [ ] 多 skill + tool 自动选择精细策略（需要更多抓包）
