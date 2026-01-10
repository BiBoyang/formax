# Formax 产品化路线图（Codex CLI 视角）- Next 问题清单

> 对应文件：`plans/product-strategy/Formax 产品化路线图.md`（WebGPT：Codex CLI 方向）
>
> 目标：把“Codex CLI 可交付产品”的做法，转化为 Formax 的 **可落地工程方案**；同时把所有 Codex 相关结论严格区分【证据】与【推测】。

## 0) 质量快速评估（供你决定要不要再追问）

**优点**
- 很完整：覆盖 config/auth/sandbox/approval/rules/diff/patch/plugin/doctor，并给 PR 切分。
- 有明确“可交付产品骨架”的意识：配置优先级、诊断文案、审批持久化、策略可解释性（execpolicy explain）。

**风险/需要二次澄清的点**
- Codex CLI 相关来源虽有链接，但仍混有一些【推测】；需要更严格地“逐条证据化 + 可复现步骤”。
- 对 Formax 现状有少量误判（例如把“notests 包”当成“没有测试”）；需要基于 repo 真相纠偏后再给最终实施计划。
- 规则语言（Starlark-like）/插件生态/变更队列这些可能偏重，P0 更应该聚焦 setup/config/doctor/安全边界；需要“降级到 MVP”的明确路线。

## 1) 下一次提问建议（建议直接复制给 WebGPT）

> 请附上：`proxy/repomix-webgpt-overview.txt` + `proxy/repomix-webgpt-src-notests.txt`
> （可选：再附 `proxy/repomix-webgpt-src.txt`，告诉它“tests 实际存在，只是我打包时为减体积排除了”）

```text
你上一次给了《Formax 产品化路线图（Codex CLI 视角）》。我准备开始落地实现，但我只想先做“能交给陌生用户用”的 P0/P1，不想过早实现重型生态（starlark rules / 插件市场 / 复杂 diff 队列）。

请你做一次“证据化校正 + MVP 重排优先级 + 实现落点收敛”，并基于我提供的 repomix 代码包给出可执行的工程方案。

输出格式要求：
- 用 Markdown，按 0/A/B/C… 分节输出
- 每个小节都给 “决策 + 依据 + 落点（文件/函数）+ DoD/验收” 四件套
- 如果你的输出长度可能超限：优先保证 0/B/C/E/F/G/K 完整；其余节可以给精炼版 + 明确“下一问要补什么”

强约束：
1) 你提到任何 Codex CLI 的具体行为/默认值/配置路径/命令时：必须给来源 URL；没有来源就标【推测】并给出验证方法（我该运行 Codex CLI 执行哪些命令、截哪些输出）。
2) 请先纠偏 Formax 现状：tests 实际存在（我只是打包 notests）；此外 Formax 已有 Bash/Edit 审批、Plan/acceptEdits 模式、Task/TaskOutput、slash commands 下拉提示等，请你在方案里复用这些能力。
3) 输出必须能直接用于实现：给出数据结构、接口签名、模块边界、拦截点、以及 PR 切分（含验收脚本/测试点）。

你需要输出：

0. 事实校正（先做，越具体越好）
- 你上一次文档里的关键结论逐条过一遍（至少 25 条），按【证据/推测】标注
- 对【证据】给出：来源 URL / repo 证据（文件路径+符号名）/ 可复现实验（命令+预期输出）
- 对【推测】给出：最小验证清单（我该运行/截图/抓包什么）+ 验证失败时的替代方案
- 纠偏 Formax 现状：把你上次误判或缺失的点列出来（至少 10 条），避免后续路线图建立在错误前提上

A. Codex “产品骨架”对 Formax 的最小映射（MVP 版）
- 配置系统（config + auth store + precedence）
- sandbox/approval（至少覆盖：写文件、bash、网络）
- policy/rules（至少覆盖：记住批准、允许目录、允许域名）
- doctor/status（自助排障与导出 debug bundle）

B. Setup/config/auth MVP（请写到“能直接实现”的颗粒度）
- 配置与凭证的边界：哪些写到 config，哪些写到 auth store（脱敏/权限/备份/迁移）
- 配置优先级表：flags/env/config/default（必须给成表格，并写清“冲突时谁赢”）
- v1 config schema（JSON schema 或 TypeScript interface 任选其一，但要完整）：provider/baseUrl/apiKeyRef/defaultModel/logDir/workspaceRoots/networkPolicy/approvalPolicy 等
- setup wizard 的 Ink 交互规格（逐屏/逐键盘交互）：缺 key/baseUrl 不通/模型为空/写权限不足时的分支；错误文案与可执行修复步骤
- 与 REPL 的关系：是否需要 `/setup`、`/config`、`/auth` 这些 slash commands；以及它们与“首次启动自动进入 setup”的关系
- 精确落点：尽量复用现有实现（例如 `src/env/config.ts`、`src/features/commands/*`、`src/components/ui/*`），只在必要时新增文件

C. 规则系统 MVP：请明确选型（先 JSON 还是直接 starlark）
要求你做决定并解释：
- v1 用 JSON 规则（更易实现），v2 再兼容 starlark；或者直接上 starlark
如果选 JSON：
- 给 schema（字段、版本、优先级、作用域：global/project/profile）
- 给 10 条示例规则（覆盖：允许目录、允许域名、bash deny/confirm、写文件 deny/confirm、read outside workspace confirm、记住本次/永久）
- 给匹配算法与 explain 输出格式（为什么命中这条/为什么拒绝）
- 给最小实现落点（Formax 现有 policy 在 src/tools/modules/bash/policy.ts 等，你建议统一到哪里？）

D. ApprovalService 统一化落点（把“分散在 tool handler 的审批”统一）
请明确：
- 统一拦截放在 ToolExecutor 层还是每个 tool handler？两者如何分工？
- UI 交互如何复用现有 AskUserQuestion/EditApprovalPrompt（或抽象一个通用 ApprovalPrompt）
- “记住选择”的持久化如何实现（rules 文件写入时机、撤销机制）
- 如何保证一致性：Bash/Write/Edit/Read/Glob/Grep/WebFetch 的审批提示应共享同一套“决策引擎 + 文案 + explain”

E. /status + /doctor + debug bundle（产品化自解释）
- `/status` 输出字段设计（必须脱敏）：profile/provider/model/baseUrl/configPath/logDir/workspaceRoots/networkPolicy/approvalPolicy 等
- `/doctor` 检查项清单：鉴权、网络连通性、写权限、工作区识别、规则/配置可读写、依赖版本等
- 错误分层：把 HTTP/SDK/系统错误映射到稳定错误码（E_AUTH_401/E_TIMEOUT/E_FS_DENIED…）并给统一文案模板
- debug bundle：给出 bundle 结构（manifest + logs + config redacted + doctor snapshot），以及如何一键导出/分享（不包含 secrets）
- 精确落点：哪些逻辑放在 `src/features/commands/*`，哪些放在 `src/env/*`，哪些放在 `src/tools/*`

F. P0/P1 重新排序（严格压缩到最小闭环）
- P0：陌生用户 15 分钟可跑通（setup wizard + config/auth + status/doctor + 最小安全边界）
- P1：稳定可用（规则持久化、审批一致性、debug bundle、错误文案统一）
请给每项：
- 改动文件列表（尽量复用现有目录）
- DoD（可运行命令 + 预期输出）
- 必要测试点（vitest）

G. CLI/命令契约（把“产品骨架”变成稳定接口）
- 给 `formax` 的命令树（subcommands + flags），至少覆盖：`repl`/`setup`/`config`/`auth`/`status`/`doctor`/`policy`
- 每个命令的：
  - 用法示例
  - flags/env/config 的输入来源说明
  - 输出格式：人类可读 + `--json` 机器可读（给 JSON schema）
  - exit codes 约定（0/1/2… 的语义）
- 明确 REPL slash commands 与 CLI 子命令的复用关系（同一份实现、不同 presenter）

H. 文档与文案（一次性产出可直接粘贴的材料）
- `README.md` 面向陌生用户 QuickStart（安装→setup→首次对话→常见失败）
- `docs/troubleshooting.md` 目录与每节要点（401/403/DNS/timeout/baseUrl 不兼容/权限边界/规则冲突等）
- `--help` 的完整输出文案（含最常用示例）
- 安全文案：哪些信息必须永远不打印（apiKey、token、cookies 等）+ redaction 规则

I. 迁移与兼容（避免上线后“静默坏掉”）
- 从当前“env-only/零配置”迁移到 config/auth store 的策略（一步到位 vs 渐进迁移）
- 兼容窗口与提示文案（例如：v0.x 兼容旧 env，但 `/doctor` 强提示迁移；v1.0 移除旧 env）
- 防回归测试建议（至少 10 条）：优先级正确、脱敏不泄露、doctor 分类正确、规则匹配稳定

J. Codex 对齐的“最小验证清单”
为了把【推测】变【证据】，请你给我一个最小清单：我运行 Codex CLI 时只需执行哪些命令/操作、保存哪些输出（脱敏），就能验证：
- config 文件位置与字段
- sandbox/approval 的默认行为
- rules/记住选择是否存在以及格式
- /doctor /status 的字段集合
- /diff /apply_patch 工作流的关键 UX

K. 最终输出要求（请在最后附上“可直接复制”的）
1) config 示例（v1）
2) rules 示例（v1）
3) doctor 输出示例（成功+失败）
4) status 输出示例（成功+失败）
5) debug bundle 的 manifest 示例（含脱敏规则说明）
6) 最小 PR 切分计划（PR1..PRN，每个 PR 给文件列表+验收步骤+要补的测试）
```

## 2) 额外可选追问（如果你要把 Codex 相关【推测】做成“可验证实验”）

```text
请把你文中所有 Codex CLI 的【推测】逐条列出来，并为每条推测给一个“最小验证实验”（我需要运行什么命令、期望看到什么输出、如何脱敏），以及一旦验证为 false 你建议 Formax 应该怎么做（替代方案）。
```

## 3) 额外可选追问（如果你还想要更硬核的“安全/策略”方案）

```text
我只关心“安全边界 + 可解释策略 + 可审计日志”三件事：请你给我一份 Formax 的 v1 threat model（攻击面、资产、威胁、缓解），并把它落到工程实现：默认 workspaceRoot 如何确定、跨目录/跨网络访问如何审批与持久化、日志如何脱敏与留存、以及如何写 20 条 vitest 安全回归测试。
```

## 4) 额外可选追问（发布与分发：把它真的交到别人手里）

```text
请你只从“可发布产品”的角度给我一套最小分发方案：安装方式（brew/npm/bun/单文件二进制 选一到两条主路径）、版本升级策略（含 config/rules 版本迁移与回滚）、以及在 macOS/Linux/Windows 上的默认目录与权限注意事项。要求：每个选择给出理由、最小实现落点（文件/脚本）、以及可复现的验收命令。
```
