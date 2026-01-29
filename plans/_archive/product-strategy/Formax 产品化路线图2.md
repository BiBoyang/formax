# 0. 事实校正（证据化校正 + 误判纠偏）

* **决策**

  * 把“上一次文档里影响实现方向的关键结论”拆成 **35 条**（≥25），逐条标注【证据/推测】。
  * 对【证据】：给出 **Codex 官方来源（用引用链接）** / **repo 证据（文件路径 + 符号）** / **可复现实验（命令 + 预期）**。
  * 对【推测】：给 **最小验证清单** + **验证失败的替代方案**。
  * 同步把我上次对 **Formax 现状**的误判点列出（≥10），确保后续路线图不建立在错误前提上。

* **依据**

  * Codex：以 **OpenAI 官方 Codex 文档**（config / rules / security / CLI reference）为准。([OpenAI Developers][1])
  * Formax：以你给的 repomix 代码包为准（overview + src-notests + src）。例如：`loadRuntimeConfig`、Bash/Edit 审批、modes、slash command registry、vitest 配置等。

* **落点（文件/函数）**

  * Codex：仅引用官方文档页面（不改代码）。
  * Formax（现状证据落点）：

    * `src/env/config.ts` / `loadRuntimeConfig`（env-only runtime config）
    * `src/utils/env.ts`（`FORMAX_CONFIG_DIR/FILE` 常量）
    * `src/tools/modules/bash/handler.ts`（Bash 审批 + remember）
    * `src/tools/presenters/editApprovalPrompt.tsx`（Edit/Write 审批 UI）
    * `src/features/repl/mode.ts`（normal/plan/acceptEdits）
    * `src/features/commands/registry.ts` + `src/screens/REPL.tsx`（slash commands + 下拉提示）
    * `vitest.config.ts`（tests 存在）

* **DoD/验收**

  * ✅ 35 条结论全部标注【证据/推测】。
  * ✅ 每条【证据】都包含：来源（URL 引用或 repo 文件+符号）+ 可复现实验。
  * ✅ 每条【推测】都包含：最小验证清单 + 验证失败替代方案。
  * ✅ 至少 10 条“Formax 现状误判/缺失”纠偏清单。

---

## 0.1 关键结论逐条校正（35 条）

> 说明：你要求“提到任何 Codex CLI 的具体行为/默认值/配置路径/命令必须给来源 URL；没来源就标【推测】并给验证方法”。下面所有 **Codex 相关**条目都严格遵守这一点；我**不会**在无来源时把猜测当事实。

### Codex（18 条）

1. **Codex 的 home 目录由 `CODEX_HOME` 决定，默认是 `~/.codex`；配置文件是 `$CODEX_HOME/config.toml`；还会用到 `$CODEX_HOME/auth.json` 与 `$CODEX_HOME/history.log`。**【证据】

   * 来源：Advanced configuration / Configuration reference。
   * 可复现实验：

     * `echo $CODEX_HOME`（若未设置则为空）
     * `ls -la ~/.codex`（预期能看到 `config.toml`/`auth.json`/`history.log` 之一或为空目录）
     * `CODEX_HOME=$(mktemp -d) codex ...`（预期在该目录创建相应文件；具体生成时机可能与是否登录有关）【若未生成属于正常情况，视运行路径而定】

2. **Codex 支持 profiles：`[profile.NAME]`；用 `--profile/-p` 选择 profile。**【证据】

   * 来源：Basic configuration（profiles 片段）+ CLI reference（`--profile`）。([OpenAI Developers][1])
   * 可复现实验：

     * 在 `~/.codex/config.toml` 写两个 profile；
     * `codex -p <name>` 启动（预期使用该 profile 的 model/base_url/…）。

3. **Codex 的配置优先级（明确写在文档里）：CLI flags 覆盖 `config.toml`；`-c/--config key=value` 的 inline override 覆盖所有其他配置源。**【证据】

   * 来源：Basic configuration “take precedence… `-c` … precedence over all other configuration sources”。
   * 可复现实验：

     * `config.toml` 写 `model="A"`；
     * 运行 `codex -c model=B`（预期实际使用 B）。

4. **Codex 的认证凭证存储可配置 `cli_auth_credentials_store = file|keyring|auto`。**【证据】

   * 来源：Configuration reference（`cli_auth_credentials_store`）。
   * 可复现实验：

     * `~/.codex/config.toml` 设置该字段；
     * 执行 `codex login`，再查看 `$CODEX_HOME/auth.json` 是否写入（file 模式应写入）。([OpenAI Developers][1])

5. **Codex 的 `approval_policy` 有四种：`untrusted`/`on-request`/`on-failure`/`never`。**【证据】

   * 来源：Configuration reference（approval_policy 说明）。
   * 可复现实验：

     * 在 config.toml 修改 approval_policy；
     * 在 interactive 里触发写文件/跑命令，观察是否提示审批（不同策略提示频率不同）。

6. **Codex 的 `sandbox_mode` 有三种：`read-only` / `workspace-write` / `danger-full-access`。**【证据】

   * 来源：Configuration reference + CLI `--sandbox` 值域。([OpenAI Developers][1])
   * 可复现实验：

     * `codex --sandbox read-only` 运行一个会写文件的命令（预期被阻止/需要更高权限）。

7. **在 `workspace-write` sandbox 下，可以配置 `sandbox_workspace_write.network_access`（默认 false）与 `writable_roots` 等。**【证据】

   * 来源：Advanced configuration（workspace-write sandbox 配置）+ Configuration reference（network_access default false）。
   * 可复现实验：

     * `sandbox_workspace_write.network_access=false`；
     * 让 Codex 执行 `curl`（预期网络访问被禁止或需要切换策略；具体行为取决于实现/平台）。

8. **`--full-auto` 是 Codex 的“低摩擦自动化 preset”：`workspace-write` sandbox + `on-request` approvals。**【证据】

   * 来源：CLI reference `--full-auto` 描述。([OpenAI Developers][1])
   * 可复现实验：

     * `codex --full-auto` 启动，观察行为与手工设置等价（sandbox/approval 应体现该 preset）。

9. **`--dangerously-bypass-approvals-and-sandbox`（别名 `--yolo`）会绕过审批与 sandbox，文档明确标记危险。**【证据】

   * 来源：CLI reference。([OpenAI Developers][1])
   * 可复现实验：

     * `codex --yolo` 启动（预期几乎不提示审批；仅建议隔离环境运行）。

10. **Codex rules 文件位置：`$CODEX_HOME/rules/*.rules`，启动时加载。**【证据】

* 来源：Rules 文档。
* 可复现实验：

  * 在 `~/.codex/rules/default.rules` 写一条规则；
  * 重启 codex，触发相应命令，看是否命中。

11. **当你在 Codex TUI 里把命令加入 allow list，会追加到 `$CODEX_HOME/rules/default.rules`。**【证据】

* 来源：Rules 文档。
* 可复现实验：

  * 交互里选择 “Allow and remember”（或等价动作）；
  * diff `default.rules`（预期出现新条目）。

12. **Codex 的 rules 决策优先级：forbidden > prompt > allow。**【证据】

* 来源：Rules 文档。
* 可复现实验：

  * 写一条 `allow` 和一条更具体的 `forbidden`；
  * 触发命令，预期被 forbidden 拦截。

13. **Codex interactive 内有 `/status` 与 `/approvals` 命令：`/status` 用于查看 workspace 目录等；`/approvals` 可切换审批开关。**【证据】

* 来源：Security / sandbox 文档。
* 可复现实验：

  * 启动 interactive，输入 `/status`、`/approvals`（预期出现对应输出/切换）。

14. **Codex 有 `codex login` / `codex logout` 子命令。**【证据】

* 来源：CLI reference。([OpenAI Developers][1])
* 可复现实验：

  * `codex login`（按提示完成）
  * `codex logout`（预期移除凭证）。

15. **Codex 有 `codex completion` 子命令生成 shell completion。**【证据】

* 来源：CLI reference。([OpenAI Developers][1])
* 可复现实验：

  * `codex completion zsh > _codex`（预期 stdout 输出脚本）。

16. **Codex 有 `codex execpolicy`（评估 execpolicy rule files：allowed / prompted / blocked）。**【证据】

* 来源：CLI reference（列表条目）。([OpenAI Developers][1])
* 可复现实验：

  * `codex execpolicy ...`（以 `codex --help` 为准，看参数要求）【需要你实际跑一次确认参数形式】

17. **Codex `--json/--experimental-json` 会输出 newline-delimited JSON events（而非格式化文本）。**【证据】

* 来源：CLI reference。([OpenAI Developers][1])
* 可复现实验：

  * `codex --json`（预期 stdout 为 NDJSON）。

18. **Codex `codex apply`：应用 Codex Cloud task diff；如果 `git apply` 失败则 non-zero exit。**【证据】

* 来源：CLI reference。([OpenAI Developers][1])
* 可复现实验：

  * `codex apply <TASK_ID>`（需要 cloud task 环境；预期失败时 exit code != 0）。

19. **“Codex 默认 sandbox_mode / approval_policy 是什么？”**【推测】（文档说明了可配置项，但我没看到“默认值=…”的明确句子）

* 最小验证清单：

  * 在干净环境（`CODEX_HOME=$(mktemp -d)`）运行 `codex`；
  * 触发写文件/跑 bash/网络访问，观察提示频率；
  * 同时打印实际使用的 config（若 Codex 有显示配置的方式则截屏/保存）。
* 若验证为 false（比如默认很宽松）：Formax 的替代方案：**我们自己定义“默认安全”**（P0 默认 `approvalPolicy=untrusted` + `networkPolicy=deny` + workspace 限制），不跟随 Codex 默认。

20. **“Codex 是否有 `doctor` 子命令或 `/doctor` slash command？”**【推测：更可能没有】

* 证据：CLI reference 与 security 文档里明确列了 `/status`、`/approvals`，但没看到 `/doctor`；搜索也没搜到。([OpenAI Developers][1])
* 最小验证清单：

  * `codex --help | rg -i doctor`
  * interactive 输入 `/doctor` 看是否存在（预期：unknown command）。
* 若实际上存在 doctor：Formax 的替代方案不变（我们仍实现 `/doctor`），但字段可向 Codex 对齐。

---

### Formax（17 条）

21. **tests 实际存在，vitest 配置会跑 `src/**/*.test.ts(x)`。**【证据】

* repo 证据：`vitest.config.ts`。
* 可复现实验：

  * `pnpm test`（或 `npm test`，以 package.json scripts 为准）预期 vitest 扫描 `src/**/*.test.ts(x)`。

22. **`package.json` 声明 `bin.formax -> dist/entrypoints/cli.js`，Node >=18；依赖包含 `openai`、`@anthropic-ai/sdk`、`ink` 等。**【证据】

* repo 证据：`package.json`。
* 可复现实验：

  * `node -v`（>=18）
  * `node dist/entrypoints/cli.js --help`（当前可能没有 help；我们会补）

23. **Formax 已经有 `~/.formax` 的 config dir/file 常量：`FORMAX_CONFIG_DIR`/`FORMAX_CONFIG_FILE`。**【证据】

* repo 证据：`src/utils/env.ts`。
* 可复现实验：

  * `rg "FORMAX_CONFIG_DIR|FORMAX_CONFIG_FILE" -n src/utils/env.ts`

24. **但当前运行时配置仍是 env-only：`loadRuntimeConfig` 从 env 读 `FORMAX_API_KEY`、`FORMAX_BASE_URL`、`FORMAX_MODEL`、`FORMAX_LOGS_DIR`…；planDir 默认是 `~/.claude/plans`。**【证据】

* repo 证据：`src/env/config.ts` / `loadRuntimeConfig`。
* 可复现实验：

  * `FORMAX_MODEL=... node dist/entrypoints/cli.js`（预期使用该 model；具体表现可用 `/status`（我们会实现）观察）

25. **CLI entrypoint 里如果 cfg.llm.model 为空，会 fallback 到 `'claude-sonnet-4-5-20250929'`。**【证据】

* repo 证据：`src/entrypoints/cli.tsx`。
* 可复现实验：

  * 清空 `FORMAX_MODEL`，启动；在日志或未来 `/status` 里看到 model=该默认值。

26. **Formax 已有 repl mode：`normal`/`plan`/`acceptEdits`。**【证据】

* repo 证据：`src/features/repl/mode.ts`。
* 可复现实验：

  * `rg "type ReplMode" src/features/repl/mode.ts`

27. **Bash 工具已经有审批与“记住”机制：`approve_remember`，并用 `approvedKeys` 做 session-level remember。**【证据】

* repo 证据：`src/tools/modules/bash/handler.ts`。
* 可复现实验：

  * 在 REPL 里触发 bash 工具，选 “approve_remember”；再触发相同 key 的命令，预期不再提示（同一 session 内）。

28. **Bash tool spec 里已有 `dangerouslyDisableSandbox` 和 `confirm` 字段，并在 tool description 里提到了 sandbox 语义。**【证据】

* repo 证据：`src/tools/modules/bash/presenter.tsx`。
* 可复现实验：

  * 让模型输出带 `dangerouslyDisableSandbox` 的 tool call（或手工构造 tool call 测试）。

29. **Edit/Write 的审批 UI 已有统一组件，包含“allow all edits during this session（shift+tab）”。**【证据】

* repo 证据：`src/tools/presenters/editApprovalPrompt.tsx`。
* 可复现实验：

  * 触发 edit/write 工具（非 acceptEdits mode），观察提示选项。

30. **Plan 模式对写入有硬限制：write tool 在 plan mode 只允许改 plan 文件，否则返回错误。**【证据】

* repo 证据：`src/tools/modules/write/handler.test.ts`（测试名与断言）。
* 可复现实验：

  * 在 plan mode 调用 write 修改非 plan 文件，预期报错。

31. **ExitPlanMode 会询问是否“auto-accept edits”，并据此设置 replMode 为 `acceptEdits` 或 `normal`。**【证据】

* repo 证据：`src/tools/modules/exitPlanMode/handler.ts`。
* 可复现实验：

  * 进入 plan mode，再 exit；选择不同选项，观察后续 edit/write 是否还会提示审批。

32. **Slash command registry 已经存在（包含 `/doctor`、`/statusline` 等），并且 REPL 已经做了下拉建议。**【证据】

* repo 证据：`src/features/commands/registry.ts` + `src/screens/REPL.tsx`。
* 可复现实验：

  * 在输入框键入 `/d`，看 suggestion 列表。

33. **Read 工具目前只校验“绝对路径”，不做 workspace 限制；系统 prompt 甚至明确“能读机器上任何文件”。**【证据】

* repo 证据：`src/tools/modules/read/handler.ts` + `system-prompts/tool-description-readfile.md`。
* 可复现实验：

  * `read` 指向 `/etc/hosts`（或等价）能否成功（⚠️这正是 P0 要收紧的安全边界）。

34. **WebSearch 当前直接 fetch DuckDuckGo HTML，并支持输入里 `allowedDomains/blockedDomains` 过滤。**【证据】

* repo 证据：`src/tools/modules/webSearch/handler.ts`。
* 可复现实验：

  * web_search 输入 `allowedDomains=["example.com"]`，预期结果被过滤。

35. **ToolExecutor 已经在 subagent depth>0 时禁用写入类工具（Write/Edit/NotebookEdit/TodoWrite/PlanMode…），属于现有 sandbox-ish 能力，应复用。**【证据】

* repo 证据：`src/tools/executor.ts`。
* 可复现实验：

  * 触发 Task（subagent），让 subagent 尝试写文件，预期被拒绝（或 tool 不可用）。

---

## 0.2 纠偏 Formax 现状（上次误判/缺失点，≥10）

> 这些点会直接影响 MVP 的“复用 vs 重写”边界，我在后续方案里会**显式复用**。

1. **tests 并非缺失**：vitest 配置与多处 `*.test.ts(x)` 存在。([OpenAI Developers][1])
2. **已有 Bash 审批**，并支持 session-level “记住”（`approve_remember`）。
3. **已有 Edit/Write 审批 UI**（且有 approve_all/session 语义）。
4. **已有 plan/acceptEdits mode**，并且 plan mode 对写入有硬限制。
5. **已有 Task/TaskOutput 与 subagent 限制**（ToolExecutor 层）。
6. **已有 slash command registry + 下拉提示**（不是缺项）。
7. **已有 `~/.formax` 路径常量**（不是完全“零配置路径”）。
8. **已有 WebSearch 域名过滤**（可作为 network policy 的基础落点）。
9. **Read tool 目前过宽**（“能读任何文件”）是明确的安全缺口，需要 P0 收紧。
10. **已有一个“GlobalConfig/ModelProfile”结构**（但现在不落盘且把 apiKey 放在 config 里，需要迁移）。

---

# A. Codex “产品骨架”对 Formax 的最小映射（MVP 版）

* **决策**

  * 把 Codex 的骨架拆成 4 个最小可交付模块，并映射到 Formax（不引入 starlark / 插件市场 / 复杂 diff 队列）：

    1. **Config + Auth store + precedence**
    2. **Sandbox/approval（软 sandbox：工具前置审批 + workspace/network 边界）**
    3. **Rules（v1 JSON）+ remember choice**
    4. **status/doctor + debug bundle**

* **依据**

  * Codex 在“骨架层”明确提供：`config.toml`/profiles、approval_policy、sandbox_mode、rules、`--json` 输出等。([OpenAI Developers][1])
  * Formax 已经具备：modes、审批 UI、bash 记住、subagent 工具禁用、slash registry。

* **落点（文件/函数）**

  * Config/Auth：复用 `src/utils/env.ts`、`src/env/config.ts`（但把“最终 resolved config”移到新模块），并引入新文件：

    * `src/config/*`（load/resolve/paths/schema）
    * `src/auth/*`（file auth store）
  * Sandbox/Approval：在 `src/tools/executor.ts` 加统一拦截（ApprovalService），复用现有审批 UI 与 mode。
  * Rules：新 `src/policy/*`，并把 `bash/policy.ts` 的“风险评估”当作 signal 输入，不再在 handler 内部散落做决定。
  * status/doctor：实现 CLI 子命令 + slash 命令（复用 registry）。

* **DoD/验收**

  * `formax` 首次启动：自动引导完成 setup（或失败给明确修复步骤）。
  * `formax status`、`formax doctor` 可在无人指导下定位 80% 常见问题（缺 key / baseUrl 不通 / 无写权限 / policy 冲突）。
  * 默认安全边界：**写文件 / bash / 网络**均有一致的审批与可解释策略（P0 先做到“陌生用户可用”）。

---

# B. Setup/config/auth MVP（可直接实现的颗粒度）

* **决策**

  1. **配置与凭证彻底分离**：

     * `config.json`：只放 *非敏感* 的运行配置与 policy（provider、baseUrl、defaultModel、workspaceRoots、approvalPolicy、networkPolicy、logDir…）
     * `auth.json`：只放 *敏感* 的 secret（apiKey/token），config 里只引用 `apiKeyRef`
  2. **配置优先级固定为**：`-c/--config-inline` > `flags` > `env` > `config file` > `defaults`
     （对齐 Codex：“CLI args 覆盖 config；`-c key=value` 覆盖所有其他源”。）
  3. **P0 只实现 file-based AuthStore**（权限 0600）+ 可选迁移到 keyring（留接口，P1 不做 keyring）。
  4. **首次启动自动进入 Setup Wizard**（Ink screen），成功后直接进入 REPL；REPL 内 `/setup` 先做“提示用户运行 `formax setup` 或重启”，不做复杂热切换（P0 省工）。

* **依据**

  * Codex 的同类设计：config 与 auth 分离（`config.toml` 与 `auth.json`），并且可配置 credential store。
  * Formax 当前 env-only（`loadRuntimeConfig`）但已有 `~/.formax` 路径常量，非常适合作为 v1 落盘位置。
  * Formax 已有 UI 组件（`Select`、`TextInput`）可直接拼 setup wizard。

* **落点（文件/函数）**

  * **复用/修改**

    * `src/utils/env.ts`：保留 `FORMAX_CONFIG_DIR/FILE`，新增 `FORMAX_AUTH_FILE`、`FORMAX_RULES_FILE`、`FORMAX_DEBUG_BUNDLES_DIR` 常量。
    * `src/env/config.ts`：`loadRuntimeConfig` 继续支持 env（兼容窗口），但“最终 resolved config”从新模块来（见下）。
  * **新增（建议）**

    * `src/config/schema.ts`
    * `src/config/paths.ts`
    * `src/config/load.ts`
    * `src/config/resolve.ts`
    * `src/config/write.ts`
    * `src/auth/schema.ts`
    * `src/auth/fileStore.ts`
    * `src/features/setup/wizard.ts`（状态机 + 校验）
    * `src/screens/SetupWizard.tsx`（Ink UI）
    * `src/entrypoints/cli.tsx`（增加 subcommand router：setup/status/doctor/...）
  * **拦截点**

    * CLI router：在 render REPL 之前调用 `resolveConfig()`；缺 config/缺 key 则 render SetupWizard。

* **DoD/验收**

  * P0 验收（陌生用户 15 分钟跑通）：

    1. `formax`（首次）→ 进入 setup wizard
    2. 完成后自动进入 REPL
    3. `formax status` 输出（脱敏）配置摘要
    4. `formax doctor` 至少检查：配置可读写、auth 可读写、baseUrl 可连通/鉴权、workspace roots 可识别
  * vitest：

    * `resolveConfig()` precedence 覆盖测试（flags/env/config/default）
    * `auth.json` 权限与脱敏输出测试
    * 失败分支文案（缺 key / 无写权限）输出包含可执行修复步骤

---

## B.1 配置与凭证边界（config vs auth store）

### 决策

* **config.json（可备份/可同步）**：

  * ✅ provider/baseUrl/defaultModel/workspaceRoots/networkPolicy/approvalPolicy/logDir/tool-spec-path 等
  * ❌ apiKey/token/cookies/session 等
* **auth.json（不可随意同步/分享）**：

  * ✅ apiKey/token（按 `ref` 存储）
  * ❌ 不存 config（避免 config “携带 secret” 被提交/共享）

### 依据

* Codex 明确分离：`config.toml` vs `auth.json`。
* Formax 现有 `ModelProfile` 把 `apiKey` 放进配置结构（需要纠偏迁移）。

### 落点（接口签名）

```ts
// src/auth/schema.ts
export type SecretKind = 'apiKey';

export interface AuthStoreFileV1 {
  version: 1;
  secrets: Record<string, { kind: SecretKind; value: string; createdAt: string; updatedAt?: string }>;
}

// src/auth/fileStore.ts
export interface AuthStore {
  get(ref: string): Promise<string | null>;
  set(ref: string, value: string): Promise<void>;
  list(): Promise<Array<{ ref: string; kind: SecretKind; createdAt: string }>>;
  delete(ref: string): Promise<void>;
}
```

### DoD/验收

* `auth.json` 文件权限（POSIX）应为 `0600`（或至少 user-only）；Windows 用 ACL/尽力而为（P0 可先记录 warning）。
* `formax status`/`doctor`/debug bundle 永远不输出 `value`。

---

## B.2 配置优先级表（flags/env/config/default）

> 你要求必须给表格，且写清“冲突时谁赢”。

| 层级（高→低） | 来源                                       | 例子                                                        | 冲突处理                        |
| ------- | ---------------------------------------- | --------------------------------------------------------- | --------------------------- |
| 1       | **Inline override** `-c key=value`       | `formax repl -c llm.defaultModel=gpt-5.1`                 | 覆盖所有其他来源（对齐 Codex `-c` 语义）。 |
| 2       | **CLI flags**                            | `--profile work --model ... --base-url ...`               | 覆盖 env/config/default       |
| 3       | **Environment**                          | `FORMAX_API_KEY`、`FORMAX_MODEL`、`FORMAX_LOGS_DIR`… | 覆盖 config/default；兼容旧用户。    |
| 4       | **Config file**（`~/.formax/config.json`） | v1 schema                                                 | 覆盖 default                  |
| 5       | **Defaults**                             | 内置默认：workspaceRoots=[cwd]、networkPolicy=deny…             | 最低优先级                       |

---

## B.3 v1 config schema（TypeScript interface，完整）

> 你要求：`provider/baseUrl/apiKeyRef/defaultModel/logDir/workspaceRoots/networkPolicy/approvalPolicy` 等字段必须出现。

```ts
// src/config/schema.ts

export type ProviderId = 'anthropic' | 'openai'; // P0 先跑通 anthropic；openai 可先保留类型

export type ApprovalMode = 'untrusted' | 'on-request' | 'never';
// 语义对齐 Codex approval_policy（但我们是 Formax 自己的实现）。

export type SandboxMode = 'read-only' | 'workspace-write' | 'danger-full-access';
// 语义对齐 Codex sandbox_mode（Formax v1 是“软 sandbox”=审批+边界）。:contentReference[oaicite:68]{index=68}

export type NetworkDefault = 'deny' | 'prompt' | 'allow';

export interface NetworkPolicyV1 {
  default: NetworkDefault;          // P0 默认 deny
  allowedDomains?: string[];        // e.g. ["api.github.com", "*.npmjs.org"]
  blockedDomains?: string[];        // e.g. ["*.internal", "169.254.169.254"]
  allowPrivateIps?: boolean;        // P0 默认 false（防 SSRF）
}

export interface ApprovalPolicyV1 {
  mode: ApprovalMode;               // P0 默认 untrusted
  remember: 'off' | 'session' | 'project' | 'global'; // P0 至少 session；P1 实现 project/global
  defaultDecision?: 'prompt' | 'deny';               // 当无规则命中时
}

export interface WorkspacePolicyV1 {
  workspaceRoots: string[];         // 绝对路径；P0 默认 [process.cwd()]
  allowOutsideWorkspaceReads?: boolean; // P0 默认 false（读外部要审批）
}

export interface ProviderConfigV1 {
  provider: ProviderId;
  baseUrl?: string;                 // 可为空=使用 SDK 默认
  apiKeyRef?: string;               // 引用 auth store，例如 "anthropic/default"
  defaultModel: string;
  timeoutMs?: number;
}

export interface LoggingConfigV1 {
  logDir: string;                   // P0 默认 ~/.formax/logs 或 FORMAX_LOGS_DIR
  level?: 'debug' | 'info' | 'warn' | 'error';
}

export interface RulesConfigV1 {
  globalRulesPath: string;          // P0 默认 ~/.formax/rules.json
  projectRulesFileName?: string;    // P0 默认 ".formax/rules.json"
}

export interface FormaxProfileV1 {
  llm: ProviderConfigV1;
  workspace: WorkspacePolicyV1;
  networkPolicy: NetworkPolicyV1;
  approvalPolicy: ApprovalPolicyV1;
  logging: LoggingConfigV1;
  rules: RulesConfigV1;

  // 兼容/迁移：保留旧字段映射（P0: read-only）
  compat?: {
    anthropicApiKeyEnv?: string;    // default "FORMAX_API_KEY"
    anthropicModelEnv?: string;     // default "FORMAX_MODEL"
    anthropicBaseUrlEnv?: string;   // default "FORMAX_BASE_URL"
  };
}

export interface FormaxConfigV1 {
  version: 1;
  activeProfile: string;            // e.g. "default"
  profiles: Record<string, FormaxProfileV1>;
}
```

---

## B.4 Setup wizard（Ink）交互规格：逐屏/逐键盘交互 + 错误分支

> 复用现有 `Select` / `TextInput` 组件（已支持方向键/回车/删除/遮罩）。

### 决策：Wizard 分屏（P0）

1. **Welcome**

   * 显示：将写入的路径（config/auth/rules/logDir）、隐私提示（不会打印 key）。
   * 键：`Enter` 继续；`Ctrl+C` 退出（exit code 2）。

2. **选择 Provider**（Select）

   * 选项：Anthropic / OpenAI（P0 若只实现 Anthropic，可把 OpenAI 标注“Coming soon”但仍保留入口）。
   * 键：↑↓ 选择，Enter 确认。

3. **Base URL**（TextInput，可空）

   * 默认：留空=使用 SDK 默认；或填自建代理。
   * 校验：若非空，必须是 `http(s)://`。
   * 错误文案例：

     * `Base URL must start with https:// or http://`
     * 修复：`Re-enter a valid URL, or leave blank to use default.`

4. **API Key**（TextInput mask=true）

   * 必填。
   * 校验：非空；（可选）简单前缀校验（anthropic `sk-`？如果不确定就不强校验）。
   * 写入 `auth.json`，ref 默认：`<provider>/<profile>`（例如 `anthropic/default`）。
   * 错误文案：

     * `API key is required.`
     * 修复：`Paste your key. If you don't have one, open provider console to create it.`

5. **拉取模型列表（可选）/选择 defaultModel**

   * 尝试用现有 `src/services/models.ts` 的 fetch 逻辑拉模型（成功则 Select；失败则 TextInput 手填）。
   * 失败分支文案：

     * `Couldn't fetch models from <baseUrl>.`
     * 原因提示：`401 (invalid key) / DNS / timeout`（来自 doctor-style 分类）
     * 修复：`Check baseUrl, check key, or enter model name manually.`

6. **workspaceRoots**（Select + TextInput）

   * 默认：`[process.cwd()]`
   * 允许：添加一个额外 root（P0 先做 1~3 个即可）。
   * 校验：路径存在且可读；不是则 warning + 允许继续（但会影响工具）。

7. **networkPolicy**（Select）

   * 选项：`deny`（默认）、`prompt`、`allow`（危险）
   * 文案：解释默认 deny（陌生用户安全）。

8. **approvalPolicy**（Select）

   * 选项：`untrusted`（默认）、`on-request`、`never`（危险）
   * 解释：untrusted=大多数动作需确认；on-request=主要在外部资源/危险动作时确认（对齐 Codex 概念）。([OpenAI Developers][1])

9. **logDir 写权限检查**

   * 默认：`~/.formax/logs` 或 `FORMAX_LOGS_DIR`（兼容）
   * 若 mkdir 失败：

     * 文案：`Cannot write logs to <path> (EACCES).`
     * 修复：`Choose another directory or fix permissions (chmod/chown).`

10. **Summary + Confirm**

* 显示 redacted preview（apiKeyRef 只显示 ref，不显示 value）
* `Enter` 写入 config/auth/rules，并运行一次 `doctor (lite)`（只做关键 3 项：读写/鉴权/网络连通）。

### 落点（代码骨架）

```ts
// src/features/setup/wizard.ts
export type SetupStep =
  | { id: 'welcome' }
  | { id: 'provider'; provider?: ProviderId }
  | { id: 'baseUrl'; baseUrl?: string }
  | { id: 'apiKey'; apiKey?: string }
  | { id: 'model'; defaultModel?: string; models?: string[]; fetchError?: string }
  | { id: 'workspaceRoots'; roots: string[] }
  | { id: 'networkPolicy'; policy: NetworkPolicyV1 }
  | { id: 'approvalPolicy'; policy: ApprovalPolicyV1 }
  | { id: 'logDir'; logDir: string; writable?: boolean }
  | { id: 'summary' }
  | { id: 'done' };

export interface SetupResult {
  config: FormaxConfigV1;
  authUpdates: Array<{ ref: string; value: string }>;
}

export async function runSetupWizardIO(
  io: { /* presenter hooks: select/input */ },
  opts: { cwd: string; defaultProfile: string; }
): Promise<SetupResult>;
```

### DoD/验收（Wizard）

* 断网、401、baseUrl 不通、无写权限都必须走到“可执行修复步骤”分支（不是只报栈）。
* wizard 完成后：

  * `~/.formax/config.json` 存在、schema version=1
  * `~/.formax/auth.json` 存在、权限合理
  * `formax repl` 可启动

---

## B.5 与 REPL 的关系：`/setup` `/config` `/auth` 是否需要？

* **决策**

  * P0：实现 **CLI 子命令**为主：`formax setup|config|auth|status|doctor|policy`
  * REPL 内：

    * `/setup`：输出一段明确指令（“请退出运行 `formax setup`”）或触发重启提示（不做复杂热切换）。
    * `/config`：只做 `show`（脱敏）+ `path`；修改仍建议走 CLI（避免在会话 UI 里做复杂编辑）。
    * `/auth`：只做 `list refs`（不显示 value）+ `set` 引导（提示跑 CLI）。
  * P1：再把 `/setup` 做成“嵌入式 wizard”（如果你觉得必要）。

* **依据**

  * Formax 现有 slash registry 已经在建议列表里暴露 `/doctor` 但未实现；我们按同模式补 `/status`/`/doctor`/`/setup`。
  * P0 目标是“陌生用户可用”，不需要在 REPL 内实现完整配置编辑器。

* **落点**

  * `src/features/commands/registry.ts`：实现 `/status`、`/doctor`、`/setup`、`/config`、`/auth` 的 dispatch（至少返回 message）。
  * CLI 子命令实现放在 `src/features/cli/*`，slash 命令调用同一份 core 函数（见 G 节）。

* **DoD/验收**

  * 在 REPL 输入 `/doctor` → 输出 doctor 摘要（P0 要求实现）。
  * 在 REPL 输入 `/setup` → 输出明确可复制的修复命令（而不是“未知命令”）。

---

# C. 规则系统 MVP：明确选型与最小实现（JSON v1 → v2 可扩展）

* **决策**

  * **v1 选 JSON 规则**（不是 starlark）：

    * P0/P1 目标是“交给陌生用户用”，**先要可解释、可审计、可编辑、可测试**；JSON 规则最快落地。
  * **v2 再兼容 starlark**：

    * 保留 `PolicyEngine` 接口不变，把 `RuleSource` 从 JSON 扩展为 starlark evaluator（不影响 CLI/ApprovalService）。
  * 规则作用域（v1 就做全）：`global` + `project` + （可选）`profile`

    * global：`~/.formax/rules.json`
    * project：`<workspaceRoot>/.formax/rules.json`
    * profile：可选（放 config.json 里引用 path 或内联 rules）

* **依据**

  * Codex rules 本质也是“文本规则 + precedence + allow list 追加”，并且强调 forbidden > prompt > allow 的可解释优先级。
  * Formax 已有“session remember”（bash approvedKeys）与“approve_all 模式”（acceptEdits），但缺少 **持久化与统一解释**；JSON 最适合快速补齐。

* **落点（文件/函数）**

  * 新增：

    * `src/policy/schema.ts`（Rules JSON schema 类型）
    * `src/policy/store.ts`（加载 global/project/profile 规则）
    * `src/policy/engine.ts`（匹配 + 决策）
    * `src/policy/explain.ts`（explain 输出）
    * `src/policy/actions.ts`（统一 action 定义：bash/fs/net…）
  * 复用/收敛：

    * `src/tools/modules/bash/policy.ts`（保留“风险评估/分类”，但最终 allow/prompt/deny 交给 PolicyEngine）。

* **DoD/验收**

  * `formax policy test --bash "rm -rf /"` 输出：decision + explain（命中哪些规则，为什么拒绝）。
  * `approve_remember`/`approve_all` 可以写入 rules.json（P1），并能被 explain 解释。
  * vitest：规则 precedence / scope / 解析失败 / explain 稳定（快照测试）。

---

## C.1 JSON 规则 schema（v1）

```ts
// src/policy/schema.ts

export type RuleScope = 'global' | 'project' | 'profile';
export type RuleEffect = 'allow' | 'prompt' | 'deny';

export type ActionKind =
  | 'bash'
  | 'fs.read'
  | 'fs.write'
  | 'fs.edit'
  | 'fs.glob'
  | 'fs.grep'
  | 'net.fetch'
  | 'net.search';

export type BashRisk = 'low' | 'medium' | 'high';

export interface RuleMatchV1 {
  // bash
  commandPrefix?: string[];         // startsWith any
  risk?: BashRisk[];                // optional: only match for certain risk

  // filesystem
  pathStartsWith?: string[];        // absolute prefixes (resolved)
  outsideWorkspace?: boolean;       // match when target is outside workspace roots

  // network
  domainIs?: string[];              // exact or suffix (*.example.com)
  urlPrefix?: string[];             // startsWith any

  // tools (escape hatch)
  toolNames?: string[];
}

export interface PolicyRuleV1 {
  id: string;
  scope: RuleScope;
  priority: number;                 // higher wins within same effect
  effect: RuleEffect;
  action: ActionKind;
  match: RuleMatchV1;

  description?: string;
  createdAt?: string;
  createdBy?: 'user' | 'approval';
}

export interface RulesFileV1 {
  version: 1;
  rules: PolicyRuleV1[];
}
```

---

## C.2 10 条示例规则（覆盖目录/域名/bash/write/read/记住）

> 这些示例是 v1 JSON 格式（你在 K 节会拿到可复制版）。

1. 允许 workspace 内读
2. 读 workspace 外：prompt
3. 写 workspace 内：prompt（untrusted 模式）
4. 写 workspace 外：deny
5. bash 高危（risk=high）：prompt
6. bash 高危且前缀 `rm -rf /`：deny
7. 允许 `git status` 前缀：allow
8. net 默认 deny（由 config 决定），但允许 `api.github.com`：prompt/allow
9. net 阻止 metadata IP：deny（169.254.169.254）
10. “记住本项目允许 `pnpm install`”：project scope allow + prefix

---

## C.3 匹配算法与 explain 输出格式

### 匹配算法（v1）

1. 计算 action：`ActionKind` + 结构化字段（path/domain/command/risk/…）。
2. 载入规则集：project → profile → global（scope order），合并后筛选 `rule.action === action.kind`。
3. 对所有匹配的规则分组：deny / prompt / allow。
4. 选择最终决策：

   * 若存在任意 deny 匹配：选 deny 中（priority 最大、若相同则 scope 更近者优先）。
   * 否则若存在 prompt：同上选 prompt。
   * 否则若存在 allow：选 allow。
   * 否则：用 config 的 `approvalPolicy.defaultDecision`（建议默认 prompt 或 deny）。
5. 输出 explain：列出“候选匹配规则”+“最终选中规则”+“缺省策略”。

### explain 输出（人类可读 + JSON）

* 人类可读示例：

  * `Decision: PROMPT (rule project:allow-gitstatus matched commandPrefix 'git status')`
  * `Also matched: global:prompt-highrisk-bash (priority 50)`

* JSON schema（用于 `--json`）：

```ts
export interface PolicyExplainV1 {
  decision: 'allow' | 'prompt' | 'deny';
  action: { kind: ActionKind; summary: string; };
  matchedRules: Array<{ id: string; scope: RuleScope; effect: RuleEffect; priority: number; description?: string }>;
  chosenRule?: { id: string; scope: RuleScope; effect: RuleEffect; priority: number };
  defaulted?: boolean;
}
```

---

# D. ApprovalService 统一化落点（把分散审批统一）

* **决策**

  * **统一拦截点放在 ToolExecutor 层**（最强一致性）：所有 tool call 先走 `ApprovalService.preflight()` 再执行 handler。
  * tool handler 的职责收敛为：

    * 解析/校验输入（path 绝对、格式合法）
    * 执行实际操作
    * 发 tool_update / tool_result
  * 审批 UI：优先复用现有 `EditApprovalPrompt`（用于 fs.edit/fs.write）和 `AskUserQuestion`（用于 bash/net/read）。
  * “记住选择”的持久化：P0 只 session（复用已有机制）；P1 写入 rules 文件（global 或 project），并提供撤销（`formax policy delete <id>` 或手工编辑 + `policy lint`）。

* **依据**

  * Formax 当前审批散落：bash handler 自己做 approvedKeys；edit/write presenter 有 approve_all 语义；read 无审批。
  * ToolExecutor 已经有统一工具禁用（subagent）逻辑，是天然的“全局拦截点”。

* **落点（文件/函数）**

  * `src/tools/executor.ts`：新增 preflight hook（ApprovalService 注入）。
  * 新增：

    * `src/approval/approvalService.ts`
    * `src/approval/prompts.ts`（把 AskUserQuestion / EditApprovalPrompt 包装成统一接口）
    * `src/approval/remember.ts`（把“approve_all/session”写成可复用逻辑）
  * 修改：

    * bash/write/edit/read/webFetch/webSearch 等 handler：移除重复审批决策（保留风险评估/输入校验）。

* **DoD/验收**

  * 任意工具的审批提示都来自同一套“决策引擎 + 文案 + explain”（bash/write/edit/read/glob/grep/webFetch/webSearch）。
  * `--json` 模式下（CLI 或 debug bundle）能拿到每次审批的 explain 结构（可审计）。
  * vitest：同一输入在不同工具路径下（比如 write vs edit）得到一致的决策与文案。

---

# E. `/status` + `/doctor` + debug bundle（产品化自解释）

* **决策**

  1. 实现 **CLI 子命令**：`formax status` / `formax doctor` / `formax doctor --bundle`
     同时实现 **REPL slash 命令**：`/status` `/doctor`（复用同一 core 函数）。
  2. 输出必须有两种模式：

     * 默认：人类可读
     * `--json`：机器可读（给 JSON schema）
  3. 统一错误分层：将 HTTP/SDK/系统错误映射为稳定错误码（E_AUTH_401/E_TIMEOUT/E_FS_DENIED…），并配统一文案模板（含“可执行修复步骤”）。
  4. debug bundle 必须**默认脱敏**，结构固定，可一键打包/分享。

* **依据**

  * Codex 在 interactive 中提供 `/status`、`/approvals` 并强调安全/审批/沙箱。
  * Formax 已有 slash registry（只缺实现）与 logsDir/configDir 等路径基础。
  * P0/P1 要求“陌生用户可自助排障”，这是最短闭环。

* **落点（文件/函数）**

  * 新增：

    * `src/features/status/status.ts`（构建 StatusSnapshot）
    * `src/features/doctor/doctor.ts`（运行检查项）
    * `src/features/doctor/errors.ts`（错误码映射）
    * `src/features/doctor/debugBundle.ts`（bundle 导出）
    * `src/utils/redact.ts`（脱敏规则）
  * 修改：

    * `src/features/commands/registry.ts`：实现 `/status`、`/doctor`（返回 message 或 llm prompt）。
    * `src/entrypoints/cli.tsx`：增加 subcommand router（见 G）。
  * 逻辑归属：

    * `src/features/commands/*`：REPL presenter（slash）
    * `src/features/status|doctor/*`：核心逻辑（可被 CLI 与 slash 复用）
    * `src/env/*` & `src/config/*`：配置解析/路径
    * `src/tools/*`：仅负责工具执行，不塞诊断

* **DoD/验收**

  * `formax status`：输出脱敏配置摘要 + 路径 + 当前 profile + workspace roots + policy 概览。
  * `formax doctor`：至少 10 项检查（见 E.2），并给稳定错误码 + 修复步骤。
  * `formax doctor --bundle`：生成 bundle（不含 secret），并输出路径；bundle 里含 manifest/doctor snapshot/redacted config/logs。
  * vitest：脱敏不泄露；doctor 分类正确；bundle 结构稳定。

---

## E.1 `/status` 输出字段设计（脱敏）

### 人类可读（示意）

* Profile / Provider / Model / Base URL（baseUrl 可显示，但不要显示 key）
* Config path / Auth store path / Rules paths / Log dir
* Workspace roots（绝对路径）
* Approval policy（mode + remember）
* Network policy（default + allow/block 计数）
* Tool sandbox（subagent tool deny 列表摘要）

### `--json` schema（v1）

```ts
export interface StatusSnapshotV1 {
  version: 1;
  timestamp: string;
  profile: string;

  llm: {
    provider: string;
    model: string;
    baseUrl?: string;
    apiKeyRef?: string;   // 仅 ref
    timeoutMs?: number;
  };

  paths: {
    configPath: string;
    authPath: string;
    globalRulesPath: string;
    projectRulesPath?: string;
    logDir: string;
  };

  workspace: {
    roots: string[];
    cwd: string;
  };

  policy: {
    approval: { mode: string; remember: string; };
    network: { default: string; allowedDomainsCount: number; blockedDomainsCount: number; };
    sandbox: { mode: string; subagentWriteToolsBlocked: boolean; };
  };
}
```

---

## E.2 `/doctor` 检查项清单（P0→P1）

> P0 至少 10 项；P1 可以扩到 15~20。

1. **Config 可读**（JSON parse + version）
2. **Config 可写**（能否原子写入/备份）
3. **Auth store 可读**（auth.json 存在/权限）
4. **Auth store 可写**
5. **apiKeyRef 可解析**（ref 存在）
6. **Base URL DNS/连通性**（可选：HEAD / 或最小 SDK ping）
7. **鉴权有效性**（最小请求：401/403 分类）
8. **模型名非空**（空则 fail）
9. **workspaceRoots 存在且可读**
10. **logDir 可写**
11. **rules 文件可读写**（P1：lint JSON）
12. **subagentsDir/planDir 存在**（兼容旧 env）
13. **依赖版本**（node 版本 >=18；git 是否可用）
14. **网络策略是否允许私网 IP**（若 allowPrivateIps=true 给强 warning）
15. **输出脱敏检查**（doctor 输出不含 secret）

### DoctorReport `--json` schema

```ts
export type DoctorCheckStatus = 'pass' | 'warn' | 'fail';

export interface DoctorCheckResultV1 {
  id: string;
  status: DoctorCheckStatus;
  message: string;
  hint?: string;        // 可执行修复步骤
  errorCode?: string;   // E_AUTH_401 / E_FS_DENIED ...
  details?: Record<string, unknown>; // 脱敏
}

export interface DoctorReportV1 {
  version: 1;
  timestamp: string;
  summary: { pass: number; warn: number; fail: number; };
  checks: DoctorCheckResultV1[];
  debugBundlePath?: string;
}
```

---

## E.3 错误分层与稳定错误码（模板）

### 决策：统一错误类型

```ts
export type ErrorCode =
  | 'E_CONFIG_INVALID'
  | 'E_CONFIG_NOT_FOUND'
  | 'E_AUTH_MISSING'
  | 'E_AUTH_401'
  | 'E_AUTH_403'
  | 'E_NETWORK_DNS'
  | 'E_NETWORK_TIMEOUT'
  | 'E_NETWORK_REFUSED'
  | 'E_FS_DENIED'
  | 'E_POLICY_DENY'
  | 'E_UNKNOWN';
```

### 文案模板（示例）

* `E_AUTH_401`:

  * message: `Authentication failed (401).`
  * hint: `Check your apiKeyRef and re-run "formax auth set <ref>". If using env, verify FORMAX_API_KEY is set.`
* `E_FS_DENIED`:

  * message: `Cannot write to <path> (permission denied).`
  * hint: `Choose a writable logDir in config, or fix permissions: chmod/chown.`

---

## E.4 debug bundle 结构 + 一键导出

### 决策：bundle 结构固定

```
formax-debug-bundle/
  manifest.json
  status.json
  doctor.json
  config.redacted.json
  rules.global.json
  rules.project.json (optional)
  logs/
    latest.log
    audit.log
  system/
    node.txt
    platform.txt
    env.redacted.txt
```

### 脱敏规则（必须写入 manifest）

* 永远删除/替换：

  * `apiKey`, `token`, `Authorization` headers
  * `auth.json` 中的 `value`
* 可能包含敏感信息的日志行：做正则替换（`sk-...` → `sk-***`），并在 manifest 记录规则版本。

### 一键导出（实现建议）

* `formax doctor --bundle`：

  * 创建目录 `~/.formax/debug-bundles/<timestamp>/`
  * 写文件（JSON + redacted）
  * （可选）检测系统是否有 `tar`，有则打包 `bundle.tgz`；无则保留目录并打印路径。

---

# F. P0/P1 重新排序（严格压缩到最小闭环）

* **决策**

  * **P0：陌生用户 15 分钟可跑通**（最小闭环）

    1. setup wizard（首次启动自动进入）
    2. config/auth store（落盘 + precedence + env 兼容）
    3. `/status` + `/doctor`（最小自助排障）
    4. 最小安全边界：写文件/bash/网络统一审批（先做到一致提示与默认 deny/prompt）
  * **P1：稳定可用**

    1. JSON rules 持久化（remember choice）
    2. ApprovalService 全工具一致化（Read/Glob/Grep/WebFetch/WebSearch 统一）
    3. debug bundle + 错误文案统一
    4. `--json` 输出契约稳定 + exit code 稳定
    5. 安全回归测试（策略不泄露、默认拒绝跨 workspace/私网）

* **依据**

  * Formax 已有审批/模式等“中层能力”，P0 的关键缺口是 **可落盘配置 + 统一策略 + 可自解释诊断**。
  * Codex CLI 的产品化体验核心也集中在：配置、审批/沙箱、规则、可脚本化输出。([OpenAI Developers][1])

* **落点（改动文件列表）**

  * 见 K.6 PR 切分（每个 PR 给文件列表+验收步骤+测试点）。

* **DoD/验收**

  * P0 DoD（必须都满足）：

    * 新机器（无任何 env）：`formax` → wizard → REPL 可对话
    * `formax status`（脱敏）可打印 config/auth/rules/log/workspace/policy
    * `formax doctor` 给出 10 项检查 + 修复步骤
    * 默认策略：网络 deny；写文件 prompt；高危 bash prompt/deny（至少 rm -rf / deny）
  * P1 DoD：

    * `remember` 写入 rules 文件（project/global），并能 `policy list` 看到
    * debug bundle 一键导出且不含 secret
    * vitest 覆盖关键安全回归（≥10 条）

---

## F.1 P0 事项清单（每项：文件 + DoD + 测试点）

### P0-1 Setup Wizard + config/auth 落盘

* 改动文件：

  * 新：`src/config/*`, `src/auth/*`, `src/features/setup/*`, `src/screens/SetupWizard.tsx`
  * 改：`src/entrypoints/cli.tsx`, `src/utils/env.ts`
* DoD：

  * `rm -rf ~/.formax && formax` → wizard
  * 完成后：`~/.formax/config.json`、`~/.formax/auth.json` 存在
* tests：

  * `resolveConfig` precedence（env 覆盖 config）
  * `auth store` set/get/list（不泄露 value）

### P0-2 `/status` + `/doctor`

* 改动文件：

  * 新：`src/features/status/*`, `src/features/doctor/*`, `src/utils/redact.ts`
  * 改：`src/features/commands/registry.ts`, `src/entrypoints/cli.tsx`
* DoD：

  * `formax status` 输出字段齐全
  * `formax doctor` 输出 10 项检查与修复
* tests：

  * status JSON schema（快照）
  * doctor error mapping（401/ENOENT/EACCES 等）

### P0-3 最小安全边界（写/bash/网络一致审批）

* 改动文件：

  * 新：`src/approval/*`, `src/policy/*`（P0 可先不落盘，先 in-memory）
  * 改：`src/tools/executor.ts`, `bash|read|webSearch|webFetch` handler（去散落审批）
* DoD：

  * read workspace 外 → prompt
  * web access → deny（默认）或 prompt
  * write/edit → prompt
* tests：

  * executor preflight 被调用
  * default deny 网络

---

## F.2 P1 事项清单（稳定可用）

1. Rules 持久化（JSON）
2. remember choice 写 rules
3. debug bundle
4. 错误文案统一
5. `--json` 输出稳定 + exit codes
6. 安全回归测试（≥10）

---

# G. CLI/命令契约（稳定接口 + --json + exit codes）

* **决策**

  * `formax` 提供稳定命令树（P0 起就定），并保证：

    * 每个命令都有：用法示例、输入来源（flags/env/config）、输出格式（human + `--json`）、exit codes
  * CLI 与 REPL slash commands **复用同一份 core 实现**：

    * core：`src/features/status|doctor|policy|setup/*`
    * presenter：CLI（stdout） vs REPL（chat message）
  * 提供最小 `-c key=value` inline override（对齐 Codex `-c` 概念）。([OpenAI Developers][1])

* **依据**

  * Codex CLI reference 明确列了 subcommands 和 `--json`（NDJSON）等脚本化能力。([OpenAI Developers][1])
  * Formax package.json 已明确 `bin.formax`，适合产品化命令树。

* **落点（文件/函数）**

  * `src/entrypoints/cli.tsx`：加 subcommand router（解析 argv）

    * Node>=18，可用 `node:util` 的 `parseArgs`（无需新依赖）。
  * 新增：

    * `src/features/cli/args.ts`（parseArgs + help 文案）
    * `src/features/cli/commands/*.ts`（每个子命令实现）
  * `src/features/commands/registry.ts`：slash 命令调用同一个 core 函数。

* **DoD/验收**

  * `formax --help` 输出完整、包含常用示例
  * 每个命令 `--json` 输出符合 schema（见下）
  * exit code 在脚本中可依赖（不会随版本漂移）

---

## G.1 `formax` 命令树（P0 至少覆盖这些）

```text
formax                      # 默认 = formax repl
formax repl [flags]
formax setup [--profile NAME]
formax status [--json] [--profile NAME]
formax doctor [--json] [--bundle] [--profile NAME]
formax config path|get|set|show [--json]
formax auth list|set|delete [--json]
formax policy list|test|explain|add|delete [--json]
```

---

## G.2 每个命令的契约（示例）

### `formax repl`

* 示例：`formax repl --profile default`
* 输入来源：

  * flags：`--profile --model --base-url -c`
  * env：兼容 `ANTHROPIC_*` 等（见 B.2）
  * config：`~/.formax/config.json`
* 输出：

  * 默认：Ink REPL
  * `--json`：不建议（interactive），但可以复用 NDJSON event（P1）
* exit codes：

  * 0：正常退出
  * 2：配置缺失/无效（并已提示运行 setup）

### `formax status`

* 示例：`formax status --json`
* 输出：

  * human：多行 key-value
  * json：`StatusSnapshotV1`（见 E.1）
* exit codes：

  * 0：成功
  * 2：配置错误
  * 3：auth 缺失

### `formax doctor`

* 示例：`formax doctor --bundle --json`
* 输出：

  * human：按检查项列出 pass/warn/fail + hint
  * json：`DoctorReportV1`
* exit codes：

  * 0：全部 pass（或仅 warn）
  * 1：存在 fail
  * 2：配置不可用导致无法运行 doctor（config parse fail）

### `formax auth set`

* 示例：`formax auth set anthropic/default`（stdin 输入 key 或提示输入）
* 输出：不显示 key，只显示 ref 与创建时间
* exit codes：

  * 0：成功
  * 3：写 auth 失败（权限/路径）

### `formax policy test`

* 示例：`formax policy test --bash "git status" --json`
* 输出：`PolicyExplainV1`
* exit code：

  * 0：decision allow
  * 1：decision prompt/deny（脚本可用来 gate）
  * 2：rules 文件解析失败

---

## G.3 REPL slash commands 与 CLI 子命令复用关系

* **决策**

  * core 函数只做“业务逻辑 + 返回结构化结果”
  * CLI：把结构化结果渲染到 stdout（human/json）
  * REPL：把结构化结果渲染成一段 message（或 tool_result）

* **落点**

  * `src/features/status/status.ts`: `getStatusSnapshot(...)`
  * `src/features/doctor/doctor.ts`: `runDoctor(...)`
  * `src/features/commands/registry.ts` dispatch 直接调用这些 core 函数。

---

# H. 文档与文案（精炼版：保证可直接粘贴）

* **决策**

  * P0 只写两份文档 + help：

    * `README.md` QuickStart（安装→setup→首次对话→常见失败）
    * `docs/troubleshooting.md`（401/403/DNS/timeout/baseUrl 不兼容/权限/规则冲突）
    * `formax --help`（覆盖常用示例 + exit codes + `--json`）
  * 安全文案：明确哪些永远不打印（apiKey/token/cookies/Authorization）。

* **依据**

  * 工具对陌生用户交付时，排障文档与 doctor/status 一起形成闭环（减少你维护成本）。

* **落点**

  * `README.md`
  * `docs/troubleshooting.md`
  * `src/features/cli/help.ts`（help 文案单独模块，避免散落）

* **DoD/验收**

  * 新用户不看源码，仅靠 README + doctor 能跑通并解决 3 类错误（缺 key、baseUrl 不通、无写权限）。

---

# I. 迁移与兼容（避免上线后静默坏掉）

* **决策**

  * 渐进迁移（推荐）：

    * v0.x：仍支持 env-only（现状），但 `formax doctor` 强提示迁移到 config/auth
    * v1.0：默认走 config/auth；env 仍可 override（兼容窗口）
    * v2.0：考虑移除旧 env（或仅保留少数）
  * 迁移策略：

    * 若 env 中存在 `FORMAX_API_KEY` 且 config 缺失：wizard 自动预填（但仍要求确认写入 auth.json）
    * 若 config 中曾包含 apiKey（来自旧 GlobalConfig 结构）：自动迁移到 auth store 并把 config 替换为 apiKeyRef（P1）

* **依据**

  * `loadRuntimeConfig` 里已存在一堆 env 约定，直接删会破坏老用户。
  * `src/utils/config.ts` 旧结构含 apiKey，需要迁移。

* **落点**

  * `src/config/migrate.ts`（检测旧字段→迁移）
  * `src/features/doctor/doctor.ts`（给迁移提示）

* **DoD/验收**

  * 10 条防回归测试建议（精炼）：

    1. flags > env > config > default precedence 正确
    2. status/doctor 输出不含 secret
    3. auth store 缺 ref → doctor fail E_AUTH_MISSING
    4. baseUrl DNS 失败 → E_NETWORK_DNS
    5. timeout → E_NETWORK_TIMEOUT
    6. rules deny 覆盖 allow
    7. project rule 覆盖 global（同 effect 同 priority）
    8. read workspace 外默认 prompt/deny
    9. 网络私网默认 deny（169.254.169.254）
    10. debug bundle 不包含 auth.json value

---

# J. Codex 对齐的“最小验证清单”（把【推测】变【证据】）

> 只列最小动作，且每项都能“保存输出（脱敏）”作为证据。

* **决策**

  * 你只需跑 8 组命令/操作，就能验证：config 路径、profiles、sandbox/approval、rules remember、`--json`、diff apply 的关键 UX。

* **依据**

  * CLI 命令与 flags 来自官方 CLI reference；rules/sandbox 来自官方 docs。([OpenAI Developers][1])

* **最小清单（命令/操作 + 要保存的输出）**

  1. **CLI 能力与 flags**

     * `codex --help`（保存整段输出，脱敏无关）
     * 重点确认：`--full-auto`、`--yolo`、`--profile`、`--sandbox`、`--json` 是否出现。([OpenAI Developers][1])
  2. **验证 CODEX_HOME 与 config 文件位置**

     * `CODEX_HOME=$(mktemp -d) codex --help >/dev/null; ls -la "$CODEX_HOME"`
     * 保存：目录列表截图/文本（证明路径）
  3. **验证 profiles**

     * 写 `"$CODEX_HOME/config.toml"` 含两个 profile
     * `codex -p <profile>` 启动（保存启动屏/日志里显示的 model）
  4. **验证配置优先级（-c 覆盖）**

     * `config.toml` 写 `model="A"`
     * 运行 `codex -c model=B`（保存输出，证明用 B）([OpenAI Developers][1])
  5. **验证 `--full-auto` 行为**

     * `codex --full-auto`（保存提示/状态，观察审批变少；文档说是 preset）([OpenAI Developers][1])
  6. **验证 rules 文件与 remember**

     * 查看：`ls -la "$CODEX_HOME/rules"`（保存）
     * 在 TUI 里把某命令加入 allow list 后，diff `default.rules`（保存 diff）
  7. **验证 `/status` `/approvals`**

     * interactive 输入 `/status`、`/approvals`（保存输出截图）
  8. **验证 `--json` 输出**

     * `codex --json`（保存 NDJSON 片段，确保不含敏感信息）([OpenAI Developers][1])

* **DoD/验收**

  * 你拿到上述 8 份输出后，我这份方案中所有 Codex 相关【推测】应能被消除或替换为证据；剩余差异由 Formax 自己的实现选择承担。

---

# K. 最终输出：可直接复制的样例 + 最小 PR 切分计划

* **决策**

  * 提供 6 份“可直接复制”的产物（你要求的 1~6），并配 PR1..PRN 切分（每 PR：文件列表 + 验收步骤 + 测试点）。

* **依据**

  * 你要“能直接用于实现”，所以这里给你 **最终配置/规则/输出样例** + **工程切分**，可直接粘到 repo。

* **落点**

  * 这些样例文件将对应：

    * `~/.formax/config.json`
    * `~/.formax/rules.json`
    * `formax status/doctor` 输出
    * debug bundle 的 `manifest.json`
    * PR 切分落点（文件列表）

* **DoD/验收**

  * 你可以按 PR 计划逐个合并，每个 PR 都能独立验收且不引入“重型生态”。

---

## K.1 config 示例（v1，`~/.formax/config.json`）

```json
{
  "version": 1,
  "activeProfile": "default",
  "profiles": {
    "default": {
      "llm": {
        "provider": "anthropic",
        "baseUrl": "",
        "apiKeyRef": "anthropic/default",
        "defaultModel": "claude-sonnet-4-5-20250929",
        "timeoutMs": 60000
      },
      "workspace": {
        "workspaceRoots": ["/ABS/PATH/TO/YOUR/REPO"],
        "allowOutsideWorkspaceReads": false
      },
      "networkPolicy": {
        "default": "deny",
        "allowedDomains": ["api.github.com", "*.npmjs.org"],
        "blockedDomains": ["169.254.169.254", "*.internal"],
        "allowPrivateIps": false
      },
      "approvalPolicy": {
        "mode": "untrusted",
        "remember": "session",
        "defaultDecision": "prompt"
      },
      "logging": {
        "logDir": "/ABS/PATH/TO/.formax/logs",
        "level": "info"
      },
      "rules": {
        "globalRulesPath": "/HOME/USER/.formax/rules.json",
        "projectRulesFileName": ".formax/rules.json"
      },
      "compat": {
        "anthropicApiKeyEnv": "FORMAX_API_KEY",
        "anthropicModelEnv": "FORMAX_MODEL",
        "anthropicBaseUrlEnv": "FORMAX_BASE_URL"
      }
    }
  }
}
```

---

## K.2 rules 示例（v1，`~/.formax/rules.json`）

```json
{
  "version": 1,
  "rules": [
    {
      "id": "global-deny-metadata-ip",
      "scope": "global",
      "priority": 100,
      "effect": "deny",
      "action": "net.fetch",
      "match": { "urlPrefix": ["http://169.254.169.254", "https://169.254.169.254"] },
      "description": "Block cloud metadata SSRF targets",
      "createdBy": "user",
      "createdAt": "2026-01-10T00:00:00.000Z"
    },
    {
      "id": "global-prompt-outside-workspace-read",
      "scope": "global",
      "priority": 50,
      "effect": "prompt",
      "action": "fs.read",
      "match": { "outsideWorkspace": true },
      "description": "Reading outside workspace requires confirmation"
    },
    {
      "id": "global-deny-outside-workspace-write",
      "scope": "global",
      "priority": 80,
      "effect": "deny",
      "action": "fs.write",
      "match": { "outsideWorkspace": true },
      "description": "Never write outside workspace by default"
    },
    {
      "id": "global-prompt-bash-highrisk",
      "scope": "global",
      "priority": 60,
      "effect": "prompt",
      "action": "bash",
      "match": { "risk": ["high"] },
      "description": "High-risk bash needs approval"
    },
    {
      "id": "global-deny-bash-rm-root",
      "scope": "global",
      "priority": 100,
      "effect": "deny",
      "action": "bash",
      "match": { "commandPrefix": ["rm -rf /", "sudo rm -rf /"] },
      "description": "Never allow rm -rf /"
    },
    {
      "id": "project-allow-git-status",
      "scope": "project",
      "priority": 10,
      "effect": "allow",
      "action": "bash",
      "match": { "commandPrefix": ["git status"] },
      "description": "Allow git status without prompting"
    },
    {
      "id": "global-prompt-net-github",
      "scope": "global",
      "priority": 20,
      "effect": "prompt",
      "action": "net.fetch",
      "match": { "domainIs": ["api.github.com"] },
      "description": "Allow GitHub API with prompt"
    },
    {
      "id": "global-deny-net-private",
      "scope": "global",
      "priority": 90,
      "effect": "deny",
      "action": "net.fetch",
      "match": { "domainIs": ["127.0.0.1", "localhost"] },
      "description": "Block localhost by default (SSRF)"
    },
    {
      "id": "global-prompt-fs-write",
      "scope": "global",
      "priority": 10,
      "effect": "prompt",
      "action": "fs.write",
      "match": { "pathStartsWith": ["/ABS/PATH/TO/YOUR/REPO"] },
      "description": "Writing inside workspace requires approval in untrusted mode"
    },
    {
      "id": "global-prompt-net-search",
      "scope": "global",
      "priority": 10,
      "effect": "prompt",
      "action": "net.search",
      "match": {},
      "description": "Web search requires approval unless allowlisted"
    }
  ]
}
```

---

## K.3 doctor 输出示例（成功 + 失败）

### 成功（human）

```text
Doctor report (v1) 2026-01-10T12:00:00Z
PASS  config.readable         Config loaded (v1) from ~/.formax/config.json
PASS  config.writable         Config directory writable
PASS  auth.readable           Auth store readable at ~/.formax/auth.json
PASS  auth.ref.exists         apiKeyRef anthropic/default found
PASS  network.dns             baseUrl resolved
PASS  llm.auth                LLM auth OK
PASS  workspace.roots         1 workspace root(s) readable
PASS  logs.writable           logDir writable
PASS  rules.readable          global rules loaded (10 rules)
WARN  rules.project.missing   No project rules file found at /repo/.formax/rules.json (optional)
```

### 失败（human）

```text
Doctor report (v1) 2026-01-10T12:03:00Z
FAIL  auth.ref.exists   E_AUTH_MISSING  apiKeyRef anthropic/default not found
      Fix: run "formax auth set anthropic/default" and paste your API key.
FAIL  llm.auth          E_AUTH_401  Authentication failed (401)
      Fix: verify key for anthropic/default (or FORMAX_API_KEY env), then re-run doctor.
WARN  logs.writable     E_FS_DENIED  Cannot write logs to /root/.formax/logs
      Fix: set logging.logDir to a writable path, e.g. ~/.formax/logs
```

---

## K.4 status 输出示例（成功 + 失败）

### 成功（human）

```text
Formax status
Profile: default
LLM: provider=anthropic model=claude-sonnet-4-5-20250929 baseUrl=<default> apiKeyRef=anthropic/default
Config: ~/.formax/config.json
Auth:   ~/.formax/auth.json
Rules:  ~/.formax/rules.json (project: /repo/.formax/rules.json)
Logs:   /repo/.formax/logs
Workspace roots:
  - /repo
Policy:
  approval: mode=untrusted remember=session defaultDecision=prompt
  network:  default=deny allowDomains=2 blockDomains=2 allowPrivateIps=false
Sandbox:
  subagents: write tools blocked = true
```

### 失败（human）

```text
Formax status
ERROR E_CONFIG_NOT_FOUND: No config file at ~/.formax/config.json
Fix: run "formax setup" (or start "formax" to launch the wizard).
```

---

## K.5 debug bundle manifest 示例（含脱敏规则说明）

```json
{
  "version": 1,
  "createdAt": "2026-01-10T12:10:00.000Z",
  "formaxVersion": "0.0.0-dev",
  "paths": {
    "bundleDir": "/HOME/USER/.formax/debug-bundles/2026-01-10T12-10-00Z",
    "configPath": "/HOME/USER/.formax/config.json",
    "authPath": "/HOME/USER/.formax/auth.json",
    "logDir": "/HOME/USER/.formax/logs"
  },
  "included": [
    "status.json",
    "doctor.json",
    "config.redacted.json",
    "rules.global.json",
    "rules.project.json",
    "logs/latest.log",
    "logs/audit.log",
    "system/node.txt",
    "system/platform.txt",
    "system/env.redacted.txt"
  ],
  "redaction": {
    "rulesVersion": 1,
    "removedFields": ["auth.secrets.*.value", "Authorization", "apiKey", "token"],
    "regexMasks": [
      { "pattern": "sk-[A-Za-z0-9_-]{10,}", "replacement": "sk-***" }
    ],
    "notes": "No secrets are included. Only apiKeyRef identifiers are preserved."
  }
}
```

---

## K.6 最小 PR 切分计划（PR1..PR6）

> 你要求：每个 PR 给文件列表 + 验收步骤 + 要补的测试点。

### PR1 — Config/Auth 基础设施 + precedence + redaction

* 文件列表

  * 新：`src/config/schema.ts`, `src/config/paths.ts`, `src/config/load.ts`, `src/config/resolve.ts`, `src/config/write.ts`
  * 新：`src/auth/schema.ts`, `src/auth/fileStore.ts`
  * 新：`src/utils/redact.ts`
  * 改：`src/utils/env.ts`, `src/env/config.ts`（兼容 env + 输出 resolved config）
* 验收步骤

  * `node -e "..."`（调用 resolveConfig 输出解析结果，确保 precedence）
  * `formax status --json`（暂时可 stub）
* 测试点（vitest）

  * precedence 覆盖（flags/env/config/default）
  * redact 不泄露 auth secrets

### PR2 — Setup Wizard（Ink）+ 首次启动自动进入 setup

* 文件列表

  * 新：`src/features/setup/wizard.ts`, `src/screens/SetupWizard.tsx`
  * 改：`src/entrypoints/cli.tsx`（router：无 config → wizard → repl）
  * 复用：`src/components/ui/Select.tsx`, `src/components/ui/TextInput.tsx`（不改或微调）
* 验收步骤

  * `rm -rf ~/.formax && formax` → wizard → 写入 config/auth → 进入 repl
* 测试点

  * wizard 状态机：缺 key/baseUrl 不通/模型为空/写权限不足分支（可用纯函数测试）

### PR3 — `/status` + `/doctor`（CLI + slash）+ 错误码映射

* 文件列表

  * 新：`src/features/status/status.ts`
  * 新：`src/features/doctor/doctor.ts`, `src/features/doctor/errors.ts`
  * 改：`src/features/commands/registry.ts`（实现 /status /doctor）
  * 改：`src/entrypoints/cli.tsx`（新增 status/doctor 子命令）
* 验收步骤

  * `formax status`、`formax doctor`
  * REPL 中 `/doctor` 输出可读文本
* 测试点

  * doctor 分类：401/timeout/EACCES/ENOENT → 对应错误码

### PR4 — Policy JSON（加载/匹配/explain）+ `formax policy test`

* 文件列表

  * 新：`src/policy/schema.ts`, `src/policy/store.ts`, `src/policy/engine.ts`, `src/policy/explain.ts`, `src/policy/actions.ts`
  * 新：`src/features/cli/commands/policy.ts`
* 验收步骤

  * `formax policy test --bash "rm -rf /"` → deny + explain
* 测试点

  * precedence：deny > prompt > allow
  * scope：project > global

### PR5 — ApprovalService 注入 ToolExecutor（统一拦截）+ 最小三类动作覆盖

* 文件列表

  * 新：`src/approval/approvalService.ts`, `src/approval/prompts.ts`
  * 改：`src/tools/executor.ts`（preflight hook）
  * 改：`read`/`bash`/`webSearch`/`webFetch`/`write`/`edit` handlers（移除重复审批，走统一引擎）
* 验收步骤

  * 默认 deny 网络、prompt 写、prompt 高危 bash
  * 行为一致且 explain 可输出
* 测试点

  * executor preflight 必经
  * read workspace 外默认 prompt

### PR6 — debug bundle + 文档/帮助文案

* 文件列表

  * 新：`src/features/doctor/debugBundle.ts`
  * 新：`README.md`, `docs/troubleshooting.md`
  * 新：`src/features/cli/help.ts`
* 验收步骤

  * `formax doctor --bundle` 输出路径并生成 manifest
* 测试点

  * bundle 不包含 secrets（扫描 `sk-` 等 pattern 必须被 mask）

---

如果你希望我把 **D（ApprovalService）**部分再“更落地到每个 tool 的 action 映射与文案模板”，我可以在下一轮把 `toolCall → PolicyAction` 的映射表（bash/read/write/edit/glob/grep/webFetch/webSearch）逐条列出来，并给每类动作的审批 UI 文案与 `remember` 写 rule 的具体生成策略（含 rule id 生成与撤销策略）。

[1]: https://developers.openai.com/codex/cli/reference "Command line options"
