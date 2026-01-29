下面这份是“实现级规格说明 + 最小改动落点”，以你给的 repomix 代码为事实基础，把 P0（首次使用/配置/诊断/安全边界/发布）落成可按 PR 逐个实现的改造方案。
我会把**对现状的判断**按【证据】/【推测】拆开，并在最后给出把【推测】变成【证据】的最小验证清单。

---

# 0. 现状基线（从 repomix 提取）

## 【证据】（直接来自代码）

### 0.1 当前配置来源：仅 env（RuntimeConfig）

* `src/env/config.ts` 里 `loadRuntimeConfig()` 读取 `FORMAX_API_KEY / FORMAX_BASE_URL / FORMAX_MODEL / FORMAX_TIMEOUT_MS` 等环境变量；并包含 UI/feature 的 env 开关。


### 0.2 默认“配置目录/文件”常量已经存在（但未真正读取 config 文件）

* `FORMAX_CONFIG_DIR = ~/.formax`，`FORMAX_CONFIG_FILE = ~/.formax/config.json`。


### 0.3 CLI 入口目前直接用 env config 启动 REPL

* `src/entrypoints/cli.tsx`：`cfg = loadRuntimeConfig()`，然后创建 `AnthropicStreamClient({ apiKey, baseUrl, model, timeoutMs })`，注册工具并渲染 `<App/>`。


### 0.4 工具体系：ToolExecutor + ToolModules（Read/Write/Edit/Glob/Grep/WebSearch/WebFetch…）

* 内置工具在 `src/tools/modules/index.ts` 注册（含 Read/Write/Edit/Glob/Grep/WebSearch/WebFetch/Bash/NotebookEdit/Task 等）。


### 0.5 工具执行上下文 ExecutionContext 目前没有 workspaceRoot / policy

* `src/tools/executor/index.ts` 定义了 `ExecutionContext`（cwd/signal/agentDepth/allowTools/denyTools/replMode…），没有 workspaceRoot、网络策略、规则解释等字段。

### 0.6 文件读写工具目前只做“绝对路径”校验，不做 workspace 边界

* Read：`requireAbsolutePath(input.file_path)`，然后读文件；未做 workspace root 限制。

* Write：会提示用户 approve（或 plan mode 限制），但同样没做 workspace root 限制。

### 0.7 WebSearch/WebFetch 已存在，但没有“网络默认策略/allowlist”中枢

* WebSearch 允许传 `allowed_domains/blocked_domains`，并在 handler 内做过滤；这属于“单次调用参数”，不是持久策略。


* WebFetch 工具定义已存在（输入 `url/prompt`），且 module 创建函数可注入 client/maxTokens 等。


### 0.8 你已有一个可复用的“连接测试”逻辑：fetchAnthropicModels

* `src/services/models.ts`：会构造 Anthropic SDK client，并用 `messages.create({ max_tokens: 1, ... })` 做 key/baseURL 可用性测试，然后返回常用模型列表；对 401/403 有明确报错文案。


---

## 【推测】（需要验证/或 repo 未覆盖的部分）

1. Windows/macOS/Linux 上当前运行时实际写权限/路径行为（例如 `~` 展开、权限位 0o600）在你环境中的表现。
2. 你提到要对齐 Claude Code 的默认策略/路径/审批模型：Formax 目前只是“仿 Claude Code 风格”，并不等于 Claude Code。
3. WebFetch 的底层实现（抓网页/抽取/用 Anthropic 再总结）在 repo 里是否对外网访问做了额外限制 —— 我没在已检索片段里看到策略层。

> Claude Code 官方关于权限系统/工作目录/凭证存储/设置层级的说明在其文档中：
>
> * 权限系统：读取 vs 写入/执行需审批；工作目录概念、`--add-dir`/`/add-dir` 等；设置层级与优先级；macOS Keychain/Windows Credential Manager/Linux libsecret 等。
>   下面我会**引用这个 URL**来支撑“我们借鉴其模型”的理由，但不会把 Claude Code 的行为当成 Formax 的既定事实。

---

# A. “配置系统 v1”最终决策

这里是 v1 的**最终选择**（并说明为什么），并给出可落地 schema + 落点。

## A1) 配置文件格式：**JSON（v1 主格式）**

* **决策：v1 用 JSON**
* 未来可选：JSONC / TOML（但 v1 不做解析）
* 理由（【证据】）：

  * repo 已经把默认配置文件命名为 `config.json`（`FORMAX_CONFIG_FILE`）。
  * 现有代码对配置解析尚未实现（目前仅 env），引入 JSON 最少依赖、最直观。

## A2) 配置路径：**v1 默认 `~/.formax`，同时支持 XDG/Windows 标准目录，并提供迁移**

* **决策：v1 默认仍用 `~/.formax`（与现有常量一致）**，但实现时新增一个“路径解析器”，优先遵循 OS 标准目录；并在 `~/.formax` 存量存在时自动迁移/兼容读取。
* 推荐默认路径（v1 实现时“计算出的默认路径”）：

  * **macOS**：`~/Library/Application Support/formax/config.json`
  * **Linux（XDG）**：`$XDG_CONFIG_HOME/formax/config.json`，否则 `~/.config/formax/config.json`
  * **Windows**：`%APPDATA%\formax\config.json`
  * **兼容路径**：`~/.formax/config.json`（你 repo 现有默认）
* 迁移策略（v1）：

  1. 如果 OS 标准路径不存在，但 `~/.formax/config.json` 存在 → **读取并提示迁移**（doctor 强提示），可选 `formax config migrate` 一键搬迁。
  2. 如果 OS 标准路径存在 → 只读标准路径；但仍支持从 `~/.formax` 读取旧 auth（一次性迁移）。

> 参考 Claude Code 的“工作目录/设置层级”理念（工作目录可配置，设置可分层）。
> 但 Formax 的路径与 Claude Code 不必一致——此处只是借鉴“多层 + 迁移”。

## A3) 凭证存储：**文件（0o600）为主；Keychain（可选）/env（兼容）**

* **决策（v1）**

  * 主方案：文件 `auth.json`（权限 0o600 / Windows 用 ACL 或尽量限制）
  * 兼容：读取 env（包含旧 `ANTHROPIC_*2`）
  * 未来可选：macOS Keychain / Windows Credential Manager / Linux libsecret（对齐 Claude Code 的做法）
* 具体落盘：

  * `auth.json`：存 API key 等敏感信息
  * `config.json`：不存 key，只存 `authRef`
* 权限策略（v1）：

  * macOS/Linux：写文件时 `mode: 0o600`；目录 `0o700`
  * Windows：尽力写到 `%APPDATA%` 下并避免 world-readable（**推测**：Node 的 `mode` 不保证 ACL；见验证清单）

## A4) 配置优先级：明确表格（flags/env/config/default）

> v1 将把当前 `loadRuntimeConfig()`（env-only）升级为 `resolveRuntimeConfig()`（flags + env + file + defaults），并提供 `--print-effective-config`（或 `formax status --json`）做可见化。

| 优先级（高→低） | 来源               | 示例                                                                       |
| -------- | ---------------- | ------------------------------------------------------------------------ |
| 1        | CLI flags        | `--profile prod --base-url ... --model ...`                              |
| 2        | 环境变量 env         | `FORMAX_API_KEY`, `FORMAX_BASE_URL`, `FORMAX_MODEL` 等（含旧变量兼容） |
| 3        | 配置文件 config.json | `profiles.default.llm.baseUrl` 等                                         |
| 4        | 默认值 default      | baseUrl 默认 `https://api.anthropic.com`（现有逻辑里也默认该值）                       |

## A5) 旧 env 兼容策略（含 `ANTHROPIC_*2`）

* **决策**：v0.x ~ v1.0 初期仍兼容读取，但**强提示迁移**；到 v1.1（或 v2.0）移除旧变量（可按你节奏调整）。
* 行为规则（v1）：

  * 如果 config/auth 已存在且完整：env 只在显式 `--prefer-env` 或 `--override` 时覆盖（防止“上线后静默坏掉”）
  * 如果 config/auth 缺失：读取 env（包括旧 `ANTHROPIC_*2`）并在 `status/doctor` 输出 `warnings: ["ENV_DEPRECATED: FORMAX_API_KEY"]`
* 理由（【证据】）：当前系统就是靠 `FORMAX_API_KEY` 等工作；直接移除会大面积 break。

---

## A6) v1 配置/凭证数据结构（可直接实现）

### A6.1 config.json（不含 key）

建议新增文件：`src/config/schema.ts`（或 `src/config/types.ts`）

```ts
// src/config/types.ts

export type ConfigVersion = 1;

export type ProviderId = "anthropic"; // v1 只做 anthropic，未来可扩展 openai 等

export type NetworkMode = "off" | "ask" | "allow"; // v1 安全边界会用到

export interface FormaxConfigV1 {
  version: 1;
  defaultProfile: string; // e.g. "default"
  profiles: Record<string, ProfileConfigV1>;

  // 全局行为（不含敏感信息）
  ui?: {
    assistantTextMode?: "standard" | "markdown"; // 对齐你现有 assistantTextModeRaw:contentReference[oaicite:21]{index=21}
    promptProfile?: "full" | "lite";             // 对齐你现有 promptProfileRaw:contentReference[oaicite:22]{index=22}
  };

  // 安全边界（v1）
  security?: {
    workspace?: {
      rootStrategy?: "git" | "cwd" | "explicit"; // 详见 D
      explicitRoot?: string;                     // 当 explicit
      additionalAllowedDirs?: string[];          // 最小落地：额外允许目录
    };
    network?: {
      mode?: NetworkMode;                        // 默认 "off" or "ask"（见 D）
      allowedDomains?: string[];                 // v1 先简单存 domain list
      blockedDomains?: string[];
    };
    // 未来：bash/write/edit 统一审批策略可放这里
  };

  // 文件系统路径（可覆盖）
  paths?: {
    configDir?: string;
    logDir?: string;
    planDir?: string;
  };

  // 遥测/诊断
  diagnostics?: {
    verbose?: boolean;
  };
}

export interface ProfileConfigV1 {
  provider: ProviderId;

  llm: {
    baseUrl?: string;
    model?: string;
    timeoutMs?: number;
    // 不含 apiKey；只引用 auth store
    authRef: string; // e.g. "anthropic-default"
  };

  // provider 特定项（v1 先不加）
}
```

### A6.2 auth.json（含 key）

建议新增：`src/config/authStore.ts`

```ts
export interface AuthStoreV1 {
  version: 1;
  entries: Record<string, AuthEntryV1>; // key = authRef
}

export interface AuthEntryV1 {
  provider: "anthropic";
  apiKey: string;          // 敏感信息
  createdAt: string;       // ISO
  lastValidatedAt?: string;
  // 未来：keychainRef?
}
```

### A6.3 config/ auth 默认文件名（v1）

建议新增常量（复用现有 `src/utils/env.ts`）

* 现有：`FORMAX_CONFIG_DIR`, `FORMAX_CONFIG_FILE`
* 新增：

  * `FORMAX_AUTH_FILE = join(FORMAX_CONFIG_DIR, 'auth.json')`
  * `FORMAX_LOG_DIR = join(FORMAX_CONFIG_DIR, 'logs')`
  * `FORMAX_POLICY_FILE_NAME = '.formax/policy.json'`（workspace 侧）

---

## A7) 最小改动落点（config v1）

### 修改

1. `src/env/config.ts`

   * 从 `loadRuntimeConfig()`（env-only）升级为：

     * `resolveRuntimeConfig(args: CliArgs): ResolvedRuntimeConfig`
     * 仍保留 `loadRuntimeConfigFromEnv()` 作为内部步骤（复用现有解析逻辑）
2. `src/entrypoints/cli.tsx`

   * 在创建 `AnthropicStreamClient` 前调用 `resolveRuntimeConfig()`（可注入 flags）
3. `src/utils/env.ts`

   * 增加 auth/log/policy 的路径常量（或新增 `src/config/paths.ts`）

### 新增

* `src/config/loaders.ts`：读写 config/auth（含权限/原子写）
* `src/config/migrate.ts`：从 env-only → config/auth 的迁移助手
* `src/config/redact.ts`：脱敏（用于 status/doctor）

---

# B. “setup wizard” Ink 交互规格（逐屏/逐键盘）

目标：首次使用时无需读文档，能完成配置/诊断/落盘；且错误分支给**可执行的修复步骤**。

## B1) 进入条件（v1）

进入 setup wizard 的条件（按优先级）：

1. 用户显式执行：

   * CLI：`formax setup`（一定进入）
   * REPL：`/setup`（一定进入）

2. 自动进入（首次使用/配置不完整）：

   * `apiKey` 缺失（config/auth/env 都没有）
   * `model` 为空（最终解析后为空）
   * `baseUrl` 为空或非法 URL（无法 parse）
   * **连接测试失败且错误为可修复类（DNS/timeout/SSL/401/403）**：提示“检测到配置不可用，是否进入修复向导？”（默认 Yes）

> 连接测试建议复用现有 `fetchAnthropicModels(apiKey, baseURL)`，它已经用最小请求验证 key/baseURL，并对 401/403 给了明确错误文案。

## B2) Wizard 状态机（实现级）

建议实现一个显式状态机，便于测试与 PR 拆分。

```ts
type SetupStep =
  | { id: "welcome" }
  | { id: "selectProfile"; suggested: string }
  | { id: "selectProvider" } // v1 只有 anthropic，仍保留 UI
  | { id: "editBaseUrl"; value: string }
  | { id: "editApiKey"; value: string }
  | { id: "testConnection"; baseUrl: string; apiKey: string }
  | { id: "selectModel"; models: string[]; value?: string }
  | { id: "confirm"; summary: SetupSummary }
  | { id: "writeFiles"; summary: SetupSummary }
  | { id: "done"; summary: SetupSummary }
  | { id: "error"; error: SetupError; canRetry: boolean; backTo: SetupStep["id"] };

type SetupErrorCode =
  | "E_AUTH_401"
  | "E_AUTH_403"
  | "E_DNS"
  | "E_TIMEOUT"
  | "E_SSL"
  | "E_HTTP"
  | "E_CONFIG_WRITE"
  | "E_AUTH_WRITE";

type SetupError = { code: SetupErrorCode; message: string; details?: string };
```

## B3) 逐屏规格（含键盘交互）

### Screen 1: Welcome

* 内容：

  * “Welcome to Formax”
  * 当前检测到的状态摘要（脱敏）：是否找到 config/auth/env；是否能连通 baseUrl
  * CTA：

    * `[Enter] Start setup`
    * `[q] Quit`
* 键：

  * Enter → 进入 selectProfile
  * q / Esc → exit code 1（用户取消）

### Screen 2: Select Profile

* 目标：支持多 profile（默认 `default`），便于企业/个人多环境。
* UI：复用现有 `TextInput`（如果已有）或实现一个简单输入框
* 默认值：`default`
* 键：

  * Enter → selectProvider
  * Esc → 回到 welcome

### Screen 3: Select Provider

* v1 只有 anthropic：显示列表但不可选其他（置灰），为未来扩展留 UI。
* 键：

  * 上/下：移动
  * Enter：选中 anthropic → editBaseUrl
  * Esc：回到 selectProfile

### Screen 4: Edit Base URL

* 默认值优先级：

  1. 解析后的 effective baseUrl（来自 flags/env/config）
  2. 空则 `https://api.anthropic.com`
* 输入校验：

  * 必须是 `http`/`https`；去掉末尾 `/`
* 键：

  * Enter → editApiKey
  * Ctrl+U → 清空输入（可选）
  * Esc → 回到 selectProvider

### Screen 5: Edit API Key（不回显）

* 要求：不回显、可粘贴
* UI：复用 `TextInput`，加 `mask="*"` 或 `conceal` 逻辑
* 键：

  * Enter → testConnection
  * Esc → 回到 editBaseUrl

### Screen 6: Test Connection（连接测试）

* 行为：调用 `fetchAnthropicModels(apiKey, baseURL)`

  * 成功：拿到 common models 列表并进入 selectModel
  * 失败：进入 error screen，按错误类型展示“可执行修复步骤”
* 为什么用这个函数（【证据】）：

  * 它已经实现了：baseURL 规范化、创建 Anthropic client、用 `messages.create(max_tokens:1)` 做最小验证，并区分 401/403/网络错误。
* 键：

  * 运行中：`Ctrl+C` → 中止测试并返回 editApiKey

### Screen 7: Select Model

* UI：复用现有 `Select` 组件（repo 里已有选择 UI 的 pattern：AskUserQuestion presenter 支持 select/multiSelect）
* 列表：

  * 用 testConnection 得到的 common models（或 fallback list）
  * “Custom…” 选项：允许手动输入模型名
* 键：

  * Enter → confirm
  * Esc → 回到 editApiKey（允许改 key）

### Screen 8: Confirm

* 展示：

  * profile/provider/model/baseUrl
  * config path / auth path / log dir / workspace root（如已检测）
  * “API key: sk-****abcd”（脱敏）
* 操作：

  * `[Enter] Save`
  * `[b] Back`
  * `[q] Quit without saving`
* 键：

  * Enter → writeFiles
  * b/Esc → 回到 selectModel
  * q → exit code 1

### Screen 9: Write Files（落盘）

* 行为（必须全成功，否则 error）：

  1. mkdir configDir (0700)
  2. 写 `config.json`（原子写：temp + rename）
  3. 写 `auth.json`（0600）
  4. mkdir logDir（0700）
  5. 可选：写 `policy.json` 初始化（见 D）
* 键：

  * 无（显示进度）
* 成功 → done

### Screen 10: Done

* 输出：

  * “Setup complete.”
  * “Next: run `formax repl` or just `formax`”
  * “Tip: run `formax doctor` if you hit issues.”
* 键：

  * Enter → 退出（exit 0）
  * 自动退出也可

## B4) 失败分支：错误码→显示文案→可执行修复步骤

> Wizard 的错误分类要跟 C/D 的 doctor 错误码体系一致。

| 场景               | 错误码                           | 展示文案（建议）             | 修复步骤（必须可执行）                                                                                 |
| ---------------- | ----------------------------- | -------------------- | ------------------------------------------------------------------------------------------- |
| 401 Unauthorized | E_AUTH_401                    | “API key 无效（401）。”   | 1) 重新粘贴 key；2) 若使用代理/网关，确认是否需要不同 key；3) `formax doctor --json` 查看详细                         |
| 403 Forbidden    | E_AUTH_403                    | “API key 没有权限（403）。” | 1) 换 key；2) 确认账号权限/组织策略；3) 若走企业网关，确认允许该模型                                                   |
| DNS              | E_DNS                         | “无法解析域名（DNS）。”       | 1) 检查 baseUrl 拼写；2) 检查系统 DNS；3) 若需代理：设置 `HTTPS_PROXY` 并重试；4) 用 `nslookup <host>`（提示命令）      |
| timeout          | E_TIMEOUT                     | “连接超时。”              | 1) 检查网络；2) 如需代理设置 `HTTPS_PROXY`; 3) 提高 timeout：`formax config set llm.timeoutMs 600000`（示例） |
| SSL              | E_SSL                         | “TLS/证书错误。”          | 1) 检查企业中间人证书；2) 确认系统证书链；3) 若 baseUrl 是自签名网关，导入 CA                                           |
| 其他 HTTP          | E_HTTP                        | “HTTP 错误：xxx”        | 1) 查看 baseUrl 是否兼容 Anthropic API；2) 运行 doctor 获取响应片段（脱敏）                                    |
| 写文件失败            | E_CONFIG_WRITE / E_AUTH_WRITE | “无法写入配置文件。”          | 1) 检查目录权限；2) `ls -ld <dir>`；3) 换路径：`--config-dir`                                           |

## B5) 组件复用/新增与文件落点

### 可复用

* `AskUserQuestion` 的 question schema + presenter 能做 select/multiSelect/review 等交互（你已有 userInputManager 体系）
* `Select/TextInput`（如 repo 已有 UI 组件，可复用；否则用 AskUserQuestion 方式实现“向导每一步”也可以）

### 建议新增（最少）

* `src/screens/SetupWizard.tsx`（Ink 主组件）
* `src/features/setup/stateMachine.ts`（纯逻辑，可单测）
* `src/features/setup/connectionTest.ts`（复用 `fetchAnthropicModels`）
* `src/features/setup/persist.ts`（写 config/auth/log/policy）

---

# C. “/status + /doctor” 输出规格与实现落点

目标：让用户/CI/支持同学能一眼看懂配置是否正确、问题在哪、怎么修。

## C1) status 输出字段（必须脱敏）

### 人类可读（默认）

建议输出示例：

```
Formax Status
- profile: default
- provider: anthropic
- model: claude-3-5-sonnet-latest
- baseUrl: https://api.anthropic.com
- configPath: /Users/me/.../config.json
- auth: present (apiKey: sk-****abcd)
- logDir: /Users/me/.../logs
- mode: repl
- workspaceRoot: /Users/me/project
- security:
  - fs: workspace-only (extra: 0 dirs)
  - network: off (allowed: 0 domains)
```

### `--json`（机器可读）

JSON schema（v1）：

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "FormaxStatusV1",
  "type": "object",
  "required": ["version","profile","provider","model","baseUrl","paths","security"],
  "properties": {
    "version": { "type": "integer", "enum": [1] },
    "profile": { "type": "string" },
    "provider": { "type": "string" },
    "model": { "type": "string" },
    "baseUrl": { "type": "string" },
    "paths": {
      "type": "object",
      "required": ["configPath","authPath","logDir"],
      "properties": {
        "configPath": { "type": "string" },
        "authPath": { "type": "string" },
        "logDir": { "type": "string" }
      }
    },
    "auth": {
      "type": "object",
      "required": ["present","redactedHint"],
      "properties": {
        "present": { "type": "boolean" },
        "redactedHint": { "type": "string" }
      }
    },
    "mode": { "type": "string", "enum": ["cli","repl"] },
    "workspaceRoot": { "type": "string" },
    "security": {
      "type": "object",
      "required": ["fs","network"],
      "properties": {
        "fs": {
          "type": "object",
          "required": ["mode","allowedDirs"],
          "properties": {
            "mode": { "type": "string", "enum": ["workspace-only","custom"] },
            "allowedDirs": { "type": "array", "items": { "type": "string" } }
          }
        },
        "network": {
          "type": "object",
          "required": ["mode","allowedDomains"],
          "properties": {
            "mode": { "type": "string", "enum": ["off","ask","allow"] },
            "allowedDomains": { "type": "array", "items": { "type": "string" } }
          }
        }
      }
    },
    "warnings": { "type": "array", "items": { "type": "string" } }
  }
}
```

## C2) doctor 的检查列表（P0）

doctor 由一串 checks 组成，每个 check 有统一结构（pass/warn/fail + code + fix）。

必做 checks：

1. 配置文件读取/解析（存在？版本？字段？）
2. auth store 读取/解析（存在？该 profile 的 authRef 存在？）
3. workspaceRoot 探测（见 D）
4. logDir/configDir/authPath 写权限（mkdir + write temp file）
5. baseUrl 合法性（parse URL、scheme、去尾斜杠）
6. 代理环境变量检测（`HTTPS_PROXY/HTTP_PROXY/NO_PROXY`）
7. 网络连通性：对 baseUrl 做一次最小请求（同 setup 的 connection test）
8. 鉴权：401/403 分类
9. SSL/证书：捕获错误类型（见错误映射）
10. 工具策略：网络默认策略、允许目录列表、policy 文件可读写

输出示例（默认人类可读）：

```
Formax Doctor
[PASS] config: loaded (v1) at ...
[PASS] auth: entry anthropic-default present
[WARN] env: deprecated FORMAX_API_KEY is set (use `formax setup`)
[PASS] workspace: /Users/me/project (git root)
[PASS] fs: can write config/log dirs
[FAIL] network: E_DNS cannot resolve api.anthropic.com
  Fix:
   - Check baseUrl
   - Check DNS
   - If behind proxy: export HTTPS_PROXY=...
```

`--json` 结构：

```ts
export interface DoctorReportV1 {
  version: 1;
  ok: boolean;
  checks: DoctorCheckV1[];
  summary: { pass: number; warn: number; fail: number };
}

export interface DoctorCheckV1 {
  id: string;                  // e.g. "network.connectivity"
  status: "pass"|"warn"|"fail";
  code?: DoctorErrorCode;       // e.g. "E_DNS"
  message: string;
  details?: Record<string, any>; // 脱敏后细节
  fix?: string[];              // 可执行步骤
}
```

## C3) 错误分类：Anthropic/HTTP/Node 错误 → 错误码（统一文案）

### 错误码（建议 v1）

* `E_AUTH_401`：鉴权失败（401）
* `E_AUTH_403`：无权限（403）
* `E_TIMEOUT`：超时（AbortError / ETIMEDOUT）
* `E_DNS`：DNS 解析失败（ENOTFOUND / EAI_AGAIN）
* `E_CONN_REFUSED`：ECONNREFUSED
* `E_SSL`：TLS/证书（ERR_TLS_* / CERT_*）
* `E_HTTP`：其他 HTTP 状态（>=400）
* `E_CONFIG_PARSE` / `E_CONFIG_WRITE`
* `E_AUTH_PARSE` / `E_AUTH_WRITE`
* `E_POLICY_DENY`：被策略拒绝（见 D）
* `E_UNKNOWN`

### 统一文案模板（示例）

* `E_AUTH_401`：`Authentication failed (401). Please re-run 'formax setup' or set a valid API key.`
* `E_DNS`：`DNS lookup failed. Check your baseUrl and network/DNS settings.`
* `E_SSL`：`TLS/SSL error. If you're behind a corporate proxy, ensure the CA certificate is trusted.`

## C4) 具体落点（文件修改建议）

### 新增

* `src/features/diagnostics/status.ts`

  * `getStatusSnapshot(ctx): StatusV1`
  * `formatStatusHuman(snapshot): string`
* `src/features/diagnostics/doctor.ts`

  * `runDoctor(ctx): DoctorReportV1`
  * `formatDoctorHuman(report): string`
* `src/features/diagnostics/errors.ts`（错误映射）

### 修改（绑定现有入口/命令）

* `src/features/commands/registry.ts`：新增 `/status`、`/doctor`（REPL 内）

  * 你已把它作为“单一事实来源”。（同时 overview 也指出 registry 是命令源）
* `src/entrypoints/cli.tsx`：新增子命令 `status/doctor`（CLI）并复用同一实现（见 G）

---

# D. “安全边界 v1”（默认只允许 workspaceRoot）

这是最关键 P0：把“默认只允许 workspaceRoot”落成**可解释、可持久化、可测试**的机制，并把审批从“分散在 handler”收敛到一个中枢。

## D1) workspaceRoot 如何确定（最终决策）

**决策：workspaceRoot 的确定优先级：**

1. CLI flag：`--workspace <path>`（显式最高优先级）
2. env：`FORMAX_WORKSPACE_ROOT`
3. config：`security.workspace.explicitRoot`
4. 自动探测：

   * 若 `git` 可用且当前在 git repo：`git rev-parse --show-toplevel`
   * 否则：`process.cwd()`

> 参考 Claude Code 的“工作目录”概念：默认是启动目录，并可通过 `--add-dir`/`/add-dir` 增加额外目录。
> Formax v1 的策略更严格：默认只允许 workspaceRoot（而不是多 working dirs），但保留“额外允许目录”机制。

实现建议：新增 `src/security/workspace.ts`

```ts
export interface WorkspaceResolution {
  root: string;
  strategy: "flag"|"env"|"config"|"git"|"cwd";
  details?: string;
}

export async function resolveWorkspaceRoot(args: {
  cwd: string;
  flagWorkspace?: string;
  envWorkspace?: string;
  configWorkspace?: string;
}): Promise<WorkspaceResolution> { /* ... */ }
```

## D2) Read/Glob/Grep 是否限制在 workspaceRoot（默认）？超出走审批

**决策：默认限制在 workspaceRoot；超出必须走审批（一次/永久/规则）**。

### 覆盖的工具（v1 P0）

* FS 读：`Read`, `Glob`, `Grep`, `LS`（如有）
* FS 写：`Write`, `Edit`, `NotebookEdit`
* 其他：未来可扩

理由（【证据】）：当前 Read/Write 只校验绝对路径，不限制 workspace。

* Read：`requireAbsolutePath` 后直接读取。
* Write：提示 approval，但仍可写任意绝对路径。

### 审批类型

* Allow once（仅本次会话记忆）
* Allow permanently for this workspace（写入 workspace policy）
* Allow permanently for user（写入 user policy，全局生效）
* Deny（本次拒绝，可选“永久拒绝”也写入 policy）

## D3) WebFetch/WebSearch 网络策略：v1 选项与默认

**决策：v1 默认 network = off**（保守、安全；避免“上线后静默泄露”），但 wizard/doctor 明确提示并给一键开启/按域名允许的路径。

* `network.mode`：

  * `off`：所有 WebSearch/WebFetch 拒绝（提示如何开启）
  * `ask`：每个新域名首次询问（可记忆到 allowlist）
  * `allow`：全放开（仍可用 blocklist）
* allowlist 的存储：

  * v1 先简单：`config.security.network.allowedDomains[]`（全局）
  * workspace 侧细粒度：`policy.json` 规则（见 D5）

理由：

* 你 repo 已实现 WebSearch/WebFetch，但没有统一的持久网络策略中枢（WebSearch 的 allow/block 是“单次输入参数”）
* 先默认 off 能把风险边界做实，再逐步开放。

## D4) Bash/Write/Edit 的审批策略如何统一（从分散 tool handler → 中枢）

现状（【证据】）：Write handler 自己用 userInput 做 approval（以及 plan mode 的特殊逻辑）。

**决策：v1 不推翻现有 approval UI**（避免大改），而是增加一个**PolicyEnforcer（前置拦截）**，统一做：

* workspaceRoot 边界检查（读/写）
* network 策略检查（WebSearch/WebFetch）
* 规则持久化 & explain（为什么允许/为什么拒绝）

这样：

* Write/Edit 原有的“是否允许写入”弹窗仍在（你现有 UX 不变）
* 但“是否允许跨 workspace 访问/是否允许联网”由 PolicyEnforcer 统一做

## D4.1 拦截点设计：ToolExecutor 层（最小且不易绕过）

**决策：拦截放在 ToolExecutor 层（而不是每个 handler）**。

理由（【证据】）：工具统一走 `ToolExecutor`，并由 chat engine 调用 `executor(call, ctx)`。
如果你在 handler 里分散做边界，很容易漏掉；放 executor 里可以“一处覆盖全部工具”。

### 最小改动实现方式（推荐）

* 不改 `createToolExecutor()` 的核心逻辑，新增 wrapper：

新增文件：`src/security/policyExecutor.ts`

```ts
import type { ToolExecutor, ExecutionContext } from "../tools/executor";
import type { ToolCall, ToolResult } from "../tools/types";
import type { UserInputManager } from "../tools/runtime/userInputManager";

export interface PolicyEnforcer {
  evaluate(call: ToolCall, ctx: ExecutionContext): Promise<PolicyDecision>;
  // 可选：explain(call, ctx)
}

export type PolicyDecision =
  | { kind: "allow" }
  | { kind: "deny"; code: string; message: string; explain: PolicyExplain }
  | { kind: "prompt"; prompt: PolicyPrompt; explain: PolicyExplain };

export function createPolicyEnforcingExecutor(args: {
  base: ToolExecutor;
  policy: PolicyEnforcer;
  userInput: UserInputManager;
}): ToolExecutor {
  return async (call, ctx) => {
    const decision = await args.policy.evaluate(call, ctx);

    if (decision.kind === "allow") return args.base(call, ctx);

    if (decision.kind === "deny") {
      return {
        tool_use_id: call.id,
        is_error: true,
        content: decision.message + "\n\n" + formatPolicyExplain(decision.explain),
      };
    }

    // prompt
    const answer = await args.userInput.requestAnswers({
      toolUseId: call.id,
      questions: buildPolicyQuestions(decision.prompt),
      signal: ctx.signal,
    });

    const followup = await args.policy.applyPromptAnswer(decision.prompt, answer);
    if (followup.kind === "allow") return args.base(call, ctx);

    return {
      tool_use_id: call.id,
      is_error: true,
      content: followup.message + "\n\n" + formatPolicyExplain(followup.explain),
    };
  };
}
```

> `UserInputManager.requestAnswers(...)` 现成可用（含 select/multiSelect/review），适合用来做“Allow once / Allow always”等审批选择。

## D5) 规则持久化格式（JSON schema + 示例规则）

### 文件位置（v1）

* workspace policy：`<workspaceRoot>/.formax/policy.json`
* user policy：`<configDir>/policy.json`（例如 `~/.formax/policy.json` 或 OS 标准路径）

### Schema（v1，够用、可扩展）

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "FormaxExecPolicyV1",
  "type": "object",
  "required": ["version", "rules"],
  "properties": {
    "version": { "type": "integer", "enum": [1] },
    "updatedAt": { "type": "string" },
    "rules": {
      "type": "array",
      "items": { "$ref": "#/definitions/rule" }
    }
  },
  "definitions": {
    "rule": {
      "type": "object",
      "required": ["id", "effect", "tools", "resource"],
      "properties": {
        "id": { "type": "string" },
        "effect": { "type": "string", "enum": ["allow", "deny"] },
        "tools": {
          "type": "array",
          "items": { "type": "string" }
        },
        "resource": {
          "oneOf": [
            { "$ref": "#/definitions/pathResource" },
            { "$ref": "#/definitions/domainResource" }
          ]
        },
        "reason": { "type": "string" },
        "createdAt": { "type": "string" }
      }
    },
    "pathResource": {
      "type": "object",
      "required": ["type", "path", "match"],
      "properties": {
        "type": { "type": "string", "enum": ["path"] },
        "path": { "type": "string" },
        "match": { "type": "string", "enum": ["prefix", "exact"] }
      }
    },
    "domainResource": {
      "type": "object",
      "required": ["type", "domain", "includeSubdomains"],
      "properties": {
        "type": { "type": "string", "enum": ["domain"] },
        "domain": { "type": "string" },
        "includeSubdomains": { "type": "boolean" }
      }
    }
  }
}
```

### 示例规则（3 条，覆盖你的 P0）

1. **默认允许 workspaceRoot（prefix）**

```json
{
  "id": "allow-workspace",
  "effect": "allow",
  "tools": ["Read","Write","Edit","Glob","Grep","NotebookEdit"],
  "resource": { "type": "path", "path": "/Users/me/project", "match": "prefix" },
  "reason": "Default workspace access",
  "createdAt": "2026-01-10T00:00:00.000Z"
}
```

2. **允许访问某个外部目录（比如 monorepo 共享包）**

```json
{
  "id": "allow-shared-lib",
  "effect": "allow",
  "tools": ["Read","Glob","Grep"],
  "resource": { "type": "path", "path": "/Users/me/shared-lib", "match": "prefix" },
  "reason": "Shared library outside workspace",
  "createdAt": "2026-01-10T00:00:00.000Z"
}
```

3. **允许某个域名（WebFetch/WebSearch）**

```json
{
  "id": "allow-domain-docs",
  "effect": "allow",
  "tools": ["WebFetch","WebSearch"],
  "resource": { "type": "domain", "domain": "example.com", "includeSubdomains": true },
  "reason": "Docs domain allowlist",
  "createdAt": "2026-01-10T00:00:00.000Z"
}
```

## D6) 匹配顺序与冲突处理

**决策（v1）：最具体优先 + deny 优先**

* 计算 match score：

  * path/exact > path/prefix
  * prefix 越长分越高（更具体）
  * domain exact > includeSubdomains
* 选择 score 最高的规则
* score 相同时：deny > allow
* 再相同：按 rules 数组顺序（先出现优先）

## D7) explain 输出格式（命中/拒绝原因必须可解释）

建议统一 `PolicyExplain`：

```ts
export interface PolicyExplain {
  request: {
    tool: string;
    resource:
      | { type: "path"; target: string; workspaceRoot: string }
      | { type: "domain"; target: string };
  };
  decision: "allow" | "deny" | "prompt";
  matchedRule?: {
    id: string;
    effect: "allow" | "deny";
    source: { scope: "workspace" | "user"; path: string };
    score: number;
    reason?: string;
  };
  reason: string;        // 人类可读
  suggestions?: string[]; // 下一步建议
}
```

### 对用户输出（人类可读）示例

```
Policy denied: Read /etc/passwd
- workspaceRoot: /Users/me/project
- reason: target is outside workspace and no allow rule matched
To proceed:
  - Allow once (interactive prompt)
  - Or: formax execpolicy allow path /etc --scope workspace
```

### /execpolicy explain（额外命令，强烈建议加）

* CLI：`formax execpolicy explain --tool Read --path /etc/passwd --json`
* REPL：`/execpolicy explain tool=Read path=/etc/passwd`

---

# E. 最小 PR 切分计划（可直接照着做）

我按“每个 PR 只做一件事”的原则拆成 6 个 PR。每个 PR 都写清：改动文件列表、核心接口、验收步骤、需要补的测试。

> 统一测试框架：vitest（repo 已用）

---

## PR1 — 配置文件 & auth store 基础设施（读写/脱敏/优先级骨架）

**目标**：引入 config.json + auth.json，但不改启动流程（仍可 env-only 跑）。

### 改动文件

* ✅ 新增

  * `src/config/types.ts`（FormaxConfigV1/AuthStoreV1）
  * `src/config/paths.ts`（default path 计算：XDG/Windows + legacy ~/.formax）
  * `src/config/loaders.ts`（read/write/atomicWrite）
  * `src/config/redact.ts`（脱敏）
* ✏️ 修改

  * `src/utils/env.ts`：补充 AUTH/LOG 等常量（可选）
  * `src/env/config.ts`：增加 `loadRuntimeConfigFromEnv()`（保留现有）

### 核心接口

* `loadConfig(): FormaxConfigV1 | null`
* `loadAuthStore(): AuthStoreV1 | null`
* `saveConfig(config: FormaxConfigV1): void`
* `saveAuthStore(store: AuthStoreV1): void`
* `redactApiKey(key: string): string`

### 验收步骤

* `npm test -- src/config/loaders.test.ts`
* 手动：删除/创建 configDir 后运行一个小脚本（或 `node dist` 后续 PR）验证：

  * 能写出 config.json/auth.json
  * auth.json 权限（mac/linux 0600）

### 测试（vitest）

1. 写入/读取 config round-trip
2. auth.json 脱敏
3. atomicWrite：中途失败不会破坏原文件（模拟）

---

## PR2 — RuntimeConfig 解析升级：flags/env/config/default（但不改 UI）

**目标**：实现 precedence，产生 effective config；为 setup/status/doctor 做基础。

### 改动文件

* ✏️ 修改

  * `src/env/config.ts`：新增 `resolveRuntimeConfig(cliArgs)`，内部按优先级合并
  * `src/entrypoints/cli.tsx`：仅把 cfg 获取方式替换成 resolve（先不加子命令）

### 核心接口

```ts
export interface CliArgs {
  profile?: string;
  baseUrl?: string;
  model?: string;
  timeoutMs?: number;
  configDir?: string;
  json?: boolean;
}

export interface ResolvedRuntimeConfig {
  profile: string;
  provider: "anthropic";
  llm: { apiKey: string; baseUrl: string; model: string; timeoutMs: number; };
  paths: { configPath: string; authPath: string; logDir: string; };
  security: { networkMode: "off"|"ask"|"allow"; allowedDomains: string[]; allowedDirs: string[]; };
  warnings: string[];
  sources: Record<string, "flag"|"env"|"config"|"default">; // 便于 status/doctor
}
```

### 验收步骤

* `npm test -- src/env/resolveRuntimeConfig.test.ts`

### 测试（vitest）

4. precedence：flags 覆盖 env/config
5. precedence：env 覆盖 config
6. 兼容旧 env：`FORMAX_API_KEY` 生效并产生 warning

---

## PR3 — CLI 命令树（setup/status/doctor/config/auth/repl）+ `--help`

**目标**：让 `formax status`/`formax doctor` 能在不启动 Ink 的情况下工作（便于脚本/CI）。

### 改动文件

* ✏️ 修改

  * `src/entrypoints/cli.tsx`：加入 argv parsing + 子命令路由
* ✅ 新增

  * `src/cli/args.ts`（轻量 parse，不引入 commander）
  * `src/cli/help.ts`（集中管理 help 文案）

### 验收步骤

* `formax --help` 输出完整帮助
* `formax status --json` 输出 JSON
* `formax doctor --json` 输出 JSON + exit code 0/非0

### 测试（vitest）

7. CLI args 解析：`status --json`、未知命令返回 exit 2

---

## PR4 — Setup Wizard（Ink）+ 自动触发

**目标**：真正解决首次使用体验：没 key/不可达 → 自动进入向导。

### 改动文件

* ✅ 新增

  * `src/screens/SetupWizard.tsx`
  * `src/features/setup/*`（stateMachine/ persist / connectionTest）
* ✏️ 修改

  * `src/entrypoints/cli.tsx`：当 `resolveRuntimeConfig()` 检测缺 key/模型空 → 进入 wizard

### 验收步骤

* 清空 config/auth/env → `formax` 自动进入 setup
* 输入 key/baseUrl → 测试成功 → 写 config/auth → 进入 repl 或退出
* 错误分支：用假 key 测 401/403

### 测试（vitest）

8. stateMachine：输入流程、回退、取消（纯逻辑单测）
9. connectionTest：mock `fetchAnthropicModels` 抛 401/403 时映射到正确错误码

---

## PR5 — /status + /doctor（REPL + CLI 复用同一份实现）

**目标**：诊断落地；REPL `/doctor` 与 CLI `formax doctor` 共享实现。

### 改动文件

* ✅ 新增

  * `src/features/diagnostics/status.ts`
  * `src/features/diagnostics/doctor.ts`
  * `src/features/diagnostics/errors.ts`
* ✏️ 修改

  * `src/features/commands/registry.ts`：新增 `/status` `/doctor`（本地命令）
  * `src/entrypoints/cli.tsx`：子命令调用 diagnostics

### 验收步骤

* `formax status`（人类可读）
* `formax status --json`
* REPL 输入 `/status` `/doctor` 能输出同样信息

### 测试（vitest）

10. status 脱敏：不会输出 apiKey 原文
11. doctor 分类：DNS/timeout/401/403 映射正确

---

## PR6 — 安全边界 v1：workspaceRoot + 规则持久化 + 网络策略

**目标**：默认只允许 workspaceRoot，网络默认 off；并能 explain & 持久化。

### 改动文件

* ✅ 新增

  * `src/security/workspace.ts`
  * `src/security/policyStore.ts`
  * `src/security/policyEngine.ts`
  * `src/security/policyExecutor.ts`（ToolExecutor wrapper）
* ✏️ 修改

  * `src/entrypoints/cli.tsx`：创建 policyEnforcer 并 wrap tool executor
  * `src/chat/engine.ts`：如需把 workspaceRoot 传到 executor ctx，可扩展 exec pick（目前 pick 很窄）
  * （可选）`src/features/commands/registry.ts`：新增 `/execpolicy`（可先仅 explain）

### 验收步骤

* 在 workspace 里：Read/Write workspace 内文件 → ok
* 访问 `/etc/hosts`：

  * 第一次提示审批（allow once / always）
  * 选择 “deny” → tool result error，含 explain
  * 选择 “allow workspace” → 写入 `.formax/policy.json`，下次不再提示
* WebFetch/WebSearch：

  * network off 默认拒绝
  * 开启 allow domain → 生效

### 测试（vitest）

12. path boundary：workspace 内允许，外部默认拒绝
13. policy persistence：写入 policy 后匹配成功
14. domain policy：allowlist 匹配 subdomain
15. conflict resolution：deny 覆盖 allow（同 score）

---

# F. 验证清单（把【推测】变成【证据】）

你要提供的材料尽量少，但能验证最多假设。下面每条我都写了“你该运行/截图/抓什么”。

## F1) 运行输出（最少 3 条命令）

1. **当前版本（未改前）启动行为**

   * 运行：`formax`（或 `npm run dev`）
   * 截图：启动后第一屏（是否直接 REPL、是否报错）
   * 目的：确认“无 key 时的用户体验”现状（证据化）

2. **不同 OS 路径/权限行为（mac/linux/windows 任选你目标平台）**

   * 运行：`node -e "const fs=require('fs'); fs.writeFileSync('tmp', 'x', {mode:0o600}); console.log(fs.statSync('tmp').mode.toString(8));"`
   * 截图/输出：stat mode
   * 目的：验证 “0o600 是否生效”（Windows 可能不等价）→ 把权限策略从推测变证据

3. **网络错误分类（DNS/timeout/SSL）**

   * 修改 baseUrl 为一个不存在域名（例如 `https://no-such-domain.invalid`）
   * 运行：`formax doctor --json`（实现后）
   * 目的：验证 error mapping 是否能区分 E_DNS/E_TIMEOUT/E_SSL

## F2) Claude Code 对齐点（你若要“对齐 Claude Code”，建议用官方文档 + 实测）

* 官方文档证据（我已引用 URL）：权限系统/工作目录/凭证存储/设置层级
* 若你要进一步“实测 Claude Code 行为”（可选）：

  * 运行 Claude Code 并截图：

    1. 第一次写文件/执行 bash 的审批 UI
    2. settings 层级与位置（例如 `~/.claude/settings.json`）
  * 目的：把“交互细节/默认值”从推测变证据（用于文案与 UX 对齐）

---

# G. CLI/命令契约（可实现的接口）

## G1) 命令树（v1）

```
formax [repl] [--profile <name>] [--workspace <path>] [--config-dir <path>] [--json]

formax setup [--profile <name>] [--repair] [--non-interactive] [--json]
formax status [--profile <name>] [--json]
formax doctor [--profile <name>] [--json]

formax config get <key> [--profile <name>] [--json]
formax config set <key> <value> [--profile <name>]
formax config list [--profile <name>] [--json]
formax config migrate [--from legacy|xdg] [--to xdg|legacy]

formax auth status [--profile <name>] [--json]
formax auth set-key [--profile <name>]   # 交互式或 stdin
formax auth delete [--profile <name>]

# 可选（强烈建议，为安全边界落地提供可观测性）
formax execpolicy explain --tool <ToolName> (--path <abs> | --url <url>) [--json]
formax execpolicy allow path <absPrefix> [--scope workspace|user] [--tools ...]
formax execpolicy allow domain <domain> [--scope workspace|user]
```

## G2) 每个命令：用法/输入/输出/exit codes

### `formax repl`

* 用法：`formax` 或 `formax repl`
* 输入：

  * flags/env/config/default（按 A4）
* 输出：

  * 交互式 Ink REPL
* exit codes：

  * 0 正常退出
  * 1 运行时错误
  * 3 配置缺失（且用户取消 setup）

### `formax setup`

* 用法：`formax setup`
* 输入：

  * `--profile`（默认 config.defaultProfile）
  * `--repair`：强制重新验证并重写
* 输出：

  * 默认 Ink 交互
  * `--json`：输出 `{ ok, written: {configPath, authPath} }`
* exit：

  * 0 成功
  * 1 用户取消/失败

### `formax status`

* 输出：

  * 默认人类可读
  * `--json` 输出 `FormaxStatusV1`（见 C1）
* exit：

  * 0 成功
  * 3 配置不可用（比如 parse 失败）

### `formax doctor`

* 输出：

  * 默认人类可读（带 fix steps）
  * `--json` 输出 `DoctorReportV1`
* exit：

  * 0 全 pass/warn（ok=true）
  * 4 有 fail（ok=false）
  * 2 参数错误

### `/status`、`/doctor`（REPL 内）

* **复用关系（关键约束）**：

  * 逻辑复用：`getStatusSnapshot()` / `runDoctor()` 是同一份实现
  * presenter 不同：REPL 输出为一段文本；CLI 可选择 JSON 或文本

---

# H. 文档与文案（可直接粘贴）

## H1) README.md QuickStart（面向陌生用户）

> 你可以直接把这段贴进 README。

````md
## QuickStart

### Install
```bash
npm install -g formax
# or
bun add -g formax
````

### First-time setup

```bash
formax setup
```

You will be asked for:

* Base URL (default: [https://api.anthropic.com](https://api.anthropic.com))
* API key (hidden input)
* Model selection

### Start chatting

```bash
formax
```

### Common commands

* `formax status` — show current effective config (redacted)
* `formax doctor` — run connectivity/auth/filesystem checks and show actionable fixes

### Troubleshooting

If you see errors like `401`, `DNS`, `timeout`, run:

```bash
formax doctor
```

and follow the suggested fix steps.

````

## H2) docs/troubleshooting.md（目录与每节要点）
```md
# Troubleshooting

## 1) Authentication (401)
- Symptoms
- Root causes
- Fix: re-run `formax setup` / update auth store
- How to verify: `formax doctor --json`

## 2) Permission denied (403)
- Symptoms
- Fix: use a key with proper permissions / check gateway policy

## 3) DNS / Network unreachable
- Symptoms: ENOTFOUND / EAI_AGAIN
- Fix: check baseUrl, DNS, proxy env (HTTPS_PROXY/NO_PROXY)
- Verify: `nslookup <host>` + `formax doctor`

## 4) Timeout
- Fix: check connectivity, proxy, increase timeout (`formax config set llm.timeoutMs ...`)

## 5) SSL/TLS errors
- Corporate MITM, custom CA
- Fix: trust CA / fix gateway cert

## 6) baseUrl incompatibility
- baseUrl must be Anthropic-compatible endpoint
- How Formax tests it (messages.create max_tokens=1)

## 7) Workspace security policy blocked
- Symptoms: E_POLICY_DENY
- Fix: allow once / allow permanently (execpolicy), or move files into workspace

## 8) Config migration (env-only -> config/auth)
- How migration works
- Deprecation timeline
````

## H3) `--help` 完整输出文案（建议）

```text
formax - Terminal AI REPL with tools

USAGE:
  formax [repl] [options]                Start interactive REPL (default)
  formax setup [options]                 Run interactive setup wizard
  formax status [options]                Print current effective config (redacted)
  formax doctor [options]                Diagnose config/network/auth/workspace issues

  formax config get <key> [options]      Read a config value
  formax config set <key> <value>        Update a config value
  formax config list [options]           List config for current profile (redacted)
  formax auth status [options]           Show auth store status (redacted)

OPTIONS:
  --profile <name>       Select profile (default: "default")
  --workspace <path>     Set workspace root (security boundary)
  --config-dir <path>    Override config directory
  --json                 Output machine-readable JSON where supported
  -h, --help             Show help
  -v, --version          Show version

EXAMPLES:
  formax setup
  formax
  formax status --json
  formax doctor
  formax config set llm.model claude-3-5-sonnet-latest
```

---

# I. 迁移与兼容（避免上线后静默坏掉）

## I1) 迁移策略：env-only → config/auth store

v1 的迁移流程（自动 + 手动两条腿）：

1. 自动（首次运行）

* 若 config/auth 缺失，但检测到 env（含 `FORMAX_API_KEY` 等）：

  * `status/doctor` 提示：`ENV_DEPRECATED` + “Run `formax setup` to persist configuration.”
  * `setup wizard` 允许“一键导入 env 值作为初始值”（baseUrl/model 预填，apiKey 预填但仍隐藏显示）

2. 手动

* `formax config migrate`：把 legacy `~/.formax` → XDG/Windows 标准路径（或反向）
* `formax auth set-key`：仅更新 key，不动 config

## I2) 兼容窗口（建议）

* v0.x：保持 env-only 工作；但新增 `/doctor` 强提示迁移
* v1.0：默认使用 config/auth；仍兼容读取旧 env（含 `ANTHROPIC_*2`）但会 `WARN`
* v1.1（或 v2.0）：移除旧 env（或需要 `--allow-legacy-env` 才启用）

提示文案（建议）

* `WARN: Detected deprecated env var FORMAX_API_KEY. Please run 'formax setup' to migrate.`
* `In v1.1 this env var will no longer be supported.`

## I3) 防回归测试（至少 10 条，P0）

1. migration：仅 env 时，effective config 读取正确
2. migration：写入 auth/config 后，env 不再 silently 覆盖（除非 flag）
3. precedence：flags > env > config > default
4. status：输出不会包含明文 apiKey
5. doctor：401 映射 E_AUTH_401
6. doctor：403 映射 E_AUTH_403
7. doctor：DNS 映射 E_DNS
8. policy：workspace 内 path allow
9. policy：workspace 外 path 默认 deny/prompt（按默认策略）
10. policy persistence：allow workspace rule 写入后生效
11. network：mode=off 时 WebFetch/WebSearch 拒绝
12. allow domain：允许后不再提示

---

# 最后：你可以先只做一个“安全边界+规则持久化”最小闭环（对应你的可选追问）

如果你决定 P0 先聚焦安全边界，我建议你把 PR6 拆成 2 个更小的 PR：

* PR6a：workspaceRoot 探测 + path boundary（Read/Glob/Grep/Write/Edit/NotebookEdit）
* PR6b：network policy（WebSearch/WebFetch）+ policy.json 持久化 + explain

这两步能最快把“默认只允许 workspaceRoot”变成真实可测的机制。

---

## Claude Code 相关引用（满足你的强约束 #1）

我在上面引用 Claude Code 的行为/策略（权限系统、工作目录、设置层级、凭证存储）时，来源均来自官方文档页面：

```text
https://code.claude.com/docs/en/iam#permission-system
```

---

如果你愿意，我也可以把 **D 章（workspace 安全边界 + policy JSON）**再进一步写到“具体到每个 Tool 输入字段怎么抽取 resource、每种 tool 的 request→policy resource mapping 表”，并给出 `PolicyEngine.evaluate()` 的伪代码与 vitest 用例数据表（全部绑定到现有工具名：Read/Write/Edit/Glob/Grep/WebSearch/WebFetch 等）。
