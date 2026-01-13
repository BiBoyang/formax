# Formax 产品化完整执行计划（激进版：P0/P1 + PR 流程）

> 目的：把 `plans/product-strategy/Formax 产品化差距审计2.md`（Claude Code 视角）与 `plans/product-strategy/Formax 产品化路线图2.md`（Codex CLI 视角）合并成一份 **可直接照着落地** 的执行流程。
>
> 设计原则：我会更“激进”——**先立终局架构**（Kernel + Adapters），再用“Strangler Fig”方式把旧代码逐段迁移进新内核；这样不会被现有目录结构牵着走，也更利于未来做多 UI（Ink / TUI / Web）与插件化。

> 与上一版（偏“就地修补”的 6 PR）相比，本版核心变化：
> - 从“最小新增目录 + 复用现有实现”升级为“Kernel-first + Adapters（强边界）”
> - 配置层从 `flags/env/config/default` 扩展到 `flags/env/project-config/global-config/default`
> - Policy 从“按工具名”升级为“按能力/动作 PolicyAction”（fs.read/bash.exec/net.fetch…）
> - 增加事件流/审计作为一等公民（为 debug bundle / 可解释策略服务）
> - PR 规划从 6 个扩展为 9 个（PR0..PR8），先立骨架再迁移

## 0) 最终目标（验收口径）

### P0（陌生用户 15 分钟跑通）
- 新机器、无任何 env：`formax` 自动进入 setup → 落盘 config/auth → 进入 REPL 对话成功
- `formax status` / REPL `/status`：脱敏展示有效配置、路径、workspace roots、网络/审批策略
- `formax doctor` / REPL `/doctor`：至少 10 项检查 + 可执行修复建议；失败 exit code 有语义
- 默认安全：网络默认拒绝；写文件/高危 bash 默认提示或拒绝（有一致的交互）

### P1（稳定可用）
- 规则持久化：`remember` 能写入 JSON rules（global/project），并能 explain 命中原因
- 审批一致：Read/Glob/Grep/WebFetch/WebSearch/Bash/Write/Edit/NotebookEdit 统一走同一套 preflight + UI
- debug bundle：一键导出（不含 secrets），可用于 Issue/支持排障
- `--json` 输出与 exit codes 稳定，可用于脚本/CI

## 1) 关键决策（先定死，减少返工）

### 终局架构（先定：否则越做越像“补丁集合”）
- **Kernel-first**：所有“业务/规则/状态机”进入 `src/core/*`，禁止引用 Ink/Anthropic SDK/Node FS/网络；只依赖抽象接口。
- **Adapters**：`src/adapters/*` 实现边界（fs/network/keyring/llm/ui），Kernel 通过依赖注入拿到能力。
- **UI/CLI 只是外壳**：`src/ui/*`（Ink）与 `src/cli/*`（stdout/JSON）只负责渲染与输入，不包含业务决策。
- **事件流/审计优先**：Kernel 全部关键决策（配置来源、审批、policy 命中、工具执行）产出结构化事件，便于 debug bundle 与审计。
- **契约优先**：对外输出（`--json`、doctor/status/policy explain）都用稳定 schema（推荐 zod 做 runtime validation + TS 类型）。

### 配置/凭证（产品骨架）
- `config`：v1 主格式仍选 **JSON**（`config.json`），但要求 **runtime 校验**（zod）+ **版本化**（`version: 1`）。
- `auth`：敏感信息单独写 `auth.json`（mac/linux 0600；Windows 以目录 + ACL 约束为主）；Kernel 只看到 `authRef`。
- 路径：全局 config 位于“OS 标准路径”，并兼容读取 `~/.formax`（legacy）；提供 `formax config migrate` 一键迁移。
- 优先级：`flags > env > project-config > global-config > defaults`（新增 project-config：`<repo>/.formax/config.json`），并输出 `sources`。
- env 兼容：保留 `ANTHROPIC_*2` 作为 **迁移输入**（非长期配置源）；doctor 强提示迁移并给一键命令。

### 安全/策略
- v1 规则格式：**JSON rules**（先易落地；未来再考虑 DSL）。
- 规则优先级：`deny > prompt > allow`（与 explain 一致）。
- **从“工具名”抽象到“能力/动作”**：policy 评估目标是 `PolicyAction`（fs.read/fs.write/bash.exec/net.fetch…），而非 Read/Bash/WebFetch 这些工具名。
- workspace root：默认 `git-root`（fallback `cwd`），支持多 root（monorepo/worktrees）。
- 网络策略：默认 `deny`；允许按 domain allowlist；明确 `allowPrivateIps=false`。
- 审批统一：所有需要审批的动作都必须通过 `ApprovalService`（一个入口）产生 UI 与 remember 规则（禁止散落在 handler）。

### CLI 契约（强制：`--json` + stdout/stderr + exit codes）
- `--json`：stdout **只输出 JSON**（不混日志/进度）；日志/调试输出走 stderr。
- JSON envelope v1（建议固定字段，便于快照/脚本/CI）：
  - `schemaVersion: 1`
  - `command: string`
  - `ok: boolean`
  - `data?: unknown`
  - `error?: { code: string; message: string; hint?: string; details?: unknown }`
  - `warnings?: string[]`
  - `meta?: { durationMs?: number; profile?: string; provider?: string }`
- `--no-color`：禁用 ANSI（帮助输出/doctor/status/policy explain 都能快照）。
- exit codes（建议避免冲突，usage 永远是 2）：
  - `0`：成功（或仅 warnings）
  - `1`：执行失败（例如 doctor 有 fail / policy deny 在非交互模式）
  - `2`：用法错误（unknown command/invalid args）
  - `3`：配置不可用（config 解析失败/缺失导致无法运行）
  - `4`：认证不可用（auth 缺失/不可读）
- 验证隔离：所有验证命令都应支持 `FORMAX_CONFIG_DIR=/tmp/...`（避免污染真实 `~/.formax`）。

## 2) 模块边界（激进版：Kernel + Adapters）

> 这里是“立终局架构”，但采用 **Strangler Fig** 迁移：旧实现先作为 adapter/legacy provider 被包住，逐步把逻辑搬进 core。

### 推荐目录结构（新增为主，旧目录逐步迁移）
```text
src/
  core/
    app/                # createApp(), AppContext, event bus
    config/             # schema + resolver + precedence + migrations
    auth/               # auth refs + store interface（file/keyring）
    policy/             # PolicyAction/Decision + rules engine + explain
    approval/           # approval state machine（不含 UI），remember -> rule patch
    diagnostics/        # status/doctor + error codes + debug bundle builder（不含 fs）
    commands/           # command registry（slash + cli 共用），插件加载协议（先留接口）
    tools/              # tool capability map + preflight contract（不含具体工具实现）
    types/              # shared schemas（zod）
  adapters/
    fs/                 # file store + atomic write + permissions
    llm/                # anthropic/openai clients（streaming）
    network/            # WebFetch/WebSearch adapters + domain policy hooks
    ui/                 # Ink prompts adapter（AskUserQuestion/Select/TextInput）
    git/                # git-root detection, repo metadata
    clock/              # time for timestamps/durations (testable)
  ui/                   # Ink screens only（REPL, SetupWizard, etc.）
  cli/                  # argv routing + human/json renderers + exit codes
  legacy/               # 临时：把现有实现包一层，逐步删掉
```

### 关键接口（只列“必须稳定”的）
- `src/core/app/createApp.ts`：`createApp(adapters): App`
- `src/core/config/resolve.ts`：`resolveRuntimeConfig(inputs): ResolvedConfig`（含 sources/warnings）
- `src/core/policy/engine.ts`：`evaluate(action, context): PolicyDecision`
- `src/core/approval/service.ts`：`requestApproval(decision): ApprovalOutcome`（UI 由 adapter 承担）
- `src/core/diagnostics/doctor.ts`：`runDoctor(context): DoctorReportV1`
- `src/core/commands/registry.ts`：`registerBuiltins(); loadProjectCommands(); dispatch()`

## 3) 执行流程（按 PR 分解：推荐 10–11 个 PR；PR10 可选）

> 相比之前 6 个 PR 的“就地修补”，这里先把 **Kernel + Adapters** 立起来；代价是早期变更更大，但后期迭代会快很多。
>
> 实操建议：把下面每个 PR 当成 **Epic**；你真正每天推进的单位应该是 “PRx-a / PRx-b” 或者 checklist 里的单条 TODO。
> - 每条 TODO 都要写清楚 DoD（验收命令/截图/测试）。
> - 如果某条 TODO 改动面太大（>5 个文件或跨 2 个领域），就继续拆成 2 条。
>
> 推荐落地顺序（解决常见“依赖反转”，并让每一步都可验证）：
> `PR0 → PR2 → PR1 → PR4 → PR3 → PR5 → PR6 → PR7 → PR8 → PR9 → PR10`

### PR0 — Kernel 骨架 + Adapters 约束（零功能改动）
**目标**
- 新增 `src/core/*` 与 `src/adapters/*` 的基本骨架、事件模型、以及“禁止 core 引入 UI/FS/网络”的约束。

**主要改动**
- 新增：`src/core/app/*`（AppContext + event bus + logger interface）
- 新增：`src/adapters/*`（fs/llm/network/ui/git/clock 的 interface + default impl stub）
- `src/entrypoints/cli.tsx`：改为先 `createApp()` 再启动（内部仍可调用旧逻辑）

**DoD**
- 行为完全不变；仅引入骨架与编译期约束（tsconfig path + lint 规则可选）

**TODO（建议拆成 PR0a/PR0b）**
- [x] PR0a：新增 `src/core/app/*`（`createApp` + `EventBus` + `Logger` interface），不接任何现有逻辑
- [x] PR0a：新增 `src/adapters/*` 的 interface（先只定义最小能力，不写实现）
- [x] PR0a：新增 `src/legacy/*`，把现有启动逻辑包一层导出（`runLegacyCli()`）
- [x] PR0a：`src/entrypoints/cli.tsx` 改为 `createApp(adapters)` 后调用 legacy（行为必须不变）
- [x] PR0a：vitest 增加一个最小 smoke test（`createApp` 可实例化、event bus 可 publish/subscribe）
- [x] PR0b：加自动化边界约束（脚本）：禁止 `src/core/**` import 任何 `node:*`、`ink`、`@anthropic-ai/sdk`、`openai` 等（`npm run type-check` 内执行）

---

### PR1 — Config/Auth v1（schema+paths+migrate）+ `resolveRuntimeConfig`（core 化）
**目标**
- 引入 config/auth 的读写与路径计算
- 产生“有效配置”（flags/env/config/default 合并）与可解释来源（sources/warnings）

**主要改动**
- 新增：`src/core/config/*`、`src/core/auth/*`、`src/adapters/fs/*`、`src/core/types/*`
- 新增：core API（供 CLI/REPL 调用）：config/auth/rules 的读写 + resolver + redaction（具体 CLI 命令 wiring 放到 PR2b）
- 旧：`src/env/config.ts` 退化为 env 输入适配器（只负责读取 env，不负责合并）

**DoD**
- 没有 config/auth 时：仍可通过 env 跑 REPL（兼容现状）
- 支持 project-config：`<repo>/.formax/config.json` 覆盖全局 config
- vitest：precedence、atomic write、redaction 不泄露 secrets

**TODO（建议拆成 PR1a/PR1b/PR1c/PR1d）**
- [x] PR1a：定义 zod schema（`FormaxConfigV1` / `AuthStoreV1` / `ResolvedConfig` / `RedactionRules`）
- [x] PR1a：定义稳定 `ErrorCode` 枚举（setup/doctor/cli 共用），并写一份表格（避免 PR3 依赖 PR4 才能复用）
- [x] PR1a：schema 里把 provider 作为一等字段（至少 `anthropic | openai`，`gemini` 先占位但可禁用）
- [x] PR1a：AuthStore 支持多个 `authRef`（按 provider 分组；不把 apiKey 写进 config）
- [x] PR1b：实现 `ConfigPaths`（global/project/legacy）与 OS 标准路径计算（XDG/APPDATA/macOS）
- [x] PR1b：实现 `FileStore`（atomic write + 权限 best-effort + `~` 展开）
- [x] PR1b：实现读取：global/project 的 `config.json` + `auth.json` + `rules.json`（adapter）
- [x] PR1c：实现 `resolveRuntimeConfig(inputs)`（`flags > env > project > global > defaults`，输出 `sources/warnings`）
- [x] PR1c：把 `src/env/config.ts` 退化为 env 输入适配器（只负责读 env，不负责合并）
- [x] PR1d：让 `auth.json` 真正生效：按 `llm.provider + llm.authRef` 解析 apiKey（env 仍可覆盖）
- [x] PR1d：提供 programmatic API（core）：`configShow()` / `configMigrate()` / `authList|set|delete()`（CLI wiring 放到 PR2b）
- [x] PR1d：测试：precedence/atomic write/schema 校验失败/脱敏不泄露（至少 10 条）

---

### PR2 — CLI 产品骨架（命令树 + `--json` + exit codes）
**目标**
- `formax` 从“一条 REPL 入口”升级为可脚本化 CLI（repl/setup/status/doctor/config/auth/policy）。

**主要改动**
- 新增：`src/cli/*`（argv router + human/json renderers + exit codes）
- `src/features/commands/*` 迁移为 `src/core/commands/*`（共用 dispatch）

**DoD**
- `formax --help` 输出稳定且可测试；`--json` 输出 schema v1；exit codes 可依赖

**TODO（建议拆成 PR2a/PR2b）**
- [x] PR2a：新增 `src/cli/args.ts`（argv parse：subcommand + flags + `--json`）
- [x] PR2a：新增 `src/cli/help.ts`（help 文案集中管理，可做快照测试）
- [x] PR2a：定义 exit codes（0/1/2/3…）并写入文档与 help
- [x] PR2a：实现命令树骨架：`repl/setup/status/doctor/config/auth/policy`（先让它能跑、允许 stub）
- [x] PR2b：建立 `--json` 输出契约（JSON envelope v1）：`schemaVersion/command/ok/data/error/warnings/meta`（stdout 只输出 JSON；日志/调试走 stderr）
- [x] PR2b：增加 `--no-color`（禁用 ANSI；用于快照/CI）并保证 help/status/doctor 在 80 列不爆版
- [x] PR2b：把 PR1d 的 core API 接到 CLI：`formax config show|migrate`、`formax auth list|set|delete`（并支持 `FORMAX_CONFIG_DIR` 隔离目录）
- [x] PR2b：把 “unknown command / invalid args” 统一成 exit=2 + 指向 `--help`
- [x] PR2b：测试：help 快照、unknown command、`--json` 输出可被 JSON.parse

**备注**
- [ ] 如果你未来想做“NDJSON 事件流”（类似 Codex），可以在 PR2b 先留 `--jsonl` 的 flag 占位（不实现）

---

### PR3 — Setup Wizard（Ink）+ 首次启动自动进入 setup（用 core 状态机）
**目标**
- 把“第一次使用”从 README 迁移到产品流程：缺 key/模型/不可达时引导用户修复并落盘

**主要改动**
- 新增：`src/core/approval/*`（用于 wizard 的选择/确认逻辑复用）
- 新增：`src/ui/SetupWizard.tsx`（纯 UI；逻辑在 core）
- 连接测试走 adapter（复用现有 `fetchAnthropicModels` 作为实现）

**DoD**
- `rm -rf ~/.formax && formax` → wizard → 写 config/auth → 进入 REPL
- 错误分支：401/403/DNS/timeout/SSL 有明确修复建议
- vitest：wizard 状态机纯逻辑单测 + connectionTest error mapping

**TODO（建议拆成 PR3a/PR3b/PR3c）**
- [x] PR3a：实现 `src/core/setup/*` 状态机（纯逻辑），步骤：welcome → provider → baseUrl → apiKey → test → model → confirm → write → done
- [x] PR3a：把错误类型映射到稳定 ErrorCode（复用 PR1a 的 ErrorCode 枚举，避免依赖 PR4）
- [x] PR3b：实现 `src/ui/SetupWizard.tsx`（Ink UI），并在 wizard 期间隐藏 REPL 输入框
- [x] PR3b：Provider 选择 UX：Anthropic + OpenAI-compatible（Gemini 置灰/隐藏；可加 `--experimental-providers` 开关）
- [x] PR3c：实现 connection test adapter（Anthropic：复用现有 `fetchAnthropicModels`；OpenAI/Gemini 先返回 “未实现” 但要有清晰提示）
- [x] PR3c：实现写入：config.json + auth.json + log dir +（可选）初始化 rules.json
- [x] PR3c：测试：状态机回退/取消/重试；写入失败；401/403/DNS/timeout 文案

**验收脚本（人工）**
- [ ] 全新环境：`rm -rf ~/.formax` → `formax` → wizard 走通
- [ ] 错误分支：填错 key 触发 401；baseUrl 写错触发 DNS/timeout（至少各测 1 次）

---

### PR4 — Diagnostics（/status + /doctor）+ 结构化错误码体系
**目标**
- 让用户自助排障闭环（并为 debug bundle 做铺垫）

**主要改动**
- 新增：`src/core/diagnostics/*`（status/doctor/errorCodes）
- CLI/REPL 共用同一份 core 输出；UI 只负责渲染

**DoD**
- `formax status`（human）+ `formax status --json`（schema v1）
- `formax doctor`（human）+ `formax doctor --json`（schema v1，exit code：0=pass/warn，1=fail，2=配置不可用）
- vitest：401/ENOENT/EACCES/DNS/timeout 映射稳定

**TODO（建议拆成 PR4a/PR4b）**
- [x] PR4a：实现 `getStatusSnapshot()`：profile/provider/model/baseUrl/configPath/authPresent/logDir/workspaceRoots/policySummary/sources/warnings（全部脱敏）
- [x] PR4a：实现 `runDoctor()`：至少 10 项检查（config/auth 可读写、目录权限、网络连通性、provider 可用性、规则解析、日志目录等）
- [x] PR4a：错误码与提示文案统一：每个错误给 “原因 + 可执行修复步骤”
- [x] PR4b：CLI 子命令接入：`formax status|doctor`（human + `--json`）
- [x] PR4b：REPL slash commands 接入：`/status` `/doctor`（当前 `/status` 基于 runtime snapshot；`/doctor` 复用 core/diagnostics）
- [x] PR4b：测试：doctor 的 error mapping、status 的 redaction、exit code 语义

**DoD（产品视角补充）**
- [x] `formax doctor` 在 3 种常见失败场景下能直接告诉用户下一步怎么做（缺 key / baseUrl 不通 / 无写权限）

---

### PR5 — Policy Engine（actions/capabilities）+ rules JSON + explain/test
**目标**
- 把“默认安全边界”做成可解释、可测试、可持久化的 policy/rules

**主要改动**
- 新增：`src/core/policy/*`（PolicyAction/Decision + rules engine）
- 新增：`src/core/tools/*`（tool → capability map；不再用 tool name 做策略）
- `formax policy test/explain` 直接基于 PolicyAction（不依赖工具执行）

**DoD**
- `formax policy test --bash "rm -rf /"` → deny + explain
- 规则优先级：deny > prompt > allow；作用域：project > global
- vitest：匹配算法、冲突处理、domain allowlist/subdomain、path boundary

**TODO（建议拆成 PR5a/PR5b/PR5c）**
- [x] PR5a：定义 `PolicyAction`（fs.read/fs.write/bash.exec/net.fetch/net.search）+ `PolicyContext`（cwd/workspaceRoots/provider）
- [x] PR5a：定义 rules JSON schema（global/project/session；decision=allow/prompt/deny；reason/template）
- [x] PR5a：rules 必须包含 `ruleId/enabled/createdAt/scope`（否则无法撤销/审计，也不敢让用户点“remember”）
- [x] PR5b：实现 rules store（load/save/merge）+ precedence（project > global）
- [x] PR5b：实现匹配算法与 explain（命中规则、拒绝原因、下一步建议）
- [x] PR5c：实现 CLI：`formax policy list|test|explain`（不依赖工具执行）
- [x] PR5c：实现 CLI：`formax policy delete|disable <ruleId>`（避免“点错一次永久坏掉”）
- [x] PR5c：`policy explain --json` 输出固定结构：`decision` + `matchedRule{ruleId,scope,decision,reason}` + `suggestions[]`
- [ ] PR5c：实现 workspaceRoots 探测 adapter（git-root + cwd fallback，多 root 支持）
- [x] PR5c：测试：deny 覆盖 allow、subdomain 匹配、路径越界、scope precedence（至少 15 条）

**关键约束（别省略）**
- [x] policy 的判断必须基于 `PolicyAction` 而不是 tool name（否则以后加 provider/插件会崩）

---

### PR6 — ApprovalService 注入 ToolExecutor（统一拦截 + remember + 审计事件）
**目标**
- 把目前分散在各 tool handler 的审批统一掉，避免体验不一致、也避免漏拦截

**主要改动**
- 新增：`src/core/approval/*`（决定/remember patch 生成），`src/adapters/ui/*`（交互）
- 修改：`src/tools/executor/*`（preflight：tool call → PolicyAction → PolicyDecision → Approval）
- 修改：各 tool modules：移除散落审批；只返回“我需要哪些 actions/capabilities”

**DoD**
- write/edit/bash/web 默认策略行为一致（同一套 UI/文案/remember）
- 一次批准/永久批准都会落到 rules（如 P0 阶段可先 session memory，P1 再落盘；但建议直接落盘）
- vitest：preflight 必经；wildcard subagent/tool allow-list 也要回归（避免“工具全部被拒绝”）

**TODO（强烈建议拆成 PR6a/PR6b/PR6c/PR6d）**
- [x] PR6a：在 ToolExecutor 层加入 preflight hook（tool call → PolicyAction → PolicyDecision），先只做到“可拒绝/可 explain”（不弹 UI）
- [x] PR6b：实现 `ApprovalService`（core）：把 decision=prompt 转成 “allow once / allow always / deny” 三选一
- [x] PR6b：实现 UI adapter（Ink）：统一文案、支持 remember scope（session/project/global）
- [x] PR6b：非交互模式（无 TTY/CI）：默认不弹 UI，直接 deny 并返回稳定 ErrorCode + explain（避免卡住自动化）
- [x] PR6b：remember 的落盘：把 “allow always” 写入 rules（project 或 global），并能在 `policy list` 看见
- [x] PR6c：建立 tool→action 映射表（集中在一处）：Read/Write/Edit/Bash/WebFetch/WebSearch/Glob/Grep/NotebookEdit/TaskOutput
- [x] PR6c：逐个工具迁移（每次 2–3 个）：先 Bash/Write/Edit/WebFetch → 再 Read/Glob/Grep → 再 NotebookEdit/TaskOutput
- [x] PR6d：统一取消/中断：Esc/abort 逻辑一致，且不会把“半截审批内容”塞进后续对话（先覆盖 Edit/Write/Bash 审批）
- [x] PR6d：回归 wildcard subagent：`tools:['*']` 代表“允许全部工具”，不要被 allow-list 误杀
- [x] PR6d：测试：preflight 必经、remember 生效、deny 覆盖 allow、subagent wildcard 不回归

**DoD（体验版）**
- [x] 任意需要审批的行为，用户看到的 UI/文案/选项顺序一致（至少手测 3 类：fs.write / bash.exec / net.fetch）

---

### PR7 — debug bundle + 审计日志 + 文档/帮助文案
**目标**
- 把排障材料标准化，减少维护成本；同时补齐“可交付产品”的文档入口；并把关键动作可审计化。

**主要改动**
- 新增：`src/core/diagnostics/debugBundle.ts` + `src/adapters/fs/auditLog.ts`
- 新增：`docs/troubleshooting.md`（最小）
- 修改：`README.md`（QuickStart）
- 修改：`src/cli/help.ts`（集中 help 文案）

**DoD**
- `formax doctor --bundle` 生成目录/压缩包 + manifest（脱敏规则明确）
- `formax --help` 完整输出（含常用示例、exit codes、--json）
- vitest：bundle 不含 secrets（pattern 扫描必须 mask）

**TODO（建议拆成 PR7a/PR7b/PR7c）**
- [ ] PR7a：定义审计事件 schema（NDJSON）：policy decision / approval outcome / tool call / tool result / errors / durations
- [ ] PR7a：默认 **不** 记录对话文本（transcript）进审计/Bundle；如确需，提供 `--include-transcript` 显式开关
- [ ] PR7a：实现 `AuditLog` adapter：写入 `~/.formax/logs/audit.ndjson`（或 config 指定），并做 redaction
- [x] PR7b：实现 debug bundle builder（core）：收集 status/doctor/config.redacted/rules + manifest
- [ ] PR7b：bundle 增加 logs/audit（如存在），并做 redaction
- [x] PR7b：实现 `formax doctor --bundle`：生成 bundle 目录（可选 tar.gz）
- [ ] PR7c：补齐 docs：README QuickStart + `docs/troubleshooting.md` + “如何提交 bug（附 bundle）”
- [x] PR7c：测试：bundle 不含 secrets（扫描 `sk-`、`Authorization:`、`apiKey` 等必须被 mask）

**DoD（支持视角）**
- [ ] 你可以让朋友在他机器上跑 `formax doctor --bundle`，把压缩包发给你；你能仅凭 bundle 定位到“缺 key / 网络不通 / 权限拒绝 / policy 拦截”中的一种

---

### PR8 — Release/Distribution（可选，但如果你想“真给别人用”就做）
**目标**
- 安装/升级/卸载的最小闭环（brew/npm/bun 选 1-2 条主路径），并保证迁移与回滚策略清晰。

**DoD**
- 新用户按 README 一条命令安装并进入 setup；升级不丢 config/rules；doctor 可一键导出 debug bundle。

**TODO（建议先把“选择”写死，再做实现）**
- [ ] 选定分发路径（建议：`npm` + `brew`；或 bun 单文件二进制），写清取舍与非目标
- [ ] 增加 `formax --version`（版本号 + git sha/构建时间）
- [ ] 安装/升级/卸载文档：macOS/Linux/Windows 各 1 条路径（能复制粘贴）
- [ ] 升级/迁移策略：config/rules schema 版本升级与回滚（遇到破坏性变更必须提示）
- [ ] 外部试用：找 1–2 个朋友按 README 安装运行（反馈记录到 `plans/product-strategy/`）

---

### PR9 — 多家大模型兼容（Anthropic + OpenAI-compatible）
**目标**
- 在不破坏现有工具调用/流式体验的前提下，增加 OpenAI-compatible（OpenAI 官方/其他兼容网关）；Gemini 放到 PR10（可选）。

**Checklist（建议拆成 PR9a/PR9b/PR9c）**
- [ ] PR9a：定义统一 LLM 事件接口（streaming）：text delta / tool call / tool result / error（core 只看统一事件，不看 SDK）
- [ ] PR9a：定义 provider 抽象：`anthropic | openai`（`gemini` 先占位，不启用）
- [ ] PR9b：Anthropic adapter：用现有 streaming 实现适配到统一接口（必须不回退工具调用行为）
- [ ] PR9b：把现有 `streaming/anthropic/*` 迁移到 `src/adapters/llm/anthropic/*`（或先做 wrapper，逐步搬）
- [ ] PR9c：OpenAI-compatible adapter：支持 baseUrl 自定义（OpenAI 官方与兼容网关），并把 tool-calling 映射到统一事件
- [ ] PR9c：实现 OpenAI 的连接测试 + models 列表（最小可用即可：能验证 key/baseUrl/model）
- [ ] PR9c：setup wizard 启用 OpenAI-compatible 选项（没有实现前必须置灰/隐藏，避免“选了跑不动”）
- [ ] PR9c：测试：同一段“触发工具调用”的对话在 Anthropic 与 OpenAI 下都能跑通（至少覆盖：Read/Glob + Bash/Write 其中一个）

**DoD**
- [ ] `formax setup` 可选 Anthropic/OpenAI-compatible，并能完成一次包含工具调用的对话（手测 + 录屏/截图）

---

### PR10 — Gemini（可选：复杂就延后）
**目标**
- Gemini 兼容通常更“特殊”（SDK/函数调用/流式差异），先做占位与验证路线；实现可延后到 P2。

**Checklist**
- [ ] 选型：Gemini 的 SDK/HTTP 接入方式；确认 function/tool calling 与 streaming 的事件语义
- [ ] 实现 Gemini adapter（统一事件接口）
- [ ] setup wizard 启用 Gemini 选项（默认隐藏或 `--experimental-providers`）
- [ ] 测试：工具调用 + streaming + 错误映射（至少 5 条）

## 4) 可复制的验证步骤（按 PR）

> 全局约定（强烈建议写进你的习惯）：
> - 所有验证命令都用隔离目录：`FORMAX_CONFIG_DIR=/tmp/formax-<pr>`
> - `--json` 时 stdout **只能**输出 JSON；任何日志/调试输出必须走 stderr
> - 建议统一加 `--no-color` 做快照/CI

### PR0（骨架）
- Commands:
  - `npm run type-check`
  - `npm test -- src/core/app/createApp.test.ts`
- Expected:
  - `type-check` exit 0；`vitest` PASS

### PR1（config/auth + resolver）
- Commands:
  - `npm test -- src/core/config/resolve.test.ts`
  - `node -e "import { resolveRuntimeConfig } from './dist/...'; console.log('ok')"`（或同等方式调用 resolver；以实现落点为准）
- Expected:
  - precedence 测试覆盖 `flags > env > project > global > defaults`

### PR2（CLI 契约）
- Commands:
  - `FORMAX_CONFIG_DIR=/tmp/formax-pr2 rm -rf /tmp/formax-pr2`
  - `formax --help --no-color`
  - `formax unknown-subcommand ; echo $?`
  - `formax status --json | jq '.schemaVersion,.command,.ok'`
- Expected:
  - unknown command exit=2，并提示 `--help`
  - `status --json` 可被 JSON.parse，且 stdout 只有 JSON

### PR3（setup wizard）
- Manual checks:
  - `FORMAX_CONFIG_DIR=/tmp/formax-pr3 rm -rf /tmp/formax-pr3 && formax`
  - wizard 期间 REPL 输入框隐藏；错误分支（401/DNS/timeout）有可执行修复建议

### PR4（status/doctor）
- Commands:
  - `FORMAX_CONFIG_DIR=/tmp/formax-pr4 rm -rf /tmp/formax-pr4`
  - `formax status --json ; echo $?`
  - `formax doctor --json ; echo $?`
- Expected:
  - status 脱敏（不出现 apiKey 原文）
  - doctor exit：0=pass/warn；1=fail；3/4 用于 config/auth 不可用（以本文档 exit code 表为准）

### PR5（policy）
- Commands:
  - `FORMAX_CONFIG_DIR=/tmp/formax-pr5 rm -rf /tmp/formax-pr5 && mkdir -p /tmp/formax-pr5`
  - `formax policy list --json`
  - `formax policy explain --action bash.exec --cmd "rm -rf /" --json`
- Expected:
  - explain 输出 `decision` + `matchedRule{ruleId,...}` + `suggestions[]`

### PR6（approval + executor 统一拦截）
- Manual checks:
  - 在 REPL 触发 `fs.write` / `bash.exec` / `net.fetch` 三类审批
  - 测试 Allow once / Allow always / Deny；remember 后下次不再提示
  - 非交互模式（无 TTY）应直接 deny 并返回 explain（不应卡住）

### PR7（debug bundle + audit）
- Commands:
  - `FORMAX_CONFIG_DIR=/tmp/formax-pr7 rm -rf /tmp/formax-pr7 && formax doctor --bundle`
  - `rg -n \"sk-|Authorization:|apiKey\" <bundleDir> || true`（应只命中脱敏后的内容）
- Expected:
  - bundle 生成成功；manifest 存在；默认不包含 transcript

### PR8（release）
- Commands:
  - `formax --version`
  - 按 README 安装/升级/卸载路径走一遍（至少 macOS）

### PR9（Anthropic + OpenAI-compatible）
- Manual checks:
  - Anthropic：纯对话 + 触发一个工具调用 + 401 错误分支
  - OpenAI-compatible：纯对话 + 触发一个工具调用 + baseUrl 不通错误分支

### PR10（Gemini，可选）
- Manual checks:
  - 一旦启用：纯对话 + 触发工具调用 + 错误映射（至少 5 条）

### 最小回归脚本（建议每次合并/发版前必跑）
- `npm run type-check`
- `npm test`
- `FORMAX_CONFIG_DIR=/tmp/formax-smoke rm -rf /tmp/formax-smoke`
- `formax --help --no-color >/tmp/help.txt`
- `formax status --json >/tmp/status.json`
- `formax doctor --json ; echo $?`
- `formax policy explain --action bash.exec --cmd "rm -rf /" --json >/tmp/policy.json`

## 5) 仍需抓包/验证的“证据化清单”（可选，但建议做）

> 只要你还想继续“对齐 Claude/Codex 的产品习惯”，就把推测变证据；否则容易做偏。

- Codex：默认 `sandbox_mode/approval_policy` 的真实默认值（文档未必写死）
- Codex：`execpolicy` 的参数形式与输出格式（用于 Formax `policy test/explain` 设计参考）
- Claude Code：首次写文件/运行 bash 的审批 UI 文案与 remember 行为（用于对齐体验）

## 6) 后续（P2+ Backlog，不阻塞 P0/P1）
- Keychain/libsecret/credential manager：把 auth store 从 file 升级为 keyring（跨平台差异大）
- rules DSL（Starlark-like）：在 JSON rules 稳定后再考虑（先有 explain/test）
- 插件/skills：命令注册协议先在 core 里“留好扩展点”，等产品骨架稳定再开生态
