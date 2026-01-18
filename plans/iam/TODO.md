# TODO：/permissions（对齐 Claude Code 的最小落地清单）

> 证据来源：`plans/iam/permissions.txt`（终端复制）。
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
- [ ] A6 WebFetch/WebSearch 接入统一 permissions（先做 tool-only rule）：`src/tools/executor/policyPreflight.ts`
- [ ] A7 Workspace roots：先约束只读（Read/Glob/Grep）：（边界检查所在模块）+ 测试
- [ ] A8 Workspace roots：再约束写入（Edit/Write/NotebookEdit）：（边界检查所在模块）+ 测试

### B. UI（最后做，严格不改样式）

- [ ] B1 `/permissions` UI 接真数据（只读展示）：`src/entrypoints/permissions.tsx`
- [ ] B2 Add rule（Allow：默认写 project local）：`src/entrypoints/permissions.tsx` + store
- [ ] B3 Add rule（Ask/Deny：进入“保存位置选择”）：`src/entrypoints/permissions.tsx` + store
- [ ] B4 Delete rule / Add directory / Delete directory / dismissed 行：`src/entrypoints/permissions.tsx` + store

### C. 暂缓（必须抓包确认）

- [ ] C1 local command 的 permission key 形式（等抓包确认后再实现）：`plans/iam/index.md` + 抓包记录

---

## 0. 范围与命名（先定死，避免反复改）

- [ ] 仅实现 `.formax`（不兼容 `.claude` 目录）。
- [ ] Settings 文件（建议）：
  - [ ] **User**：`~/.formax/settings.json`
  - [ ] **Project settings（checked-in）**：`<projectRoot>/.formax/settings.json`
  - [ ] **Project settings（local）**：`<projectRoot>/.formax/settings.local.json`
  - [ ] 合并策略：`projectLocal > project > user`
- [ ] 统一 schema（最小）：
  - [ ] `version: 1`
  - [ ] `permissions.allow: string[]`
  - [ ] `permissions.ask: string[]`
  - [ ] `permissions.deny: string[]`
  - [ ] `permissions.workspace.additionalDirectories: string[]`
  - [ ] 读写必须 **保留 settings 的其他字段**（例如未来可能有 `env`）

> TODO（待抓包确认）：Claude 对 settings 的字段名/更多权限类型；Formax 先按上面 schema 做最小闭环即可。

---

## 1. 权限规则解析与匹配（运行时硬限制）

目标：把 “deny / ask / allow” 做成 **统一的、可解释** 的 matcher，并让所有工具执行走同一条判定路径。

- [ ] 定义 `PermissionRule` 的最小解析：
  - [ ] `ToolName`（例：`WebFetch`）
  - [ ] `ToolName(spec)`（例：`Bash(ls:*)`、`Skill(frontend-design)`）
- [ ] 优先级：`deny > ask > allow > default`
- [ ] 匹配策略（先做最小可用）：
  - [ ] `Skill(name)`：精确匹配 name
  - [ ] `Bash(prefix:*)`：基于 **规范化后的命令前缀** 匹配（复用你们现有 bash 规范化/文件路径抽取能力；不要另写一套）
  - [ ] 其他 `ToolName(spec)`：先做“全文字符串相等”匹配（后续再扩展）
- [ ] `explainPermissionDecision()`：
  - [ ] 输出：命中 rule、来源（user/project）、决策、原因、建议
  - [ ] 用途：非交互模式报错 / UI 展示 / future doctor bundle

> TODO（待抓包确认）：local command 的 permission key 形式（先不做；等抓包明确它到底是 `Bash(...)` 还是独立 ToolName）。

---

## 2. PermissionsStore（读写 + 合并 + 热更新）

目标：支持 user/project 两级读写，并保证“修改后立即生效”（不需要重启）。

- [ ] 新增路径解析：
  - [ ] user settings 路径：基于 `FORMAX_CONFIG_DIR`（默认 `~/.formax`）
  - [ ] project settings 路径：基于 `resolveFormaxProjectRoot(cwd)`
  - [ ] project local settings 路径：基于 `resolveFormaxProjectRoot(cwd)`
- [ ] 读取：
  - [ ] 每次判定都从磁盘读（或做短 TTL 缓存，但必须支持“移除后立刻重新提示”）
  - [ ] JSON 不可读/损坏：保守降级为空（提示而不是放行）
- [ ] 写入：
  - [ ] `writeJsonAtomic` 原子写入（保持顺序/去重策略要明确）
  - [ ] 只修改目标字段，保留其他字段
- [ ] 合并：
  - [ ] 合并 allow/ask/deny：project 覆盖 user（同一条 rule 若同时存在，优先 project；UI 需能标记来源）
  - [ ] 合并 workspace dirs：先 project 在前，再拼 user（或反过来，但要固定并写清楚）

---

## 3. 运行时接入（对齐 Claude 的“记住/模式”）

### 3.1 Bash / Skill：落盘到 permissions

- [ ] Bash：
  - [ ] 命中 `deny`：直接拒绝并给出 explain
  - [ ] 命中 `ask`：永远弹确认（不受“session allow”影响）
  - [ ] 命中 `allow`：直接执行
  - [ ] 默认：仍走你们现有 Bash policy（不是每条 Bash 都要确认）
  - [ ] “don’t ask again” 时写入 `permissions.allow`（user 或 project？默认 project；UI 支持选择来源则后续再做）
- [ ] Skill：
  - [ ] “don’t ask again” 写入 `permissions.allow`（按你们现有的 repo 级逻辑扩展到 user+project）
  - [ ] UI 输出压缩为一行：`⏺ Skill(frontend-design)`（你已要求在 Skill TODO 里对齐）

### 3.2 Write/Edit/NotebookEdit：不落盘 permissions（走 accept edits mode）

- [ ] 保持现有约束（对齐 Claude）：
  - [ ] “remember/allow all edits” 仅会话生效（accept edits mode）
  - [ ] 不写入 `permissions.allow`
- [ ] 但 `deny/ask` **必须能硬拦截**（即使 accept edits on 也要尊重 deny/ask）

---

## 4. Workspace（立刻影响读写边界）

目标：Add directory 后立刻影响工具对文件系统的访问范围。

- [ ] 定义 workspace roots：
  - [ ] 默认 root：`<projectRoot>`（Original working directory）
  - [ ] additionalDirectories：来自 user/project settings 合并结果
- [ ] 接入到这些工具：
  - [ ] Read / Glob / Grep：只允许在 workspace roots 内
  - [ ] Edit / Write / NotebookEdit：只允许在 workspace roots 内（并且仍受 accept edits mode 控制）
- [ ] 边界检查输出要可解释：
  - [ ] 返回“被 workspace 拒绝”的原因 + 建议（例如“去 /permissions 添加目录”）

> TODO（范围确认）：是否允许 workspace roots 包含 `~`、相对路径、符号链接；建议先按“解析为绝对路径并做 realpath 对比”实现。

---

## 5. `/permissions` UI（严格对齐样式）

> 视觉基准：`src/entrypoints/permissions.tsx`（颜色/边框/间距/文案已调好，后续只能“接真数据”，不能改输出）。

- [ ] 把 UI 从“mock data”接到真实 PermissionsStore：
  - [ ] Allow/Ask/Deny：显示 rules（含 `Add a new rule…`）
  - [ ] Workspace：显示 `- <dir> (Original working directory)` + `Add directory…`
  - [ ] 支持 `/` 搜索过滤（`permissions.txt` 明确写了 `Press ... / to search`）
- [ ] Add rule 弹窗：
  - [ ] 标题：`Add <tab> permission rule`
  - [ ] 提示文案按 `permissions.txt` 原样
  - [ ] Enter 提交：
    - [ ] Allow：默认写入 project local（不再追加“保存位置”二次确认）
    - [ ] Ask/Deny：进入“保存位置选择”步骤（见下）
- [ ] Save rule location（Ask/Deny 提交后的“保存位置选择”）：
  - [ ] 标题/布局严格按 `src/entrypoints/permissions.tsx` 对齐
  - [ ] 三个选项（对应落盘文件）：
    1) Project settings (local) → `<projectRoot>/.formax/settings.local.json`
    2) Project settings → `<projectRoot>/.formax/settings.json`
    3) User settings → `~/.formax/settings.json`
  - [ ] 上下键移动、Enter 确认、Esc 回到“编辑 rule 输入框”
- [ ] Add directory 弹窗：
  - [ ] Enter 提交：写入 `workspace.additionalDirectories`
- [ ] Delete rule：
  - [ ] 选中已有 rule → 弹确认框（红色边框 + `Yes/No`）
  - [ ] 删除时只删当前来源层级（若 rule 同时存在 user+project，需要先明确删除哪一个；建议默认删 project，否则删 user）
  - [ ] 删除后立刻热生效
- [ ] 关闭对话框：
  - [ ] Esc 关闭时在消息流里追加：`⎿  Permissions dialog dismissed`（对齐 `permissions.txt`）

---

## 6. 集成到 REPL（可用性）

- [ ] `/permissions` 作为 built-in slash command：
  - [ ] 从 REPL 打开 overlay（不进入 messages，或进入但可配置；以你们命令契约为准）
  - [ ] overlay 关闭后追加 dismissed 行（进入 static messages）
- [ ] 保留 `src/entrypoints/permissions.tsx` 作为“快速预览入口”：
  - [ ] 让你无需启动完整 REPL 即可调 UI（但不影响正式路径）

---

## 7. 测试与验收（先保证不回归）

- [ ] 单测：PermissionsStore（读写/保留字段/坏 JSON/合并优先级）
- [ ] 单测：Permission matcher（deny>ask>allow、Bash(prefix) 匹配、Skill(name)）
- [ ] 单测：Workspace 边界（允许/拒绝，提示信息）
- [ ] Ink 测试：`/permissions` UI 的基础交互（tab/上下/enter/esc）

---

## 8. 待抓包确认（先不做）

- [ ] local command 的 permissions key 形式（Claude 里到底落在什么 ToolName/spec）
- [ ] Allow 是否也会走“保存位置选择”（目前我们按 `src/entrypoints/permissions.tsx` 的交互：仅 Ask/Deny 需要）
