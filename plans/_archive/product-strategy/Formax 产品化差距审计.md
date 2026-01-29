────────────────────────────────────────────────────────
0) 你认为 Formax 现在处于什么产品阶段 + 3 句关键结论
────────────────────────────────────────────────────────

我认为 **Formax 目前处于“开发者向 MVP / 高完成度 Demo（核心交互可用，但尚不可直接交付陌生用户）”阶段**：REPL + 工具调用 + Plan/AcceptEdits 等核心交互已经跑通，但“首次使用/配置/诊断/安全边界/发布维护”这些产品化必需件仍缺口较大。

1. **最大交付阻塞点是配置与凭证**：当前主要靠环境变量（如 `FORMAX_API_KEY` / `FORMAX_BASE_URL`），缺少“首次启动向导、配置文件、profile、凭证安全存储、连接测试与错误引导”，陌生用户很难 15 分钟跑通。`/status`、`/doctor` 也已列为内置命令但仍未实现。
2. **安全能力“有骨架但缺边界”**：你已经实现了 Bash/Edit 的交互审批与“记住本次选择”的机制（`approve_remember`）以及 plan/acceptEdits 模式切换（Shift+Tab），这是很好的底座；但 Read/Glob/Grep 等文件读取与搜索目前可对任意绝对路径生效，缺少“工作区目录白名单/额外目录授权/网络访问域名白名单”等产品级权限边界。
3. **可维护/可发布体系尚未成型**：CLI 层几乎只有 REPL，缺少 `--help`、子命令（setup/config/doctor）、版本与升级策略、诊断包导出、日志与脱敏策略、文档与 FAQ；此外 repo 内存在“文档/状态记录与运行时代码不一致或仅作参考”的情况（比如 `system-prompts/` 明确不在运行时加载），需要把“真相来源”收敛到一套稳定的配置/诊断/文档链路上。

---

────────────────────────────────────────────────────────

1. 产品化差距总表（至少 30 行）
   ────────────────────────────────────────────────────────

> 说明：
>
> * Claude Code 的“具体行为/命令/默认值”尽量引用官方文档来源；无法确认的会标【推测】并说明依据。
> * Formax 当前状态引用你 repo 中的路径/片段（来自 repomix），并标注“已/部分/缺失”。

| 能力点                              | Claude Code 的做法（来源URL；没把握标【推测】）                                                                                     | Formax 当前状态（已/部分/缺失 + 文件路径）                                                                                       | 用户痛点/风险                                        | 建议（MVP 实现步骤）                                                                             |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- | ---------------------------------------------------------------------------------------- |
| A1 安装/首次启动路径                     | 提供明确的安装与“快速开始”文档；安装后可运行 `claude` 进入交互模式；官方强调“自动保持最新状态/更新”。                                                          | **部分**：README/概览里有 `bun run ...` 的开发启动方式与环境变量说明；但缺少“普通用户安装方式”。（例如 overview 中提到 `bun run src/entrypoints/cli.tsx`） | 陌生用户不知道怎么装、怎么跑；只能按开发者方式运行，门槛高                  | P0：提供 npm 包（bin）或单文件二进制；README 给 3 行 QuickStart（安装→setup→首次对话）                           |
| A2 首次运行引导（缺 key 自动进入向导）          | 文档提示首次运行需要完成认证/登录（例如 Claude.ai 或 API key 相关），并提供故障排查。                                                               | **缺失**：当前只从 env 读 `FORMAX_API_KEY` 等，不存在交互式 wizard；缺 key 时不会给“下一步指令”，只会在 API 调用时报错。                           | “第一次就卡死”：用户看到 HTTP 错误但不知道怎么修                   | P0：启动时 `ensureCredentials()` 检测缺失→触发 `runSetupWizard()`（输入 key 不回显、测试连通、写配置）             |
| A3 配置优先级/作用域                     | Claude Code 有“设置作用域与优先级”概念：企业/托管设置、CLI 参数、项目设置、用户设置等（文档列出 precedence）。                                              | **缺失**：目前没有统一配置系统；env 是唯一来源；`src/utils/config.ts` 只是返回默认对象且“不从磁盘加载”。                                              | 配置不可追溯、不可迁移、不可诊断；多人协作时无法项目级覆盖                  | P0：实现 `resolveRuntimeConfig(flags, env, configFile)` 并定义优先级表（见第 3 节）                     |
| A4 Provider/Model/Base URL 的统一入口 | Claude Code 支持通过 CLI flags 与设置文件配置 model、provider、base URL（例如 CLI reference 描述多选项；LLM gateway/设置相关文档）。              | **部分**：env 支持 `FORMAX_BASE_URL`/`FORMAX_MODEL`；但 CLI flag 与配置文件缺失。                                         | 用户想用代理/本地网关时，只能改 env；无法 profile 化              | P0：新增 `--provider/--model/--base-url/--profile`；落盘配置；支持 per-profile 覆盖                   |
| A5 终端多行输入/键绑定引导                  | Claude Code 有 `/terminal-setup` 来安装终端键绑定/设置以支持多行输入（文档）。                                                             | **缺失**：Formax 目前没有 /terminal-setup；命令 registry 标记该命令为未实现。                                                         | 用户在不同终端下输入体验不一致；无法引导 Shift+Enter 等             | P1：实现最小 `/terminal-setup`：只输出“如何开启多行/粘贴模式”的手册（先不改系统）                                     |
| B1 凭证安全存储                        | Claude Code 侧强调安全存储：例如 macOS 使用 Keychain；也支持 `apiKeyHelper` 脚本以动态获取 key；并支持刷新/过期策略（IAM/credential 文档）。              | **缺失**：只通过 env 注入 key；没有 Keychain/Keytar；也没有“从外部 helper 获取”的接口。                                                   | 用户把 key 写进 `.env` 或 shell history；泄露风险高；无法企业集成 | P1：引入 keytar（可选依赖）→优先 OS 密钥库；否则 `~/.config/formax/credentials.json`（0600）                |
| B2 key 脱敏显示与日志脱敏                 | Claude Code 文档提到隐私设置/日志等（/privacy-settings、sentry 等端点在网络文档出现）；同时诊断/错误通常不会直接回显完整 key。                                | **缺失**：没有统一 `redactSecrets`；也没有日志系统策略（默认是否记录/记录哪些）。当前还默认启动 console logger（见 A?）。                                  | 用户贴 log 给你/issue 时可能把 key/路径/项目内容一起泄露          | P0：实现 `redactSecrets(text)` 并在所有错误/日志/诊断输出走脱敏；默认不记录 prompt 全量                            |
| B3 多 provider credential 管理      | Claude Code 支持与企业/网关/不同认证方式结合（LLM gateway、managed settings、env）。                                                    | **缺失/未来**：当前 runtime 只有 Anthropic；README 里提到 openai 的痕迹可能已过期（需清理）。                                                | 未来扩展 provider 时会推翻现有 env 设计；用户迁移痛苦             | P0：先把 schema 设计成 providers map；即使只实现 anthropic，也把接口抽象好                                   |
| C1 `/status`                     | Claude Code 有 `/status`（slash commands 文档列出；用于显示状态/版本等）。                                                            | **缺失**：内置命令表里 `/status` 标为 `implemented: false`。                                                                  | 用户无法自助确认当前 provider/model/baseUrl/配置路径/权限模式    | P0：实现 `/status` 与 `formax status`（同一套底层函数）                                               |
| C2 `/doctor` 健康检查                | Claude Code 提供 `claude doctor`（setup 文档提到），slash commands 也有 `/doctor`；用于安装与设置诊断。                                   | **缺失**：命令表里 `/doctor` 未实现。                                                                                        | 常见失败（DNS/401/timeout/代理）完全靠猜                   | P1：实现 /doctor（网络连通性+鉴权+写权限+依赖版本+建议）+ `--json` 输出                                         |
| C3 导出诊断包                         | Claude Code 有 /bug 入口引导报告问题（troubleshooting 里提到）。                                                                   | **缺失**：无 debug bundle；无一键收集系统信息/配置/日志                                                                             | 用户/你在 issue 沟通成本巨大；难复现                         | P1：`formax doctor --bundle <path>`：zip + 脱敏 config + 最近 log + 环境信息                       |
| D1 CLI `--help`/命令发现             | Claude Code 有清晰 CLI 与 slash commands（/help、/config 等），并提供交互模式快捷键文档。                                                 | **部分**：REPL 内 `/help` 已实现（registry dispatch），并能列出命令；但**没有**外层 CLI help/子命令体系。                                     | 用户不知道 `formax` 还能做什么；也无法脚本化/CI 使用              | P0：引入 commander/yargs；实现 `formax --help`, `formax setup`, `formax doctor`, `formax repl` |
| D2 交互快捷键/历史搜索                    | Claude Code 交互模式有快捷键说明：如 Ctrl+R 反向搜索历史、Ctrl+O 切 verbose、Shift+Tab 切权限模式等。                                           | **部分**：Shift+Tab 切 mode 已实现（ModeIndicator 提示）；但历史搜索/verbose toggle 等未知/缺失。                                        | 长会话可用性差；用户无法快速找回命令                             | P2：实现输入历史与 Ctrl+R 搜索；Ctrl+O 切日志级别（仅 UI 层）                                                |
| D3 错误提示质量                        | Claude Code troubleshooting 文档给出典型错误的解释与解决方式。                                                                       | **缺失**：StreamClient 对非 2xx 直接抛 `HTTP status: ...`；没有 401/timeout 的分流提示（需补）。（StreamClient 行为需你 repo 证据；此处不展开）      | 用户看到 raw HTTP 错误，不知道下一步                        | P0：实现 `mapApiErrorToUserMessage(err)`；输出“原因+下一步+诊断命令”                                    |
| E1 权限模式（plan/auto-accept）        | Claude Code 有 permission modes（normal / auto-accept / plan），并支持 Shift+Tab 切换；CLI flag `--permission-mode plan` 也存在。 | **已**：你实现了 `normal -> acceptEdits -> plan` 模式循环（Shift+Tab 提示与逻辑）。                                                 | 这是优势：能减少频繁确认；适合 power user                     | P0：把 mode 写进 /status；并允许 config 中设置默认 mode                                               |
| E2 Bash 危险命令确认/记住选择              | Claude Code 有权限提示与“不要再问”（permission rules + UI）。                                                                    | **已/部分**：Bash tool 有 `approve_remember` 分支并基于 `cwd::command` 记忆批准（仅内存）。                                           | 会话重启后失效；无法形成长期安全策略                             | P1：把 remember 规则落盘（按 profile + project root）并支持通配符规则                                     |
| E3 Edit 写文件确认/Auto-accept        | Claude Code 在 auto-accept / plan mode 下行为不同；并强调权限管理。                                                                | **已/部分**：Edit tool 默认需要用户确认；acceptEdits 模式下可自动批准；plan 模式限制只允许改 plan 文件并返回提示信息。                                    | 写文件权限缺少“目录白名单/工作区边界”；model 仍可写到任意绝对路径（如果传入）    | P1：引入 allowedDirs，Edit/Write 只能在 allowedDirs 内；超出需 /add-dir                              |
| E4 文件读取权限边界                      | Claude Code 通过“工作目录 + additional directories”控制可访问路径，CLI 有 `--add-dir`。                                             | **缺失**：Read/Glob 等只要求绝对路径，不限制目录；`requireAbsolutePath` 仅做绝对路径校验。                                                   | 安全隐患：模型可读取 `~/.ssh` 等敏感文件；用户不知情                | P0/P1：默认仅允许 cwd（或 repo root）内读；提供 /add-dir 与配置白名单                                        |
| E5 网络访问权限/域名白名单                  | Claude Code sandboxing 文档提到网络隔离与域名限制机制。                                                                             | **缺失**：webFetch/webSearch 没有权限提示或 allowlist；默认直接发起网络请求（工具里）。                                                      | 可能泄露内网/敏感 URL；也可能误访问恶意站点                       | P1：新增 net policy：首次访问新域名提示“允许一次/总是允许/拒绝”并落盘                                              |
| F1 会话恢复 `/resume`                | Claude Code slash commands 有 `/resume`（恢复对话）。                                                                       | **缺失**：没有对话持久化/恢复命令（registry 未实现）。                                                                                | 用户中断后上下文丢失                                     | P2：最小实现：把每次对话写 JSONL；`/resume <id>` 读取并加载到消息列表                                           |
| F2 导出会话 `/export`                | Claude Code slash commands 有 `/export`（导出会话）。                                                                       | **缺失**：无导出；只能复制终端输出                                                                                               | 用户无法把会话交给同事/提 issue                            | P1：`/export` 输出 Markdown/JSON；默认脱敏路径与 key                                                |
| F3 压缩上下文 `/compact`              | Claude Code 有 `/compact`（troubleshooting 中提到相关行为）。                                                                  | **缺失**：没有“压缩/总结并替换历史”的机制；只有 prompt profile 切换（dev 功能）。                                                            | 长会话容易超 token/变慢                                | P2：实现 `/compact`：调用模型生成摘要→替换历史，保留关键引用                                                    |
| G1 流式输出与长输出控制                    | Claude Code 交互模式有 verbose toggle（Ctrl+O）等。                                                                          | **部分**：有 streaming；但缺少“长输出折叠/截断/复制友好”策略；也无 Ctrl+O 控制。（需你再确认 UI）                                                   | 长输出刷屏；难回溯                                      | P1/P2：实现“折叠块/分页/复制提示”；加 `--no-stream`/`--json`                                           |
| G2 重试/超时/网络健壮性                   | Claude Code troubleshooting 给出网络代理与常见失败排查；并有 `claude doctor`。                                                       | **部分/缺失**：有超时参数（env里 `FORMAX_TIMEOUT_MS`），但错误提示与重试策略弱。                                                            | 网络抖动直接失败；用户不知道该等还是重试                           | P1：统一 fetch 包装：超时/重试（幂等接口）+ 指数退避 + 友好错误                                                  |
| H1 自定义 slash commands            | Claude Code 支持自定义 slash commands（官方文档）。                                                                             | **已**：你支持 `.claude/commands/*.md` 与 `~/.claude/commands/*.md` 加载为命令，并参与 `/` 补全。                                   | 这是优势；但缺少“参数/作用域/权限声明”                          | P1：为命令加 frontmatter（name/args/needsTools）并在执行前做权限检查                                      |
| H2 插件/生态                         | Claude Code 有 plugins 体系与 reference 文档，并支持 MCP server（插件/扩展）。                                                       | **缺失/部分**：Formax 的扩展目前主要靠 tool modules 与 commands；无插件安装/版本管理                                                      | 扩展靠 fork；难形成生态                                 | P2：定义 plugin manifest（npm 包或本地目录）+ capability registry                                   |
| H3 Subagents / Task tool         | Claude Code 支持 subagents/Task（文档）。                                                                                  | **已/部分**：你有 `.agent/subagents/*.md`（subagent 配置），并有 Task tool 与 executor 的 agentDepth/allowTools 限制。              | 子代理可用但缺少“资源限制/日志/可观测性”                         | P1：为每个 subagent 记录任务摘要、耗时、工具调用；加入 /tasks 详情导出                                            |
| I1 版本号/升级                        | Claude Code 有 `claude update`（setup 文档提到），且文档强调保持最新。                                                                | **缺失**：无 `formax version/update`；发行链路不明                                                                           | 用户无法判断是否最新；难支持                                 | P0：`formax --version`；P1：`formax upgrade`（提示 npm/bun 升级方式）+ changelog                    |
| I2 发布产物                          | Claude Code 提供可安装的官方 CLI（多安装方式见文档/概览）。                                                                              | **缺失**：当前以 bun dev/run 为主；没有 npm package / binary 发布策略                                                            | 陌生用户无法“拿来即用”                                   | P0：npm 包（带 dist）是最现实；P2：提供 bun compile 二进制                                               |
| J1 用户级 QuickStart/FAQ/排障         | Claude Code 有 Quickstart、Troubleshooting、Network configuration 等文档体系。                                               | **部分**：有 overview 与一些 STATUS/PORTING 文档，但面向用户的“15 分钟跑通”缺失，且部分文档是“参考快照/不加载”。                                       | 用户读不懂/读了也跑不通；你支持成本高                            | P0：新增 `docs/quickstart.md` + `docs/troubleshooting.md` + `docs/security.md`，并保证与代码一致     |
| J2 “真相来源”一致性                     | Claude Code 文档与行为一致；配置文件位置/命令在 troubleshooting 里明确。                                                                 | **风险**：你明确指出 `system-prompts/` 是参考快照，运行时以 `src/prompts/system.ts` 为准；但整体上仍需让“用户文档→代码→诊断输出”一致。                     | 用户按文档做却失败；维护成本暴涨                               | P0：所有用户文档只引用“运行时真相路径”；诊断 `/status` 输出 config path 与版本，作为唯一对齐点                            |

> 上表已覆盖并超过 30 行（且覆盖 A-J 类别）；后续章节会把每条建议落成“可执行路线图 + 规格说明”。

---

────────────────────────────────────────────────────────
2) “可交付产品”的 P0/P1/P2 Roadmap（非常具体）
────────────────────────────────────────────────────────

下面的 Roadmap 以“交付陌生用户”为目标，优先解决：**首次使用、配置、诊断自救、安全边界、日志与隐私、分发升级**。
（你强调的 lite/full prompt 是开发者调试开关，不作为 Claude Code 对齐目标；我会把它留在“开发者模式/调试功能”里，不强制产品化。）

---

## P0（交付门槛）：15 分钟内跑通并完成一次有效对话（含配置）

### P0-1：CLI 外壳成型（help / version / setup / repl）

**用户故事**

> “我第一次拿到 Formax（repo 或二进制），不知道怎么启动。希望 `formax --help` 能告诉我怎么配置、怎么进入聊天、怎么跑诊断。”

**设计决策**

* 默认行为：`formax` 进入 REPL（等价 `formax repl`）。
* 子命令最少集：`setup | repl | doctor | status | config | version`。
* 所有命令都支持 `--profile`（默认 `default`）。
* 不把用户淹没：P0 只做 anthropic provider；但 schema 先预留 providers 结构。

**MVP 步骤**

1. 新增 `src/cli/`：命令解析（建议 commander）。
2. 新增 `src/entrypoints/main.ts` 作为 bin 入口：解析 args → 调用 `runRepl()`/`runDoctor()` 等。
3. 把现有 REPL 启动逻辑从 `src/entrypoints/cli.tsx` 抽成 `src/repl/runRepl.tsx`（或保留但改为可传入 ResolvedConfig）。
4. 实现 `formax --help`（自动生成）与 `formax --version`（读取 package.json 版本）。
5. `formax setup` 调用配置向导（见 P0-2）。
6. `formax repl`：启动 REPL 前调用 `ensureConfiguredOrWizard()`。
7. `formax status`：打印状态（见 P0-4）。
8. `formax doctor`：先给最小骨架（见 P1 完整）。

**关键落点文件/模块（Formax 路径）**

* 新增：`src/cli/index.ts`、`src/cli/commands/*.ts`、`src/entrypoints/main.ts`
* 修改：`src/entrypoints/cli.tsx`（抽逻辑或改名）、`package.json` bin 指向
* 复用：REPL UI `src/screens/REPL.tsx`（已有）

**验收标准（DoD）**

* `formax --help` 输出包含：安装后第一步（setup）、配置来源说明、常见错误提示。
* `formax --version` 输出 `formax x.y.z`。
* `formax repl` 在缺 key 时不会直接报 HTTP 错，而是进入 setup wizard。

**安全与隐私注意点**

* `--api-key` flag 若提供：提示“可能写入 shell history，不推荐”，并允许 `--api-key-stdin` 替代。
* `--help` 不展示任何用户配置值。

**测试建议**

* 手测脚本：在全新 HOME（临时目录）运行：`formax --help`、`formax repl`、`formax setup`。
* 自动化：CLI snapshot tests（vitest）验证 help/version 输出固定片段；参数解析单测。

---

### P0-2：配置系统 MVP（落盘 + 优先级 + profile）

**用户故事**

> “我希望不用看源码/环境变量说明，也能完成 API key/base URL/model 的配置，并且下次启动自动生效。”

**设计决策**

* 配置文件默认使用 **XDG**（Linux/macOS）与 Windows 对应目录；单文件配置（JSONC）+ 单独的 credentials store（可选）。
* 支持多 profile：`default/work/personal`。
* 优先级：CLI flags > env > config file > defaults（详见第 3 节）。
* P0 不做 Keychain，先做安全的文件权限（0600）+ 明确告警；Keychain 放 P1。

**MVP 步骤**

1. 新增 `src/config/paths.ts`：计算 config 路径。复用你现有 `src/utils/env.ts` 里对 `XDG_CONFIG_HOME` 的逻辑（它已经定义 `FORMAX_CONFIG_DIR` 与 `FORMAX_CONFIG_FILE`）。
2. 新增 `src/config/schema.ts`：TypeScript types + zod 校验（或手写校验）。
3. 新增 `src/config/load.ts`：读取 config file（不存在返回空）→ validate → migrate。
4. 新增 `src/config/resolve.ts`：merge flags/env/config/defaults，输出 `ResolvedConfig`。
5. 新增 `src/config/save.ts`：写 config file（确保目录存在、权限 0700/0600）。
6. 修改 `src/env/config.ts`：逐步弃用“只读 env 的 RuntimeConfig”，改为调用 `resolveRuntimeConfig()`；保留 env override 兼容。你当前 `loadRuntimeConfig` 只读 env（`FORMAX_API_KEY` 等）。
7. 修改 `src/entrypoints/cli.tsx`（或新的 `runRepl`）：从 `ResolvedConfig` 注入 `apiKey/baseUrl/model/timeout`。
8. 在 `/status` 输出“config path / profile / provider / model / baseUrl（脱敏）”。

**关键落点文件/模块**

* 现有：`src/env/config.ts`（当前 runtime config）
* 现有：`src/utils/env.ts`（已有 config 路径定义，可复用）
* 新增：`src/config/*`（详见第 3 节规范）

**验收标准（DoD）**

* 第一次运行：创建 `~/.config/formax/config.json`（示例路径）且权限正确。
* 允许 `FORMAX_PROFILE=work` 或 `--profile work` 切换配置。
* 允许 `--model` 覆盖并在 /status 中可见。

**安全与隐私注意点**

* config 中默认不保存明文 apiKey（P0 可以保存在 `credentials.json` 并 0600；或者保存引用 alias）。
* 输出/日志必须调用 `redactSecrets()`。

**测试建议**

* 手测：创建 `default` 与 `work` profile，切换后 /status 输出变化。
* 自动化：resolve 优先级测试（flags/env/file），migrate 测试（configVersion）。

---

### P0-3：首次启动 Setup Wizard（交互式）

**用户故事**

> “我运行 `formax` 后，它能一步步问我：用哪个 provider、key、baseUrl、model，并当场测试连通性；失败时告诉我怎么修。”

**设计决策**

* Wizard 触发条件：缺少必需的 provider 凭证（比如 anthropic 的 apiKey）。
* 输入 key 时必须“不回显”；你已经有 `TextInput` 的 `mask` 能力可复用（UI 上可显示 `*`）。
* 连接测试：优先做轻量请求（例如 “list models” 或最小 messages 请求），并把常见错误分类（401/403/DNS/timeout/SSL）。

**MVP 步骤**

1. 新增 `src/config/wizard.tsx`（Ink UI）或 `src/config/wizard.ts`（stdin prompt）。
2. 逐屏流程见第 3.3（必须含失败分支）。
3. 写入配置文件（不写入历史记录）。
4. wizard 完成后自动进入 REPL。

**关键落点文件/模块**

* 新增：`src/config/wizard.tsx`
* 复用：`src/components/ui/TextInput.tsx`（mask 输入）
* 复用/改造：API 客户端（现有 StreamClient 或新增 minimal “ping client”）

**验收标准（DoD）**

* 缺 key 时自动进入 wizard；填完后立刻能发一条“Hello”并收到回复。
* 401 时输出“key 无效或无权限，请检查/重新粘贴”并给出 `formax setup` 再跑一次。

**安全与隐私注意点**

* key 输入不回显；落盘时权限 0600；wizard 日志不记录 key。

**测试建议**

* 手测：模拟错误 key、错误 baseUrl、断网。
* 自动化：wizard 状态机单测（不测 UI）。

---

### P0-4：实现 `/status`（以及 `formax status`）

**用户故事**

> “我想快速确认：当前用了哪个 profile/provider/model/baseUrl，配置文件在哪里，安全模式是否打开，工具权限是什么。”

**设计决策**

* 输出必须可复制：单屏摘要 + 可选 `--json`。
* 不泄露秘密：apiKey 永远脱敏（只显示前 4/后 2 或 hash）。

**MVP 步骤**

1. 在 `src/features/commands/registry.ts` 中把 `/status` 从 `implemented: false` 改为 true，并加 dispatch。你现在 `/status` 明确是未实现。
2. 输出字段见第 4 节（/status 清单）。
3. CLI `formax status` 复用同一输出函数。

**关键落点文件/模块**

* `src/features/commands/registry.ts`（已有 `/status` spec 但未实现）
* 新增：`src/diagnostics/status.ts`

**验收标准（DoD）**

* 在 REPL 输入 `/status` 返回状态文本。
* CLI `formax status` 返回同样内容（无 UI）。

**安全与隐私注意点**

* baseUrl 可显示完整，但路径中如含 token/query 应脱敏。
* cwd 与路径输出可选“脱敏模式”（P1）。

**测试建议**

* snapshot test（固定字段顺序）。

---

### P0-5：默认关闭 Console Logger（只在 debug 打开）

**用户故事**

> “我不希望工具默认开一个本地端口/WS 服务；我只想聊天，不想暴露额外攻击面。”

**证据（当前行为）**
你当前在 REPL entrypoint 里：`const enableLogger = process.env.ENABLE_CONSOLE_LOGGER !== 'false'`，意味着 **默认开启**；并监听端口（默认 `3001`）。

**设计决策**

* 默认关闭：`ENABLE_CONSOLE_LOGGER` 改为默认 off（必须显式 `true` 才开）。
* 或者改为 `FORMAX_DEBUG=1` 统一开 debug 功能。

**MVP 步骤**

1. 修改 `src/entrypoints/cli.tsx`：enableLogger 默认 false。
2. 把端口写入 config `features.consoleLogger`。
3. `/status` 输出 console logger 状态。

**关键落点**

* `src/entrypoints/cli.tsx`（现默认开启）
* `src/utils/consoleLogger.ts`（WS server）

**验收标准**

* 默认运行 `formax repl` 不再监听 3001；只有 `FORMAX_DEBUG=1` 才监听。

**安全与隐私注意点**

* debug server 绑定 `127.0.0.1`；明确提示“不要在不可信机器开启”。

**测试建议**

* 手测：检查端口是否占用；自动化可不做。

---

### P0-6：最小“错误提示文案与修复路径”

**用户故事**

> “遇到 401/timeout/DNS，我希望看到‘原因 + 你现在能做什么’。”

**设计决策**

* 每个错误消息必须包含：

  1. 简短原因（1 行）
  2. 下一步（2-4 条可执行命令）
  3. 提示运行 `formax doctor`（P1 完整，但 P0 先可提示）

**MVP 步骤**

1. 新增 `src/errors/userFacing.ts`：`toUserFacingError(err, ctx)`
2. 在 StreamClient 抛错处包一层：根据 status/text 分类（401/403/404/429/5xx）。
3. 在 REPL 顶层捕获错误，渲染为用户友好提示。

**关键落点**

* REPL 主循环/消息发送处（你当前直接抛 HTTP status 文本的地方需要包裹）。

**验收标准**

* 故意给错 key：输出明确提示“401 认证失败→请运行 formax setup 或设置环境变量…”。

**安全与隐私注意点**

* 错误输出不得包含 Authorization header / key。

**测试建议**

* 单测：输入 fake error object → 输出文案。

---

### P0-7：README/QuickStart 最小闭环（用户向）

**用户故事**

> “我只看 README 就能在 5 分钟内跑起来。”

**设计决策**

* README 第一屏只给：安装 → `formax setup` → `formax` → `/help`。
* 把开发者脚本放到“开发/贡献”章节，不挡住普通用户。

**MVP 步骤**

1. 更新 README：加入 Quick Start（第 10 节我会给草案）。
2. 新增 `docs/troubleshooting.md`（列 10 个常见失败）。
3. 在 `/help` 输出里加入“遇到问题→/doctor→导出 bundle”。（/doctor P1 但先提示）

**关键落点**

* README（当前偏开发者 env/bun 启动）
* `src/features/commands/registry.ts` 的 `/help` dispatch（已存在）

**验收标准**

* 新用户按 README 从零到首次对话不超过 15 分钟。

---

## P1（稳定可用）：诊断/安全/日志/常见失败可自救

### P1-1：完整 `/doctor` + `formax doctor`（含 `--json`、`--bundle`）

（第 4 节会给规格；这里强调 Roadmap）

**用户故事**

> “我失败了但不想问作者：我跑 /doctor 就能知道哪里坏了，并能导出诊断包发 issue。”

**设计决策**

* `/doctor` 输出分组：Network/Auth/FS/Runtime/Deps/Advice。
* `--bundle` 默认生成 zip，脱敏。

**MVP 步骤**

1. 实现 `doctorChecks[]` 可组合。
2. 每个 check 输出：`id, status(ok/warn/fail), message, hint, details`。
3. `/doctor` 渲染为表格 + 结论。
4. `--json` 输出 machine-readable。
5. `--bundle` 收集 config（脱敏）、logs、versions、最近错误栈（脱敏）等。

**关键落点**

* `src/features/commands/registry.ts`（把 `/doctor` 从 false 改为 true）
* 新增 `src/diagnostics/doctor/*`

**DoD**

* 401/DNS/timeout 都能被 doctor 区分并给下一步。

**安全与隐私**

* bundle 里 key 永远 mask；路径可选脱敏。

**测试建议**

* 用 mock server 模拟 401/timeout。

---

### P1-2：权限边界（Allowed Dirs + `/add-dir` + 默认工作区锁定）

**用户故事**

> “我信任它在当前项目里读写，但不希望它读我的 home/ssh。”

**对齐 Claude Code 事实参考**

* Claude Code 有 “additional directories / add-dir” 概念与权限系统（CLI reference / settings）。

**Formax 现状证据**

* `requireAbsolutePath` 仅校验“必须是绝对路径”，不限制目录。

**设计决策**

* 默认 allowedDirs = `[cwd]` 或 `[repoRoot]`（建议 repoRoot：优先找到 `.git` 根）。
* Read/Glob/Grep/Edit/NotebookEdit 等工具统一走路径策略。
* 提供 `/add-dir <path>`（local slash command）与 `--add-dir`（CLI flag）保持一致。

**MVP 步骤**

1. 新增 `src/security/paths.ts`：`isPathAllowed(absPath, allowedDirs)`。
2. 扩展 `ExecutionContext`（`src/tools/types.ts` 或 executor）带 `allowedDirs`。
3. 在 tool executor 前置拦截：若 tool input 包含 path 且不在 allowedDirs → 弹出确认/引导 `/add-dir`。
4. 实现 `/add-dir`：更新 config 的 allowedDirs 并立即生效。
5. `/status` 显示 allowedDirs。

**验收标准**

* 读取 `~/.ssh/id_rsa` 会被拦截并提示“超出工作区，先 /add-dir”。
* 读取项目内文件不提示。

**安全与隐私**

* `/add-dir` 必须显示规范化后的绝对路径并二次确认。

**测试建议**

* 单测：路径规范化、符号链接逃逸（realpath）。

---

### P1-3：权限规则持久化（allow/deny patterns + “记住选择”落盘）

**用户故事**

> “我不想每次都允许 `npm test`，但我也不想全局放开 `bash`。”

**对齐 Claude Code 事实参考**

* Claude Code 有权限规则与“无需重复询问”的机制（IAM/permissions docs）。

**Formax 现状证据**

* Bash tool 支持 `approve_remember`，但仅内存记录 `cwd::command`。

**设计决策**

* 规则格式：`ToolName(pattern)` + 可选 cwd scope；支持 deny 优先。
* 规则存储在 config 的 `permissions` 段。
* UI：提示 “Allow once / Always for this project / Deny”。

**MVP 步骤**

1. 新增 `src/security/permissions.ts`：匹配规则。
2. 将现有 bash approvedKeys 替换为可持久化规则存储。
3. Edit/Write/Network 同样支持 remember。

**验收标准**

* 允许一次 `npm test` 后选择“记住”，重启后仍不再询问。

---

### P1-4：日志系统（默认 off 或最小、可脱敏、可导出）

**用户故事**

> “我需要 debug 时能开日志，但默认不希望记录 prompt 全量。”

**设计决策**

* 默认只记录：时间戳、请求类型、模型、token 统计（若可得）、错误码；不记录 prompt 内容。
* 提供 `--log-level debug` 与 `--log-prompts` 显式开 prompt 记录（强提示风险）。
* 所有日志走 `redactSecrets()`。

**MVP 步骤**

1. 新增 `src/logging/logger.ts`（pino/winston 或自研 JSONL）。
2. 在 API 客户端与 tool 执行处埋点（tool name、耗时）。
3. 在 /doctor bundle 中包含最近 N 行日志。

**验收标准**

* 用户可通过 config 关闭/开启日志；日志不含 key。

---

## P2（体验与生态）：插件/扩展/高级 UX

### P2-1：会话持久化 + `/resume` + `/export` + `/compact`

参考 Claude Code slash commands：`/resume`、`/export`、`/compact`。

最小形态：

* 每次对话存 `~/.config/formax/sessions/<id>.jsonl`
* `/export` 生成 md
* `/resume` 载入历史
* `/compact` 生成摘要并替换历史（只需要一个“摘要消息”保留关键 context）

---

### P2-2：插件系统（本地目录 + npm 包）与能力声明

参考 Claude Code plugins / MCP / hooks 文档体系。

最小形态：

* `~/.formax/plugins/<name>/plugin.json` + `index.js`
* 插件可注册：tools、slash commands、subagents
* `formax plugin list/install/remove`（install 先支持本地路径）

---

### P2-3：交互体验增强（Ctrl+R 历史、Verbose toggle、提示更聪明）

参考 Claude Code interactive mode keybindings。

---

（P2 其余项会在第 8 节 Top10 里合并排序）

---

────────────────────────────────────────────────────────
3) 重点专题：配置系统（规格说明书 / RFC 风格）
────────────────────────────────────────────────────────

> 目标：把配置系统做成“陌生用户可用”的产品级能力。
> 你现有状况：runtime 主要读 env（`src/env/config.ts`）；另有旧的 config 路径定义与 stub（`src/utils/env.ts`、`src/utils/config.ts`）。
> 建议：以 `src/config/*` 作为唯一真相来源，`src/env/config.ts` 退化为 env override 层。

---

## 3.1 配置来源与优先级（必须明确，表格）

### 3.1.1 优先级总表（从高到低）

| 优先级 | 来源                  | 说明                 | 示例                                         |
| --: | ------------------- | ------------------ | ------------------------------------------ |
|   1 | CLI Flags           | 临时覆盖/脚本化；优先级最高     | `formax --profile work --model claude-...` |
|   2 | 环境变量                | CI/容器/临时注入；可覆盖配置文件 | `FORMAX_PROVIDER=anthropic`                |
|   3 | 本地配置文件（Profile）     | 默认长期配置来源           | `~/.config/formax/config.jsonc`            |
|   4 | 内置默认值               | 保证可运行的兜底           | 默认 provider=anthropic、timeout=60s 等        |
|   5 | 交互式 setup wizard 结果 | 本质写入配置文件（优先级=3）    | `formax setup` 写入 profile                  |

> Claude Code 参考：官方也明确“设置的优先级/作用域”（managed settings、CLI args、项目/用户设置）。

---

### 3.1.2 CLI Flags 规范（建议）

**必须支持（P0）**

* `--profile <name>`：选择 profile（默认 `default`）
* `--provider <anthropic|openai|...>`：选择 provider（P0 只实现 anthropic，但 flag 预留）
* `--model <string>`
* `--base-url <url>`
* `--config <path>`：指定 config 文件路径（高级用户）
* `--api-key <string>`：不推荐（提示风险）
* `--api-key-stdin`：从 stdin 读 key（推荐脚本）
* `--timeout-ms <number>`
* `--log-level <silent|error|info|debug>`
* `--safe`：安全模式（禁 bash/写文件/网络，至少禁写与 bash）

**应支持（P1）**

* `--add-dir <path>`（可重复）：额外允许目录（与 `/add-dir` 一致）
* `--output-format <text|json>`（doctor/status/export）
* `--redact <strict|normal|off>`：控制路径脱敏级别

---

### 3.1.3 环境变量命名建议（按 provider 分组）

**通用**

* `FORMAX_PROFILE=default|work|...`
* `FORMAX_CONFIG=/path/to/config.jsonc`
* `FORMAX_LOG_LEVEL=info|debug`
* `FORMAX_TIMEOUT_MS=60000`（你已有）

**Anthropic**

* `FORMAX_PROVIDER=anthropic`
* `FORMAX_API_KEY=...`（建议新增）
* 兼容旧值：`FORMAX_API_KEY`（你当前使用）
* `FORMAX_BASE_URL=...`（兼容 `FORMAX_BASE_URL`/`FORMAX_BASE_URL`）
* `FORMAX_MODEL=...`（兼容 `FORMAX_MODEL`）

**OpenAI / 兼容服务（预留）**

* `FORMAX_OPENAI_API_KEY=...`
* `FORMAX_OPENAI_BASE_URL=...`
* `FORMAX_OPENAI_MODEL=...`
  （P0 不实现，但 schema 先留）

---

### 3.1.4 本地配置文件默认路径（XDG/用户目录）

**建议默认**

* Linux: `~/.config/formax/config.jsonc`
* macOS: `~/Library/Application Support/formax/config.jsonc`（或同样走 XDG）
* Windows: `%APPDATA%\formax\config.jsonc`

你现有代码已经有 `FORMAX_CONFIG_DIR` 的 XDG 逻辑（`src/utils/env.ts`），并定义了 `FORMAX_CONFIG_FILE = path.join(FORMAX_CONFIG_DIR,'config.json')`——建议复用，但把扩展改为 `.jsonc`。

**格式选择理由：JSONC（JSON with Comments）**

* 优点：

  * 对用户而言仍是 JSON；易于机器处理。
  * 支持注释，便于“可读的示例配置”。
  * 可用 `jsonc-parser` 等稳定解析器。
* 不选 YAML：类型/缩进易踩坑。
* 不选纯 JSON：没注释，用户体验差。

---

### 3.1.5 交互式 setup wizard（首次启动触发）

触发条件：

* `ResolvedConfig.providers[provider].credentialRef` 为空或凭证读取失败
* 或用户显式 `formax setup`

输入 key 不回显：复用 `TextInput` 的 `mask` 支持。

---

### 3.1.6 多 Profile 设计

* Profile 名称：`default`、`work`、`personal`…
* 切换方式：

  * `--profile work`（优先）
  * env `FORMAX_PROFILE=work`
  * REPL 命令 `/profile work`（P1 或 P2）
* Profile 的覆盖策略：

  * `config.profiles[profileName]` 覆盖 `config.defaults`
  * provider 选择也可 per-profile

---

### 3.1.7 Provider 切换与 Base URL 自定义

* provider adapter 接口：`LLMProvider`（见 3.4）
* baseUrl 必须可自定义：支持代理、私有网关、企业 LLM gateway。
* Claude Code 参考：LLM gateway / base URL 等在文档中出现（如环境变量、网络配置、gateway）。

---

## 3.2 配置文件 schema（必须给示例）

### 3.2.1 Schema 设计（概览）

核心对象：`AppConfig`

* `configVersion: number`
* `profiles: Record<string, ProfileConfig>`
* `providers: Record<string, ProviderConfig>`（按 provider 类型存默认值）
* `credentials: Record<string, CredentialRef>`（引用/别名，不直接放 key）
* `logging`, `telemetry`, `timeouts`, `safety`, `features` 等

### 3.2.2 完整示例（JSONC，带注释）

```jsonc
{
  // 每次 schema 变更必须 bump，并提供 migrate(from->to)
  "configVersion": 1,

  // 默认使用的 profile 名称（也可由 CLI/env 覆盖）
  "defaultProfile": "default",

  // 不同 profile = 不同 provider/model/权限/日志目录（work/personal）
  "profiles": {
    "default": {
      "provider": "anthropic",
      "model": "claude-sonnet-4-20250514",
      "baseUrl": "https://api.anthropic.com",

      // 引用 credentials 里的别名，而不是直接存明文 key
      "credential": "anthropic_default",

      // 默认工作区权限：只允许当前 repo/cwd
      "workspace": {
        "root": "auto",              // auto = 启动时探测 git root，否则 cwd
        "additionalDirs": []         // 需要用户 /add-dir 或配置显式增加
      },

      "timeouts": {
        "requestMs": 60000,
        "toolMs": 300000
      },

      "safety": {
        "mode": "normal",            // normal | acceptEdits | plan  (与你的 mode 一致)
        "confirm": {
          "bash": "always",          // always | once | never (never 仅在 safe=false 情况下允许)
          "write": "always",
          "network": "per-domain",
          "delete": "always-typed"   // 需要用户输入确认短语
        },
        "permissions": {
          // allow/deny 规则：deny 优先
          "deny": [
            "Bash(rm -rf *)",
            "Bash(sudo *)"
          ],
          "allow": [
            // 允许在本项目里免确认跑测试
            "Bash(npm test*)",
            "Bash(bun test*)"
          ],
          // 网络域名白名单（per-domain 记忆写入这里）
          "networkAllow": ["api.anthropic.com"]
        }
      },

      "logging": {
        "dir": "~/.config/formax/logs",
        "level": "info",
        "logPrompts": false,         // 默认不记录 prompt 全量
        "redact": "strict"           // strict | normal | off
      },

      "telemetry": {
        "enabled": false             // 默认关闭
      },

      "features": {
        "consoleLogger": {
          "enabled": false,          // 你当前默认开启，建议改为 false
          "port": 3001
        },
        "promptProfile": "full"      // 你的开发者调试功能：full/lite（不对齐 Claude Code）
      }
    },

    "work": {
      "provider": "anthropic",
      "model": "claude-sonnet-4-20250514",
      "credential": "anthropic_work",
      "baseUrl": "https://api.anthropic.com",
      "logging": { "level": "debug" }
    }
  },

  // providers 可放通用默认值（profile 可覆盖）
  "providers": {
    "anthropic": {
      "baseUrl": "https://api.anthropic.com"
    },
    "openai": {
      "baseUrl": "https://api.openai.com/v1"
    }
  },

  // credentials 只存“引用信息”，实际 secret 存 OS keychain 或 credentials.json
  "credentials": {
    "anthropic_default": { "type": "apiKey", "provider": "anthropic", "keychainId": "formax:anthropic:default" },
    "anthropic_work":    { "type": "apiKey", "provider": "anthropic", "keychainId": "formax:anthropic:work" }
  }
}
```

### 3.2.3 版本号与迁移策略（configVersion + migrate）

* `configVersion`：整数递增。
* `migrateConfig(raw, fromVersion)`：逐版本迁移。
* 迁移原则：

  * 不删除用户字段；未知字段保留（forward compatible）。
  * 迁移时记录 warnings（例如字段重命名）。
* 在 `/doctor` 中输出：`configVersion` 与是否发生迁移。

---

## 3.3 交互式配置流程（逐屏流程）

> 目标：从“第一次运行”到“进入 REPL”不超过 2 分钟；失败分支给可执行下一步。

### 3.3.1 成功主流程（逐屏）

**屏 1：欢迎 + 检测结果**

* 标题：`Formax Setup`
* 文案：检测到你尚未配置 Anthropic API Key（profile: default）。
* 选项：

  * `Continue`
  * `Exit`（提示如何手动配置：env 或 config path）

**屏 2：选择 provider**

* 列表：`Anthropic`（P0 只显示一个，但 UI 做成列表，方便以后加 OpenAI）
* 说明：可在之后用 `formax setup --profile work --provider anthropic` 修改

**屏 3：输入 API Key（不回显）**

* 输入框（mask=`*`）
* 提示：粘贴后回车
* 小字：不会显示在屏幕/日志；存储位置：Keychain（若启用）或 credentials 文件

**屏 4：Base URL（可选）**

* 默认：`https://api.anthropic.com`
* 允许留空 = 使用默认
* 校验：必须是 `http(s)://`，去掉尾部 `/`

**屏 5：选择 model**

* 选项 1：从 API 拉取模型列表（若实现）
* 选项 2（P0 最小）：输入框 + 默认值 `claude-sonnet-4-20250514`
* 若用户留空：使用默认

**屏 6：连接测试**

* 显示：`Testing connectivity...`
* 做一次轻量请求：

  * `GET /v1/models`（若可用）或
  * `POST /v1/messages` max_tokens=1（成本低）
* 成功：显示延迟/状态码/模型是否存在（可选）

**屏 7：写入配置**

* 显示将写入：

  * config path（例如 `~/.config/formax/config.jsonc`）
  * credentials store（Keychain or file）
* 需要确认：`Write and continue` / `Cancel`

**屏 8：完成 → 进入 REPL**

* `Setup completed. Starting REPL...`

---

### 3.3.2 失败分支（必须覆盖）

> 失败时，每一屏都要给“可执行下一步”。

**401/403（鉴权失败）**

* 提示：`Authentication failed (401).`
* 下一步：

  1. 重新粘贴 key（Back）
  2. 确认 key 对应的组织/权限是否有该模型访问权
  3. 运行 `formax doctor` 获取更多信息（P1）
* 日志：记录 status code，不记录 key

**DNS 失败**

* 提示：`Cannot resolve host api.anthropic.com`
* 下一步：

  1. 检查网络/DNS
  2. 如使用代理：设置 `HTTPS_PROXY`（并提示）
  3. 若公司网关：填写正确 baseUrl

**timeout**

* 提示：`Request timed out after 60s.`
* 下一步：

  1. 重试
  2. 提示用户可以在 config 里改 `timeouts.requestMs` 或 CLI `--timeout-ms`
  3. 若在内网/代理：检查代理可达性

**SSL/证书错误**

* 提示：`TLS handshake failed / certificate error`
* 下一步：

  1. 检查公司中间人证书
  2. 建议使用系统证书配置（不要建议关闭校验）

**baseUrl 不兼容**

* 提示：`Base URL does not look like an Anthropic-compatible endpoint.`
* 下一步：

  1. 确认路径是否包含 `/v1`（根据你的 client 实现）
  2. 若是兼容网关，提示对方需要支持 `/v1/messages`

---

## 3.4 与现有架构的集成点（引用 Formax 路径 + 接口签名）

### 3.4.1 现有 config/env 读取点在哪里？

* **runtime env config**：`src/env/config.ts` 读取 `FORMAX_API_KEY`、`FORMAX_BASE_URL`/`FORMAX_BASE_URL`、`FORMAX_MODEL`、`FORMAX_TIMEOUT_MS` 等
* **旧 config 路径定义**：`src/utils/env.ts` 已定义 `FORMAX_CONFIG_DIR`（支持 `XDG_CONFIG_HOME`）与 `FORMAX_CONFIG_FILE`
* **旧 global config stub**：`src/utils/config.ts` 目前 `loadGlobalConfig()` 不读磁盘，只返回 default
* **REPL 启动默认开启 console logger**：`src/entrypoints/cli.tsx` 默认 `ENABLE_CONSOLE_LOGGER !== 'false'`

### 3.4.2 建议新增哪些模块/目录结构

建议新增：

```
src/
  config/
    paths.ts          // XDG/OS路径
    schema.ts         // AppConfig/ProfileConfig 等 + validation
    load.ts           // loadConfigFile + migrate
    resolve.ts        // resolveRuntimeConfig(flags, env, file) => ResolvedConfig
    save.ts           // write config
    wizard.tsx        // setup wizard UI
    secrets.ts        // get/set apiKey (keychain/file/env)
    redact.ts         // redactSecrets
  diagnostics/
    status.ts
    doctor/
      index.ts
      checks/*.ts
      bundle.ts
  security/
    permissions.ts    // allow/deny rules
    paths.ts          // allowedDirs + realpath
    network.ts        // domain allowlist
  logging/
    logger.ts
```

并将现有文件改为调用它：

* `src/env/config.ts` → 逐步迁移为 `src/config/resolve.ts` 的 env layer
* `src/entrypoints/cli.tsx` → 使用 `ResolvedConfig`，并默认关闭 console logger
* tool executor（`src/tools/executor/index.ts`）→ 注入 `allowedDirs / permissionStore / safetyMode` 并在执行前拦截

### 3.4.3 关键接口签名建议（TypeScript）

```ts
// src/config/schema.ts
export type ProviderName = 'anthropic' | 'openai' | 'custom';

export type AppConfig = {
  configVersion: number;
  defaultProfile: string;
  profiles: Record<string, ProfileConfig>;
  providers?: Record<string, ProviderDefaults>;
  credentials?: Record<string, CredentialRef>;
};

export type ProfileConfig = {
  provider: ProviderName;
  model: string;
  baseUrl?: string;
  credential?: string; // alias in credentials
  workspace?: { root: 'auto' | string; additionalDirs: string[] };
  timeouts?: { requestMs: number; toolMs: number };
  safety?: SafetyConfig;
  logging?: LoggingConfig;
  telemetry?: { enabled: boolean };
  features?: FeatureFlags;
};

export type ResolvedConfig = {
  profile: string;
  provider: ProviderName;
  model: string;
  baseUrl: string;
  apiKey?: string; // resolved secret, not persisted in cleartext
  configPath: string;
  logDir: string;
  timeouts: { requestMs: number; toolMs: number };
  safety: SafetyConfigResolved;
  features: FeatureFlagsResolved;
};

export type SafetyConfig = {
  mode?: 'normal' | 'acceptEdits' | 'plan';
  confirm?: {
    bash?: 'always' | 'once' | 'never';
    write?: 'always' | 'once' | 'never';
    network?: 'per-domain' | 'always' | 'never';
    delete?: 'always' | 'always-typed';
  };
  permissions?: {
    allow?: string[];
    deny?: string[];
    networkAllow?: string[];
  };
};

export type LoggingConfig = {
  dir?: string;
  level?: 'silent'|'error'|'info'|'debug';
  logPrompts?: boolean;
  redact?: 'strict'|'normal'|'off';
};

export type CredentialRef =
  | { type: 'apiKey'; provider: ProviderName; keychainId?: string; fileKey?: string };
```

```ts
// src/config/load.ts
export function loadConfig(configPath?: string): AppConfig;
export function migrateConfig(cfg: AppConfig): { cfg: AppConfig; migrated: boolean; warnings: string[] };

// src/config/resolve.ts
export function resolveRuntimeConfig(args: CliFlags, env: NodeJS.ProcessEnv, cfg: AppConfig): ResolvedConfig;

// src/config/secrets.ts
export async function ensureCredentials(resolved: ResolvedConfig): Promise<ResolvedConfig>;
export async function getApiKey(resolved: ResolvedConfig): Promise<string | null>;
export async function setApiKey(resolved: ResolvedConfig, apiKey: string): Promise<void>;

// src/config/wizard.tsx
export async function runSetupWizard(opts: { profile?: string; provider?: ProviderName }): Promise<void>;

// src/config/redact.ts
export function redactSecrets(text: string, secrets: string[]): string;
export function redactConfigForExport(cfg: ResolvedConfig): Record<string, any>;
```

---

────────────────────────────────────────────────────────
4) 重点专题：诊断 /doctor 与可维护性
────────────────────────────────────────────────────────

> Claude Code 事实参考：
>
> * `claude doctor` 在 setup 文档出现。
> * troubleshooting 文档提到 `/bug`、以及配置文件位置等。

> Formax 现状：
>
> * 命令表中 `/status`、`/doctor`、`/terminal-setup` 明确未实现。
> * 当前缺少可导出的诊断包与统一日志策略。

---

## 4.1 诊断能力清单（你要实现的功能点）

### `/status`（轻量、永远可用）

必须包含字段（建议按块输出）：

* **Build/Version**

  * Formax 版本（package.json）
  * Node/Bun 版本（`process.version` / bun 版本）
  * OS/Arch
* **Runtime Config**

  * profile
  * provider
  * model
  * baseUrl
  * config path（实际读取的路径）
  * log dir
  * timeoutMs
  * promptProfile（full/lite，作为 dev feature）
* **Safety/Permissions**

  * 当前 mode（normal/acceptEdits/plan，你已有）
  * allowedDirs 数量与列表（可截断）
  * networkAllow 数量
  * 是否启用 safe mode
* **CWD/Workspace**

  * cwd
  * repoRoot（若探测到）

输出示例在第 10 节会给。

---

### `/doctor`（深度检查，可输出 JSON/Bundle）

**Network**

* baseUrl host DNS 解析
* TCP 连通性（可选）
* HTTPS 请求（GET /v1/models 或 HEAD /）
* 代理检测：读取 `HTTPS_PROXY`/`HTTP_PROXY`/`NO_PROXY`（Claude Code 文档提到使用标准 proxy env vars）。

**Auth**

* 发送一个最小请求验证 key（401/403 分类）
* 输出：provider、baseUrl、model（不输出 key）

**FS 权限**

* config dir 可写（创建临时文件）
* log dir 可写
* plan dir 可写（你当前 planDir 默认 `~/.claude/plans`，这对 Formax 用户是“意外的路径”，建议改为 `~/.config/formax/plans`）

**Runtime**

* node/bun 版本
* 依赖版本（从 package.json / lockfile）
* 终端能力检测（宽度/颜色等，可选）

**Common Errors & Fixes**

* 401：提示重新配置 key
* timeout：提示调整 timeout 或检查代理
* model 不存在：提示更换 model
* baseUrl 不是 anthropic 兼容：提示修正

---

## 4.2 导出 debug bundle（脱敏打包）

**打包内容（建议）**

* `status.json`（脱敏）
* `doctor.json`（脱敏）
* `config.jsonc`（脱敏版本：移除/替换 apiKey 与敏感路径）
* `logs/formax.log` 最近 N 行（脱敏）
* `repro.txt`（自动生成“如何复现”的模板：你运行了什么命令、用哪个 profile）

**脱敏策略**

* key：全 mask
* 路径：

  * strict：`/Users/alice/project` → `~/project` 或 `<HOME>/project`
  * normal：保留最后 2 段路径
* prompt/工具输出：默认不收录；除非用户显式 `--include-prompts`

---

## 4.3 日志策略（默认是否记录、如何开关、如何脱敏）

**建议默认**

* 默认：`logPrompts=false`
* 默认日志级别：`info`
* 默认记录：

  * 每次 API 请求：requestId、provider、model、latency、statusCode
  * 每次 tool 执行：toolName、latency、resultType（ok/error）
* 不记录：完整 prompt、完整文件内容、bash 输出全量（除非 debug）

**开关**

* CLI：`--log-level debug`、`--log-prompts`
* config：`profiles.<p>.logging.*`

---

────────────────────────────────────────────────────────
5) 重点专题：安全与权限（产品视角）
────────────────────────────────────────────────────────

> Claude Code 参考事实：
>
> * 有权限系统与规则（allow/deny）并可设置不同 permission mode。
> * 有 sandboxing/隔离机制（OS sandbox、网络限制）与“dangerously-skip-permissions”类开关（在某些环境/容器文档中出现）。
> * 有 checkpointing 与 /rewind 来回退改动（用于安全与可恢复）。

> Formax 当前安全底座：
>
> * Bash 有审批、含 `approve_remember`（但内存）。
> * Edit 有确认、acceptEdits 自动批准、plan 模式限制编辑 plan 文件。
> * 但 Read/Glob/Grep 等没有目录边界，`requireAbsolutePath` 只校验绝对路径。

---

## 5.1 “危险操作分类”与默认策略

### 分类 1：文件系统写入/修改

* Tools：Edit / NotebookEdit / 任何写文件工具（你主要是 Edit）
* 默认策略：

  * **always confirm**（normal mode）
  * acceptEdits：允许连续修改但必须明确显示“已处于自动批准模式”
  * plan：禁止编辑非 plan 文件（你已实现）

### 分类 2：文件读取与遍历（潜在泄密）

* Tools：Read / Glob / Grep / Search 等
* 默认策略：

  * 仅允许 `workspaceRoot` 内
  * 超出 root 必须 `/add-dir` 明确授权
  * 读取隐藏文件（`.env`, `.ssh`）可额外提示（P1）

### 分类 3：执行命令（Bash）

* 默认策略：

  * 总是确认（normal）
  * 允许“记住选择”（project scope），但必须可在 `/permissions` 或 config 中查看/撤销
  * 内置 deny：`rm -rf`, `sudo`, `curl | sh` 等（你已有 policy 迹象，但需要系统化）

### 分类 4：网络访问

* Tools：webFetch / webSearch（你已实现）
* 默认策略：

  * **per-domain confirm**：首次访问新域名询问
  * deny 内网 IP 段（10.0.0.0/8 等）【推测：实现方式】（依据：产品级安全通常要防 SSRF/内网探测；Claude Code 也强调网络限制/隔离）

### 分类 5：删除/破坏性操作（含 git）

* Bash 中 `rm`, `git reset --hard`, `git clean -fd` 等
* 默认策略：

  * 需要 typed confirmation（输入 `DELETE`）
  * 或二次确认 + 显示将删除的路径列表

---

## 5.2 用户确认 UX（一次确认 vs 每次确认、记住选择、白名单目录）

建议统一成一个“Permission Prompt”组件：

* 标题：`Permission required: Bash` / `Permission required: Network` / `Permission required: File access`
* 展示：

  * toolName、操作摘要、目标路径/域名、风险等级（low/medium/high）
  * “为什么需要”一行解释
* 按钮：

  * `Allow once`
  * `Always allow for this project`（写入 config.permissions.allow / networkAllow / additionalDirs）
  * `Deny`（并允许输入“替代建议”反馈给模型，类似你 Edit 的 reject guidance）
* 高危操作额外：`Type DELETE to confirm`

---

## 5.3 与工具系统的拦截点建议（在哪层做）

**最佳拦截层：tool executor（统一入口）**
你现在的 executor 已经有 allowTools/denyTools/agentDepth 等统一控制。
建议把“路径白名单/网络域名/写入确认”等也纳入 executor 前置拦截，而不是散落在每个 tool handler。

拦截链路建议：

1. `ToolExecutor.executeToolCall(call)`
2. `PolicyEngine.evaluate(call, resolvedConfig, sessionState)`
3. 若 `allow`：执行 handler
4. 若 `prompt`：通过 `userInputManager.promptPermission()` 获取用户选择
5. 写入 sessionState（once）或 config（always）
6. 继续执行或拒绝

---

## 5.4 最小可行方案（交付给别人用的最低安全线）

P0 最小安全线（建议必须做）：

1. 默认关闭 console logger（避免额外端口暴露）
2. 默认 workspaceRoot=repoRoot/cwd，仅允许在 root 内 Read/Glob/Grep/Edit
3. 超出 root 需要 `/add-dir`
4. Bash 与 Edit 继续保留确认（你已有）
5. 输出/日志脱敏（至少 key）

P1 再补：网络 per-domain allow、持久化规则、debug bundle。

---

────────────────────────────────────────────────────────
6) 重点专题：分发与发布（让别人真的用起来）
────────────────────────────────────────────────────────

> Claude Code 参考：有官方安装与更新说明（setup/overview/quickstart）。

## 6.1 安装方式（按 Formax 当前技术栈给最现实方案）

你当前是 Node/Bun + TS + Ink（终端 UI），最现实的交付路线我建议两条并行：

### 方案 A（P0 首选）：npm 包（带 prebuilt dist）

* 发布到 npm：`formax`
* 用户安装：

  * `npm i -g formax` 或 `pnpm add -g formax`
  * 或 `npx formax@latest`（免全局安装）
* 优点：

  * 生态成熟、跨平台稳定
  * 更新简单（npm update）
* 代价：需要把 build 产物（dist）纳入发布流程

### 方案 B（P2 可选）：bun compile 单文件二进制

* 用 `bun build --compile` 产出 `formax`
* 优点：用户不需要 node 环境
* 风险：跨平台产物与依赖兼容（尤其 keytar/原生依赖）

---

## 6.2 默认命令、示例、更新策略

**默认命令**

* `formax` → REPL
* `formax setup` → 配置向导
* `formax doctor` → 诊断
* `formax status` → 状态
* `formax config edit` → 打开配置（或打印路径 + 指令）

**更新策略**

* `formax upgrade`：检测当前安装方式（npm/bun）并给出对应升级命令（不要强行自动改系统）。
* `CHANGELOG.md`：每次 release 必须写。

---

## 6.3 README/QuickStart 需要补哪些段落标题

建议 README 顶部目录：

1. What is Formax
2. Install
3. First-time setup (`formax setup`)
4. Start chatting (`formax`)
5. Common commands (`/help`, `/status`, `/doctor`, `/add-dir`)
6. Configuration (profiles, env overrides, config path)
7. Security model (what tools can do, how approvals work)
8. Troubleshooting (401/timeout/DNS/model not found)
9. Privacy & logging (what is logged, how to disable)
10. Development (bun, tests, contributing)

---

────────────────────────────────────────────────────────
7) 快速盘点：Formax 已实现能力（1-2 页，只列清单+路径）
────────────────────────────────────────────────────────

只列“已经具备/大致可用”的能力与索引（不展开细节）：

### 7.1 REPL 与 UI 基础

* Ink/React REPL 屏幕：`src/screens/REPL.tsx`
* 输入组件支持 mask（可用于 key 输入）：`src/components/ui/TextInput.tsx`
* 模式指示与 Shift+Tab 提示：`src/components/chat/ModeIndicator.tsx` + `src/features/repl/mode.ts`

### 7.2 工具系统（Tool calling）

* Tool executor（含 allowTools/denyTools/agentDepth 限制）：`src/tools/executor/index.ts`
* Bash 工具：审批 + approve_remember（会话内记忆）：`src/tools/modules/bash/handler.ts`
* Edit 工具：确认/acceptEdits 自动批准/plan 模式限制：`src/tools/modules/edit/handler.ts`
* webSearch/webFetch 等工具模块存在（网络权限策略待补）

### 7.3 Slash Commands（本地命令 + 自定义命令加载）

* 内置 `/help`、`/tasks`、`/plan`、`/prompt`、`/init` 已实现（dispatch 在 registry）
* 支持从 `.claude/commands/*.md` 与 `~/.claude/commands/*.md` 加载自定义命令，并参与 `/` 自动补全：`src/features/commands/registry.ts`

### 7.4 Prompt 体系（运行时真相在 src/）

* `system-prompts/` 明确是参考快照，不在运行时加载；运行时以 `src/prompts/system.ts` 为准
* 支持 `full/lite` prompt profile（开发调试开关）并可通过 `/prompt` 切换

### 7.5 Subagents

* `.agent/subagents/*.md` 存在（subagent 配置）

---

────────────────────────────────────────────────────────
8) 你建议我下一步先做的 Top 10（按“产品化收益/实现成本”排序）
────────────────────────────────────────────────────────

> 这里我按“对陌生用户可交付”收益最大、实现相对可控来排。

### 1) P0 配置系统 + setup wizard（缺 key 自动引导）

* 为什么现在做：这是“陌生用户 15 分钟跑通”的最大阻塞点；否则所有支持都要你手把手。
* 最小实现：只做 anthropic；config.jsonc + `formax setup` + 启动自动触发。
* 验收标准：全新 HOME 下运行 `formax` → 2 分钟内完成配置 → 发一句话得到回复；配置落盘。

### 2) CLI 外壳（help/version/setup/repl/status）

* 为什么现在做：没有 `--help`/子命令，用户无法发现能力，也无法自助排障。
* 最小实现：`formax --help`, `formax setup`, `formax repl`。
* 验收标准：`formax --help` 输出可复制且指向 setup；`formax --version` 可用。

### 3) 默认关闭 console logger（debug opt-in）

* 为什么现在做：默认开端口是交付级安全雷；也会造成“我为什么机器多了个服务在跑”的困惑。
* 最小实现：`ENABLE_CONSOLE_LOGGER` 默认 false。
* 验收标准：不设置任何 env 时不监听 3001；设置 `FORMAX_DEBUG=1` 才监听。

### 4) `/status` 实现（可复制 + 脱敏）

* 为什么现在做：用户/你在排障时第一句话永远是“你现在用的 model/baseUrl 是啥”。
* 最小实现：REPL `/status` + CLI `formax status`。
* 验收标准：输出包含 profile/provider/model/baseUrl/config path/log dir/mode（apiKey 不泄露）。

### 5) 错误分类与提示文案（401/DNS/timeout/model-not-found）

* 为什么现在做：即使没有 /doctor，错误提示也能减少 70% 支持成本。
* 最小实现：HTTP status 分类 + 下一步指令（setup/doctor/检查 baseUrl）。
* 验收标准：故意给错 key，提示明确且可执行。

### 6) 工作区目录边界（allowedDirs + /add-dir）

* 为什么现在做：这是“把工具调用交给陌生用户”必须补的安全线。
* 最小实现：默认只允许 cwd/repoRoot；超出提示 `/add-dir`。
* 验收标准：Read `~/.ssh/*` 被阻止；Read 项目文件不提示。

### 7) `/doctor`（先做最小集，再做 bundle）

* 为什么现在做：进入 P1 后最大价值能力；能把支持工作产品化。
* 最小实现：网络+鉴权+写权限+版本信息；输出建议。
* 验收标准：断网/401/超时都能明确区分。

### 8) 日志系统（默认不记录 prompt，全链路脱敏）

* 为什么现在做：/doctor bundle 与排障必须有最小可观测性；但要避免泄露。
* 最小实现：info 日志 + key 脱敏 + 可关闭。
* 验收标准：日志中搜不到 apiKey；bundle 里只含脱敏信息。

### 9) 发布到 npm（哪怕是 alpha）

* 为什么现在做：没有分发就没有真实用户；也无法形成反馈闭环。
* 最小实现：发布 `formax@0.1.0-alpha`，README QuickStart 能跑。
* 验收标准：`npx formax@alpha` 可运行 wizard 并进入 REPL。

### 10) 文档收敛与一致性（把“真相路径”写清）

* 为什么现在做：你 repo 有 “reference snapshot vs runtime 真相” 的机制（这是好事），但必须让用户文档永远指向 runtime 真相。
* 最小实现：README/QuickStart/排障都只引用 `src/` 运行时能力与 config/status/doctor 输出。
* 验收标准：按文档走不会遇到“这文件只是参考不生效”的坑。

---

────────────────────────────────────────────────────────
9) 你需要我补充哪些材料（把【推测】变成【证据】）
────────────────────────────────────────────────────────

下面是“最小清单”（你给我这些，我能把很多【推测】变成【证据】并把路线图收敛得更精确）：

1. **Formax 当前实际运行截图/录屏**（从 `bun run src/entrypoints/cli.tsx` 启动到输入一条消息）

   * 验证：当前欢迎信息、输入体验、错误呈现方式、是否有历史/补全。
2. **一次“无 key 启动”的完整输出**（包含报错堆栈/HTTP 响应片段，记得先手动删 key）

   * 验证：缺 key 时具体失败点、错误码与文案现状。
3. **一次“错误 baseUrl（比如 [http://127.0.0.1:1）”的输出](http://127.0.0.1:1）”的输出)**

   * 验证：timeout/ECONNREFUSED 的错误链路，便于设计 /doctor 分类。
4. **你期望支持的 provider 列表与优先级**（只要 bullet list：anthropic / openai / 兼容网关…）

   * 验证：配置 schema 的字段与命名是否要提前锁定。
5. **你希望的发布形态**：npm 包 vs 单文件二进制（可同时做，但希望先选 P0 主线）

   * 验证：CLI 入口与 build 流程要如何改动（bun build vs tsup 等）。
6. **你对“默认日志策略”的偏好**（默认完全不落盘？还是落盘但不含 prompt？）

   * 验证：logging/telemetry 默认值与文案。
7. **你希望的安全默认值**（例如：是否默认允许网络访问 WebFetch/WebSearch）

   * 验证：network policy 的默认策略（per-domain confirm vs 默认允许）。

---

────────────────────────────────────────────────────────
10) 附加输出（必须给）
────────────────────────────────────────────────────────

下面给你五份可直接落地/复制的产物：Quick Start、config 示例、/doctor 示例（成功+失败）、错误提示文案清单、最小实现 PR 切分计划。

---

## 10.1 面向普通用户的 QUICK START（安装/首次配置/第一次对话/常见错误与修复）

> 这是“P0 目标态”的 QuickStart（你实现 P0 后直接可用）。
> 如果你希望我同时给“当前开发态（env + bun run）QuickStart”，我也可以补一份，但你要求的是交付陌生用户，我先给交付态。

### 安装

**方式 1：npx（无需安装）**

```bash
npx formax@latest
```

**方式 2：全局安装**

```bash
npm install -g formax
formax --version
```

### 首次配置（推荐）

```bash
formax setup
```

* 选择 provider（默认 Anthropic）
* 粘贴 API Key（输入不会回显）
* （可选）填写 Base URL（默认 [https://api.anthropic.com）](https://api.anthropic.com）)
* 选择/输入 model（默认 claude-sonnet-4-20250514）
* 连接测试通过后写入配置文件

### 开始对话

```bash
formax
```

在 REPL 中输入：

```
你好，帮我解释一下这个项目是做什么的？
```

### 常用命令

* `/help`：查看可用命令
* `/status`：查看当前配置与运行状态
* `/doctor`：诊断网络/鉴权/权限并给修复建议
* `/add-dir <path>`：允许访问额外目录（当你希望它读/写 repo 之外文件时）

### 常见错误与修复

**1) “Missing API key / Authentication failed (401)”**

* 运行：`formax setup`
* 或设置环境变量：`FORMAX_API_KEY=...`（不推荐长期使用）
* 再运行：`formax doctor`

**2) “Cannot resolve host / DNS error”**

* 检查网络/DNS
* 如在公司网络：确认是否需要代理（设置 `HTTPS_PROXY`）
* 如使用自建网关：在 setup 里填写正确 baseUrl

**3) “Request timed out”**

* 运行：`formax doctor` 看网络延迟
* 临时提高超时：`formax --timeout-ms 120000`
* 或在 config 里改 `timeouts.requestMs`

**4) “Model not found / not allowed”**

* 运行：`formax setup --model <other>` 更换模型
* 或运行 `/status` 看当前 model

**5) “Permission denied: file outside workspace”**

* 说明你尝试读/写工作区外文件
* 运行：`/add-dir /absolute/path/to/dir`
* 或启动时：`formax --add-dir /absolute/path/to/dir`

---

## 10.2 一份 config 文件示例（含字段说明与默认值）

（与第 3.2 的 JSONC 示例一致，这里再给“更短、更贴近默认”的版本）

```jsonc
{
  "configVersion": 1,
  "defaultProfile": "default",
  "profiles": {
    "default": {
      "provider": "anthropic",
      "baseUrl": "https://api.anthropic.com",
      "model": "claude-sonnet-4-20250514",
      "credential": "anthropic_default",

      "workspace": {
        "root": "auto",
        "additionalDirs": []
      },

      "timeouts": {
        "requestMs": 60000,
        "toolMs": 300000
      },

      "safety": {
        "mode": "normal",
        "confirm": {
          "bash": "always",
          "write": "always",
          "network": "per-domain",
          "delete": "always-typed"
        },
        "permissions": {
          "allow": [],
          "deny": [
            "Bash(rm -rf *)",
            "Bash(sudo *)"
          ],
          "networkAllow": [
            "api.anthropic.com"
          ]
        }
      },

      "logging": {
        "dir": "~/.config/formax/logs",
        "level": "info",
        "logPrompts": false,
        "redact": "strict"
      },

      "telemetry": {
        "enabled": false
      },

      "features": {
        "consoleLogger": { "enabled": false, "port": 3001 },
        "promptProfile": "full"
      }
    }
  },
  "credentials": {
    "anthropic_default": {
      "type": "apiKey",
      "provider": "anthropic",
      "keychainId": "formax:anthropic:default"
    }
  }
}
```

---

## 10.3 一份 /doctor 输出示例（成功与失败各 1）

### 成功示例

```
/doctor

Formax Doctor ✅

[Runtime]
- formaxVersion: 0.1.0
- node: v20.11.0
- platform: darwin arm64
- profile: default
- provider: anthropic
- model: claude-sonnet-4-20250514
- baseUrl: https://api.anthropic.com
- configPath: /Users/alice/.config/formax/config.jsonc
- logDir: /Users/alice/.config/formax/logs
- safetyMode: normal
- workspaceRoot: /Users/alice/projects/myrepo

[Network]
✅ DNS resolve api.anthropic.com (22ms)
✅ HTTPS GET /v1/models (200, 180ms)

[Auth]
✅ API key valid (200)

[Filesystem]
✅ config dir writable
✅ log dir writable
✅ workspace root accessible

[Advice]
- Tip: Use /status to quickly view current configuration.
- Tip: Use /add-dir <path> if you want Formax to access files outside your repo.
```

### 失败示例（401）

```
/doctor

Formax Doctor ❌

[Runtime]
- profile: default
- provider: anthropic
- baseUrl: https://api.anthropic.com
- model: claude-sonnet-4-20250514
- configPath: /Users/alice/.config/formax/config.jsonc

[Network]
✅ DNS resolve api.anthropic.com
✅ HTTPS reachable (200 from /v1/models endpoint probe)

[Auth]
❌ Authentication failed (401)

What you can do next:
1) Run: formax setup
2) Re-paste your Anthropic API key (it may be expired or copied incorrectly)
3) If you're using a proxy or gateway, verify baseUrl in config
4) Re-run: formax doctor --json
```

---

## 10.4 错误提示文案清单（至少 15 条）

> 下面是“用户看得懂 + 下一步可执行”的文案模板（你可以直接放到 `src/errors/copy.ts` 里）。

1. **缺少 API Key**

   * `No API key configured. Run "formax setup" or set FORMAX_API_KEY.`

2. **401 鉴权失败**

   * `Authentication failed (401). Your API key is invalid or has no access. Run "formax setup" to reconfigure.`

3. **403 无权限**

   * `Authorization failed (403). Your account may not have access to this model. Try another model in "formax setup".`

4. **404 baseUrl 不兼容/路径不对**

   * `Endpoint not found (404). Check your baseUrl. If you're using a gateway, it must support Anthropic-compatible /v1/messages.`

5. **429 限流**

   * `Rate limited (429). Please retry later, or reduce concurrency. Run "/status" to see your current model.`

6. **5xx 服务器错误**

   * `Server error (5xx). This is likely temporary. Retry, or run "formax doctor" to confirm connectivity.`

7. **DNS 解析失败**

   * `Cannot resolve host "<host>". Check your DNS/network. If behind a proxy, set HTTPS_PROXY and retry.`

8. **连接拒绝（ECONNREFUSED）**

   * `Connection refused. The baseUrl is unreachable. Verify your proxy/gateway is running and the URL is correct.`

9. **超时**

   * `Request timed out after 60s. Try increasing --timeout-ms or check your network/proxy.`

10. **TLS/证书错误**

* `TLS handshake failed. Check corporate proxy certificates or system trust store. Do not disable TLS verification.`

11. **模型不存在**

* `Model "<model>" not found. Run "formax setup" to select an available model.`

12. **配置文件损坏**

* `Config file is invalid JSON. Fix it at: <path> (or run "formax setup" to regenerate).`

13. **配置版本过旧需迁移**

* `Config was migrated from vX to vY. Review changes at: <path>.`

14. **工作区外文件访问被拦截**

* `Blocked: file is outside your workspace. Run "/add-dir <path>" to allow access, or move the file into the workspace.`

15. **写权限不足**

* `Cannot write to "<path>". Check file permissions or choose a writable directory.`

16. **网络域名未授权**

* `Network access to "<domain>" requires permission. Choose: Allow once / Always allow / Deny.`

17. **危险删除操作需要手动确认**

* `This operation may delete files permanently. Type DELETE to confirm.`

---

## 10.5 “最小实现 PR 切分计划”（PR1/PR2/PR3…）

> 目标：每个 PR 都可合并、可回滚、可验证；尽量避免“大 PR”。

### PR1：CLI 骨架 + version/help

* 目标：`formax --help`、`formax --version`、`formax repl`（仍可用 env）
* 改动目录：`src/cli/*`, `src/entrypoints/main.ts`, `package.json` bin
* 验收：help/version 可用；repl 可启动不回归

### PR2：配置系统 v1（paths/load/resolve/save）+ profile

* 目标：引入 config.jsonc；支持 `--profile`
* 改动目录：`src/config/*`, 修改 `src/env/config.ts` 调用 resolve
* 验收：能读写 config；resolve 优先级按表执行

### PR3：setup wizard（交互式）+ 缺 key 自动触发

* 目标：`formax setup` 可配置并测试连接；缺 key 自动进入
* 改动目录：`src/config/wizard.tsx`, `src/repl/runRepl.tsx`
* 验收：干净环境下 2 分钟配置完成并能对话

### PR4：/status（REPL + CLI）

* 目标：实现 `/status` 与 `formax status`
* 改动目录：`src/diagnostics/status.ts`, 修改 `src/features/commands/registry.ts`
* 验收：输出字段齐全，脱敏正确

### PR5：默认关闭 console logger + debug 开关

* 目标：默认不监听 3001；`FORMAX_DEBUG=1` 才启用
* 改动目录：`src/entrypoints/cli.tsx`, `src/config/schema.ts`
* 验收：端口行为符合预期

### PR6：错误提示系统（401/timeout/DNS 分类）

* 目标：统一错误映射与用户文案；提示下一步
* 改动目录：`src/errors/*`, API client 包装
* 验收：故意制造 401/timeout，输出文案正确

### PR7：/doctor v1（不含 bundle）

* 目标：网络+鉴权+写权限+版本信息
* 改动目录：`src/diagnostics/doctor/*`, registry dispatch
* 验收：至少能区分 401 vs DNS vs timeout

### PR8：工作区权限边界（allowedDirs + /add-dir）

* 目标：默认只允许 workspaceRoot；超出要授权
* 改动目录：`src/security/paths.ts`, `src/tools/executor/index.ts`, `src/features/commands/registry.ts`
* 验收：读取 home 目录文件被拦截，项目内不拦截

### PR9：debug bundle + 日志系统（最小）

* 目标：`formax doctor --bundle` 生成 zip；日志落盘脱敏
* 改动目录：`src/logging/*`, `src/diagnostics/doctor/bundle.ts`
* 验收：bundle 里找不到 key；包含 status/doctor/logs

---

（文件引用）
  
