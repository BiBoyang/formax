# TODO：Skills（对齐 Claude Code 的最小落地清单）

基于 `plans/skills/PRD.md`（P0 必须做）拆分；默认只做 `.formax`。

## 0. 基线（现状盘点）

- [x] 已有 Skill 文件扫描：`src/skills/SkillStore.ts`（user + project，project 覆盖 user）
- [x] 已有 Skill tool handler 雏形：`src/tools/modules/skill/handler.ts`
- [x] 已有 Skill tool spec 雏形：`src/tools/modules/skill/spec.ts`
- [x] Skill 的 UI 审批（confirm / don’t ask again / feedback）：`src/tools/presenters/skillApprovalPrompt.tsx`
- [x] allowList 落盘 + 运行时实时读取（repo 级 settings.local.json）：`src/adapters/permissions/skillAllowList.ts`
- [x] Skill 工具 description 的 `<available_skills>` 动态生成（以当前 cwd 为准）：`src/tools/modules/skill/index.ts` + `src/features/repl/useReplController.ts`
- [x] tool_result 文本对齐 Claude Code（`Launching skill...` + `Base directory...` + instructions）：`src/tools/modules/skill/handler.ts`

## 1. 权限存储（repo 级 settings.local.json）

- [x] 定义 repo settings 文件位置：`<repoRoot>/.formax/settings.local.json`（`src/adapters/permissions/skillAllowList.ts`）
- [x] 定义最小 schema：
  - `version: 1`
  - `permissions.allow: string[]`（含 `Skill(frontend-design)`）
- [x] 实现 PermissionsStore（最小可用：读/写/并发安全写入；不做 mtime 缓存）：
  - 读：每次判定时读取（保证“移除 allow 后不重启也会重新弹确认”）
  - 写：`writeJsonAtomic()` 原子写入，且保留 settings 其它字段（如 `env` / 其它 permissions）
- [x] 单测：写入/读取/保留其它字段/坏 JSON 保守为空（`src/adapters/permissions/skillAllowList.test.ts`）

## 2. Skill spec 的 `<available_skills>` 动态注入

- [x] 调整生成逻辑：由“模块初始化时 `process.cwd()`”改为“每次构建 tools spec 时按当前会话 cwd/repoRoot”
- [ ] `<available_skills>` 产出格式对齐（最小可用）：
  - `name` + `description`
  - 不默认暴露绝对路径（除非你确认 Claude Code 在 tool desc 中也包含 path）
- [ ] 单测：同进程切换 cwd（或模拟不同 repoRoot）时，`<available_skills>` 会变化（暂缺）

## 3. Skill tool handler 的输出对齐

- [x] tool_result 第一行：`Launching skill: <name>`
- [x] 追加：`Base directory for this skill: <dir>`
- [x] 追加：完整 instructions（按 char budget 截断）
- [ ] Unknown skill：错误信息包含 available list（只列 name）
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

- [ ] 在空目录/新 repo 做 2 组验证：
  - A：第一次触发 skill → 弹框 → 选 2 → 写入 settings.local.json → 再触发不弹
  - B：删除 allow → 不重启 → 再触发应重新弹

---

## 未决/不做（暂缓）

- [ ] 全局 `~/.formax/settings.json`（对标 Claude 的 `~/.claude/settings.json`）——等你确认是否要引入
- [ ] 多 skill + tool 自动选择精细策略（需要更多抓包）
