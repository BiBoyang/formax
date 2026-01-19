# TODO：/permissions（对齐 Claude Code 的最小落地清单）

> 证据来源：`plans/iam/index.md`（Claude Code 文档）+ 终端实测（抓包/复制）。
>
> 关键约束（已确认）：
> 1) **包含 user 级别**（`~/.formax/...`）+ **project 级别**（`<projectRoot>/.formax/...`），且 **project 覆盖 user**  
> 2) Workspace 规则 **立刻影响运行时边界**（读/写）  
> 3) UI 样式以 `src/entrypoints/permissions.tsx` 为“视觉基准”，后续任何接线/重构都必须 **保持输出一致**（间距/颜色/边框/文案）

---

## 执行顺序（更细拆解：每步可独立提交；UI 放最后）

> 目标：把大任务拆成“小步快跑”，避免一次改太多文件导致返工成本爆炸。
>
> 约束：
> - **先底座、后 UI**：先保证执行链路与判定一致，再把 UI 接真数据。
> - **不猜测 local command**：local command 的 permission key 形式需要抓包确认，未确认前不实现。

### A. 底座（不动 UI）

- [x] A1 清理半迁移（让 repo 回到“单一路径”）：`src/tools/executor/policyPreflight.ts`
- [x] A2 matcher 最小闭环（deny>ask>allow + ToolName/ToolName(spec)）：`src/adapters/permissions/matcher.ts` + 测试
- [x] A3 permissionsStore 最小闭环（projectLocal > project > user + 读写保留其他字段 + 热更新读）：`src/adapters/permissions/permissionsStore.ts` + 测试
- [x] A4 Skill 迁移到统一 permissions（替代旧 allowList 路径）：`src/tools/executor/skillPreflight.ts` + `src/tools/modules/skill/*`
- [x] A5 Bash 接入统一 permissions（不做 local command key；保留现有 bash 风险分类）：`src/tools/executor/policyPreflight.ts` + `src/tools/modules/bash/policy.ts`
- [x] A6 WebFetch/WebSearch 接入统一 permissions（先做 tool-only rule）：`src/tools/executor/policyPreflight.ts`
- [x] A7 Workspace roots：先约束只读（Read/Glob/Grep）：（边界检查所在模块）+ 测试
- [x] A8 Workspace roots：再约束写入（Edit/Write/NotebookEdit）：（边界检查所在模块）+ 测试

### B. UI（最后做，严格不改样式）

- [x] B1 `/permissions` UI 接真数据（只读展示）：`src/ui/permissions/PermissionsDialog.tsx`
- [x] B2 Add rule（Allow：默认写 project local）：`src/ui/permissions/PermissionsDialog.tsx` + store
- [x] B3 Add rule（Ask/Deny：进入“保存位置选择”）：`src/ui/permissions/PermissionsDialog.tsx` + store
- [x] B4 Delete rule / Add directory / Delete directory / dismissed 行：`src/ui/permissions/PermissionsDialog.tsx` + store + REPL overlay
  - [x] `/permissions` 打开 overlay：`src/features/commands/registry.ts` + `src/features/commands/adapter.ts` + `src/screens/REPL.tsx`
  - [x] Esc 关闭时追加：`⎿  Permissions dialog dismissed`：`src/features/repl/useReplController.ts`

### C. 暂缓（必须抓包确认）

- [ ] C1 local command 的 permission key 形式（等抓包确认后再实现）：`plans/iam/index.md` + 抓包记录

---

## 0. 范围与命名（先定死，避免反复改）

- [x] 仅实现 `.formax`（不兼容 `.claude` 目录）。
- [x] Settings 文件（建议）：
  - [x] **User**：`~/.formax/settings.json`
  - [x] **Project settings（checked-in）**：`<projectRoot>/.formax/settings.json`
  - [x] **Project settings（local）**：`<projectRoot>/.formax/settings.local.json`
  - [x] 合并策略：`projectLocal > project > user`
- [x] 统一 schema（最小）：
  - [x] `version: 1`
  - [x] `permissions.allow: string[]`
  - [x] `permissions.ask: string[]`
  - [x] `permissions.deny: string[]`
  - [x] `permissions.workspace.additionalDirectories: string[]`
  - [x] 读写必须 **保留 settings 的其他字段**（例如未来可能有 `env`）

> TODO（待抓包确认）：Claude 对 settings 的字段名/更多权限类型；Formax 先按上面 schema 做最小闭环即可。

---

## 1. 权限规则解析与匹配（运行时硬限制）

目标：把 “deny / ask / allow” 做成 **统一的、可解释** 的 matcher，并让所有工具执行走同一条判定路径。

- [x] 定义 `PermissionRule` 的最小解析：
  - [x] `ToolName`（例：`WebFetch`）
  - [x] `ToolName(spec)`（例：`Bash(ls:*)`、`Skill(frontend-design)`）
- [x] 优先级：`deny > ask > allow > default`
- [x] 匹配策略（先做最小可用）：
  - [x] `Skill(name)`：精确匹配 name
  - [x] `Bash(prefix:*)`：基于 **规范化后的命令前缀** 匹配（复用现有 bash 规范化）
  - [x] 其他 `ToolName(spec)`：先做“全文字符串相等”匹配（后续再扩展）
- [x] `explainPermissionDecision()`：
  - [x] 输出：命中 rule、来源（user/project）、决策、原因、建议（`src/adapters/permissions/explain.ts`）
  - [x] 用途：非交互模式报错 / UI 展示 / future doctor bundle

> TODO（待抓包确认）：local command 的 permission key 形式（先不做；等抓包明确它到底是 `Bash(...)` 还是独立 ToolName）。

---

## 2. PermissionsStore（读写 + 合并 + 热更新）

目标：支持 user/project 两级读写，并保证“修改后立即生效”（不需要重启）。

- [x] 新增路径解析：
  - [x] user settings 路径：基于 `FORMAX_CONFIG_DIR`（默认 `~/.formax`）
  - [x] project settings 路径：基于 `resolveFormaxProjectRoot(cwd)`
  - [x] project local settings 路径：基于 `resolveFormaxProjectRoot(cwd)`
- [x] 读取：
  - [x] 每次判定都从磁盘读（可加短 TTL，但必须支持“移除后立刻重新提示”）
  - [x] JSON 不可读/损坏：保守降级为空（提示而不是放行）
- [x] 写入：
  - [x] 原子写入（顺序/去重策略固定）
  - [x] 只修改目标字段，保留其他字段
- [x] 合并：
  - [x] 合并 allow/ask/deny：`projectLocal > project > user`（UI 标记来源）
  - [x] 合并 workspace dirs：固定顺序合并（project 在前，再拼 user）

---

## 3. 运行时接入（对齐 Claude 的“记住/模式”）

### 3.1 Bash / Skill：落盘到 permissions

- [x] Bash：
  - [x] 命中 `deny`：直接拒绝并给出 explain（`src/adapters/permissions/explain.ts` + `src/tools/executor/policyPreflight.ts`）
  - [x] 命中 `ask`：永远弹确认（不受“session allow”影响）
  - [x] 命中 `allow`：直接执行
  - [x] 默认：仍走现有 Bash policy（不是每条 Bash 都要确认）
  - [x] “don’t ask again” 时写入 `permissions.allow`（默认 project local）
- [ ] Skill：
  - [x] “don’t ask again” 写入 `permissions.allow`（project local）
  - [ ] UI 输出压缩为一行：`⏺ Skill(frontend-design)`（在 Skill TODO 里对齐）

### 3.2 Write/Edit/NotebookEdit：不落盘 permissions（走 accept edits mode）

- [x] 保持现有约束（对齐 Claude）：
  - [x] “remember/allow all edits” 仅会话生效（accept edits mode）
  - [x] 不写入 `permissions.allow`
- [x] `deny/ask` **必须能硬拦截**（即使 accept edits on 也要尊重 deny/ask）

---

## 4. Workspace（立刻影响读写边界）

目标：Add directory 后立刻影响工具对文件系统的访问范围。

- [x] 定义 workspace roots：
  - [x] 默认 root：`<projectRoot>`（Original working directory）
  - [x] additionalDirectories：来自 user/project settings 合并结果
- [x] 接入到这些工具：
  - [x] Read / Glob / Grep：只允许在 workspace roots 内
  - [x] Edit / Write / NotebookEdit：只允许在 workspace roots 内（并且仍受 accept edits mode 控制）
- [x] 边界检查输出要可解释：
  - [x] 返回“被 workspace 拒绝”的原因 + 建议（例如“去 /permissions 添加目录”）

> TODO（范围确认）：是否允许 workspace roots 包含 `~`、相对路径、符号链接；建议先按“解析为绝对路径并做 realpath 对比”实现。

---

## 5. `/permissions` UI（严格对齐样式）

> 视觉基准：`src/entrypoints/permissions.tsx`（颜色/边框/间距/文案已调好，后续只能“接真数据”，不能改输出）。

- [x] 把 UI 从“mock data”接到真实 PermissionsStore：
  - [x] Allow/Ask/Deny：显示 rules（含 `Add a new rule…`）
  - [x] Workspace：显示 `- <dir> (Original working directory)` + `Add directory…`
  - [x] 支持 `/` 搜索过滤（Claude Code：`/ to search`）
- [x] Add rule 弹窗：
  - [x] 标题：`Add <tab> permission rule`
  - [x] Enter 提交：
    - [x] Allow：默认写入 project local（不再追加“保存位置”二次确认）
    - [x] Ask/Deny：进入“保存位置选择”步骤（见下）
- [x] Save rule location（Ask/Deny 提交后的“保存位置选择”）：
  - [x] 三个选项（对应落盘文件）：
    1) Project settings (local) → `<projectRoot>/.formax/settings.local.json`
    2) Project settings → `<projectRoot>/.formax/settings.json`
    3) User settings → `~/.formax/settings.json`
  - [x] 上下键移动、Enter 确认、Esc 回到“编辑 rule 输入框”
- [x] Add directory 弹窗：
  - [x] Enter 提交：写入 `workspace.additionalDirectories`
- [x] Delete rule：
  - [x] 选中已有 rule → 弹确认框（红色边框 + `Yes/No`）
  - [x] 删除时只删当前来源层级（若 rule 同时存在 user+project，需要先明确删除哪一个）
  - [x] 删除后立刻热生效
- [x] 关闭对话框：
  - [x] Esc 关闭时在消息流里追加：`⎿  Permissions dialog dismissed`

---

## 6. 集成到 REPL（可用性）

- [x] `/permissions` 作为 built-in slash command：
  - [x] 从 REPL 打开 overlay
  - [x] overlay 关闭后追加 dismissed 行（进入 static messages）
- [x] 保留 `src/entrypoints/permissions.tsx` 作为“快速预览入口”：
  - [x] 让你无需启动完整 REPL 即可调 UI（但不影响正式路径）

---

## 7. 测试与验收（先保证不回归）

- [x] 单测：PermissionsStore（读写/保留字段/坏 JSON/合并优先级）
- [x] 单测：Permission matcher（deny>ask>allow、Bash(prefix) 匹配、Skill(name)）
- [x] 单测：Workspace 边界（允许/拒绝，提示信息）
- [x] Ink 测试：`/permissions` UI 的基础交互（tab/上下/enter/esc）

---

## 8. 待抓包确认（先不做）

- [ ] local command 的 permissions key 形式（Claude 里到底落在什么 ToolName/spec）
- [ ] Allow 是否也会走“保存位置选择”（目前我们按 `src/entrypoints/permissions.tsx` 的交互：仅 Ask/Deny 需要）
