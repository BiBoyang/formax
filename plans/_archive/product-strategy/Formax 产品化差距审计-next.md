# Formax 产品化差距审计（Claude Code 视角）- Next 问题清单

> 对应文件：`plans/product-strategy/Formax 产品化差距审计.md`（WebGPT：Claude Code 方向）
>
> 目标：用 **一次高质量提问** 换取“能直接落地”的规格说明与实施切分，重点补齐 **产品化骨架**（setup/config/doctor/status/安全边界/发布）。

## 0) 质量快速评估（供你决定要不要再追问）

**优点**
- 结构化非常强（差距表 + P0/P1/P2 + 交付产物 + PR 切分计划），而且“产品化”聚焦明确。
- 产物可直接复用：QuickStart、config 示例、/doctor 示例、错误文案、DoD/验收标准。
- 能抓到关键阻塞：首次使用/凭证/诊断/安全边界/发布维护，而不是陷在“功能对齐”里。

**风险/需要二次澄清的点**
- Claude Code 的具体行为/默认值/命令，有些是概述或【推测】，需要更严格的“证据标注/可验证清单”。
- 很多建议是“新建目录 + 新系统”（如 `src/config/*`、`src/diagnostics/*`），需要结合 Formax 现有实现（`src/env/config.ts`、`src/tools/runtime/*`、`src/features/commands/*`）做更精确的落点与最小改动方案。
- 权限边界（workspace allowlist、网络域名 allowlist、持久化批准规则）是产品关键，但需要具体到“数据结构/匹配算法/拦截点/交互文案/迁移策略”，否则会做成半套。

## 1) 下一次提问建议（建议直接复制给 WebGPT）

> 请附上：`proxy/repomix-webgpt-overview.txt` + `proxy/repomix-webgpt-src-notests.txt`
> （可选：再附 `proxy/repomix-webgpt-src.txt`，如果你希望它也参考测试）

```text
你上一次给了《Formax 产品化差距审计》，我准备开始落地实现 P0。请你基于我提供的 repomix 代码包，输出一份“实现级规格说明 + 最小改动落点”，重点解决：首次使用/配置/诊断/安全边界/发布。请把结论分成【证据】与【推测】，并给出把推测变成证据的验证清单。

强约束：
1) 你提到任何“Claude Code 的默认行为/命令/路径/策略”时：必须给来源 URL；没有来源就标【推测】并给验证方法（我该运行/抓包/截图什么）。
2) 对 Formax 的改造建议必须绑定到真实文件路径（从 repomix 可搜到），并尽量复用现有模块，避免“另起一套系统”。
3) 输出必须可执行：给出接口签名、数据结构、状态机、错误码/文案，以及按 PR 切分的 diff 级别实施计划。

你需要输出：

A. “配置系统 v1”最终决策（请你在几个分歧点做选择并给理由）
- 配置文件格式：json / jsonc / toml（选一个作为 v1 主格式；另两个作为未来可选）
- 配置路径：~/.formax vs XDG（Linux/macOS/Windows 的推荐默认路径与迁移）
- 凭证存储：文件（600 权限）/ keychain（可选）/ env（兼容）
- 配置优先级：flags/env/config/default 的明确表格
- 旧 env 兼容策略：像 FORMAX_API_KEY 这类旧变量是否保留、如何提示迁移、何时移除

B. “setup wizard” Ink 交互规格（逐屏/逐键盘交互）
- 进入条件（缺 key？baseUrl 不通？model 为空？）
- 输入 key 不回显、可粘贴、确认/重试、连接测试（如何测试：做一次轻量请求还是拉模型列表？）
- 失败分支：401/403/DNS/timeout/SSL，各自应显示什么可执行修复步骤
- 落盘：写 config + 写 auth store + 写日志目录（含权限处理）
- 给出你建议新增/复用的组件：例如是否复用现有 Select/TextInput 组件；每个屏幕组件建议放哪（文件路径）

C. “/status + /doctor” 输出规格与实现落点
- status 输出字段（必须脱敏）：profile/provider/model/baseUrl/configPath/logDir/mode/网络开关/允许目录列表等
- doctor 的检查列表：网络连通性、鉴权、写权限、工作区根目录探测、代理、证书等
- 错误分类：把 Anthropic SDK/HTTP 错误映射到错误码（E_AUTH_401/E_TIMEOUT/…）并给统一文案
- 具体落点：建议新增哪些文件、修改哪些入口（例如 src/entrypoints/cli.tsx / src/features/commands/registry.ts / src/env/config.ts）

D. “安全边界 v1”（最关键）
请你把“默认只允许 workspaceRoot”落成一套完整机制：
- workspaceRoot 如何确定（process.cwd? git root? 用户可指定?）
- Read/Glob/Grep 是否限制在 workspaceRoot（默认），超出要走什么审批（一次/永久/规则）
- WebFetch/WebSearch 的网络策略：默认 off 还是 per-domain confirm？domain allowlist 如何存储与匹配？
- Bash/Write/Edit 的审批策略如何统一（我现在是分散在各 tool handler）
- 规则持久化格式（建议先 JSON）：给 schema + 3 条示例规则；给匹配顺序与冲突处理；给 “为什么命中/为何拒绝” 的 explain 输出格式

E. 最小 PR 切分计划（必须是“可直接照着做”的）
- PR1..PRN：每个 PR 只做一件事，写清：改动文件列表、核心接口、验收步骤（命令 + 预期输出）、需要补的测试
- 测试建议必须落到 vitest：至少给 10 条 P0 测试用例（config precedence、脱敏、doctor 分类、路径边界、审批持久化）

F. 验证清单（把【推测】变成【证据】）
- 列出你需要我提供的材料：Claude Code 的哪些截图/命令输出/抓包片段能验证哪些点；用最少材料验证最多假设。

G. CLI/命令契约（把“产品化骨架”变成可实现的接口）
- 请给 `formax` 的命令树设计（subcommands + flags），至少覆盖：`repl`/`setup`/`config`/`auth`/`status`/`doctor`
- 每个命令的：
  - 用法（示例）
  - 输入参数（flags/env/config）
  - 输出格式（人类可读 + `--json` 机器可读两种）与 JSON schema
  - exit codes 约定（0/1/2… 的语义）
- 明确 `/status`、`/doctor` 在 REPL 内与 CLI 子命令之间的复用关系（同一份实现、不同 presenter）

H. 文档与文案（一次性产出“可直接粘贴”的文本）
- 生成 `README.md` 的“面向陌生用户 QuickStart”段落（安装→setup→首次对话→常见错误）
- 生成 `docs/troubleshooting.md` 的目录与每节要点（401/403/DNS/timeout/baseUrl 不兼容/权限边界等）
- 生成 `--help` 的完整输出文案（包含最常用示例）

I. 迁移与兼容（避免上线后“静默坏掉”）
- 给一份迁移策略：从当前 env-only（含 `ANTHROPIC_*2`）迁移到 config/auth store 的过程
- 明确兼容窗口（例如：v0.x 兼容旧 env，但 `/doctor` 强提示迁移；v1.0 移除旧 env）与用户提示文案
- 列出你建议我在代码里新增的“防回归测试”（至少 10 条）：迁移后行为一致、脱敏不泄露、优先级正确
```

## 2) 额外可选追问（如果你只想追“安全边界”一个点）

```text
只围绕“workspace 安全边界 + 规则持久化”深挖：请给我一套 JSON 规则格式（schema + 示例），以及在 Formax 的拦截点设计（ToolExecutor vs tool handlers vs REPL），并给出 /execpolicy explain 的输出格式与最小可测用例集合。
```
