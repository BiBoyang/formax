下面这份路线图把 **OpenAI Codex CLI** 当作“工程实现参考 + 可交付产品参考”，重点对齐 **产品化能力**（配置/授权/安全/诊断/可发布/可维护），而不是功能清单。
我所有关于 Codex CLI 的结论都尽量引用官方公开资料；没法从公开资料直接确认的，会标 **【推测】** 并说明依据。Formax 现状部分尽量指到你给的 repomix 里真实存在的路径与线索。

---

## 1) 产品化差距总表（至少 30 行）

> 表格说明：
>
> * **Codex CLI 做法**：尽量写清“行为/架构/默认策略”，并给 `URL` + 引用。
> * **Formax 当前状态**：给出你 repo 里的落点路径（repomix 可搜到）。
> * **建议（MVP 步骤）**：每行尽量给“最短可交付步骤”。

| 能力点                                   | Codex CLI 做法（来源URL；没把握标【推测】）                                                                                                                                                                                                                      | Formax 当前状态（文件路径）                                                                                                                                                                   | 用户痛点/风险                                   | 建议（MVP步骤）                                                                                                             |                                                                                                          |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| 1. 首次启动引导（onboarding）                 | 有明确的认证/配置入口：`codex login`（可交互），以及配置文件 `config.toml`；文档把配置当“一等功能”。`https://developers.openai.com/codex/auth`  `https://developers.openai.com/codex/config-basic`                                                                                   | 当前依赖环境变量直接启动 REPL；无“缺配置时向导”。入口：`src/entrypoints/cli.tsx` ；运行时配置来自 `src/env/config.ts`                                                                                               | 陌生用户第一次运行就失败（缺 key / 不知道配哪里）；支持成本高        | 1) 启动时检测“缺配置/缺 key/模型不可用” → 进入 wizard UI（Ink） 2) wizard 结束后写入全局 config & auth store 3) 再进入 REPL                       |                                                                                                          |
| 2. 配置文件标准化（路径/格式）                     | 默认在 `$CODEX_HOME/config.toml`（默认 `~/.codex`），集中管理；文档给完整示例与配置项说明。`https://developers.openai.com/codex/config-advanced`  `https://developers.openai.com/codex/config-reference`                                                                     | 有配置目录/文件路径常量：`~/.formax/config.json`（但运行时配置仍主要取 env）。`src/utils/env.ts` ；全局配置类型在 `src/utils/config.ts`                                                                              | “有 config.json 但不生效/不一致”的体验会让用户不信任；难做迁移   | 1) 统一配置读取：global + project config（建议改为 TOML 以对齐 Codex） 2) 引入 schema_version 与校验（zod） 3) `formax config show` 输出最终合并结果 |                                                                                                          |
| 3. 配置优先级（flags/env/config/default）    | 明确优先级：CLI flags > env > config.toml > defaults（文档列出）。`https://developers.openai.com/codex/config-advanced`                                                                                                                                        | 运行时配置目前仅从 env 装载（Anthropic），见 `src/env/config.ts`                                                                                                                                   | 用户不知道“改 env 还是改文件”，线上排障困难                 | 1) 定义优先级表（见 3.1） 2) 每次启动在 `/status` 或 `formax config show` 展示来源（env/文件/默认）                                            |                                                                                                          |
| 4. Profiles（多配置档案）                    | `model_provider` + `model_providers.<name>` 支持自定义 provider（base_url、wire_api、env_key 等）；并支持切换。`https://developers.openai.com/codex/config-advanced`  `https://developers.openai.com/codex/config-reference`                                       | 有“模型档案”雏形：`getModelProfiles()` 返回 default/fast 等；但未与真实 provider/profile 绑定，也未从文件读取。`src/utils/config.ts`                                                                            | 难支持企业用户（自建网关/代理/baseUrl），也难支持多账号切换        | 1) 把 Formax profiles 提升为“provider+auth+model+policy”整体 2) 支持 `formax profile add/use/list` 3) 在 REPL 顶部显示当前 profile   |                                                                                                          |
| 5. provider/baseUrl/model 三件套         | `model_provider` 指向某 provider；provider 可配置 `base_url`、API 形态（chat/responses）等。`https://developers.openai.com/codex/config-advanced`                                                                                                               | 当前 runtime provider 固定为 `anthropic`（写死），baseUrl/apiKey/model 取 env（`ANTHROPIC_*`）。`src/env/config.ts`                                                                               | 无法“可交付给陌生用户”：不同 provider 的接入成本太高、文档难写     | 1) 抽象 `LLMProvider` 接口（OpenAI/Anthropic/Custom） 2) 配置里统一 provider 字段 3) 运行时根据 provider 构造 client                      |                                                                                                          |
| 6. 凭证存储（keyring vs file）              | 支持 keyring 与文件存储；配置项里有 `auth.file_store`（含路径/格式等）。`https://developers.openai.com/codex/config-reference`                                                                                                                                          | 仅 env 读取 key；未见 keyring/file store 实现（运行时配置直接读 env）。`src/env/config.ts`                                                                                                             | 用户要把 key 写进 shell profile 或 .env，安全与可用性都差 | 1) 增加 `src/auth/`：KeyringStore/FileStore/EnvStore 2) `formax login` 写入安全存储 3) `/doctor` 检测凭证是否可读                      |                                                                                                          |
| 7. 登录方式（ChatGPT / API key / headless） | 文档明确：可用 API key（env），也可 `codex login`（含 headless device auth 流程）。`https://developers.openai.com/codex/auth`                                                                                                                                       | 无登录命令；只支持 env key（Anthropic）。`src/env/config.ts`                                                                                                                                    | 企业场景（CI/多用户机器/无浏览器）不可用                    | 1) 先做 API key 登录（最小） 2) 再做 device-code（若对齐 OpenAI 生态）【推测：需结合 OpenAI 官方 OAuth/设备码能力】                                   |                                                                                                          |
| 8. “展示有效配置”命令                         | 文档提到可查看 effective config（例如 `codex config show --effective` 用于校验 managed config 生效）。`https://developers.openai.com/codex/security`                                                                                                                | 无 config show；只有默认/静态配置函数。`src/utils/config.ts`                                                                                                                                     | 排障时无法确认“到底用了哪个 model/baseUrl/policy”      | 1) `formax config show [--effective]` 2) 输出：来源、合并、敏感字段脱敏 3) `/status` 里也要展示关键字段                                       |                                                                                                          |
| 9. Sandbox 模式分级                       | `sandbox_mode`：`read-only` / `workspace-write` / `danger-full-access`；并强调默认更安全。`https://developers.openai.com/codex/security`                                                                                                                     | 目前是“软策略”：Bash policy 规则（deny/confirm/allow），非 OS 级 sandbox。`src/tools/modules/bash/policy.ts`                                                                                       | 仅靠字符串规则很容易漏（rm、curl                       | bash、写出工作区等）；安全口碑风险                                                                                                   | 1) 引入 Formax `sandbox_mode`（至少三档） 2) 先实现“写文件路径白名单 + 网络开关 + 命令 denylist/confirm” 3) 后续可接容器/OS sandbox（P2） |
| 10. 默认网络策略                            | Codex 文档强调网络默认关闭、显式开启（allow_network）。`https://developers.openai.com/codex/security`                                                                                                                                                               | Formax 有 `WebFetch`/`WebSearch` 工具模块；未见全局网络开关。`src/tools/modules/webFetch/index.ts`、`src/tools/modules/webSearch/index.ts`                                                          | 默认联网会导致数据外泄风险；企业无法接受                      | 1) 增加 `network_mode`（off/on） 2) 工具执行前统一拦截 3) UI 告知“此操作将联网”并可记住选择                                                      |                                                                                                          |
| 11. Approval policy（请求批准策略）           | `approval_policy`：`untrusted` / `on-request` / `on-failure` / `never`；可配默认。`https://developers.openai.com/codex/config-reference`                                                                                                                 | 目前是“各工具各做各的”：Bash/NotebookEdit 有审批问题；且有“本会话全允许”选项。例：NotebookEdit 的审批问题 `Yes / allow all edits`                                                                                      | 策略不一致：用户无法理解“什么时候会弹窗、为什么这次没弹”             | 1) 做统一 ApprovalService：输入（tool, action, risk）→ 输出（allow/ask/deny） 2) 在配置里设置 approval_policy 3) 所有工具走同一决策              |                                                                                                          |
| 12. 持久化记住用户选择                         | Codex 用规则文件：`~/.codex/rules/*.rules`（Starlark），TUI 允许后会追加到 `default.rules`。`https://developers.openai.com/codex/rules`                                                                                                                            | Formax 目前“仅会话内允许”（例如 NotebookEdit、Edit 的 allow all edits during this session）。                                                                                                      | 用户每次都要重复确认；或为了省事开“全允许”造成风险                | 1) 引入 `~/.formax/rules/*.rules` 或 json 规则 2) 在审批 UI 提供“总是允许此类操作/此目录/此命令” 3) 规则可通过 `formax execpolicy check` 调试        |                                                                                                          |
| 13. Execpolicy / Policy 调试工具          | Codex 有 `codex execpolicy`，并支持 `codex execpolicy check ... --rules` 来测试规则。`https://developers.openai.com/codex/rules`  `https://developers.openai.com/codex/cli`                                                                                  | 无类似命令；只有 Bash policy 内部函数。`src/tools/modules/bash/policy.ts`                                                                                                                        | 策略问题排查困难（用户/客服都无法复现）                      | 1) `formax execpolicy check --tool Bash --command "rm -rf …"` 2) 输出匹配到的规则、原因、建议 3) 作为 `/doctor` 的子项                   |                                                                                                          |
| 14. Shell 环境变量策略                      | Codex 有 `shell_environment_policy`（例如 inherit/denylist 等）来控制执行命令时的环境继承。`https://developers.openai.com/codex/config-reference`                                                                                                                     | 未看到统一的 env 注入策略；执行工具上下文在 `src/tools/executor/index.ts`，但不含 env policy。                                                                                                              | 可能把敏感 env（token、AWS key）泄漏给子进程/外部命令       | 1) 增加 env policy：默认最小环境 2) allowlist 必需变量（PATH、HOME） 3) `/doctor` 检查是否启用                                              |                                                                                                          |
| 15. 危险模式开关（full-auto / yolo）          | Codex CLI 有 `--full-auto`（等价于 `approval=never + sandbox=danger`）、`--yolo` 等旗标；文档强调风险。`https://developers.openai.com/codex/security`                                                                                                               | 未见全局危险模式；只有局部 confirm/deny。Bash policy 会拒绝 sudo。                                                                                                                                    | 高级用户想“快速执行”没有明确入口；或误以为已全自动                | 1) 增加 `--full-auto/--yolo`（显式危险声明 + 二次确认） 2) 在 UI 头部持续提示当前模式 3) 写入 session logs                                       |                                                                                                          |
| 16. Patch 式编辑（apply_patch）            | Codex 仓库内有 `apply_patch` 指令文件（定义 `*** Begin Patch`、`Add/Update/Delete File` 等安全格式）。`https://github.com/openai/codex`（仓库搜索命中：`codex-rs/apply-patch/...`）；OpenAI 平台也提供 apply_patch 工具指南：`https://platform.openai.com/docs/guides/tools-apply-patch` | Formax 的 `Edit` 工具是 `old_string/new_string` 替换；Write 直接写整文件（容易大改）。工具规范来自 `tools.json`。                                                                                              | 替换法很脆弱（不唯一/找不到）；整文件写入难审计、难回滚              | 1) 新增 `ApplyPatch` 工具（patch language 或 unified diff） 2) 执行前生成最小 diff 3) 失败可重试/可回滚（见 3.3）                              |                                                                                                          |
| 17. 最小 diff/减少编辑面                     | Codex 提倡 patch-based workflow；并且 CLI 有 `/diff` 查看 diff。`https://developers.openai.com/codex/security`  `https://developers.openai.com/codex/slash-commands`                                                                                       | Formax 有 `/acceptEdits` 模式概念（repl mode），但 Edit/Write 的“最小 diff”能力不强。REPL mode：`src/features/repl/mode.ts`                                                                           | 用户难以审查改动；误改概率高                            | 1) 引入“diff first”展示（写/改文件前展示 hunks） 2) 支持 `apply`/`reject`/`edit patch` 三选一 3) 默认开启“只允许小 diff”阈值                      |                                                                                                          |
| 18. Undo/回滚                           | Codex basic config 提到可启用“每回合 git ghost snapshots”的 undo。`https://developers.openai.com/codex/config-basic`                                                                                                                                        | 未见通用 undo；文件写入后不可一键撤回                                                                                                                                                               | 一旦写坏需要手动找回；信任感差                           | 1) MVP：写文件前保存 `.formax/undo/<timestamp>/...` 2) 提供 `/undo` 或 `formax undo` 3) P1：用 git worktree/patch stack           |                                                                                                          |
| 19. 文件写入原子性/一致性                       | 【推测】Codex patch apply 通常会“先验证再应用”，失败不落盘（依据 apply_patch 工具设计目标）。                                                                                                                                                                                   | Write/Edit 目前直接写入；可导致半成品（崩溃/中断）。（需结合 handler 代码进一步核对）                                                                                                                               | 崩溃后仓库处于不一致状态                              | 1) 写入采用临时文件 + rename（原子替换） 2) 写入前后校验（hash/行数） 3) 失败自动恢复备份                                                             |                                                                                                          |
| 20. 错误处理与“可读错误”                       | Codex 有 `/status`、`/feedback` 等让用户自助排查并提交反馈。`https://developers.openai.com/codex/slash-commands`                                                                                                                                                  | Formax 错误多为 `Error: ...` 字符串；部分工具有较友好错误（如路径必须绝对路径）。`src/tools/utils/paths.ts`                                                                                                       | 新用户无法“下一步怎么修”；只能去问作者                      | 1) 定义错误码体系（E_AUTH_401 等） 2) 错误文案包含：原因 + 修复步骤 + 相关命令（doctor/config show）                                               |                                                                                                          |
| 21. /status（运行态自检）                    | Codex 有 `/status`（文档列出内置 slash command）。`https://developers.openai.com/codex/slash-commands`                                                                                                                                                      | Formax 的 command registry 支持 slash commands，但未见 `/status` 实现；registry 支持从 `.claude/commands/*.md` 加载自定义命令。`src/features/commands/registry.ts`                                       | 用户不知道当前 model/provider/policy；排障困难        | 1) 实现 `/status`：展示 profile、policy、网络、sandbox、工具数量、最近错误 2) 输出可复制给客服                                                    |                                                                                                          |
| 22. /feedback（收集诊断包）                  | Codex 有 `/feedback`（文档列出）。`https://developers.openai.com/codex/slash-commands`                                                                                                                                                                    | 无类似收集；虽有 logsDir 配置项但未形成 debug bundle。`src/env/config.ts`                                                                                                                           | 用户反馈“用不了”但你拿不到关键上下文                       | 1) `formax doctor --bundle` 生成 zip（脱敏） 2) `/feedback` 引导用户上传                                                          |                                                                                                          |
| 23. 规则文件（安全策略可审计）                     | Codex 用 Starlark 规则，支持 allow/ask/deny，并支持 runtime 检查。`https://developers.openai.com/codex/rules`                                                                                                                                                  | Bash policy 是 TS 代码内硬编码规则；可测试但不够可配置。`src/tools/modules/bash/policy.ts`                                                                                                              | 企业要可审计/可版本化策略；硬编码难管理                      | 1) 抽象 PolicyEngine 2) 规则落盘（toml/json/starlark-lite） 3) 提供“默认规则集 + 用户规则覆盖”                                             |                                                                                                          |
| 24. MCP（可扩展工具/集成）                     | Codex 支持 MCP servers：在 config 中声明 `[mcp_servers]`。`https://developers.openai.com/codex/mcp`                                                                                                                                                       | Formax 未见 MCP；但有 tool registry 与 tool definitions loader。`src/tools/registry.ts`、`src/tools/loader.ts`                                                                              | 生态扩展受限，难接企业内部系统                           | 1) P1：先做“插件包”机制（见 3.4） 2) P2：对齐 MCP server 进程管理/权限声明                                                                  |                                                                                                          |
| 25. Custom prompts（可复用命令）             | Codex 支持自定义 prompts：放在 `~/.codex/prompts`，Markdown + YAML front matter，使用时 `/prompt-name`。`https://developers.openai.com/codex/custom-prompts`                                                                                                    | Formax 已有 `.claude/commands/*.md` 的 YAML front matter 自定义命令加载机制（registry）。`src/features/commands/registry.ts`                                                                       | 现有机制命名与目录不统一（.claude vs .formax），对用户不友好   | 1) 统一为 `.formax/commands` 与 `~/.formax/commands` 两级 2) 沿用 YAML front matter 3) 提供 `formax command new` 脚手架            |                                                                                                          |
| 26. Skills（可复用“技能包”）                  | Codex skills：每个技能一个文件夹，核心是 `SKILL.md`；支持资源/脚本等。`https://developers.openai.com/codex/skills`                                                                                                                                                       | Formax 有 subagents 概念与目录：runtime config 里有 `subagentsDir`。`src/env/config.ts` ；subagent 列表/允许机制：REPL props `allowedSubagents`                                                       | 技能发现/安装/权限声明不清晰                           | 1) 定义 Formax Skill 包格式（manifest + prompt + tools 权限） 2) `formax skill install/list` 3) UI 展示技能来源与权限                   |                                                                                                          |
| 27. Skills 的“延迟注入”降低 prompt 污染        | Codex 文档：skills 仅把 name/description/path 注入上下文，**内容不会注入**，直到 skill 被调用。`https://developers.openai.com/codex/create-skill`                                                                                                                         | Formax 的 subagent/commands 是否“延迟注入”不明确（需进一步看 prompts 组织）                                                                                                                            | 全量注入会导致 prompt 变长、冲突、信息泄漏                 | 1) 实现“仅注册元数据” 2) 调用时再加载正文 3) 在 tokens/上下文预算里可控                                                                        |                                                                                                          |
| 28. Slash commands（内置与可扩展）            | Codex 内置 `/help /model /approvals /status /diff /feedback /compact ...`；并支持 `.codex/commands` 自定义。`https://developers.openai.com/codex/slash-commands`                                                                                            | Formax REPL 有 slash suggestion 系统（commandRegistry.suggest），并可加载 `.claude/commands/*.md`。`src/screens/REPL.tsx`、`src/features/commands/registry.ts`                                  | 对用户来说“有哪些命令/怎么写命令”仍不清晰                    | 1) 内置 `/help` 与命令列表页 2) 提供 `formax command create` 3) 将 `.claude` 迁移到 `.formax`                                       |                                                                                                          |
| 29. 任务/后台任务（task manager）             | Codex CLI 有 `codex apply`（把 Codex Cloud task 的 diff 应用到本地）暗示存在任务系统。`https://developers.openai.com/codex/cli`                                                                                                                                      | Formax 有 TaskManager：支持后台任务、列表与取消。`src/tools/runtime/taskManager.ts`                                                                                                                | 任务对用户不可见/不可控会造成“卡住/不知道在干嘛”                | 1) 增加 `/tasks`：list/cancel/open log 2) 每个任务有状态机与 UI 提示（见 3.5）                                                         |                                                                                                          |
| 30. Plan / Todo（计划管理）                 | 【推测】Codex 的 `/compact` 等命令偏“对话管理”，但公开文档未明确类似 EnterPlanMode/ExitPlanMode 的实现；因此不硬对齐。                                                                                                                                                               | Formax 有明确 plan mode（EnterPlanMode/ExitPlanMode），并写 plan 文件路径提示。`src/tools/modules/enterPlanMode/handler.ts`、`src/tools/modules/exitPlanMode/presenter.tsx`、`src/utils/planMode.ts` | “计划与执行分离”是强产品能力，但需要更清晰的 UX 与持久化           | 1) plan 文件持久化到 `.formax/plans/` 2) `/plan show/apply` 3) plan 批准后自动切到执行模式                                             |                                                                                                          |
| 31. 终端 UX：折叠/展开与摘要                    | Codex slash commands 有 `/compact`（压缩对话）、`/diff`（看差异）等，说明 UI 支持“聚合/压缩”。`https://developers.openai.com/codex/slash-commands`                                                                                                                        | Formax UI 有 ToolMessage、PulsingDot 等组件；并有提示“interactive 工具”判断逻辑。`src/screens/REPL.tsx`                                                                                              | 长输出刷屏、用户找不到关键信息                           | 1) Tool 输出默认摘要 + “按键展开” 2) 大文本分页/搜索 3) `/compact` 实现：保留要点，归档历史                                                        |                                                                                                          |
| 32. 终端 UX：减少闪烁/流式策略                   | Codex 文档未详细描述，但其交互命令体系暗示有稳定的 TUI 状态管理【推测】                                                                                                                                                                                                         | Formax 有 `assistantTextMode: stream/buffered` 配置项。`src/env/config.ts`                                                                                                               | 终端抖动会显著降低可用性                              | 1) 默认 buffered 渲染，批量刷新 2) stream 模式下做节流 3) 输出分区（assistant/tool/system）                                                |                                                                                                          |
| 33. 安装与分发（可给陌生人用）                     | Codex 有清晰 CLI 参考文档与命令结构（login、completion、exec、apply…）。`https://developers.openai.com/codex/cli`                                                                                                                                                   | Formax 目前更像开发态 REPL；未见对外发布/自更新链路（repomix 未包含 package/bin 信息）。                                                                                                                       | 用户拿不到“一个命令安装并运行”的体验                       | 1) 增加 `bin` 入口（npm/pnpm） 2) `formax --version`/`formax --help` 3) 发布流程（CI、changelog、签名）                               |                                                                                                          |
| 34. 版本迁移/兼容                           | Codex managed config 强调可集中管理；配置项集中可控。`https://developers.openai.com/codex/security`                                                                                                                                                               | Formax 有 config.json 路径但未统一加载；迁移机制缺失。`src/utils/env.ts`                                                                                                                             | 一旦字段变更就“静默坏掉”                             | 1) 加 `schema_version` 2) 启动时自动 migrate 3) `/doctor` 提示迁移                                                              |                                                                                                          |
| 35. 目录/工作区识别（project root）            | Codex advanced config 讨论 project root 检测等（便于 workspace-write 限制）。`https://developers.openai.com/codex/config-advanced`                                                                                                                            | Formax 多处直接用 `process.cwd()`；路径要求绝对路径（工具层）。`src/screens/REPL.tsx`、`src/tools/utils/paths.ts`                                                                                        | 不同 cwd 下规则/白名单不一致                         | 1) 引入 project root 探测（git root/配置文件） 2) sandbox workspace-write 以 root 为边界 3) `/status` 显示 root                       |                                                                                                          |
| 36. 工具扩展：工具定义加载                       | Codex 通过 MCP / skills / custom commands 形成扩展体系。`https://developers.openai.com/codex/mcp`  `https://developers.openai.com/codex/skills`                                                                                                            | Formax 已支持从 JSON 加载工具定义：`loadToolDefinitions(filePath)`，并支持 ToolRegistry patch spec。`src/tools/loader.ts`、`src/tools/registry.ts`                                                   | 工具扩展缺少“安装/权限/隔离”                          | 1) 插件包 manifest 声明 tools + 权限 2) 安装到 `~/.formax/plugins/` 3) 加载时进行权限校验                                                |                                                                                                          |
| 37. 安全默认值（secure-by-default）          | Codex security doc 强调 sandbox/approval 的默认安全性，危险模式需显式开启。`https://developers.openai.com/codex/security`                                                                                                                                            | Formax 当前默认提供 Bash/WebFetch/WebSearch 等能力；若无统一 policy，默认可能过宽。                                                                                                                       | 一旦出安全事故，产品化会被“一票否决”                       | 1) 默认 `sandbox=workspace-write` + `network=off` + `approval=on-request` 2) 首次启用联网/写出工作区需显式授权                          |                                                                                                          |
| 38. 安全提示与持续可见的模式指示                    | Codex 有显式 flags（`--full-auto`/`--yolo`）并强调风险。                                                                                                                                                                                                     | Formax REPL 有 ModeIndicator 组件（mode: normal/plan/acceptEdits）。`src/screens/REPL.tsx`                                                                                                | 用户不知道当前处于“危险模式/联网模式”                      | 1) ModeIndicator 增加：network/sandbox/approval 三个徽章 2) 颜色/文本提示不可忽略 3) 切换时强提醒                                            |                                                                                                          |
| 39. 输出可维护性：日志分级与脱敏                    | Codex 文档提及可通过 config 管控；并有反馈机制。                                                                                                                                                                                                                   | Formax runtime config 有 `logLevel`、`logsDir` 字段，但未形成标准 log bundle。`src/env/config.ts`                                                                                               | 无日志/脱敏会导致：无法排障或泄漏隐私                       | 1) 统一 Logger（json lines） 2) 默认脱敏（key/token） 3) doctor bundle 默认脱敏                                                     |                                                                                                          |
| 40. 帮助与文档内置                           | Codex 有 `/help` 和 CLI help；slash commands 文档强调 discoverability。                                                                                                                                                                                   | Formax 有 slash suggestions，但需要内置 `/help` 输出命令/示例。`src/screens/REPL.tsx`                                                                                                             | 新用户不知道怎么开始                                | 1) `/help`：Quick Start + 常见命令 2) 第一次启动自动提示“输入 /help”                                                                  |                                                                                                          |
| 41. 路径策略：强制绝对路径                       | Codex 文档未强调，但其 sandbox/workspace-write 隐含路径边界【推测】                                                                                                                                                                                                 | Formax 工具层强制绝对路径，并给出建议路径。`src/tools/utils/paths.ts`                                                                                                                                 | 新用户常用相对路径会被拒；需要更友好                        | 1) CLI 统一 project root 2) 工具层允许相对路径但会规范化并提示 3) 输出“最终解析到：…”                                                            |                                                                                                          |
| 42. 审批 UI 的一致性                        | Codex 有 `/approvals` command（查看/调整批准设置）。                                                                                                                                                                                                          | Formax 各工具 presenter 自己画审批 UI（如 EditApprovalPrompt）。相关：`src/tools/presenters/editApprovalPrompt.tsx`（存在于 repomix 命中）                                                                | 每个工具一个 UI，体验不一致，维护成本高                     | 1) 抽象通用 ApprovalPrompt 组件（标题/风险/影响/选项） 2) 工具只提供“审批上下文”                                                                |                                                                                                          |
| 43. 变更审阅（review gate）                 | Codex 有 `/diff`；并鼓励 patch-based review。                                                                                                                                                                                                           | Formax 有 acceptEdits 模式概念，但缺少统一“diff 展示 + 接受/拒绝”门槛                                                                                                                                  | 用户不敢让工具写代码                                | 1) 所有写操作默认进入“待审阅队列” 2) `/diff` 展示当前队列 3) `/apply` 一键落盘                                                                |                                                                                                          |
| 44. 完整性：CI/测试策略                       | Codex 作为产品级 CLI，公开文档/结构相对完整【推测】                                                                                                                                                                                                                   | Formax 目前 tests 缺失（你给了 notests 包）；部分 policy 有测试（bash handler test 在 src 包内）。                                                                                                        | 没测试会导致产品化“越补越碎”                           | 1) P0 强制覆盖：config load、approval、patch apply、doctor 2) golden tests：输入→输出固定                                            |                                                                                                          |
| 45. 可发布可维护：兼容/降级策略                    | Codex 有清晰配置项（如自定义 provider、base_url、wire_api），利于兼容多环境。                                                                                                                                                                                            | Formax 当前 anthropic-only 且 env 命名带 `2`（`FORMAX_API_KEY`）。                                                                                                                       | 命名不直观、迁移成本高                               | 1) 统一 env 命名（FORMAX_ 前缀） 2) 兼容旧 env（迁移提示） 3) 写 migration 文档与 `/doctor` 检测                                             |                                                                                                          |

---

## 2) P0/P1/P2 Roadmap（面向“可交付产品”）

下面按“能交给陌生人用”的顺序排优先级。每项都给：用户故事 / 设计决策 / MVP 步骤 / Formax 落点 / DoD / 安全隐私 / 测试建议。

---

### P0（必须先做：让陌生用户**能装、能配、能跑、出问题能自救**）

#### P0-1：首次启动向导（Setup Wizard）+ 最小配置落盘

* **用户故事**
  “我第一次安装 Formax，运行 `formax`，它能告诉我需要什么（API Key/模型），并引导我完成配置，然后马上能开始对话。”
* **设计决策（默认值/最少选项）**

  * 默认 profile：`default`
  * 默认 provider：先保留现状 `anthropic`，但结构上允许 `openai/custom`
  * 默认 `approval_policy=on-request`、`sandbox_mode=workspace-write`、`network=off`（可在向导中询问是否开启网络）
* **MVP 步骤（3-10 步）**

  1. 在 `src/entrypoints/cli.tsx` 启动时调用 `ensureConfigured()`：检查 config 文件是否存在、是否通过 schema 校验、是否有可用凭证 
  2. 若缺失：进入 Ink 向导界面（多步表单）：选择 provider → 输入 key → 选择 model → 选择网络开关 → 完成
  3. 写入 `~/.formax/config.toml`（或先用现有 `config.json`，但建议尽快转 TOML）与 `~/.formax/auth.json`（敏感字段单独存）
  4. 结束后打印 “配置完成，输入 /help”
  5. 继续进入 REPL
* **Formax 关键落点文件/模块**

  * 修改入口：`src/entrypoints/cli.tsx` 
  * 新增：`src/config/load.ts`、`src/config/schema.ts`、`src/config/wizard/Wizard.tsx`
  * 现状配置来源：`src/env/config.ts`（需要被替换/改造为“最终合并配置”） 
  * config dir 常量：`src/utils/env.ts` 
* **验收标准（DoD）**

  * 在全新机器（无 env、无 config）运行：能完成向导并进入可对话状态
  * 向导完成后：关闭终端再开，仍能直接进入 REPL（不需要再输 key）
  * `formax config show` 能输出最终配置（敏感信息脱敏）
* **安全/隐私注意点**

  * key 默认写入 keyring（若可用）；否则写文件必须 `chmod 600`，并提示用户
  * `/doctor --bundle` 必须自动脱敏
* **测试建议**

  * 单测：schema 校验、merge 优先级、写文件权限
  * E2E：模拟无配置 → 向导 → 重启仍可用

---

#### P0-2：统一配置系统（优先级 + schema + config show）

* **用户故事**
  “我想把 baseUrl/model/policy 配好后，任何机器/任何 shell 都一致；我也想一眼看到当前生效配置。”
* **设计决策**

  * 配置分层：CLI flags > env > project config（`.formax/config.toml`）> global config（`~/.formax/config.toml`）> defaults
  * 使用 `schema_version`，并提供迁移函数（见 3.1）
* **MVP 步骤**

  1. 定义 `FormaxConfig` schema（zod）
  2. 实现 `loadConfig({cwd, argv, env})` 返回 `{effective, sources}`
  3. 实现 `formax config show [--effective] [--json]`
  4. REPL `/status` 也调用该配置输出摘要
  5. 兼容旧 env：`FORMAX_API_KEY/BASE_URL2` → 给 warning（一次性）
* **落点**

  * `src/utils/config.ts` 当前仅返回默认值：需要改为真正加载文件并合并 
  * `src/env/config.ts` 当前 env-only：改为 “env layer provider” 
* **DoD**

  * `formax config show --effective` 输出包含来源（env/file/default）
  * 配置错误时给具体报错（哪一项、期望值）
* **安全/隐私**

  * show 输出脱敏（key 只显示后 4 位）
* **测试**

  * golden tests：给定 env+文件+flags → 固定 effective 输出

---

#### P0-3：认证与凭证管理（login/logout/status）

* **用户故事**
  “我不想设置一堆环境变量；我希望 `formax login` 后就能用，并能 `formax auth status` 看是否有效。”
* **设计决策**

  * MVP 先做 API key（不强做 OAuth）
  * auth store：优先 keyring，fallback file store
* **MVP 步骤**

  1. `formax login`：交互输入 key（支持 stdin）
  2. 写入 auth store（keyring/file）
  3. `formax auth status`：验证 key（最小可做：调用 models list 或一次轻量 request）
  4. `formax logout`：删除本地存储
* **落点**

  * 新增：`src/auth/store.ts`、`src/auth/commands/login.ts`、`src/auth/commands/status.ts`
  * 入口命令路由放在 `src/entrypoints/cli.tsx` 或新的 `src/cli/index.ts`
* **DoD**

  * 无 env 的情况下 `formax login` 后可正常聊天
  * `formax auth status` 给出 OK/失败原因（401/网络/超时）
* **安全/隐私**

  * 输入 key 不能回显；日志不写 key
* **测试**

  * mock provider：401/200/timeout 三类

---

#### P0-4：统一 ApprovalService（工具权限模型一致化）

* **用户故事**
  “我希望所有危险操作（写文件、联网、运行命令）都有一致的提示，并能记住我的选择。”
* **设计决策**

  * 统一决策：`allow | ask | deny`
  * 决策依据：`approval_policy + sandbox_mode + rules + 当前操作风险`
* **MVP 步骤**

  1. 定义 `ApprovalRequest`（tool/action/target/path/command/network）
  2. 实现 `ApprovalService.decide(req): Decision`
  3. 替换 Bash/Write/Edit/NotebookEdit 等工具内的零散审批逻辑
  4. UI：统一 ApprovalPrompt（显示风险、影响范围、可选“记住”）
* **落点**

  * Bash policy：`src/tools/modules/bash/policy.ts`（保留做风险分类输入） 
  * 多工具审批 UI 入口：presenters（如 `src/tools/presenters/editApprovalPrompt.tsx`）
  * 执行上下文：`src/tools/executor/index.ts`（可加入 policy hooks） 
* **DoD**

  * 所有写/联网/命令都能触发同一套审批 UI
  * 支持 `approval_policy=never`（危险模式）与 `on-request`（默认）
* **安全/隐私**

  * “记住选择”必须可撤销（rules 文件可编辑）
* **测试**

  * policy 决策表：输入场景 → 决策输出

---

#### P0-5：/doctor（自检）+ debug bundle（脱敏）

* **用户故事**
  “我遇到问题时不想翻源码，希望 `formax doctor` 告诉我缺什么、怎么修，并能打包日志给你。”
* **设计决策**

  * doctor 默认只读；`--fix` 可选但 P0 不做自动修复（避免误改）
  * bundle 默认脱敏
* **MVP 步骤**

  1. 实现 `formax doctor`：检查 config schema、auth、网络连通、目录权限、工具文件可读（tools.json）
  2. 实现 `formax doctor --bundle`：收集 effective config（脱敏）、最近 N 行日志、环境信息、版本信息
  3. REPL `/doctor` 显示同样输出
* **落点**

  * 工具定义文件路径已在 runtime config：`toolsJsonPath` 
  * tool loader：`src/tools/loader.ts`（用于校验 tools.json 可读） 
* **DoD**

  * doctor 输出包含“明确下一步命令”
  * bundle 生成成功且脱敏
* **安全/隐私**

  * 默认移除：key、token、用户路径可选择 hash
* **测试**

  * doctor 的每个 check 都可单测；bundle 脱敏 golden test

---

### P1（增强产品化：更安全、更可审、扩展更强）

#### P1-1：Patch 工作流（ApplyPatch + Diff Queue + Review Gate）

* **用户故事**
  “我希望 Formax 改代码时总是可审查：先看 diff，再一键应用或回滚。”
* **设计决策**

  * 引入“待应用改动队列”（changeset），写操作先进入队列
  * 通过 `ApplyPatch` 工具落盘；`/diff` 查看队列；`/apply` 应用；`/reject` 丢弃
* **MVP 步骤**

  1. 定义 `ChangeSet`（file path, patch, before/after hash）
  2. 新工具 `ApplyPatch`（支持 add/update/delete）
  3. 改造 Write/Edit：不直接写盘，先生成 patch 放入队列
  4. 实现 `/diff`、`/apply`、`/reject`
* **落点**

  * 现有 tools.json 已含 Edit/Write：可新增 ApplyPatch 并注册到 ToolRegistry 
  * REPL slash 系统：`src/features/commands/registry.ts` 
* **DoD**

  * 默认任何写操作都可在应用前审查
  * patch apply 失败时不落盘，并给出可复现错误
* **安全/隐私**

  * diff 展示避免泄漏敏感文件内容（可对某些路径遮盖）
* **测试**

  * golden patch tests：成功/冲突/不存在文件/编码问题

---

#### P1-2：持久化规则系统（Policy Rules）+ execpolicy 调试命令

* **用户故事**
  “我希望把策略写进文件，团队共享；也希望能验证某条命令会不会被允许。”
* **设计决策**

  * MVP 规则格式可选：JSON rules（更易实现）；对齐 Codex 可逐步演进到 starlark-lite
  * 规则覆盖顺序：project rules > user rules > defaults
* **MVP 步骤**

  1. 定义 rule schema（match: tool/action/command/path）
  2. 在 ApprovalService 中加载与匹配
  3. `formax execpolicy check ...` 输出命中规则
  4. UI 支持“记住这个决定”（写入 user rules）
* **落点**

  * Bash risk 分类继续复用 `src/tools/modules/bash/policy.ts` 作为输入特征 
* **DoD**

  * 用户能通过 rules 文件让某目录写入无需每次确认
  * execpolicy 能解释“为什么”
* **安全/隐私**

  * rules 修改需可审计（写入时间、来源）
* **测试**

  * match engine 的属性测试（边界、优先级）

---

#### P1-3：标准化日志体系（结构化日志 + UI 快捷入口）

* **用户故事**
  “我希望打开日志就能定位错误；遇到问题可直接复制一段日志给你。”
* **设计决策**

  * 结构化 JSONL；按天滚动；默认 info
  * UI 提供 `/logs` 或快捷键打开最近错误摘要
* **MVP 步骤**

  1. Logger 抽象：console + file
  2. 请求链路埋点：provider 请求、tool 执行、approval 决策、patch apply
  3. `/logs tail` 与 doctor bundle 引用同一套日志
* **落点**

  * runtime config 已有 logsDir/logLevel 字段，可落地到真正实现 
* **DoD**

  * 任何 error 都有 request_id / tool_use_id 可追踪
* **安全/隐私**

  * 日志默认脱敏（headers/key/path）
* **测试**

  * 脱敏过滤器 golden test

---

### P2（生态与企业化：隔离、插件市场、OS/容器 sandbox）

#### P2-1：OS/容器级 sandbox（可选）

* **用户故事**
  “我希望即使 agent 想做坏事也做不到（写出工作区/联网/执行危险命令）。”
* **设计决策**

  * Node 侧软 sandbox 仍保留；高级用户可启用容器 sandbox（docker）
  * 以 workspace root 挂载只读/读写目录
* **MVP 步骤**

  1. 抽象 `CommandRunner` 接口：local vs container
  2. container runner 支持网络开关、挂载白名单
  3. `/doctor` 检测 docker 可用性
* **DoD**

  * 在 container 模式下，写出白名单目录会失败并给明确错误
* **安全/隐私**

  * 容器运行时避免挂载 HOME/SSH 等敏感目录
* **测试**

  * 集成测试：容器内执行读/写/网三类行为

---

#### P2-2：插件包（commands + prompts + tools + subagents）一体化安装/隔离

* **用户故事**
  “我想安装一个插件，让 Formax 多出一组命令/工具/技能，而且它不能随便写文件或联网。”
* **设计决策**

  * 插件 manifest 声明权限（tools、fs、net、shell）
  * 插件加载隔离（命名空间、版本）
* **MVP 步骤**

  1. 设计 manifest（见 3.4）
  2. `formax plugin install`（从本地路径/zip）
  3. 加载时进行权限裁剪与冲突检测
* **DoD**

  * 插件请求联网但用户 policy 禁止时，必须被拦截并解释
* **测试**

  * 插件权限单测 + 冲突场景测试

---

## 3) 深挖专题（尽量具体）

### 3.1 配置与凭证管理（重点）

#### 3.1.1 Codex CLI：是否有 setup/配置文件/环境变量优先级？

从官方文档可以确认（不是猜）：

* **配置文件位置与默认目录**：使用 `$CODEX_HOME/config.toml`（默认 `~/.codex`），并支持 advanced config。
* **配置优先级**：文档明确讨论 “CLI flags、环境变量、配置文件、默认值”。
* **provider/baseUrl/model**：通过 `model_provider` + `model_providers.<name>` 支持自定义 provider、base_url 等。
* **认证**：支持 API key（如 env）与 `codex login`；并包含 headless device auth。
* **凭证存储**：config reference 中出现 `auth.file_store` 等配置项。

> 注：这说明 Codex 把“配置/认证/安全策略”作为可交付产品的骨架，而不是散落在 README 里的“开发者说明”。

---

#### 3.1.2 推荐 Formax 配置系统规范（可落地）

##### (A) 配置层级与优先级（建议）

| 优先级 | 来源        | 例子                                                             |
| --- | --------- | -------------------------------------------------------------- |
| 1   | CLI flags | `--profile prod --model ... --network on`                      |
| 2   | 环境变量      | `FORMAX_API_KEY`、`FORMAX_BASE_URL`                             |
| 3   | 项目配置（工作区） | `<repo>/.formax/config.toml`                                   |
| 4   | 全局配置（用户级） | `~/.formax/config.toml`（沿用现有 config dir 约定：`src/utils/env.ts`） |
| 5   | 默认值       | 代码内 defaults                                                   |

##### (B) 统一 schema（示例：TOML）

> 为什么建议 TOML：Codex 采用 TOML；对用户可读、可注释、易合并（比 JSON 更适合产品配置）。

（示例见第 5 节“config 文件示例”）

##### (C) Wizard 流程（Ink UI）

建议做成 **“可中断/可重进”** 的状态机：

* `Start` → `ChooseProvider` → `EnterCredentials` → `ChooseModel` → `SafetyDefaults` → `WriteConfig` → `Verify` → `Done`
* `Verify` 里做最小连通性检查（401/timeout/baseUrl 404）

##### (D) 迁移策略（schema_version）

* 在 config 里写 `schema_version = 1`
* 启动时：

  * 若缺失 → 当作 v0，尝试 migrate
  * 若版本更高 → 报错并提示升级 CLI
* `formax doctor` 输出迁移建议，避免 silent fail

##### (E) 与现状对齐（怎么落地到你的 repo）

你现在：

* runtime config 从 env 构造（且 provider 写死 anthropic）：`src/env/config.ts` 
* 已存在 config dir/file 常量：`src/utils/env.ts` 
* `src/utils/config.ts` 有全局配置类型但 `getGlobalConfig()` 直接返回默认值（未加载文件）

落地建议：

* 把 `src/utils/config.ts` 拆成：

  * `src/config/schema.ts`（zod）
  * `src/config/load.ts`（读 global+project）
  * `src/config/merge.ts`（优先级合并）
  * `src/config/commands/*.ts`（config show/edit）
* `src/env/config.ts` 变成“env layer”而不是最终配置

---

### 3.2 Sandbox/Approval（重点）

#### 3.2.1 Codex CLI：sandbox 模式有哪些？默认策略是什么？

从官方 security 文档可确认：

* `sandbox_mode` 支持：`read-only`、`workspace-write`、`danger-full-access`。
* 有“危险快捷开关”：`--full-auto`（文档描述其等价组合）与 `--yolo` 等。
* 规则系统：Starlark rules（`~/.codex/rules/*.rules`），并且在 TUI approve 后会追加到 `default.rules`。
* network 方面：文档强调默认更安全，需要显式策略（allow_network）。

> OS 级 sandbox 的具体实现细节（seatbelt/landlock/seccomp/WSL）在文档中有说明，但你在 Node 项目里短期很难 1:1 复刻；因此 Formax 的 MVP 建议从“统一拦截点 + 白名单 + 审批 + 可审计规则”开始。

---

#### 3.2.2 Formax MVP：怎么实现“最小可行 sandbox + approval”

你现状的“可挂拦截点”其实已经具备一些关键构件：

* **Bash 风险分类**：`src/tools/modules/bash/policy.ts` 已实现 deny/confirm/allow（例如拒绝 `sudo`、拒绝 root rm 等）。
* **REPL 模式**：`plan` 模式下对工具有额外限制（多处工具检查 `mode === 'plan'` 并拒绝）。
* **审批 UI 管理器**：REPL 会识别 interactive 工具并阻止 slash suggestions；说明你已有“交互阻塞”的机制。

**建议的最小实现：**

##### (A) 统一拦截点（非常关键）

在工具执行链路的最上层（建议 `src/tools/executor/index.ts` 的 dispatch 之前）增加：

```ts
type PermissionCheck = {
  tool: string;
  kind: "fs_read" | "fs_write" | "net" | "shell";
  target?: string; // path/url/command
  cwd: string;
  metadata?: Record<string, any>;
};

type Decision = { action: "allow" | "ask" | "deny"; reason: string; rememberKey?: string };
```

执行流程：

1. Tool handler 解析输入 → 形成 PermissionCheck
2. 调用 ApprovalService → 得到 Decision
3. `deny`：直接返回 tool_error（带修复建议）
4. `ask`：弹通用审批 UI（支持“记住”）
5. `allow`：进入真正执行

##### (B) 记住选择（最小）

先不做 Starlark：用 JSON rules 也可。

* `~/.formax/rules/default.json`
* rule key 示例：`shell:git push` / `fs_write:/repo/path/**` / `net:*.openai.com`

##### (C) 白名单目录（workspace-write）

* 自动识别 workspace root（git root / 向导里选目录）
* 默认允许写：workspace root 内
* 默认拒绝写：`~`、`/etc`、`/usr`、`.ssh` 等（可配置 override）

##### (D) 网络开关

* 配置：`network = "off" | "on"`
* `WebFetch/WebSearch` 执行前必须走 PermissionCheck(kind="net")

---

### 3.3 Patch/编辑工作流（重点）

#### 3.3.1 Codex CLI：如何保证“补丁式编辑”可靠？

能从公开资料确认的点：

* Codex repo 中存在专门的 `apply_patch` 指令文档（描述 `*** Begin Patch`、`Add/Update/Delete File` 等 envelope 格式）。
* OpenAI 平台也提供 apply_patch 工具指南（强调安全、可解析的 patch apply）。
* 同时 Codex 有 `/diff`（查看变更）与 `codex apply`（把任务 diff 应用到本地）的产品入口，说明“补丁/差异”是核心工作流。

> 我无法在本次环境里完整打开 GitHub 仓库文件逐行核对，因此对“内部如何失败重试/回滚”不做断言；但从公开工具设计与产品入口，可以合理推导：**patch apply 至少需要：解析→校验→应用→失败不落盘**。这些我会写成 Formax 的“建议实现”，并标注为建议而非事实。

---

#### 3.3.2 Formax：把 Edit/Write 工具契约设计成稳定、可测试、可回归

你现状：

* `Edit` 是 `old_string/new_string/replace_all`，并要求 `file_path` 绝对路径（tools.json 规范）。
* “old_string 必须唯一，否则失败”的要求存在于工具说明（system prompt 文档）。
* `requireAbsolutePath` 已经提供较友好错误（并给出 Try: 建议）。

**核心问题**：`old_string/new_string` 对 AI 不稳定；而产品化需要“可回归”的编辑协议。

##### (A) 推荐工具契约：三段式编辑（稳定）

1. `Read`（已有）
2. `PlanEdit`（新）：输出结构化变更意图（文件、范围、期望 outcome）
3. `ApplyPatch`（新）：只接收 patch（或 JSON patch），并负责原子落盘 + 回滚

这样：

* LLM 负责“想改什么”（可审查）
* 代码负责“怎么安全应用”（可测试）

##### (B) Golden 样例策略（强烈建议）

为 `ApplyPatch` 建立固定样例库（golden tests）：

* `add_file_ok`
* `update_file_ok_exact_context`
* `update_file_conflict_context_changed`
* `delete_file_ok`
* `binary_file_reject`
* `path_outside_workspace_reject`
* `patch_too_large_reject`

每个样例固定输入 patch 与初始文件树，断言：

* 输出 diff
* 文件 hash
* 回滚行为

##### (C) 失败重试与最小 diff

* 当 patch apply 失败：返回结构化错误（冲突位置、期望上下文、实际片段）
* LLM 再生成更精确 patch（这是可回归的：同一错误输入应得到同一错误输出）

---

### 3.4 插件/扩展机制（重点）

#### 3.4.1 Codex CLI 的扩展/skills 如何发现/安装/加载/隔离？

能从公开资料确认的点：

* **Custom prompts**：放在 `~/.codex/prompts`，用 YAML front matter 描述；通过 `/prompt-name` 调用。
* **Skills**：以目录组织，每个技能核心是 `SKILL.md`，并且可包含脚本/资源；还强调“只注入元数据、延迟注入正文”。
* **MCP**：通过 config 声明 servers。

关于“安装方式/隔离方式”的细节：公开文档没有完整写明“插件安装命令与沙箱隔离机制”，所以不做断言（如果你希望补证据，见第 4 节材料清单）。

---

#### 3.4.2 Formax：把 slash commands + tools modules + prompts + subagents 组合成“插件包”

你现状已经有两个可复用基础：

* `.claude/commands/*.md` 的命令加载器（YAML front matter + 内容）。
* ToolRegistry 支持 patch spec 与 presenter 注册（说明你有“可扩展工具系统”）。

##### (A) 插件包目录建议

```
~/.formax/plugins/<pluginName>/
  plugin.toml
  commands/*.md
  prompts/*.md
  tools/*.json          # 可选：工具定义（tool definitions）
  subagents/*.md        # 可选：子代理
  assets/...
```

##### (B) plugin manifest 设计（示例）

```toml
schema_version = 1
name = "jira-helper"
version = "0.1.0"
description = "Jira query + issue drafting"
entrypoint = "commands/jira.md"

[permissions]
network = ["https://jira.mycorp.com"]
fs_read = ["${workspace}/**"]
fs_write = ["${workspace}/.formax/**"]
shell = ["git status", "git diff"]

[tools]
# 声明插件要注册的工具（可选）
definitions = ["tools/jira-tools.json"]

[subagents]
paths = ["subagents/triage.md"]
```

##### (C) 权限声明如何生效

* 插件加载时：把 manifest 权限并入 PolicyEngine（但优先级低于用户/项目规则）
* 执行时：ApprovalService 决策时要知道“请求来自哪个插件/命令/子代理”，用于审计

---

### 3.5 UX 与性能

#### 3.5.1 Codex CLI 如何减少闪烁/处理长输出/折叠展开/后台任务？

公开文档可直接确认的主要是“交互入口”层面：

* 有 `/compact`（压缩上下文）、`/diff`（差异查看）、`/status`（状态）、`/feedback`（反馈）。

至于“如何减少闪烁”的具体实现（渲染策略、缓冲、虚拟列表）：公开文档没有写到实现细节，因此不做断言。【推测：其 TUI 至少具备输出分区与状态机，否则无法稳定支持这些命令入口。】

#### 3.5.2 Formax 需要补的 UI 组件与状态建模（具体建议）

你当前 REPL 具备：

* 模式：`normal/plan/acceptEdits`，并有 ModeIndicator。
* 工具消息 UI（ToolMessage）、加载点（PulsingDot）。
* “interactive 工具阻塞输入”的判断逻辑。
* 后台任务 TaskManager。

建议补齐：

##### (A) 统一的状态机（建议）

定义 REPL 顶层状态：

* `Idle`
* `AssistantStreaming`
* `ToolRunning(interactive=false)`
* `ToolRunning(interactive=true)`
* `ApprovalPending`
* `DiffReviewPending`
* `BackgroundTaskRunning`
* `ErrorState(recoverable)`

##### (B) 必备 UI 组件（落点建议）

* `src/components/diagnostics/StatusPanel.tsx`（/status）
* `src/components/diagnostics/DoctorPanel.tsx`（/doctor）
* `src/components/diff/DiffViewer.tsx`（/diff + apply/reject）
* `src/components/approvals/ApprovalPrompt.tsx`（统一审批）
* `src/components/tasks/TaskList.tsx`（/tasks）

##### (C) 性能策略（可落地）

* Assistant stream：节流（每 50-100ms 刷一次）
* Tool output：超过 N 行默认折叠 + “展开更多”
* `/compact`：把历史 messages 摘要化并归档（本地存 `.formax/history/`）

---

## 4) 最后给你

### 4.1 我最建议你下一步先做的 Top 10（只从“交给别人可用”出发）

1. **P0-1 首次启动向导**（缺 key/缺配置时不崩溃）
2. **统一配置系统 + config show**（让“到底用了什么配置”一眼可见）
3. **login/status/logout**（摆脱 env 配置，降低门槛）
4. **默认安全策略落地**：network off、workspace-write、approval on-request
5. **统一 ApprovalService**（别再每个 tool 各写各的弹窗）
6. **/doctor + --bundle（脱敏）**（可维护性的分水岭）
7. **/status**（可观测性：profile/model/policy/工具/任务）
8. **Patch 工作流雏形**：先做“改动队列 + /diff + /apply”（哪怕 ApplyPatch 先简单）
9. **规则文件与记住选择**（让用户别每次点确认；同时可审计）
10. **对外发布骨架**：`formax --help/--version` + 最小 npm bin（否则无法“交付”）

---

### 4.2 你应该再提供哪些材料，才能把【推测】变成【证据】

下面清单能显著提升“Codex CLI 细节对齐”的证据质量（尤其是 sandbox/patch/diagnostics 的实现细节）：

#### (A) 运行 Codex CLI 的可复现轨迹（最重要）

1. `codex --version` 输出截图/复制文本
2. `codex login` 全流程（包括配置文件位置、生成了哪些文件）
3. `~/.codex/` 目录树（脱敏后）：尤其是 `config.toml`、`rules/`、`prompts/`、`skills/`
4. 分别在三种 sandbox_mode 下尝试：

   * 写出工作区（例如写到 `~/tmp`）
   * 联网（curl 或内置 web tool）
   * 运行危险命令（例如 `rm -rf` 的拒绝提示）
     收集终端输出/日志
5. `/status`、`/diff`、`/feedback` 的实际输出截图/文本

#### (B) Codex repo 里你关心的具体文件（你可以直接贴出来）

如果你能从 GitHub 打开并复制这些文件内容（不需要全部仓库）：

* `apply_patch` 指令文档全文（你现在只给了搜索片段）
* sandbox/approval 相关文档/实现文件
* rules 默认规则文件（`default.rules`）样例

#### (C) Formax 侧补充材料（能让路线图更“贴地”）

1. 你计划支持的 provider 列表（OpenAI/Anthropic/自建网关？）
2. 目标用户（个人/团队/企业）与默认安全要求（是否允许默认联网）
3. 你希望的发布方式（npm/binary/homebrew）与目标平台（win/mac/linux）

---

### 4.3 5 个高质量后续提问模板（节省你的提问次数）

1. **“请基于我提供的 Codex 实际运行日志/目录树，逐条把你之前标【推测】的点改成【证据】并修订路线图。”**
2. **“请你为 Formax 的 ApplyPatch 设计一套 patch 语法与错误码，并给 20 个 golden tests 用例（输入+期望输出）。”**
3. **“请你把 ApprovalService + PolicyEngine 的接口定下来（TS types），并给出从 Bash/Write/Edit/Net 工具接入的最小改动 diff。”**
4. **“请你写一份面向企业 IT 的 Formax 安全部署指南：默认策略、规则管理、脱敏日志、离线模式。”**
5. **“请你把插件 manifest 方案落到一个可实现的 loader：目录结构、冲突处理、权限裁剪、版本管理。”**

---

## 5) 附加输出（按你要求：全部给出）

> 说明：以下 Quick Start / config / doctor 输出，是“面向最终可交付产品”的版本；你现在 repo 还没完成发布链路与 config 加载，我会在文案里明确区分“当前可做的开发态运行”与“目标产品态运行”。

---

### 5.1 面向普通用户的 QUICK START

#### 安装

**目标产品态（建议）**

```bash
npm install -g formax
# 或
brew install formax
```

**当前开发态（基于你 repo 现状线索）**

> 你 repo 有 `npm run tool-examples` 之类脚本提示（tool-examples entrypoint 注释）。
> 一般流程会是：

```bash
git clone <your_repo>
cd <your_repo>
npm install
npm run build
npm run cli
```

（具体脚本名需要你补充 package.json 才能写死。）

#### 首次配置（目标产品态）

```bash
formax
# 会自动进入 Setup Wizard
```

向导会问：

1. 选择 Provider（OpenAI / Anthropic / Custom）
2. 输入 API Key（或选择登录）
3. 选择模型（默认推荐一个）
4. 是否允许联网（默认：关闭）
5. 是否启用“自动批准”（默认：否）

完成后会写入：

* `~/.formax/config.toml`
* `~/.formax/auth.json`（或 keyring）

#### 第一次对话

```text
> formax
Formax is ready. Type /help for commands.

You: 帮我总结一下这个仓库的入口文件
Formax: ...
```

#### 常见错误与修复

* **提示：缺少 API Key**
  运行：`formax login` 或 `formax`（重新进入向导）
* **401 Unauthorized**
  运行：`formax auth status` 检查 key；必要时 `formax logout && formax login`
* **baseUrl 不通 / timeout**
  运行：`formax doctor` 看网络/代理建议
* **模型不存在**
  运行：`formax config set model <name>` 或在向导重新选择
* **写权限不足**
  运行：`formax doctor` 会指出不可写目录；把 workspace 设到可写路径或调整 sandbox_mode

---

### 5.2 一份 config 文件示例（含字段说明与默认值）

> 建议：`~/.formax/config.toml`（全局）
> 项目内可选：`<repo>/.formax/config.toml` 覆盖部分字段

```toml
schema_version = 1

# 当前使用的 profile 名
active_profile = "default"

[profiles.default]
provider = "anthropic"         # "openai" | "anthropic" | "custom"
model = "claude-sonnet-4-5"    # 默认模型
base_url = ""                  # 可选：自建网关；空表示官方默认
timeout_ms = 300000            # 请求超时（ms）

# 凭证引用方式：
# - "keyring": 优先（推荐）
# - "file": 写到 ~/.formax/auth.json（需 600 权限）
auth_store = "keyring"
auth_key_id = "default"        # keyring / auth.json 里的条目名

[policy]
approval_policy = "on-request" # "untrusted" | "on-request" | "on-failure" | "never"
sandbox_mode = "workspace-write" # "read-only" | "workspace-write" | "danger-full-access"
network = "off"                # "off" | "on"

# workspace root：为空则自动探测 git root，否则用当前 cwd
workspace_root = ""

# 允许写入的路径（相对 workspace_root）；workspace-write 模式下默认只允许这些
write_allowlist = [
  ".",
  ".formax/**",
]

# 显式禁止写入的路径（无论什么模式）
write_denylist = [
  ".git/**",
  ".ssh/**",
]

# shell 命令策略（MVP）
[shell]
# "inherit" 会把当前环境变量带进子进程；默认建议 "minimal"
environment_policy = "minimal"
# minimal 时仍允许的 env 变量
env_allowlist = ["PATH", "HOME", "TMPDIR"]

[logging]
level = "info"                 # "debug" | "info" | "warn" | "error"
dir = "~/.formax/logs"
max_files = 10
max_size_mb = 5

[paths]
# 插件/命令/技能目录（支持全局 + 项目覆盖）
commands_dir = "~/.formax/commands"
prompts_dir = "~/.formax/prompts"
skills_dir = "~/.formax/skills"
plugins_dir = "~/.formax/plugins"
rules_dir = "~/.formax/rules"
```

---

### 5.3 一份 /doctor 输出示例（成功与失败各 1）

#### 成功示例

```text
$ formax doctor

Formax Doctor Report (v0.3.0)
────────────────────────────
✅ Config: OK (~/.formax/config.toml, schema_version=1)
✅ Active profile: default (provider=anthropic, model=claude-sonnet-4-5)
✅ Auth: OK (keyring: default)
✅ Network: OFF (policy.network=off)
✅ Sandbox: workspace-write
✅ Workspace root: /Users/alice/projects/myrepo
✅ Write allowlist: [".", ".formax/**"]
✅ Tools: loaded 14 tools (tools.json OK)
✅ Logs: writable (~/.formax/logs)

Next steps:
- Run `formax` to start chatting.
```

#### 失败示例（缺 key + baseUrl 不通 + 配置版本过旧）

```text
$ formax doctor

Formax Doctor Report (v0.3.0)
────────────────────────────
❌ Config: INVALID
   - schema_version missing (expected 1)
   - profiles.default.provider missing

❌ Auth: MISSING
   - no key found for auth_key_id="default"
   Fix: run `formax login` or `formax` (setup wizard)

❌ Connectivity: FAILED
   - base_url=https://proxy.example.com
   - error=timeout after 3000ms
   Fix:
   1) Check VPN / proxy settings
   2) Try `formax config set profiles.default.timeout_ms 300000`
   3) Run `curl https://proxy.example.com/health`

✅ Logs: writable (~/.formax/logs)

Suggested command:
- `formax config migrate`
```

---

### 5.4 “错误提示文案清单”（至少 15 条）

> 目标：每条都要包含「发生了什么」+「你可以怎么修」+「相关命令」。

1. **E_AUTH_MISSING**：未检测到 API Key。运行 `formax login` 或重新运行 `formax` 进入向导。
2. **E_AUTH_401**：认证失败（401 Unauthorized）。请确认 key 正确；运行 `formax auth status`。
3. **E_AUTH_FORBIDDEN**：权限不足（403）。该 key 无权访问此模型/资源。
4. **E_MODEL_NOT_FOUND**：模型不存在或不可用。运行 `formax config show` 确认 model 字段；更换模型后重试。
5. **E_BASEURL_UNREACHABLE**：baseUrl 无法连接。检查网络/VPN/代理；运行 `formax doctor` 获取更多信息。
6. **E_TIMEOUT**：请求超时。可提高 `timeout_ms` 或检查网络质量。
7. **E_CONFIG_INVALID**：配置文件格式错误或缺字段。运行 `formax config show` 查看解析错误；或 `formax config migrate`。
8. **E_CONFIG_VERSION_TOO_NEW**：配置版本高于当前 CLI。请升级 Formax。
9. **E_SANDBOX_WRITE_DENIED**：写入被 sandbox 拒绝（路径不在 allowlist）。可改写入目录或更新 allowlist（需审批）。
10. **E_NETWORK_OFF**：当前策略禁止联网。可执行 `/approvals`（或 `formax config set policy.network on`）并确认风险。
11. **E_SHELL_DENIED**：命令被策略拒绝（例如 sudo / mkfs / root rm）。如果你确信需要，请切换 `--yolo`（危险）。
12. **E_APPROVAL_REJECTED**：用户拒绝了本次操作。你可以输入原因或更小的变更再试。
13. **E_PATCH_CONFLICT**：补丁冲突（文件已变化）。请先 `Read` 最新内容，再生成更小 patch。
14. **E_FILE_NOT_FOUND**：文件不存在。检查路径是否正确（建议使用绝对路径或 workspace 相对路径）。
15. **E_PATH_NOT_ABSOLUTE**：路径必须为绝对路径。示例：`/Users/alice/project/file.ts`（并提示 Try: ...）。
16. **E_TOOL_NOT_FOUND**：工具未注册或被禁用。运行 `/status` 查看已加载工具。
17. **E_PLUGIN_PERMISSION**：插件请求的权限超出允许范围。请在规则中显式允许或卸载插件。
18. **E_LOG_WRITE_FAILED**：无法写入日志目录。请检查磁盘权限或设置 `logging.dir`。

---

### 5.5 “最小实现 PR 切分计划”（PR1/PR2/PR3…）

> 目标：每个 PR 都可独立合并、可验收、可回滚。

#### PR1：配置加载骨架 + config show

* **目标**：把“配置读取/合并/展示”做成产品骨架
* **改动目录**：

  * 新增：`src/config/schema.ts` `src/config/load.ts` `src/config/merge.ts`
  * 修改：`src/utils/config.ts`（改为调用新配置系统）
  * 新增 CLI 命令：`src/cli/commands/configShow.ts`
* **验收标准**：

  * `formax config show --effective` 工作
  * 错误配置能报出字段级错误
  * 敏感字段脱敏

#### PR2：login/status/logout + auth store

* **目标**：陌生用户不需要 env 就能用
* **改动目录**：

  * 新增：`src/auth/*`
  * 修改：`src/env/config.ts`（从 auth store 获取 key，兼容 env）
* **验收标准**：

  * `formax login` 后可进入 REPL 并成功请求
  * `formax auth status` 能区分 401/超时/OK

#### PR3：Setup Wizard（首次启动）

* **目标**：无配置也能启动并引导
* **改动目录**：

  * 修改：`src/entrypoints/cli.tsx` 增加 `ensureConfigured()` 
  * 新增：`src/config/wizard/*`
* **验收标准**：

  * 全新环境运行 `formax` 必进向导
  * 向导完成自动写 config + auth

#### PR4：ApprovalService 统一拦截（网络 + 写文件）

* **目标**：统一审批策略，先覆盖 net/fs
* **改动目录**：

  * 新增：`src/policy/ApprovalService.ts`
  * 修改：WebFetch/WebSearch/Write/Edit/NotebookEdit 在执行前调用审批
* **验收标准**：

  * network=off 时 WebFetch/WebSearch 必拒绝并提示如何开启
  * write 超出 allowlist 必拒绝

#### PR5：/doctor + --bundle（脱敏）

* **目标**：可维护性落地
* **改动目录**：`src/diagnostics/*`、`src/cli/commands/doctor.ts`
* **验收标准**：

  * doctor 输出包含 actionable steps
  * bundle 可生成且脱敏可测

#### PR6：变更队列 + /diff（先展示不应用）

* **目标**：让用户能看到改动（哪怕暂时仍直接写盘）
* **改动目录**：`src/changes/*`、`src/components/diff/*`、命令 `/diff`
* **验收标准**：

  * 任意写操作能生成 diff 并展示

#### PR7：ApplyPatch 工具 + /apply

* **目标**：补丁式落盘 + 原子写 + 回滚
* **改动目录**：`src/tools/modules/applyPatch/*`、`src/patch/*`
* **验收标准**：

  * patch 冲突不落盘
  * 支持 undo（至少一次）

#### PR8：规则文件持久化 + execpolicy check

* **目标**：记住选择，策略可审计
* **改动目录**：`src/policy/rules/*`、`src/cli/commands/execpolicy.ts`
* **验收标准**：

  * “总是允许此目录写入”可持久化并生效
  * execpolicy 能解释命中规则

---

如果你愿意，我下一步最有价值的输入是：**你实际跑一次 Codex CLI**，把 `~/.codex/`（脱敏）目录结构 + `/status` + `/diff` + 一次 sandbox 拒绝输出贴出来；这样我就能把上面所有与 Codex 相关的【推测】几乎全部变成【证据】，并把 Formax 的策略/文案/UX 对齐到更接近“可交付产品”的水准。
