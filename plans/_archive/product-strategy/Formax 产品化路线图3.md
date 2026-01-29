## A. 总评（10 行内）

* 最大优势：你把“可交付 CLI 产品骨架”的关键（config/auth → status/doctor → policy/approval → debug bundle → 多模型）按 PR 拆出来了，而且把 **契约优先（`--json` + schema + exit codes）**写进原则里（见「PR2 — CLI 产品骨架」「PR4 — Diagnostics」「P1 稳定可用」）。
* 最大风险：当前 PR 顺序里存在 **依赖反转**（例如 PR3 想复用 PR4 的错误码枚举；PR1d 先引入 CLI 命令但 PR2 才建立 CLI 骨架），会导致你“写完没法验证/回滚困难/不断返工”。
* 最该先改的 3 点（按优先级）

  1. 【问题】PR3 依赖 PR4（错误码枚举）/ PR1d 依赖 PR2（命令树+help+exit codes）→【建议】重排：先 PR2(骨架/契约) + PR4(错误码/status/doctor) 再 PR3(wizard)，并把 PR1d(命令)并入 PR2 或放到 PR2 之后→【收益】每步都有可验证产物，避免“做完才发现缺基建”→【风险】PR 编号/文档需改动→【替代方案】不改顺序但把“错误码枚举/CLI 骨架”前移到 PR3/PR1（变相重排）→【需要我补充的证据/材料】你希望保持 PR 编号不变还是允许重命名（影响后续跟踪）。
  2. 【问题】`--json` 与 exit codes 只写“要做”，未给**统一封装与 stdout/stderr 纪律**→【建议】在 PR2 明确：所有 `--json` 输出统一 envelope（版本/command/ok/error/warnings/meta），stdout 只给 JSON，stderr 才能打印日志→【收益】脚本化/CI 可依赖；回归测试能快照→【风险】前期多写一点契约文档→【替代方案】先给 status/doctor 两个命令定义 schema，其它命令后补→【需要我补充的证据/材料】你希望 `--json` 是“单对象”还是允许数组/多行（影响 jsonl/事件流）。
  3. 【问题】policy/approval “remember 落盘”是强能力，但缺少**撤销/审计/可解释输出的固定字段**→【建议】PR5/PR6 同步加入 `policy list` 的 ruleId、`policy delete <id>`（或 disable）与 `policy explain --json` 的 matchedRule 结构→【收益】陌生用户敢用（不会“点错一次永久坏掉”）；支持成本降低→【风险】规则 schema 需要多一点字段→【替代方案】P0 先只 session remember；P1 再落盘并补撤销→【需要我补充的证据/材料】你现有 rules/approval 里有没有“撤销 UI/命令”的雏形（文件路径/函数名）。

---

## B. 架构评审（Kernel-first + Adapters + Strangler Fig）

### 结论（不绕弯）

你的 Kernel-first 并不“过度”，**前提是**你把“稳定对外契约（CLI 输出/错误码/policy explain）”当成第一等公民；否则 Kernel/Adapters 的边界成本会压垮周末维护节奏。你文档里已经把“契约优先/事件流”写成原则，但还缺“最小可执行接口清单 + 可验证 DoD”来把它落地（见「PR2」「PR4」「PR5」）。

### 我建议的“更简单但同样可扩展”的版本（Kernel-first Lite）

只把 **必须跨 UI/跨 provider** 的东西放 core；其它保持 legacy，直到你真正需要迁移。核心是“Ports（接口）先小后大”，不要一上来把 fs/network/git/clock/llm/ui 全部铺开。

**最小核心接口草图（建议写进文档「2) 模块边界」或 PR0 DoD）：**

* `ConfigService`：`resolveRuntimeConfig(inputs): ResolvedConfig`
* `DiagnosticsService`：`getStatusSnapshot(ctx)` / `runDoctor(ctx)`
* `PolicyEngine`：`evaluate(action, ctx): PolicyDecision`
* `ApprovalService`：`request(decision, ui): ApprovalOutcome`
* `LLMClient`：`streamTurn(req): AsyncIterable<LLMEvent>`
* `CommandDispatcher`：`dispatch(cmd, ctx): CommandResult`

**Ports（Adapters）只保留 P0/P1 必需：**

* `FileStore`（config/auth/rules/logs/bundle）
* `PromptUI`（wizard/approval）
* `NetworkClient`（provider connection test + WebFetch/WebSearch）
* `GitProbe`（workspace roots）
* `Clock`（审计/doctor 时间戳）

> 你文档 PR0 目前写了 “fs/llm/network/ui/git/clock” 全套，这是 OK 的，但建议“先接口、后实现、再迁移”，并且 PR0 不要引入任何真实逻辑。

### 需要修订的关键点（按你文档位置落点）

* 【问题】「PR0 — Kernel 骨架」说“加约束先用约定+review”，但后续 PR 很快会出现 core 误引入 node/ink/sdk 的风险→【建议】PR0b 就上 **自动化边界**：eslint `no-restricted-imports` 或 `eslint-plugin-boundaries`，至少禁止 `src/core/**` import `ink` / `node:fs` / `@anthropic-ai/sdk`（你也在 PR0 TODO 写了“后续再自动化”，我建议前移）→【收益】长期维护成本大幅下降；避免“看起来是 core，实际到处依赖”→【风险】初期需要调 eslint 配置→【替代方案】如果暂时不配 eslint，就把 core 单独 tsconfig project reference（更重，但更硬）→【需要我补充的证据/材料】你当前 lint 工具链（eslint/biome/tsc）到底用哪个（package.json scripts/配置文件路径）。
* 【问题】「PR2 — CLI 产品骨架」写了“迁移 `src/features/commands/*` 到 `src/core/commands/*`”，这一步可能过早且改动面大→【建议】PR2 先只做 CLI router + 输出契约；`features/commands` 先通过“适配层”挂进去（例如 `registerLegacySlashCommands()`），迁移延后到 PR6/PR7 之后→【收益】CLI 可脚本化能力更快落地；降低 PR2 风险→【风险】短期存在 legacy 适配层→【替代方案】只迁移 `/status` `/doctor` 两个命令（最小迁移）→【需要我补充的证据/材料】现有 slash commands registry 的入口文件与注册 API（文件路径/函数名）。

---

## C. PR 级评审（PR0..PR10）

### C1) 评分表（1–5；可行性/依赖清晰度/DoD 可验证性：5最好；风险：5=低风险）

| PR   | 主题                                   | 可行性 | 风险(低=5) | 依赖清晰度 | DoD 可验证性 | 评语（聚焦“可交付/可验证”）                                       |
| ---- | ------------------------------------ | --: | ------: | ----: | -------: | ----------------------------------------------------- |
| PR0  | Kernel骨架+Adapters约束                  |   4 |       4 |     4 |        3 | 需要把“约束自动化 + smoke 命令”写死，否则无法证明“零功能改动”                 |
| PR1  | Config/Auth v1 + resolver            |   3 |       3 |     2 |        3 | PR1d CLI 命令依赖 PR2；OS 标准路径跨平台是潜在卡点                     |
| PR2  | CLI 骨架 + `--json` + exit codes       |   4 |       3 |     3 |        4 | 需要补：统一 JSON envelope、stdout/stderr 纪律、exit codes 表    |
| PR3  | Setup Wizard + 首次启动                  |   3 |       3 |     2 |        4 | 你写“复用 doctor 错误码枚举”，但 PR4 在后；顺序需纠正                    |
| PR4  | status/doctor + 错误码体系                |   4 |       3 |     3 |        4 | “doctor exit code=2 配置不可用”会和 CLI usage exit=2 冲突（建议修） |
| PR5  | Policy engine + rules + explain/test |   3 |       3 |     3 |        4 | 需要补：ruleId/撤销命令、explain 的 JSON 字段固定化                  |
| PR6  | ApprovalService + ToolExecutor 统一拦截  |   2 |       2 |     3 |        3 | 工具迁移面最大；必须“分批迁移+每批回归脚本”                               |
| PR7  | debug bundle + 审计日志 + 文案             |   3 |       3 |     4 |        4 | 红线是“不泄露 secrets”；需要强制扫描测试                             |
| PR8  | Release/Distribution                 |   2 |       3 |     4 |        3 | 选型不定会拖很久；建议先写死 1 条主路径（npm）                            |
| PR9  | 多模型：Anthropic+OpenAI-compatible      |   2 |       2 |     3 |        3 | 统一事件接口需更细；OpenAI 工具调用/流式差异是最大风险                       |
| PR10 | Gemini（可选）                           |   1 |       2 |     3 |        2 | 建议只做占位+禁用，不做实装；否则会把架构拖复杂                              |

### C2) 我认为最需要“重排/拆分”的地方（含依赖解释与拆分原则）

* 【问题】当前顺序里 PR3 依赖 PR4（错误码枚举/错误映射），PR1d 依赖 PR2（CLI 骨架/exit codes/help），容易出现“写完才发现缺基建”→【建议】重排（保持 PR 编号不变也行）：

  * **PR0**（骨架+边界）
  * **PR2**（CLI router + help + exit codes + JSON envelope）
  * **PR1a–c**（schema/paths/filestore/resolveRuntimeConfig）
  * **PR4**（error codes + status/doctor）
  * **PR3**（wizard 状态机 + Ink UI，复用 PR4 error codes）
  * **PR5**（policy/rules/explain/test）
  * **PR6**（approval 统一拦截，分批迁移工具）
  * **PR7**（audit + bundle + docs/help）
  * **PR8**（release）
  * **PR9**（multi-provider）
  * **PR10**（占位）
    拆分原则：**每个 PR 都要新增至少 1 个可脚本化命令或 1 个可快照测试点**，否则就是“架构 PR”难验证。→【收益】每一步都有 DoD；回滚成本低；更符合“产品化不是 demo”的目标→【风险】文档 PR 顺序要改、你已有分支命名可能受影响→【替代方案】不重排 PR，只把 PR4 的 errorCodes 提前到 PR3a（本质仍是重排）→【需要我补充的证据/材料】你是否已经开始某些 PR 的实现分支（以避免建议与你当前进度冲突）。

### C3) 最可能卡住的 5 个 TODO（逐条拆分+验收）

1. **PR1b：OS 标准路径计算（XDG/APPDATA/macOS）+ FileStore atomic write + permissions**
   【问题】跨平台路径/权限一旦做错，会造成“配置丢失/权限泄露/迁移失败”，并且难以复现→【建议】拆成 3 个子任务：

   * (1) 先保留现有 `FORMAX_CONFIG_DIR` 行为（默认 `~/.formax`）作为 **稳定回退**（你当前代码已存在 `FORMAX_CONFIG_DIR` / `FORMAX_CONFIG_FILE`）
   * (2) 只为 macOS/Linux 实现 XDG；Windows 先写 TODO + 回退
   * (3) atomic write：先实现 tmp + rename；权限 best-effort 用 `chmod(0o600)`（失败不致命但要 warning）
     每步都写 vitest：路径计算快照、atomic write 不生成半文件、权限 warning。→【收益】避免 PR1b 变“巨坑”；你可以先交付给 mac/linux 用户→【风险】Windows 体验延后→【替代方案】直接宣布 v1.0 只支持 mac/linux，Windows 进入 P2→【需要我补充的证据/材料】你目标用户的 OS 分布（至少你自己/朋友测试环境）。

2. **PR3：wizard 的 connection test + 错误映射（401/403/DNS/timeout/SSL）**
   【问题】如果没有稳定错误码与可执行修复建议，wizard 会变成“漂亮的死路”→【建议】把错误映射抽成 `core/errors/*`，并要求 wizard 与 doctor 共用同一套 `ErrorCode` + `toUserFixSteps()`；同时增加“离线跳过测试/稍后配置”的出口（但默认不跳过）。→【收益】P0 体验稳定；后续接 OpenAI/Gemini 不重写文案→【风险】初期写更多错误分类→【替代方案】wizard 只做 Anthropic，OpenAI 入口完全隐藏直到 PR9→【需要我补充的证据/材料】你现有 anthropic client 抛错形态示例（抓 2–3 个真实错误对象，脱敏即可）。

3. **PR6：ToolExecutor preflight hook + tool→action 映射迁移**
   【问题】这是最容易“漏拦截/体验不一致/回归炸裂”的地方→【建议】先做“强制必经”再做 UI：

   * PR6a：preflight 必经 + deny 能阻断（不弹 UI）
   * PR6b：prompt 才弹统一 UI，并加 `remember`
   * PR6c：每次只迁移 2–3 个工具，并为每批写回归脚本（见下文回归清单）
     →【收益】你永远有可工作的主干；不会一次性迁移导致无法定位问题→【风险】迁移期代码会“新旧并存”→【替代方案】先只统一 Bash/Write/Edit（高风险动作），Read/Glob/Grep 后续再迁→【需要我补充的证据/材料】当前各工具里审批逻辑散落的位置清单（grep 关键字：`Approval`/`askUser`/`confirm`）。

4. **PR7：bundle 不泄露 secrets（pattern 扫描+mask）**
   【问题】debug bundle 一旦泄露 key/token，产品化直接失败→【建议】把“红线测试”写成 vitest：对 bundle 产物做全文扫描，出现 `sk-` / `Authorization:` / `apiKey` / `x-api-key` 就 fail；并把 redaction rules 写进 manifest（bundle 自描述）。→【收益】你敢让陌生用户上传 bundle；支持成本低→【风险】可能误报（用户文本里包含类似字符串）→【替代方案】允许 `--bundle --include-raw`（强提示危险）→【需要我补充的证据/材料】你愿不愿意把“用户输入/模型输出”排除在 bundle 外（我强烈建议默认排除）。

5. **PR9：OpenAI-compatible 流式 + tool calling 映射到统一事件接口**
   【问题】OpenAI-compatible 网关实现不一致，最容易出现“某家能用、换一家就炸”→【建议】PR9c 拆成：

   * (1) 非流式最小可用（能对话+能触发一次工具调用，先不追求增量 delta）
   * (2) 流式文本 delta（不含 tool delta）
   * (3) 流式 tool calling（增量）
     并为每层建立“录制回放测试”（把 provider 原始事件录成 fixture，再跑适配器）。→【收益】把不确定性压进测试夹具；接新网关更快→【风险】PR9 变多 PR→【替代方案】v1.0 只支持 OpenAI 官方 baseUrl；兼容网关延后→【需要我补充的证据/材料】你计划优先支持的 1–2 个 OpenAI-compatible 网关（名字/接口差异）。

---

## D. 多模型兼容评审（PR9/PR10）

### D1) PR9 最小 MVP：必须项 / 可选项 / 明确不做

* **必须项（建议写进 PR9 DoD）**
  【问题】PR9 DoD 目前是“能完成一次包含工具调用的对话”，但缺少“什么算支持”→【建议】PR9 MVP 明确 4 个硬指标：

  1. streaming 文本输出可用（至少一种：全量/增量）
  2. tool calling 可用（能触发并执行至少 1 个工具：建议 `Read` 或 `Glob`）
  3. error mapping 进入统一 `ErrorCode`（401/403/429/5xx/timeout/DNS）
  4. baseUrl + auth 可配置（OpenAI-compatible 的核心）
     →【收益】你能判断“PR9 做完没”；也能做最小测试矩阵→【风险】需要补接口定义与测试夹具→【替代方案】先只做非流式（但你会损失 REPL 体验）→【需要我补充的证据/材料】你现在的 Anthropic streaming/工具调用链路在哪些文件里（入口函数/类名）。

* **可选项（PR9 做了更好，但不阻塞）**

  * `models list`（有则用；无则 fallback 到“尝试一次最小请求验证 model”）
  * usage/token 统计（用于 status/doctor 或审计）
  * tool delta 增量拼接（体验优化）

* **明确不做（PR9 不要碰，否则会爆）**

  * 完整兼容 OpenAI 新旧多套 API（先挑一种协议，必要时做 feature detection）
  * 多 provider 并发/多路 fallback
  * provider-specific prompt engineering 大规模重写

### D2) “统一 LLM 事件接口”是否足够？（你现在写得偏粗）

你文档 PR9a 目前写：`text delta / tool call / tool result / error`。这对 core 来说**可能不够**，原因是：UI/审计/回放测试常需要“边界事件”与“元信息”。

* 【问题】统一事件接口过粗会导致：无法严格测试（不知道何时一个 turn 结束）、无法复现 tool call 组装过程、无法记录 provider/model/requestId→【建议】把统一事件接口扩成 **最小可测试** 的 7 类：

  1. `turn_start`（provider/model/baseUrl/requestId）
  2. `output_text_delta`（string）
  3. `tool_call_start`（id/name/initial args 或空）
  4. `tool_call_delta`（args delta，可选；没有就不发）
  5. `tool_call_end`（final args JSON）
  6. `turn_end`（stopReason/usage 可选）
  7. `error`（ErrorCode + raw redacted）
     →【收益】adapter 可分层实现；回放测试可落地；审计可对齐→【风险】接口更长→【替代方案】保持 4 类，但强制在 `tool call` 里携带完整 final args 且带 `isFinal` 标志→【需要我补充的证据/材料】你 REPL UI 是否依赖“消息开始/结束”事件（例如加载动画/进度条）。

### D3) PR10（Gemini）如何“最小占位”而不污染架构

* 【问题】PR10 checklist 容易变成“再造一套 provider 特例”，把 core 事件接口污染→【建议】PR10 只做 3 件事：

  1. `provider: gemini` 在 schema 里可存在但默认禁用（wizard 隐藏/置灰）
  2. `GeminiAdapter` 返回统一 `error`：`E_PROVIDER_NOT_ENABLED` 或 `E_NOT_IMPLEMENTED`（并在 doctor/status 里可见）
  3. 写一份“接入验证路线文档”（SDK/HTTP、tool calling、streaming 差异点），不写实装
     →【收益】不会拖慢 P0/P1；但为未来接入留好缝→【风险】用户看到 gemini 但不能用（需明确 UI 文案）→【替代方案】PR10 完全不进主干，等你真的要接再开→【需要我补充的证据/材料】你是否必须在 v1.0 宣称 Gemini（如果市场/定位需要，那就至少做占位+禁用）。

### D4) 最小测试矩阵（Anthropic vs OpenAI-compatible）

（建议写进文档「PR9 Tests」或新增「测试矩阵表」）

* **Anthropic**

  1. 纯对话：输入 “hi” → 输出包含非空文本
  2. 工具调用：输入 “列出当前目录文件” → 触发 `Glob`/`Read` 之一并返回摘要
  3. 出错分支：使用假 key → `E_AUTH_401`（或等价）且 doctor 给修复步骤

* **OpenAI-compatible**

  1. 纯对话：同上
  2. 工具调用：同上（至少 1 个工具）
  3. 出错分支：baseUrl 指向不可达 → `E_DNS`/`E_TIMEOUT`（doctor 可解释）

---

## E. 验收与验证（最重要）

> 你要求“写完怎么验证”。下面我按 PR0..PR10 给出 **可复制** 的验证步骤模板。你可以把它们直接粘贴到每个 PR 的 DoD 下。
> 说明：为了避免污染真实配置，我强烈建议所有验证命令都支持 `FORMAX_CONFIG_DIR=/tmp/...`（你当前代码已支持该 env，默认 `~/.formax`）。

### 全局约定（建议写入 PR2 的 CLI 契约）

* `--json`：stdout **只输出 JSON**；日志/调试信息走 stderr
* `--no-color`：禁用 ANSI（便于 snapshot）
* `FORMAX_CONFIG_DIR`：指定隔离配置目录（用于 e2e/回归）【你现有实现已存在】

---

### PR0 验证步骤（Kernel 骨架 + 边界约束）

* 【问题】PR0 DoD 写“行为不变”，但缺少可证明的 smoke 验证→【建议】在 PR0 DoD 增加以下验证命令与最小单测→【收益】你能自信合并“架构 PR”→【风险】多写 1–2 个 test→【替代方案】只做 `tsc --noEmit` + 1 个 createApp 单测→【需要我补充的证据/材料】当前 `typecheck/test` 的 script 名称（package.json）。

**Commands（3–5）**

1. `npx tsc -p tsconfig.json --noEmit`
2. `npx vitest run src/core/app/createApp.test.ts`
3. `FORMAX_CONFIG_DIR=/tmp/formax-pr0 rm -rf /tmp/formax-pr0 && formax --help >/dev/null`（若 PR2 之前还没有 help，就改成启动 REPL 然后 Ctrl+C 退出）

**Expected output**

* `tsc`：exit code 0
* `vitest`：`PASS  src/core/app/createApp.test.ts`
* CLI：退出码 0 或手动退出不报错

**Tests（建议新增）**

* `src/core/app/createApp.test.ts`：`it('can instantiate app and event bus works')`

**Manual checks**

* 若启动 REPL：启动速度、无明显行为变化

---

### PR1 验证步骤（Config/Auth v1 + resolveRuntimeConfig）

* 【问题】PR1 同时包含 schema/paths/resolve/CLI 命令，易出现“库写好了但命令没法验证”→【建议】把 PR1 的验证分成：resolver 单测 + CLI 最小命令（若你采纳重排，则 PR1d 并入 PR2）→【收益】每个子阶段都可验收→【风险】需要写更多 fixtures→【替代方案】先只验 resolver 单测，命令留到 PR2→【需要我补充的证据/材料】你准备的 config/auth 文件名与目录结构最终定稿（`config.json`/`auth.json`/`rules.json` 是否都在同一目录）。

**Commands（示例 5–8）**

1. `export FORMAX_CONFIG_DIR=/tmp/formax-pr1 && rm -rf $FORMAX_CONFIG_DIR`
2. `formax config show --json`
3. `formax auth set anthropic --api-key "sk-test-REDACT"`（或 `--api-key-env FORMAX_API_KEY`）
4. `formax config show --json | jq '.data.resolved.provider'`
5. `formax config migrate --dry-run --json`（如果 migrate 已实现）
6. `FORMAX_CONFIG_DIR=/tmp/formax-pr1 formax config show --json | jq '.warnings'`

**Expected output（关键 1–3 行）**

* `config show --json`：包含 `schemaVersion: 1`、`command: "config.show"`、`data.resolved`（并且 apiKey 被脱敏/不出现）
* `auth set`：exit 0；stderr 不打印 secret
* `migrate --dry-run`：打印将写入的路径/变更摘要（不写盘）

**Tests（建议新增）**

* `src/core/config/schema.test.ts`：schema roundtrip
* `src/core/config/resolve.test.ts`：precedence `flags > env > project > global > defaults`
* `src/core/auth/store.test.ts`：atomic write + redaction
* `src/core/config/paths.test.ts`：path 计算快照（按 OS 分支）

**Manual checks**

* 手动打开 `$FORMAX_CONFIG_DIR/auth.json`：确认不包含明文 apiKey（如果你用 `apiKeyRef`/keyring，则应仅保存 ref）

---

### PR2 验证步骤（CLI 产品骨架 + `--json` + exit codes）

* 【问题】PR2 是“对外契约 PR”，但当前文档未写清 stdout/stderr、统一 JSON envelope、exit codes 表→【建议】把这些写入 PR2 DoD，并加 help 快照测试→【收益】脚本化/CI 立刻可用→【风险】初期文案/契约需要更严谨→【替代方案】先只固化 `status/doctor` 的 schema→【需要我补充的证据/材料】你希望 JSON envelope 的字段命名（`schemaVersion` vs `version`，`data` vs `result`）。

**Commands（6–8）**

1. `formax --help`
2. `formax --help --json`（如果你决定支持；否则跳过）
3. `formax status --json | jq '.schemaVersion, .command, .ok'`
4. `formax status --json >/tmp/out.json && node -e "JSON.parse(require('fs').readFileSync('/tmp/out.json','utf8'))"`
5. `formax unknown-subcommand ; echo $?`
6. `formax status --unknown-flag ; echo $?`
7. `formax doctor --json ; echo $?`

**Expected output**

* `--help`：稳定包含 `repl/setup/status/doctor/config/auth/policy` 命令列表
* unknown command：exit code = 2（usage error），并提示 `--help`
* `status --json`：可被 `JSON.parse`；包含 `schemaVersion:1`、`command:"status"`、`ok:true/false`

**Tests（建议新增）**

* `src/cli/help.test.ts`：help snapshot（`--no-color`）
* `src/cli/args.test.ts`：unknown command/invalid args exit=2
* `src/cli/jsonEnvelope.test.ts`：所有命令 `--json` 产物可 parse

**Manual checks**

* `formax --help` 在窄终端（80 列）不爆版/不乱码

---

### PR3 验证步骤（Setup Wizard + 首次启动）

**Commands（3–6）**

1. `export FORMAX_CONFIG_DIR=/tmp/formax-pr3 && rm -rf $FORMAX_CONFIG_DIR`
2. `formax`（或 `formax setup`）
3. （wizard 内）输入 provider/baseUrl/apiKey → 运行连接测试
4. 完成后：`formax status --json | jq '.data.resolved.provider, .data.resolved.model'`
5. 故意填错 key：重新跑 `rm -rf $FORMAX_CONFIG_DIR && formax setup` 验证 401 分支
6. 故意填错 baseUrl：验证 DNS/timeout 分支

**Expected output**

* 完成后生成 `config.json` / `auth.json`（以及可选 `rules.json`）
* `status` 显示 provider/model/baseUrl（脱敏）
* 错误分支：输出稳定 `ErrorCode` + 可执行修复步骤

**Tests（建议新增）**

* `src/core/setup/stateMachine.test.ts`：welcome→…→done 及回退/取消
* `src/core/errors/mapping.test.ts`：401/timeout/DNS/SSL → ErrorCode
* （可选）`src/ui/SetupWizard.test.tsx`：Ink 交互快照（若你有 ink-testing 工具）

**Manual checks（需要截图/录屏）**

* wizard 每屏文案、默认值、按键提示（Enter/ESC/↑↓）
* wizard 期间 REPL 输入框隐藏（你在 PR3 目标写了）

---

### PR4 验证步骤（status/doctor + 错误码体系）

**Commands（5–8）**

1. `FORMAX_CONFIG_DIR=/tmp/formax-pr4 rm -rf /tmp/formax-pr4`
2. `formax status ; echo $?`
3. `formax status --json | jq '.data.paths, .data.policySummary'`
4. `formax doctor ; echo $?`
5. `formax doctor --json | jq '.data.checks | length, .data.summary'`
6. 模拟缺 key：`FORMAX_CONFIG_DIR=/tmp/formax-pr4 rm -rf /tmp/formax-pr4 && formax doctor --json ; echo $?`
7. 模拟无写权限：把 `FORMAX_CONFIG_DIR` 指到只读目录（或 chmod 500）再跑 doctor

**Expected output**

* `doctor`：0=pass/warn；1=fail；（**建议**把“配置不可用”改成 exit=3，避免与 usage exit=2 冲突）
* `doctor --json`：至少 10 项 checks，每项含 `id/status/message/fix`（字段你可定，但要固定）

**Tests（建议新增）**

* `src/core/diagnostics/doctor.test.ts`：缺 key/baseUrl 不通/无写权限
* `src/core/diagnostics/status.test.ts`：redaction（确保 apiKey 不出现）
* `src/core/errors/errorCodes.test.ts`：枚举稳定（快照）

**Manual checks**

* `/status` `/doctor` slash commands 输出与 CLI 一致（你 PR4 写了共用 core）

---

### PR5 验证步骤（Policy engine + rules + explain/test）

**Commands（6–8）**

1. `export FORMAX_CONFIG_DIR=/tmp/formax-pr5 && rm -rf $FORMAX_CONFIG_DIR && mkdir -p $FORMAX_CONFIG_DIR`
2. 写入一份 rules（global 或 project）：`cat >$FORMAX_CONFIG_DIR/rules.json <<'JSON' ... JSON`
3. `formax policy list --json | jq '.data.rules | length'`
4. `formax policy explain --action bash.exec --cmd "rm -rf /" --json | jq '.data.decision, .data.matchedRule'`
5. `formax policy test --bash "rm -rf /" ; echo $?`（按你文档示例）
6. `formax policy explain --action net.fetch --url "https://example.com" --json`
7. `formax policy explain --action fs.write --path "$PWD/README.md" --json`

**Expected output**

* deny > prompt > allow 优先级正确
* explain 输出能说明“命中了哪条规则、为何拒绝、如何修复”（你 PR5 TODO 写了）

**Tests（建议新增）**

* `src/core/policy/match.test.ts`：冲突、scope precedence
* `src/core/policy/domainMatch.test.ts`：subdomain/allowlist
* `src/core/policy/pathBoundary.test.ts`：越界/normalize/symlink 策略（必须写死）

**Manual checks**

* `policy explain` human 输出对普通用户可读（1 屏内）

---

### PR6 验证步骤（ApprovalService + ToolExecutor 统一拦截）

**Commands（5–8）**

1. `export FORMAX_CONFIG_DIR=/tmp/formax-pr6 && rm -rf $FORMAX_CONFIG_DIR`
2. `formax setup`（配置好 provider，或用 env）
3. 在 REPL 输入：让模型执行一个 **会触发审批** 的动作（例如“把 hello 写入 ./tmp.txt”）
4. 在审批 UI 选择：Allow once → 验证只本次生效
5. 再次触发同动作：应再次提示
6. 选择：Allow always（project scope）→ 再次触发应不提示
7. `formax policy list`：能看到新增规则（remember 落盘）

**Expected output**

* 所有 prompt 行为都走统一 UI（Write/Bash/WebFetch 至少手测 3 类）
* remember 落盘后可 explain 命中

**Tests（建议新增）**

* `src/tools/executor/preflight.test.ts`：preflight 必经（无 preflight 直接执行应 fail）
* `src/core/approval/service.test.ts`：prompt→allowOnce/allowAlways/deny
* `src/core/approval/rememberPatch.test.ts`：生成的 rule patch 可被 `policy list` 读回
* `src/core/policy/wildcardSubagent.test.ts`：`tools:['*']` 不被误杀（你 PR6 TODO 写了）

**Manual checks（截图/录屏）**

* 审批提示文案、选项顺序、Esc 取消一致性（你 PR6 DoD 体验版写了）

---

### PR7 验证步骤（debug bundle + audit log + 文档/帮助）

**Commands（5–8）**

1. `export FORMAX_CONFIG_DIR=/tmp/formax-pr7 && rm -rf $FORMAX_CONFIG_DIR`
2. 跑一次对话触发 1 次工具调用（生成 audit）
3. `formax doctor --bundle --json | jq '.data.bundlePath'`（或 human 输出路径）
4. `tar -tf <bundle>.tar.gz | head`（如果你选择压缩）
5. `rg -n "sk-|Authorization:|x-api-key|apiKey" <bundleDir> && echo "FOUND" || echo "OK"`（红线检查）
6. `formax --help | sed -n '1,80p'`
7. 打开 `docs/troubleshooting.md`（人工检查）

**Expected output**

* bundle 包含 manifest + status/doctor snapshot + redacted config/rules + logs/audit
* bundle 内全文扫描不出现 secrets（vitest 也要覆盖）

**Tests（建议新增）**

* `src/core/diagnostics/bundle.test.ts`：bundle 结构与脱敏
* `src/adapters/fs/auditLog.test.ts`：NDJSON redaction
* `src/cli/help.test.ts`：help 文案包含 exit codes/--json 示例

**Manual checks**

* README QuickStart 可复制粘贴完成安装/启动（你 PR7 TODO 写了）

---

### PR8 验证步骤（Release/Distribution）

**Commands（3–6）**

1. `npm pack`（或你选的发布工具）
2. 在干净目录：`npm i -g <tgz>`（或 brew 安装）
3. `formax --version`
4. `formax` → 自动进入 setup
5. 升级：安装新版后 `formax status --json` 仍能读旧 config/rules（迁移提示正确）

**Expected output**

* 一条命令安装可用；升级不丢配置；doctor 可导 bundle

**Tests（建议）**

* `scripts/e2e/install-smoke.sh`（可选）：在 CI 用容器跑一次最小安装验证
* `src/core/config/migrations.test.ts`：schema version 升级/回滚策略

**Manual checks**

* 找 1–2 个朋友按 README 安装（你 PR8 TODO 已写）

---

### PR9 验证步骤（Anthropic + OpenAI-compatible）

**Commands（6–8）**

1. `FORMAX_CONFIG_DIR=/tmp/formax-pr9 rm -rf /tmp/formax-pr9`
2. `formax setup` 选择 Anthropic，完成后跑一段触发工具调用的对话（录屏）
3. `formax setup` 选择 OpenAI-compatible（配置 baseUrl/apiKey/model），完成后同样跑工具调用对话（录屏）
4. `formax doctor --json | jq '.data.providerChecks'`（字段你定，但应能看到 provider 可用性）
5. 错误分支：baseUrl 指向不可达 → `ErrorCode=E_TIMEOUT/E_DNS`
6. 错误分支：假 key → `ErrorCode=E_AUTH_401`

**Expected output**

* 两个 provider 的统一事件接口都能驱动 REPL：文本 streaming + 至少 1 个 tool call
* 错误码一致、修复建议一致

**Tests（建议新增）**

* `src/adapters/llm/anthropic/adapter.test.ts`：把 anthropic 原始事件 fixture 转换为统一事件
* `src/adapters/llm/openai/adapter.test.ts`：同上（含 tool call）
* `src/core/llm/unifiedEventContract.test.ts`：统一事件序列必须满足（turn_start→…→turn_end）

**Manual checks**

* 同一条“触发工具调用”的提示词，在两 provider 下行为一致（或差异可接受并记录）

---

### PR10 验证步骤（Gemini 占位）

**Commands（3–5）**

1. `formax setup`（默认不显示 gemini）
2. `formax setup --experimental-providers`（若你实现该 flag）
3. 选择 gemini → 应给出 “not enabled / not implemented” 的清晰提示，并且不写坏 config
4. `formax doctor --json`：能报告 provider 未启用原因

**Expected output**

* 不污染主流程；不让用户误选后卡死

**Tests（建议）**

* `src/adapters/llm/gemini/stub.test.ts`：错误码与提示一致

---

### 最小回归脚本清单（10–15 条命令）

> 目标：你每次合并/发版前跑这一套，就能对 P0/P1 的关键能力有信心。

1. `formax --help`（必须包含命令树与最常用示例）
2. `formax unknowncmd ; test $? -eq 2`
3. `FORMAX_CONFIG_DIR=/tmp/formax-reg rm -rf /tmp/formax-reg`
4. `FORMAX_CONFIG_DIR=/tmp/formax-reg formax status --json | jq '.ok'`
5. `FORMAX_CONFIG_DIR=/tmp/formax-reg formax doctor --json ; echo $?`（缺配置时应给明确错误码与修复建议；exit code 按你表）
6. `FORMAX_CONFIG_DIR=/tmp/formax-reg formax config show --json | jq '.data.sources'`
7. `FORMAX_CONFIG_DIR=/tmp/formax-reg formax policy explain --action bash.exec --cmd "rm -rf /" --json | jq '.data.decision'`
8. `FORMAX_CONFIG_DIR=/tmp/formax-reg formax doctor --bundle`（生成 bundle 路径）
9. `rg -n "sk-|Authorization:|x-api-key|apiKey" /tmp/formax-reg/bundles/<latest> && exit 1 || true`
10. （若有 provider key）`FORMAX_CONFIG_DIR=/tmp/formax-reg formax setup`（人工走一次可选）
11. REPL：触发一次 Write 审批（截图）
12. REPL：触发一次 net.fetch（应被 policy 拦截或审批）
13. `formax status --json | node -e "JSON.parse(fs.readFileSync(0,'utf8'))"`（确保机器可读）
14. `formax doctor --json | jq '.data.checks | length >= 10'`
15. `formax --version`

---

## F. 建议补充到文档里的“缺失章节/缺失表格”

1. 【问题】当前只说“`--json` 输出 schema v1”，但没有 schema 字段定义→【建议】新增章节「CLI 输出契约」：统一 JSON envelope v1、每个命令 data schema、stdout/stderr 纪律、`--no-color` 规则→【收益】可脚本化能力落地；测试可快照；第三方集成容易→【风险】需要一次性把字段定稿→【替代方案】先只固化 `status/doctor/policy explain` 三个 schema→【需要我补充的证据/材料】你对“向后兼容”的承诺（字段能加不能删？版本如何 bump）。

2. 【问题】exit codes 在 PR2 只写“定义 0/1/2/3…”，但 PR4 doctor 又定义了自己的 exit code 语义，存在冲突风险→【建议】新增表格「Exit Codes 总表」：全局 exit code（usage/config/runtime）+ doctor 专用（pass/warn/fail）→【收益】CI/脚本可靠；避免未来改坏→【风险】你需要做一次统一取舍（例如 doctor 的 config error 不用 2）→【替代方案】exit codes 全局只用 0/1/2，其它语义放到 JSON `error.code`→【需要我补充的证据/材料】你是否有既定 exit code 偏好（例如遵循 sysexits）。

3. 【问题】policy 规则提了 JSON schema，但没有“PolicyAction 列表/默认决策/是否需要审批”总表→【建议】新增表格「PolicyAction 总表」：action、参数、默认决策、是否进入 ApprovalService、对应工具→【收益】减少漏拦截；新工具接入更快→【风险】前期要把 action 想清楚→【替代方案】先只列 P0 必需 5 个（fs.read/fs.write/bash.exec/net.fetch/net.search）→【需要我补充的证据/材料】你当前工具清单（ToolRegistry 注册处）与每个工具的输入 schema。

4. 【问题】PR9/PR10 讲多模型，但缺 provider 能力矩阵与最小测试矩阵（你在要求里强调了）→【建议】新增「Provider 能力矩阵」+「测试矩阵表」：Anthropic/OpenAI-compatible/Gemini 各支持：streaming、tool calling、models list、error mapping、baseUrl、auth→【收益】避免“接口写得很美但某 provider 做不到”→【风险】文档变长→【替代方案】只写 Anthropic/OpenAI-compatible 两列，Gemini 先占位→【需要我补充的证据/材料】你选择的 OpenAI API 形态（chat.completions vs responses）与目标兼容网关。

5. 【问题】缺“迁移与兼容窗口”章节：env→config/auth 的过渡如何不静默坏掉→【建议】新增「迁移策略」：v0.x 兼容 env、doctor 强提示迁移；v1.0 移除 env；列出 deprecation 文案与检测逻辑→【收益】上线后不会大量 Issue；用户知道怎么修→【风险】需要维护一段兼容逻辑→【替代方案】直接宣布 breaking change，但必须提供 `config migrate` 一键命令→【需要我补充的证据/材料】你当前 env 变量名集合（ANTHROPIC_* 等）与使用位置。

---

## G. 反对者视角挑刺（尖锐版）+ 降级路线图

### G1) “只有周末维护”时，哪里会拖垮你？

* 【问题】PR0/PR1 的“立终局架构 + 跨平台路径 + 强边界”会带来大量非功能性工作，而 P0 价值（setup/status/doctor）可能迟迟交付不了→【建议】把“强边界自动化/跨平台路径”拆成可延后项：P0 只保证 mac/linux + `FORMAX_CONFIG_DIR`，Windows/XDG/APPDATA 放到 PR8 之后→【收益】更快把 CLI 交到朋友手里试用→【风险】后续补 Windows 需要改路径逻辑→【替代方案】直接宣称 v1.0 仅 mac/linux 支持→【需要我补充的证据/材料】你是否必须在 v1.0 覆盖 Windows（商业/用户需求）。
* 【问题】审计事件/NDJSON/bundle 如果把“对话内容”也记进去，隐私与 redaction 成本会指数级上升→【建议】审计默认只记录：policy decision、approval outcome、tool call metadata（参数可部分脱敏）、错误码、耗时；对话文本默认不进 audit/bundle→【收益】你敢默认开启；泄露风险可控→【风险】支持排障可能少一些上下文→【替代方案】提供 `--include-transcript` 显式开关→【需要我补充的证据/材料】你是否有“必须复现对话”的支持诉求（一般不建议）。

### G2) “降级版路线图”（不牺牲安全边界与可维护性）

> 目标：仍保留 **默认安全边界 + 可解释策略 + 可审计日志**，但把“重型架构/跨平台/多 provider”延后。

* **P0（周末可做完）**

  1. PR2（先做）：CLI router + `--json` envelope + exit codes + `status/doctor` 两命令（哪怕内部先调用 legacy）
  2. PR1（简化）：只做 `~/.formax` + `FORMAX_CONFIG_DIR`；config/auth schema + resolver（不做 XDG/APPDATA）
  3. PR3：setup wizard 只支持 Anthropic（OpenAI 入口隐藏）
  4. PR5(min)：policy actions + 默认 deny net + prompt write/bash（规则先只 global JSON，不做复杂 merge）
  5. PR6(min)：只统一 Bash/Write/Edit 审批入口（Read/Glob/Grep 后续）

* **P1（稳定）**
  6) PR4（完善）：doctor checks ≥10 + 统一错误码
  7) PR5(full)+PR6(full)：rules merge + remember 落盘 + explain/test 完整
  8) PR7：bundle + audit（严格 redaction）
  9) PR8：npm 发布（brew 后补）

* **P2**
  10) PR9：OpenAI-compatible
  11) PR10：Gemini

【收益】最快把“陌生用户能用”的闭环跑通；你能早拿到真实反馈
【后果】Windows 与多 provider 会延后；但不影响你 P0/P1 的产品化骨架

---

## （最后）你文档的“修改摘要”（相当于建议做的 diff 大纲）

1. 在「0) 最终目标（验收口径）」后新增一节：**CLI 输出契约**

   * 统一 JSON envelope v1（字段表 + 示例）
   * stdout/stderr 纪律
   * `--no-color`/`--json`/（可选 `--jsonl` 占位）
2. 在「PR2 — CLI 产品骨架」下补 2 张表：

   * Exit Codes 总表（全局 + doctor 特例如何避免冲突）
   * 命令树与每个命令的 JSON schema 索引（至少 status/doctor/config/auth/policy）
3. 调整 PR 依赖顺序（至少解决两处依赖反转）：

   * PR3 依赖 PR4 的 error codes：要么 **重排 PR4 在 PR3 前**，要么把 error codes 提前到 PR3a 并声明 PR4 复用
   * PR1d 的 CLI 命令依赖 PR2：把 PR1d 并入 PR2 或移动到 PR2 之后
4. 在「PR5 — Policy Engine」新增：

   * PolicyAction 总表（action/默认决策/是否审批/参数）
   * rules schema 里增加 `ruleId` 与撤销方式（`policy delete/disable`）
   * `policy explain --json` 的 matchedRule 固定字段
5. 在「PR6 — ApprovalService」新增：

   * 非交互模式（无 TTY/CI）策略：默认 deny + 返回可解释错误码
   * 分批迁移工具的批次清单 + 每批回归脚本（2–3 工具/批）
6. 在「PR7 — debug bundle」新增：

   * bundle 内容白名单/黑名单（明确不包含 secrets/对话文本）
   * vitest “bundle secrets 扫描必过”红线用例
7. 在「PR9 — 多模型兼容」新增：

   * 统一 LLM 事件接口最小可测试版本（turn_start/turn_end/tool_call_* 等）
   * Provider 能力矩阵 + 最小测试矩阵（你要求的 2×3 用例）
8. 在文档末尾新增：**每个 PR 的“验证步骤”小节**（直接粘贴我上面 E 的模板即可），并新增一节：**最小回归脚本清单（10–15 条）**
