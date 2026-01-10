# WebGPT 回复建议：优化版

> 本文件提供两份优化后的提问稿，分别对应两个 WebGPT 窗口（Claude Code 视角 & Codex CLI 视角）。
>
> **核心优化思路**：
>
> 1. 减少"开放式请求"，增加"二选一决策点"——逼 AI 做选择而不是罗列
> 2. 把最高价值的输出放在前面（避免 AI 输出超限时丢失关键内容）
> 3. 明确"什么不要做"，减少 AI 产出冗余
> 4. 利用 AI 长时间思考的优势：要求输出"可直接用的代码/配置/命令"

---

## 窗口 1：Claude Code 方向（对应 `Formax 产品化差距审计-next.md`）

````text
请基于我提供的 repomix 代码包（overview + src-notests），把你上次的《产品化差距审计》落实为**可直接实现的工程规格**。

⚠️ 约束（请严格遵守）：
1. 你提到的每个 Claude Code 行为/命令/路径，必须给来源 URL；无来源标【推测】。
2. 所有方案必须复用 Formax 现有模块（src/env/config.ts、src/tools/executor、src/features/commands 等），不要"另起一套系统"。
3. 输出按我下面列的顺序，先完成高优先级再答其他；如果输出超限，优先保证 A/B/C/E 完整。

---

## 输出要求（请按顺序完成）

### A. 关键决策表（强制你做选择，不要给"两种方案各自优缺点"）

请逐项做**唯一决策**并给一句话理由：

| 决策点 | 选项 | 你的选择 | 一句话理由 |
|--------|------|----------|------------|
| 配置格式 | JSON / JSONC / TOML | ? | |
| 配置路径 | ~/.formax (固定) / XDG (标准) | ? | |
| 凭证存储 | 文件+600权限 / keychain优先 | ? | |
| 旧 env 兼容 | 保留但警告 / 直接移除 | ? | |
| 网络默认策略 | off / per-domain confirm | ? | |
| workspaceRoot | cwd / git root / 用户指定 | ? | |

### B. Setup Wizard 完整规格（Ink UI）

请给出**逐屏状态机**（5-7 个状态），每个状态包含：
- 条件：何时进入此状态
- 渲染：显示什么内容（给出实际文案）
- 用户操作：能做什么（按键/输入）
- 成功转移：成功后到哪个状态
- 失败转移：失败后（401/DNS/timeout）到哪个状态 + 显示什么文案

要求复用 Formax 现有组件：`src/components/ui/TextInput.tsx`、`src/components/ui/Select.tsx`

### C. Config/Auth Schema（可直接复制的 TypeScript）

```typescript
// 请输出完整的：
interface ForMaxConfig { ... }
interface AuthStore { ... }
interface SecurityPolicy { ... }
interface PermissionRule { ... }
````

并给出：

- 配置优先级表（flags > env > config > default）
- `resolveConfig()` 函数签名与实现骨架

### D. /status + /doctor 输出规格

请给出两者的**完整输出示例**（成功 & 失败各一份），包含：

- 字段列表（profile/provider/model/baseUrl/configPath/logDir/workspaceRoots/networkPolicy）
- 脱敏规则（哪些字段如何脱敏）
- 错误分类与文案模板（E_AUTH_401 / E_TIMEOUT / E_FS_DENIED...）

### E. 最小 PR 切分（5 个 PR，可直接执行）

每个 PR 给出：

- PR 标题
- 改动文件列表（尽量少）
- 核心接口定义
- 验收命令 + 预期输出
- 需要补的 vitest 测试（给 3 个用例的描述）

**请按以下顺序切分：**

1. Config schema + load/save
2. Setup wizard (Ink)
3. /status + /doctor
4. 安全边界 (allowedDirs + networkPolicy)
5. CLI 入口 (formax --help / formax setup / formax doctor)

### F. 规则持久化 MVP（JSON 格式）

请给出：

- JSON Schema
- 5 条示例规则（覆盖：允许目录、允许域名、bash deny、bash confirm、写文件 confirm）
- 匹配算法伪代码
- `explainDecision()` 函数的输出格式

---

## 不需要输出的内容（节省 token）

- ❌ 产品化差距表（已有）
- ❌ P2 及以后的路线图
- ❌ 插件/MCP/Skills 相关设计
- ❌ 详细的用户故事/安全与隐私注意点（之前已给）

````

---

## 窗口 2：Codex CLI 方向（对应 `Formax 产品化路线图-next.md`）

```text
请基于我提供的 repomix 代码包（overview + src-notests），把你上次的《产品化路线图》转化为**可直接落地的工程方案**。

⚠️ 前置纠偏：
- Formax 测试是存在的（我打包时排除了），别把"缺测试"作为前提
- Formax 已有：Bash/Edit 审批、Plan/acceptEdits 模式、Task/TaskOutput、slash commands 下拉提示
- 请复用这些能力，不要"从头设计"

⚠️ 约束：
1. Codex CLI 相关结论必须给来源 URL；无来源标【推测】
2. 复用 Formax 现有模块（src/tools/modules/bash/policy.ts、src/tools/executor、src/features/commands 等）
3. 输出按顺序，优先保证 0/A/B/D/E 完整

---

## 输出要求

### 0. 事实校正表（最重要）

请把你上次文档里的 **关键结论/推测** 逐条列出（至少 20 条），并标注：

| # | 结论摘要 | 分类 | 来源/落点 | 若为推测的验证方法 |
|---|----------|------|-----------|-------------------|
| 1 | Codex 有 config.toml | 证据 | URL:... | - |
| 2 | Codex sandbox 有 3 级 | 证据 | URL:... | - |
| 3 | Codex 规则用 Starlark | 推测 | 运行 `codex rules show` 看输出格式 | |
| ... | | | | |

同时列出 Formax 现状纠偏（至少 8 条）：
- 你上次误判或遗漏的 Formax 能力
- 正确的文件路径和符号名

### A. MVP 架构决策（请做选择）

| 决策点 | 选项 | 你的选择 | 理由 |
|--------|------|----------|------|
| 规则格式 v1 | JSON 规则 / Starlark | ? | |
| Approval 拦截点 | ToolExecutor 统一 / 各 handler 分散 | ? | |
| patch/diff 工作流 | P0 必须 / P1 再做 | ? | |
| 插件系统 | P1 必须 / P2 再做 | ? | |

### B. ApprovalService 统一化设计

请给出：

1. **接口定义**
```typescript
interface ApprovalRequest { ... }
interface ApprovalDecision { ... }
interface ApprovalService {
  decide(req: ApprovalRequest): Promise<ApprovalDecision>;
  remember(req: ApprovalRequest, allow: boolean): Promise<void>;
  explain(req: ApprovalRequest): string;
}
````

2. **如何接入现有 Bash/Edit/WebFetch handler**
   给出 diff 级别的改动示意（伪代码即可）

3. **UI 复用**
   如何复用 `src/tools/presenters/editApprovalPrompt.tsx` 或抽象通用组件

### C. Config + Auth 最终 Schema

```typescript
// 完整输出
interface FormaxConfig { ... }
interface AuthStore { ... }
```

配置优先级表 + `loadConfig()` 签名

### D. P0 重新切分（严格压缩）

只给 P0 的 5 个 PR，每个 PR 包含：

- 改动文件列表
- 核心接口
- 验收命令
- 3 个 vitest 测试点

**P0 定义：陌生用户 15 分钟可跑通**

1. Config schema + load/save
2. Setup wizard
3. /status + /doctor
4. ApprovalService 统一化
5. CLI 入口 (formax --help/setup/doctor)

### E. 可直接使用的输出物

请附上"可直接复制使用"的：

1. `config.json` 示例（完整字段）
2. `rules.json` 示例（5 条规则）
3. `/doctor` 成功输出示例
4. `/doctor` 失败输出示例（401）
5. `/status` 输出示例
6. `formax --help` 完整文案

---

## 不需要输出的内容

- ❌ 45 行差距表（已有）
- ❌ P2（容器 sandbox、插件市场）
- ❌ Patch/Diff 工作流详细设计（P1）
- ❌ 详细的用户故事

```

---

## 你当前 -next.md 的优化建议

### 优点（可保留）：
1. 结构清晰，强调"证据 vs 推测"的区分
2. 要求"可执行"输出（接口签名、PR 切分）
3. 包含验证清单（帮助把推测变证据）

### 建议调整：
1. **内容太多**：两份 next.md 加起来要求 AI 输出 A-K 近 10 个大节，很可能导致：
   - 输出截断
   - 每节都不够深入
   - 重复劳动（两个窗口要求很多重叠内容）

2. **开放问题太多**：比如"给配置系统规范"——AI 可能给你 3 种方案让你选，浪费 token
   - 改成：逼 AI 做决策（"在 JSON/JSONC/TOML 中选一个并给理由"）

3. **优先级不明**：如果输出超限，AI 不知道先保证哪些
   - 改成：明确说"优先保证 A/B/C 完整，其他可精简"

4. **两个窗口重复**：config/auth/doctor/status 设计两边都在问
   - 建议：让一个窗口聚焦"config+setup+doctor"，另一个聚焦"安全边界+approval+rules"

---

## 两个窗口的分工建议（如果你只想问一次）

| 内容 | 窗口 1 (Claude Code) | 窗口 2 (Codex CLI) |
|------|---------------------|-------------------|
| Config schema | ✅ 主责 | 复用窗口1 |
| Setup wizard | ✅ 主责 | - |
| /status /doctor | ✅ 主责 | - |
| ApprovalService | - | ✅ 主责 |
| Rules 持久化 | 简版 | ✅ 主责 |
| PR 切分 | ✅ 主责 | 安全边界部分 |
| 事实校正 | Claude Code | Codex CLI |
```
