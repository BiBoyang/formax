> ## Documentation Index
> Fetch the complete documentation index at: https://code.claude.com/docs/llms.txt
> Use this file to discover all available pages before exploring further.

# Claude Code 设置

> 使用全局和项目级设置以及环境变量配置 Claude Code。

Claude Code 提供多种设置来配置其行为以满足您的需求。您可以在使用交互式 REPL 时运行 `/config` 命令来配置 Claude Code，这会打开一个选项卡式设置界面，您可以在其中查看状态信息并修改配置选项。

## 配置作用域

Claude Code 使用**作用域系统**来确定配置应用的位置以及与谁共享。了解作用域可以帮助您决定如何为个人使用、团队协作或企业部署配置 Claude Code。

### 可用作用域

| 作用域         | 位置                          | 影响范围        | 与团队共享？        |
| :---------- | :-------------------------- | :---------- | :------------ |
| **Managed** | 系统级 `managed-settings.json` | 机器上的所有用户    | 是（由 IT 部署）    |
| **User**    | `~/.claude/` 目录             | 您，跨所有项目     | 否             |
| **Project** | 存储库中的 `.claude/`            | 此存储库上的所有协作者 | 是（提交到 git）    |
| **Local**   | `.claude/*.local.*` 文件      | 您，仅在此存储库中   | 否（gitignored） |

### 何时使用每个作用域

**Managed 作用域**用于：

* 必须在整个组织范围内强制执行的安全策略
* 无法被覆盖的合规要求
* 由 IT/DevOps 部署的标准化配置

**User 作用域**最适合：

* 您想在任何地方使用的个人偏好设置（主题、编辑器设置）
* 您在所有项目中使用的工具和 plugins
* API 密钥和身份验证（安全存储）

**Project 作用域**最适合：

* 团队共享的设置（权限、hooks、MCP servers）
* 整个团队应该拥有的 plugins
* 跨协作者标准化工具

**Local 作用域**最适合：

* 特定项目的个人覆盖
* 在与团队共享之前测试配置
* 不适用于其他人的机器特定设置

### 作用域如何相互作用

当在多个作用域中配置相同的设置时，更具体的作用域优先：

1. **Managed**（最高）- 无法被任何内容覆盖
2. **命令行参数** - 临时会话覆盖
3. **Local** - 覆盖项目和用户设置
4. **Project** - 覆盖用户设置
5. **User**（最低）- 当没有其他内容指定设置时应用

例如，如果权限在用户设置中被允许但在项目设置中被拒绝，项目设置优先，权限被阻止。

### 哪些功能使用作用域

作用域适用于许多 Claude Code 功能：

| 功能              | 用户位置                      | 项目位置                              | 本地位置                          |
| :-------------- | :------------------------ | :-------------------------------- | :---------------------------- |
| **Settings**    | `~/.claude/settings.json` | `.claude/settings.json`           | `.claude/settings.local.json` |
| **Subagents**   | `~/.claude/agents/`       | `.claude/agents/`                 | —                             |
| **MCP servers** | `~/.claude.json`          | `.mcp.json`                       | `~/.claude.json`（每个项目）        |
| **Plugins**     | `~/.claude/settings.json` | `.claude/settings.json`           | `.claude/settings.local.json` |
| **CLAUDE.md**   | `~/.claude/CLAUDE.md`     | `CLAUDE.md` 或 `.claude/CLAUDE.md` | `CLAUDE.local.md`             |

***

## 设置文件

`settings.json` 文件是我们用于通过分层设置配置 Claude Code 的官方机制：

* **用户设置**在 `~/.claude/settings.json` 中定义，适用于所有项目。
* **项目设置**保存在您的项目目录中：
  * `.claude/settings.json` 用于检入源代码管理并与您的团队共享的设置
  * `.claude/settings.local.json` 用于未检入的设置，适用于个人偏好和实验。Claude Code 将在创建 `.claude/settings.local.json` 时配置 git 以忽略它。
* **Managed 设置**：对于需要集中控制的组织，Claude Code 支持 `managed-settings.json` 和 `managed-mcp.json` 文件，可以部署到系统目录：

  * macOS：`/Library/Application Support/ClaudeCode/`
  * Linux 和 WSL：`/etc/claude-code/`
  * Windows：`C:\Program Files\ClaudeCode\`

  <Note>
    这些是系统范围的路径（不是像 `~/Library/...` 这样的用户主目录），需要管理员权限。它们设计用于由 IT 管理员部署。
  </Note>

  有关详细信息，请参阅 [Managed 设置](/zh-CN/iam#managed-settings) 和 [Managed MCP 配置](/zh-CN/mcp#managed-mcp-configuration)。

  <Note>
    Managed 部署还可以使用 `strictKnownMarketplaces` 限制**插件市场添加**。有关更多信息，请参阅 [Managed 市场限制](/zh-CN/plugin-marketplaces#managed-marketplace-restrictions)。
  </Note>
* **其他配置**存储在 `~/.claude.json` 中。此文件包含您的偏好设置（主题、通知设置、编辑器模式）、OAuth 会话、[MCP server](/zh-CN/mcp) 配置（用于用户和本地作用域）、每个项目的状态（允许的工具、信任设置）和各种缓存。项目作用域的 MCP servers 单独存储在 `.mcp.json` 中。

```JSON 示例 settings.json theme={null}
{
  "permissions": {
    "allow": [
      "Bash(npm run lint)",
      "Bash(npm run test:*)",
      "Read(~/.zshrc)"
    ],
    "deny": [
      "Bash(curl:*)",
      "Read(./.env)",
      "Read(./.env.*)",
      "Read(./secrets/**)"
    ]
  },
  "env": {
    "CLAUDE_CODE_ENABLE_TELEMETRY": "1",
    "OTEL_METRICS_EXPORTER": "otlp"
  },
  "companyAnnouncements": [
    "欢迎来到 Acme Corp！在 docs.acme.com 查看我们的代码指南",
    "提醒：所有 PR 都需要代码审查",
    "新安全政策已生效"
  ]
}
```

### 可用设置

`settings.json` 支持多个选项：

| 键                            | 描述                                                                                                                                                              | 示例                                                               |
| :--------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------- | :--------------------------------------------------------------- |
| `apiKeyHelper`               | 自定义脚本，在 `/bin/sh` 中执行，以生成身份验证值。此值将作为 `X-Api-Key` 和 `Authorization: Bearer` 标头发送用于模型请求                                                                           | `/bin/generate_temp_api_key.sh`                                  |
| `cleanupPeriodDays`          | 非活动时间超过此期间的会话在启动时被删除。设置为 `0` 立即删除所有会话。（默认：30 天）                                                                                                                 | `20`                                                             |
| `companyAnnouncements`       | 在启动时显示给用户的公告。如果提供多个公告，它们将随机循环显示。                                                                                                                                | `["欢迎来到 Acme Corp！在 docs.acme.com 查看我们的代码指南"]`                   |
| `env`                        | 将应用于每个会话的环境变量                                                                                                                                                   | `{"FOO": "bar"}`                                                 |
| `attribution`                | 自定义 git 提交和拉取请求的归属。请参阅 [Attribution 设置](#attribution-settings)                                                                                                  | `{"commit": "🤖 Generated with Claude Code", "pr": ""}`          |
| `includeCoAuthoredBy`        | **已弃用**：改用 `attribution`。是否在 git 提交和拉取请求中包含 `co-authored-by Claude` 署名（默认：`true`）                                                                               | `false`                                                          |
| `permissions`                | 有关权限结构，请参阅下表。                                                                                                                                                   |                                                                  |
| `hooks`                      | 配置自定义命令以在工具执行前后运行。请参阅 [hooks 文档](/zh-CN/hooks)                                                                                                                  | `{"PreToolUse": {"Bash": "echo 'Running command..'"}}`           |
| `disableAllHooks`            | 禁用所有 [hooks](/zh-CN/hooks)                                                                                                                                      | `true`                                                           |
| `allowManagedHooksOnly`      | （仅 Managed 设置）防止加载用户、项目和 plugin hooks。仅允许 managed hooks 和 SDK hooks。请参阅 [Hook 配置](#hook-configuration)                                                          | `true`                                                           |
| `model`                      | 覆盖 Claude Code 使用的默认模型                                                                                                                                          | `"claude-sonnet-4-5-20250929"`                                   |
| `otelHeadersHelper`          | 生成动态 OpenTelemetry 标头的脚本。在启动时和定期运行（请参阅 [Dynamic headers](/zh-CN/monitoring-usage#dynamic-headers)）                                                              | `/bin/generate_otel_headers.sh`                                  |
| `statusLine`                 | 配置自定义状态行以显示上下文。请参阅 [`statusLine` 文档](/zh-CN/statusline)                                                                                                         | `{"type": "command", "command": "~/.claude/statusline.sh"}`      |
| `fileSuggestion`             | 为 `@` 文件自动完成配置自定义脚本。请参阅 [File suggestion 设置](#file-suggestion-settings)                                                                                         | `{"type": "command", "command": "~/.claude/file-suggestion.sh"}` |
| `respectGitignore`           | 控制 `@` 文件选择器是否尊重 `.gitignore` 模式。当为 `true`（默认）时，匹配 `.gitignore` 模式的文件被排除在建议之外                                                                                   | `false`                                                          |
| `outputStyle`                | 配置输出样式以调整系统提示。请参阅 [output styles 文档](/zh-CN/output-styles)                                                                                                      | `"Explanatory"`                                                  |
| `forceLoginMethod`           | 使用 `claudeai` 限制登录到 Claude.ai 账户，使用 `console` 限制登录到 Claude Console（API 使用计费）账户                                                                                  | `claudeai`                                                       |
| `forceLoginOrgUUID`          | 指定组织的 UUID 以在登录期间自动选择它，绕过组织选择步骤。需要设置 `forceLoginMethod`                                                                                                         | `"xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"`                         |
| `enableAllProjectMcpServers` | 自动批准项目 `.mcp.json` 文件中定义的所有 MCP servers                                                                                                                         | `true`                                                           |
| `enabledMcpjsonServers`      | 要批准的 `.mcp.json` 文件中特定 MCP servers 的列表                                                                                                                          | `["memory", "github"]`                                           |
| `disabledMcpjsonServers`     | 要拒绝的 `.mcp.json` 文件中特定 MCP servers 的列表                                                                                                                          | `["filesystem"]`                                                 |
| `allowedMcpServers`          | 在 managed-settings.json 中设置时，用户可以配置的 MCP servers 的允许列表。未定义 = 无限制，空数组 = 锁定。适用于所有作用域。拒绝列表优先。请参阅 [Managed MCP 配置](/zh-CN/mcp#managed-mcp-configuration)            | `[{ "serverName": "github" }]`                                   |
| `deniedMcpServers`           | 在 managed-settings.json 中设置时，明确阻止的 MCP servers 的拒绝列表。适用于所有作用域，包括 managed servers。拒绝列表优先于允许列表。请参阅 [Managed MCP 配置](/zh-CN/mcp#managed-mcp-configuration)         | `[{ "serverName": "filesystem" }]`                               |
| `strictKnownMarketplaces`    | 在 managed-settings.json 中设置时，用户可以添加的 plugin 市场的允许列表。未定义 = 无限制，空数组 = 锁定。仅适用于市场添加。请参阅 [Managed 市场限制](/zh-CN/plugin-marketplaces#managed-marketplace-restrictions) | `[{ "source": "github", "repo": "acme-corp/plugins" }]`          |
| `awsAuthRefresh`             | 修改 `.aws` 目录的自定义脚本（请参阅 [advanced credential configuration](/zh-CN/amazon-bedrock#advanced-credential-configuration)）                                            | `aws sso login --profile myprofile`                              |
| `awsCredentialExport`        | 输出包含 AWS 凭证的 JSON 的自定义脚本（请参阅 [advanced credential configuration](/zh-CN/amazon-bedrock#advanced-credential-configuration)）                                      | `/bin/generate_aws_grant.sh`                                     |
| `alwaysThinkingEnabled`      | 为所有会话默认启用 [extended thinking](/zh-CN/common-workflows#use-extended-thinking-thinking-mode)。通常通过 `/config` 命令配置，而不是直接编辑                                          | `true`                                                           |
| `plansDirectory`             | 自定义计划文件的存储位置。路径相对于项目根目录。默认：`~/.claude/plans`                                                                                                                    | `"./plans"`                                                      |
| `showTurnDuration`           | 在响应后显示转向持续时间消息（例如"Cooked for 1m 6s"）。设置为 `false` 以隐藏这些消息                                                                                                        | `true`                                                           |
| `language`                   | 配置 Claude 的首选响应语言（例如 `"japanese"`、`"spanish"`、`"french"`）。Claude 将默认以此语言响应                                                                                      | `"japanese"`                                                     |
| `autoUpdatesChannel`         | 遵循更新的发布渠道。使用 `"stable"` 获取通常约一周前的版本并跳过有重大回归的版本，或使用 `"latest"`（默认）获取最新版本                                                                                         | `"stable"`                                                       |
| `spinnerTipsEnabled`         | 在 Claude 工作时在微调器中显示提示。设置为 `false` 以禁用提示（默认：`true`）                                                                                                              | `false`                                                          |
| `terminalProgressBarEnabled` | 启用终端进度条，在 Windows Terminal 和 iTerm2 等支持的终端中显示进度（默认：`true`）                                                                                                      | `false`                                                          |

### 权限设置

| 键                              | 描述                                                                                                                                                                          | 示例                                                                     |
| :----------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :--------------------------------------------------------------------- |
| `allow`                        | 允许工具使用的权限规则数组。有关模式匹配详细信息，请参阅下面的 [Permission rule syntax](#permission-rule-syntax)                                                                                           | `[ "Bash(git diff:*)" ]`                                               |
| `ask`                          | 要求在工具使用时确认的权限规则数组。请参阅下面的 [Permission rule syntax](#permission-rule-syntax)                                                                                                  | `[ "Bash(git push:*)" ]`                                               |
| `deny`                         | 拒绝工具使用的权限规则数组。使用此选项从 Claude Code 访问中排除敏感文件。请参阅 [Permission rule syntax](#permission-rule-syntax) 和 [Bash permission limitations](/zh-CN/iam#tool-specific-permission-rules) | `[ "WebFetch", "Bash(curl:*)", "Read(./.env)", "Read(./secrets/**)" ]` |
| `additionalDirectories`        | Claude 有权访问的其他[工作目录](/zh-CN/iam#working-directories)                                                                                                                        | `[ "../docs/" ]`                                                       |
| `defaultMode`                  | 打开 Claude Code 时的默认[权限模式](/zh-CN/iam#permission-modes)                                                                                                                      | `"acceptEdits"`                                                        |
| `disableBypassPermissionsMode` | 设置为 `"disable"` 以防止激活 `bypassPermissions` 模式。这禁用 `--dangerously-skip-permissions` 命令行标志。请参阅 [managed settings](/zh-CN/iam#managed-settings)                                 | `"disable"`                                                            |

### 权限规则语法

权限规则遵循格式 `Tool` 或 `Tool(specifier)`。理解语法可以帮助您编写与您的意图完全匹配的规则。

#### 规则评估顺序

当多个规则可能匹配相同的工具使用时，规则按以下顺序评估：

1. **Deny** 规则首先被检查
2. **Ask** 规则其次被检查
3. **Allow** 规则最后被检查

第一个匹配的规则确定行为。这意味着 deny 规则始终优先于 allow 规则，即使两者都匹配相同的命令。

#### 匹配工具的所有使用

要匹配工具的所有使用，请使用不带括号的工具名称：

| 规则         | 效果               |
| :--------- | :--------------- |
| `Bash`     | 匹配**所有** Bash 命令 |
| `WebFetch` | 匹配**所有**网络获取请求   |
| `Read`     | 匹配**所有**文件读取     |

<Warning>
  `Bash(*)` 不匹配所有 Bash 命令。`*` 通配符仅在指定符上下文中匹配。要允许或拒绝工具的所有使用，请使用工具名称：`Bash`，而不是 `Bash(*)`。
</Warning>

#### 使用指定符进行细粒度控制

在括号中添加指定符以匹配特定的工具使用：

| 规则                             | 效果                      |
| :----------------------------- | :---------------------- |
| `Bash(npm run build)`          | 匹配确切的命令 `npm run build` |
| `Read(./.env)`                 | 匹配读取当前目录中的 `.env` 文件    |
| `WebFetch(domain:example.com)` | 匹配对 example.com 的获取请求   |

#### 通配符模式

Bash 规则有两种通配符语法：

| 通配符  | 位置       | 行为                              | 示例                                   |
| :--- | :------- | :------------------------------ | :----------------------------------- |
| `:*` | 仅在模式末尾   | **前缀匹配**带有单词边界。前缀后面必须跟空格或字符串末尾。 | `Bash(ls:*)` 匹配 `ls -la` 但不匹配 `lsof` |
| `*`  | 模式中的任何位置 | **Glob 匹配**无单词边界。匹配该位置处的任何字符序列。 | `Bash(ls*)` 匹配 `ls -la` 和 `lsof`     |

**使用 `:*` 的前缀匹配**

`:*` 后缀匹配任何以指定前缀开头的命令。这适用于多字命令。以下配置允许 npm 和 git commit 命令，同时阻止 git push 和 rm -rf：

```json  theme={null}
{
  "permissions": {
    "allow": [
      "Bash(npm run:*)",
      "Bash(git commit:*)",
      "Bash(docker compose:*)"
    ],
    "deny": [
      "Bash(git push:*)",
      "Bash(rm -rf:*)"
    ]
  }
}
```

**使用 `*` 的 Glob 匹配**

`*` 通配符可以出现在模式的开头、中间或末尾。以下配置允许任何针对 main 的 git 命令（如 `git checkout main`、`git merge main`）和任何版本检查命令（如 `node --version`、`npm --version`）：

```json  theme={null}
{
  "permissions": {
    "allow": [
      "Bash(git * main)",
      "Bash(* --version)"
    ]
  }
}
```

<Warning>
  尝试约束命令参数的 Bash 权限模式很脆弱。例如，`Bash(curl http://github.com/:*)` 旨在将 curl 限制为 GitHub URL，但不会匹配 `curl -X GET http://github.com/...`（标志在 URL 之前）、`curl https://github.com/...`（不同的协议）或使用 shell 变量的命令。不要依赖参数约束模式作为安全边界。有关替代方案，请参阅 [Bash permission limitations](/zh-CN/iam#tool-specific-permission-rules)。
</Warning>

有关工具特定权限模式的详细信息（包括 Read、Edit、WebFetch、MCP、Task 规则和 Bash 权限限制），请参阅 [Tool-specific permission rules](/zh-CN/iam#tool-specific-permission-rules)。

### Sandbox 设置

配置高级沙箱行为。沙箱将 bash 命令与您的文件系统和网络隔离。有关详细信息，请参阅 [Sandboxing](/zh-CN/sandboxing)。

**文件系统和网络限制**通过 Read、Edit 和 WebFetch 权限规则配置，而不是通过这些沙箱设置。

| 键                           | 描述                                                                                                                                                         | 示例                        |
| :-------------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------- | :------------------------ |
| `enabled`                   | 启用 bash 沙箱（macOS、Linux 和 WSL2）。默认：false                                                                                                                    | `true`                    |
| `autoAllowBashIfSandboxed`  | 沙箱化时自动批准 bash 命令。默认：true                                                                                                                                   | `true`                    |
| `excludedCommands`          | 应在沙箱外运行的命令                                                                                                                                                 | `["git", "docker"]`       |
| `allowUnsandboxedCommands`  | 允许命令通过 `dangerouslyDisableSandbox` 参数在沙箱外运行。当设置为 `false` 时，`dangerouslyDisableSandbox` 逃生舱完全禁用，所有命令必须沙箱化（或在 `excludedCommands` 中）。对于需要严格沙箱的企业政策很有用。默认：true | `false`                   |
| `network.allowUnixSockets`  | 沙箱中可访问的 Unix 套接字路径（用于 SSH 代理等）                                                                                                                             | `["~/.ssh/agent-socket"]` |
| `network.allowLocalBinding` | 允许绑定到 localhost 端口（仅 macOS）。默认：false                                                                                                                       | `true`                    |
| `network.httpProxyPort`     | 如果您想使用自己的代理，则使用的 HTTP 代理端口。如果未指定，Claude 将运行自己的代理。                                                                                                          | `8080`                    |
| `network.socksProxyPort`    | 如果您想使用自己的代理，则使用的 SOCKS5 代理端口。如果未指定，Claude 将运行自己的代理。                                                                                                        | `8081`                    |
| `enableWeakerNestedSandbox` | 为无特权 Docker 环境启用较弱的沙箱（仅 Linux 和 WSL2）。**降低安全性。** 默认：false                                                                                                  | `true`                    |

**配置示例：**

```json  theme={null}
{
  "sandbox": {
    "enabled": true,
    "autoAllowBashIfSandboxed": true,
    "excludedCommands": ["docker"],
    "network": {
      "allowUnixSockets": [
        "/var/run/docker.sock"
      ],
      "allowLocalBinding": true
    }
  },
  "permissions": {
    "deny": [
      "Read(.envrc)",
      "Read(~/.aws/**)"
    ]
  }
}
```

**文件系统和网络限制**使用标准权限规则：

* 使用 `Read` deny 规则阻止 Claude 读取特定文件或目录
* 使用 `Edit` allow 规则让 Claude 写入当前工作目录之外的目录
* 使用 `Edit` deny 规则阻止写入特定路径
* 使用 `WebFetch` allow/deny 规则控制 Claude 可以访问哪些网络域

### Attribution 设置

Claude Code 为 git 提交和拉取请求添加归属。这些分别配置：

* 提交默认使用 [git trailers](https://git-scm.com/docs/git-interpret-trailers)（如 `Co-Authored-By`），可以自定义或禁用
* 拉取请求描述是纯文本

| 键        | 描述                                 |
| :------- | :--------------------------------- |
| `commit` | git 提交的归属，包括任何 trailers。空字符串隐藏提交归属 |
| `pr`     | 拉取请求描述的归属。空字符串隐藏拉取请求归属             |

**默认提交归属：**

```
🤖 Generated with [Claude Code](https://claude.com/claude-code)

   Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>
```

**默认拉取请求归属：**

```
🤖 Generated with [Claude Code](https://claude.com/claude-code)
```

**示例：**

```json  theme={null}
{
  "attribution": {
    "commit": "Generated with AI\n\nCo-Authored-By: AI <ai@example.com>",
    "pr": ""
  }
}
```

<Note>
  `attribution` 设置优先于已弃用的 `includeCoAuthoredBy` 设置。要隐藏所有归属，请将 `commit` 和 `pr` 设置为空字符串。
</Note>

### File suggestion 设置

为 `@` 文件路径自动完成配置自定义命令。内置文件建议使用快速文件系统遍历，但大型 monorepos 可能受益于项目特定的索引，例如预构建的文件索引或自定义工具。

```json  theme={null}
{
  "fileSuggestion": {
    "type": "command",
    "command": "~/.claude/file-suggestion.sh"
  }
}
```

该命令使用与 [hooks](/zh-CN/hooks) 相同的环境变量运行，包括 `CLAUDE_PROJECT_DIR`。它通过 stdin 接收包含 `query` 字段的 JSON：

```json  theme={null}
{"query": "src/comp"}
```

将换行符分隔的文件路径输出到 stdout（当前限制为 15）：

```
src/components/Button.tsx
src/components/Modal.tsx
src/components/Form.tsx
```

**示例：**

```bash  theme={null}
#!/bin/bash
query=$(cat | jq -r '.query')
your-repo-file-index --query "$query" | head -20
```

### Hook 配置

**仅 Managed 设置**：控制允许运行哪些 hooks。此设置只能在 [managed settings](#settings-files) 中配置，为管理员提供对 hook 执行的严格控制。

**当 `allowManagedHooksOnly` 为 `true` 时的行为：**

* Managed hooks 和 SDK hooks 被加载
* 用户 hooks、项目 hooks 和 plugin hooks 被阻止

**配置：**

```json  theme={null}
{
  "allowManagedHooksOnly": true
}
```

### 设置优先级

设置按优先级顺序应用。从最高到最低：

1. **Managed 设置** (`managed-settings.json`)
   * 由 IT/DevOps 部署到系统目录的策略
   * 无法被用户或项目设置覆盖

2. **命令行参数**
   * 特定会话的临时覆盖

3. **本地项目设置** (`.claude/settings.local.json`)
   * 个人项目特定设置

4. **共享项目设置** (`.claude/settings.json`)
   * 源代码管理中的团队共享项目设置

5. **用户设置** (`~/.claude/settings.json`)
   * 个人全局设置

此层次结构确保组织策略始终被强制执行，同时仍允许团队和个人自定义其体验。

例如，如果您的用户设置允许 `Bash(npm run:*)`，但项目的共享设置拒绝它，项目设置优先，命令被阻止。

### 关于配置系统的关键要点

* **Memory 文件 (`CLAUDE.md`)**：包含 Claude 在启动时加载的说明和上下文
* **Settings 文件 (JSON)**：配置权限、环境变量和工具行为
* **Skills**：可以使用 `/skill-name` 调用或由 Claude 自动加载的自定义提示
* **MCP servers**：使用其他工具和集成扩展 Claude Code
* **优先级**：更高级别的配置（Managed）覆盖更低级别的配置（User/Project）
* **继承**：设置被合并，更具体的设置添加到或覆盖更广泛的设置

### 系统提示

Claude Code 的内部系统提示未发布。要添加自定义说明，请使用 `CLAUDE.md` 文件或 `--append-system-prompt` 标志。

### 排除敏感文件

要防止 Claude Code 访问包含敏感信息（如 API 密钥、秘密和环境文件）的文件，请在 `.claude/settings.json` 文件中使用 `permissions.deny` 设置：

```json  theme={null}
{
  "permissions": {
    "deny": [
      "Read(./.env)",
      "Read(./.env.*)",
      "Read(./secrets/**)",
      "Read(./config/credentials.json)",
      "Read(./build)"
    ]
  }
}
```

这替代了已弃用的 `ignorePatterns` 配置。匹配这些模式的文件被排除在文件发现和搜索结果之外，这些文件上的读取操作被拒绝。

## Subagent 配置

Claude Code 支持可在用户和项目级别配置的自定义 AI subagents。这些 subagents 存储为带有 YAML frontmatter 的 Markdown 文件：

* **用户 subagents**：`~/.claude/agents/` - 在所有项目中可用
* **项目 subagents**：`.claude/agents/` - 特定于您的项目，可与您的团队共享

Subagent 文件定义具有自定义提示和工具权限的专门 AI 助手。在 [subagents 文档](/zh-CN/sub-agents) 中了解有关创建和使用 subagents 的更多信息。

## Plugin 配置

Claude Code 支持一个 plugin 系统，让您可以使用 skills、agents、hooks 和 MCP servers 扩展功能。Plugins 通过市场分发，可以在用户和存储库级别配置。

### Plugin 设置

`settings.json` 中与 plugin 相关的设置：

```json  theme={null}
{
  "enabledPlugins": {
    "formatter@acme-tools": true,
    "deployer@acme-tools": true,
    "analyzer@security-plugins": false
  },
  "extraKnownMarketplaces": {
    "acme-tools": {
      "source": "github",
      "repo": "acme-corp/claude-plugins"
    }
  }
}
```

#### `enabledPlugins`

控制启用哪些 plugins。格式：`"plugin-name@marketplace-name": true/false`

**作用域**：

* **用户设置** (`~/.claude/settings.json`)：个人 plugin 偏好
* **项目设置** (`.claude/settings.json`)：与团队共享的项目特定 plugins
* **本地设置** (`.claude/settings.local.json`)：每台机器的覆盖（未提交）

**示例**：

```json  theme={null}
{
  "enabledPlugins": {
    "code-formatter@team-tools": true,
    "deployment-tools@team-tools": true,
    "experimental-features@personal": false
  }
}
```

#### `extraKnownMarketplaces`

定义应为存储库提供的其他市场。通常在存储库级别设置中使用，以确保团队成员可以访问所需的 plugin 源。

**当存储库包含 `extraKnownMarketplaces` 时**：

1. 当团队成员信任该文件夹时，他们会被提示安装市场
2. 然后团队成员会被提示从该市场安装 plugins
3. 用户可以跳过不需要的市场或 plugins（存储在用户设置中）
4. 安装尊重信任边界并需要明确同意

**示例**：

```json  theme={null}
{
  "extraKnownMarketplaces": {
    "acme-tools": {
      "source": {
        "source": "github",
        "repo": "acme-corp/claude-plugins"
      }
    },
    "security-plugins": {
      "source": {
        "source": "git",
        "url": "https://git.example.com/security/plugins.git"
      }
    }
  }
}
```

**市场源类型**：

* `github`：GitHub 存储库（使用 `repo`）
* `git`：任何 git URL（使用 `url`）
* `directory`：本地文件系统路径（使用 `path`，仅用于开发）

#### `strictKnownMarketplaces`

**仅 Managed 设置**：控制用户可以添加哪些 plugin 市场。此设置只能在 [`managed-settings.json`](/zh-CN/iam#managed-settings) 中配置，为管理员提供对市场源的严格控制。

**Managed 设置文件位置**：

* **macOS**：`/Library/Application Support/ClaudeCode/managed-settings.json`
* **Linux 和 WSL**：`/etc/claude-code/managed-settings.json`
* **Windows**：`C:\Program Files\ClaudeCode\managed-settings.json`

**关键特征**：

* 仅在 managed 设置 (`managed-settings.json`) 中可用
* 无法被用户或项目设置覆盖（最高优先级）
* 在任何网络/文件系统操作之前强制执行（被阻止的源永远不会执行）
* 对源规范使用精确匹配（包括 git 源的 `ref`、`path`）

**允许列表行为**：

* `undefined`（默认）：无限制 - 用户可以添加任何市场
* 空数组 `[]`：完全锁定 - 用户无法添加任何新市场
* 源列表：用户只能添加完全匹配的市场

**所有支持的源类型**：

允许列表支持六种市场源类型。每个源必须完全匹配才能允许用户的市场添加。

1. **GitHub 存储库**：

```json  theme={null}
{ "source": "github", "repo": "acme-corp/approved-plugins" }
{ "source": "github", "repo": "acme-corp/security-tools", "ref": "v2.0" }
{ "source": "github", "repo": "acme-corp/plugins", "ref": "main", "path": "marketplace" }
```

字段：`repo`（必需）、`ref`（可选：分支/标签/SHA）、`path`（可选：子目录）

2. **Git 存储库**：

```json  theme={null}
{ "source": "git", "url": "https://gitlab.example.com/tools/plugins.git" }
{ "source": "git", "url": "https://bitbucket.org/acme-corp/plugins.git", "ref": "production" }
{ "source": "git", "url": "ssh://git@git.example.com/plugins.git", "ref": "v3.1", "path": "approved" }
```

字段：`url`（必需）、`ref`（可选：分支/标签/SHA）、`path`（可选：子目录）

3. **基于 URL 的市场**：

```json  theme={null}
{ "source": "url", "url": "https://plugins.example.com/marketplace.json" }
{ "source": "url", "url": "https://cdn.example.com/marketplace.json", "headers": { "Authorization": "Bearer ${TOKEN}" } }
```

字段：`url`（必需）、`headers`（可选：用于身份验证访问的 HTTP 标头）

<Note>
  基于 URL 的市场仅下载 `marketplace.json` 文件。它们不从服务器下载 plugin 文件。基于 URL 的市场中的 Plugins 必须使用外部源（GitHub、npm 或 git URL），而不是相对路径。对于具有相对路径的 plugins，请改用基于 Git 的市场。有关详细信息，请参阅 [Troubleshooting](/zh-CN/plugin-marketplaces#plugins-with-relative-paths-fail-in-url-based-marketplaces)。
</Note>

4. **NPM 包**：

```json  theme={null}
{ "source": "npm", "package": "@acme-corp/claude-plugins" }
{ "source": "npm", "package": "@acme-corp/approved-marketplace" }
```

字段：`package`（必需，支持作用域包）

5. **文件路径**：

```json  theme={null}
{ "source": "file", "path": "/usr/local/share/claude/acme-marketplace.json" }
{ "source": "file", "path": "/opt/acme-corp/plugins/marketplace.json" }
```

字段：`path`（必需：marketplace.json 文件的绝对路径）

6. **目录路径**：

```json  theme={null}
{ "source": "directory", "path": "/usr/local/share/claude/acme-plugins" }
{ "source": "directory", "path": "/opt/acme-corp/approved-marketplaces" }
```

字段：`path`（必需：包含 `.claude-plugin/marketplace.json` 的目录的绝对路径）

**配置示例**：

示例 - 仅允许特定市场：

```json  theme={null}
{
  "strictKnownMarketplaces": [
    {
      "source": "github",
      "repo": "acme-corp/approved-plugins"
    },
    {
      "source": "github",
      "repo": "acme-corp/security-tools",
      "ref": "v2.0"
    },
    {
      "source": "url",
      "url": "https://plugins.example.com/marketplace.json"
    },
    {
      "source": "npm",
      "package": "@acme-corp/compliance-plugins"
    }
  ]
}
```

示例 - 禁用所有市场添加：

```json  theme={null}
{
  "strictKnownMarketplaces": []
}
```

**精确匹配要求**：

市场源必须**完全**匹配才能允许用户的添加。对于基于 git 的源（`github` 和 `git`），这包括所有可选字段：

* `repo` 或 `url` 必须完全匹配
* `ref` 字段必须完全匹配（或两者都未定义）
* `path` 字段必须完全匹配（或两者都未定义）

**不**匹配的源示例：

```json  theme={null}
// 这些是不同的源：
{ "source": "github", "repo": "acme-corp/plugins" }
{ "source": "github", "repo": "acme-corp/plugins", "ref": "main" }

// 这些也是不同的：
{ "source": "github", "repo": "acme-corp/plugins", "path": "marketplace" }
{ "source": "github", "repo": "acme-corp/plugins" }
```

**与 `extraKnownMarketplaces` 的比较**：

| 方面         | `strictKnownMarketplaces` | `extraKnownMarketplaces` |
| ---------- | ------------------------- | ------------------------ |
| **目的**     | 组织策略强制执行                  | 团队便利                     |
| **设置文件**   | 仅 `managed-settings.json` | 任何设置文件                   |
| **行为**     | 阻止非允许列表的添加                | 自动安装缺失的市场                |
| **何时强制执行** | 在网络/文件系统操作之前              | 在用户信任提示之后                |
| **可以被覆盖**  | 否（最高优先级）                  | 是（由更高优先级设置）              |
| **源格式**    | 直接源对象                     | 具有嵌套源的命名市场               |
| **用例**     | 合规、安全限制                   | 入职、标准化                   |

**格式差异**：

`strictKnownMarketplaces` 使用直接源对象：

```json  theme={null}
{
  "strictKnownMarketplaces": [
    { "source": "github", "repo": "acme-corp/plugins" }
  ]
}
```

`extraKnownMarketplaces` 需要命名市场：

```json  theme={null}
{
  "extraKnownMarketplaces": {
    "acme-tools": {
      "source": { "source": "github", "repo": "acme-corp/plugins" }
    }
  }
}
```

**重要说明**：

* 限制在任何网络请求或文件系统操作之前被检查
* 被阻止时，用户会看到清晰的错误消息，指示源被 managed 策略阻止
* 限制仅适用于添加新市场；以前安装的市场保持可访问
* Managed 设置具有最高优先级，无法被覆盖

有关面向用户的文档，请参阅 [Managed 市场限制](/zh-CN/plugin-marketplaces#managed-marketplace-restrictions)。

### 管理 plugins

使用 `/plugin` 命令以交互方式管理 plugins：

* 浏览市场中的可用 plugins
* 安装/卸载 plugins
* 启用/禁用 plugins
* 查看 plugin 详细信息（提供的命令、agents、hooks）
* 添加/删除市场

在 [plugins 文档](/zh-CN/plugins) 中了解有关 plugin 系统的更多信息。

## 环境变量

Claude Code 支持以下环境变量来控制其行为：

<Note>
  所有环境变量也可以在 [`settings.json`](#available-settings) 中配置。这是为每个会话自动设置环境变量或为整个团队或组织推出一组环境变量的有用方式。
</Note>

| 变量                                            | 目的                                                                                                                                                                                                                                                                                                                                                      |
| :-------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `ANTHROPIC_API_KEY`                           | 作为 `X-Api-Key` 标头发送的 API 密钥，通常用于 Claude SDK（对于交互式使用，运行 `/login`）                                                                                                                                                                                                                                                                                        |
| `ANTHROPIC_AUTH_TOKEN`                        | `Authorization` 标头的自定义值（您在此处设置的值将以 `Bearer ` 为前缀）                                                                                                                                                                                                                                                                                                       |
| `ANTHROPIC_CUSTOM_HEADERS`                    | 您想添加到请求的自定义标头（采用 `Name: Value` 格式）                                                                                                                                                                                                                                                                                                                      |
| `ANTHROPIC_DEFAULT_HAIKU_MODEL`               | 请参阅 [Model configuration](/zh-CN/model-config#environment-variables)                                                                                                                                                                                                                                                                                    |
| `ANTHROPIC_DEFAULT_OPUS_MODEL`                | 请参阅 [Model configuration](/zh-CN/model-config#environment-variables)                                                                                                                                                                                                                                                                                    |
| `ANTHROPIC_DEFAULT_SONNET_MODEL`              | 请参阅 [Model configuration](/zh-CN/model-config#environment-variables)                                                                                                                                                                                                                                                                                    |
| `ANTHROPIC_FOUNDRY_API_KEY`                   | Microsoft Foundry 身份验证的 API 密钥（请参阅 [Microsoft Foundry](/zh-CN/microsoft-foundry)）                                                                                                                                                                                                                                                                       |
| `ANTHROPIC_MODEL`                             | 要使用的模型设置的名称（请参阅 [Model Configuration](/zh-CN/model-config#environment-variables)）                                                                                                                                                                                                                                                                       |
| `ANTHROPIC_SMALL_FAST_MODEL`                  | \[已弃用] [Haiku 级模型用于后台任务](/zh-CN/costs) 的名称                                                                                                                                                                                                                                                                                                              |
| `ANTHROPIC_SMALL_FAST_MODEL_AWS_REGION`       | 使用 Bedrock 时覆盖 Haiku 级模型的 AWS 区域                                                                                                                                                                                                                                                                                                                        |
| `AWS_BEARER_TOKEN_BEDROCK`                    | Bedrock API 密钥用于身份验证（请参阅 [Bedrock API keys](https://aws.amazon.com/blogs/machine-learning/accelerate-ai-development-with-amazon-bedrock-api-keys/)）                                                                                                                                                                                                     |
| `BASH_DEFAULT_TIMEOUT_MS`                     | 长时间运行的 bash 命令的默认超时                                                                                                                                                                                                                                                                                                                                     |
| `BASH_MAX_OUTPUT_LENGTH`                      | bash 输出中的最大字符数，超过此数字后会进行中间截断                                                                                                                                                                                                                                                                                                                            |
| `BASH_MAX_TIMEOUT_MS`                         | 模型可以为长时间运行的 bash 命令设置的最大超时                                                                                                                                                                                                                                                                                                                              |
| `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE`             | 设置触发自动压缩的上下文容量百分比（1-100）。默认情况下，自动压缩在大约 95% 容量时触发。使用较低的值（如 `50`）以更早压缩。高于默认阈值的值无效。适用于主对话和 subagents。此百分比与 [status line](/zh-CN/statusline) 中可用的 `context_window.used_percentage` 字段对齐                                                                                                                                                                     |
| `CLAUDE_BASH_MAINTAIN_PROJECT_WORKING_DIR`    | 在每个 Bash 命令后返回到原始工作目录                                                                                                                                                                                                                                                                                                                                   |
| `CLAUDE_CODE_API_KEY_HELPER_TTL_MS`           | 应刷新凭证的间隔（以毫秒为单位）（使用 `apiKeyHelper` 时）                                                                                                                                                                                                                                                                                                                   |
| `CLAUDE_CODE_CLIENT_CERT`                     | 用于 mTLS 身份验证的客户端证书文件的路径                                                                                                                                                                                                                                                                                                                                 |
| `CLAUDE_CODE_CLIENT_KEY_PASSPHRASE`           | 加密 CLAUDE\_CODE\_CLIENT\_KEY 的密码（可选）                                                                                                                                                                                                                                                                                                                    |
| `CLAUDE_CODE_CLIENT_KEY`                      | 用于 mTLS 身份验证的客户端私钥文件的路径                                                                                                                                                                                                                                                                                                                                 |
| `CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS`      | 设置为 `1` 以禁用 Anthropic API 特定的 `anthropic-beta` 标头。当使用带有第三方提供商的 LLM 网关时遇到"Unexpected value(s) for the `anthropic-beta` header"之类的问题时使用此选项                                                                                                                                                                                                                |
| `CLAUDE_CODE_DISABLE_BACKGROUND_TASKS`        | 设置为 `1` 以禁用所有后台任务功能，包括 Bash 和 subagent 工具上的 `run_in_background` 参数、自动后台处理和 Ctrl+B 快捷键                                                                                                                                                                                                                                                                   |
| `CLAUDE_CODE_EXIT_AFTER_STOP_DELAY`           | 查询循环变为空闲后等待自动退出的时间（以毫秒为单位）。对于使用 SDK 模式的自动化工作流和脚本很有用                                                                                                                                                                                                                                                                                                     |
| `CLAUDE_CODE_PROXY_RESOLVES_HOSTS`            | 设置为 `true` 以允许代理执行 DNS 解析而不是调用者。对于代理应处理主机名解析的环境选择加入                                                                                                                                                                                                                                                                                                     |
| `CLAUDE_CODE_TASK_LIST_ID`                    | 跨会话共享任务列表。在多个 Claude Code 实例中设置相同的 ID 以协调共享任务列表。请参阅 [Task list](/zh-CN/interactive-mode#task-list)                                                                                                                                                                                                                                                      |
| `CLAUDE_CODE_TMPDIR`                          | 覆盖用于内部临时文件的临时目录。Claude Code 将 `/claude/` 附加到此路径。默认：Unix/macOS 上的 `/tmp`，Windows 上的 `os.tmpdir()`                                                                                                                                                                                                                                                        |
| `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC`    | 等同于设置 `DISABLE_AUTOUPDATER`、`DISABLE_BUG_COMMAND`、`DISABLE_ERROR_REPORTING` 和 `DISABLE_TELEMETRY`                                                                                                                                                                                                                                                       |
| `CLAUDE_CODE_DISABLE_TERMINAL_TITLE`          | 设置为 `1` 以禁用基于对话上下文的自动终端标题更新                                                                                                                                                                                                                                                                                                                             |
| `CLAUDE_CODE_FILE_READ_MAX_OUTPUT_TOKENS`     | 覆盖文件读取的默认令牌限制。当您需要完整读取较大文件时很有用                                                                                                                                                                                                                                                                                                                          |
| `CLAUDE_CODE_HIDE_ACCOUNT_INFO`               | 设置为 `1` 以从 Claude Code UI 中隐藏您的电子邮件地址和组织名称。在流式传输或录制时很有用                                                                                                                                                                                                                                                                                                 |
| `CLAUDE_CODE_IDE_SKIP_AUTO_INSTALL`           | 跳过 IDE 扩展的自动安装                                                                                                                                                                                                                                                                                                                                          |
| `CLAUDE_CODE_MAX_OUTPUT_TOKENS`               | 设置大多数请求的最大输出令牌数。默认：32,000。最大：64,000。增加此值会减少在 [auto-compaction](/zh-CN/costs#reduce-token-usage) 触发之前可用的有效上下文窗口。                                                                                                                                                                                                                                         |
| `CLAUDE_CODE_OTEL_HEADERS_HELPER_DEBOUNCE_MS` | 刷新动态 OpenTelemetry 标头的间隔（以毫秒为单位）（默认：1740000 / 29 分钟）。请参阅 [Dynamic headers](/zh-CN/monitoring-usage#dynamic-headers)                                                                                                                                                                                                                                     |
| `CLAUDE_CODE_SHELL`                           | 覆盖自动 shell 检测。当您的登录 shell 与您的首选工作 shell 不同时很有用（例如 `bash` vs `zsh`）                                                                                                                                                                                                                                                                                      |
| `CLAUDE_CODE_SHELL_PREFIX`                    | 用于包装所有 bash 命令的命令前缀（例如用于日志记录或审计）。示例：`/path/to/logger.sh` 将执行 `/path/to/logger.sh <command>`                                                                                                                                                                                                                                                             |
| `CLAUDE_CODE_SKIP_BEDROCK_AUTH`               | 跳过 Bedrock 的 AWS 身份验证（例如使用 LLM 网关时）                                                                                                                                                                                                                                                                                                                     |
| `CLAUDE_CODE_SKIP_FOUNDRY_AUTH`               | 跳过 Microsoft Foundry 的 Azure 身份验证（例如使用 LLM 网关时）                                                                                                                                                                                                                                                                                                         |
| `CLAUDE_CODE_SKIP_VERTEX_AUTH`                | 跳过 Vertex 的 Google 身份验证（例如使用 LLM 网关时）                                                                                                                                                                                                                                                                                                                   |
| `CLAUDE_CODE_SUBAGENT_MODEL`                  | 请参阅 [Model configuration](/zh-CN/model-config)                                                                                                                                                                                                                                                                                                          |
| `CLAUDE_CODE_USE_BEDROCK`                     | 使用 [Bedrock](/zh-CN/amazon-bedrock)                                                                                                                                                                                                                                                                                                                     |
| `CLAUDE_CODE_USE_FOUNDRY`                     | 使用 [Microsoft Foundry](/zh-CN/microsoft-foundry)                                                                                                                                                                                                                                                                                                        |
| `CLAUDE_CODE_USE_VERTEX`                      | 使用 [Vertex](/zh-CN/google-vertex-ai)                                                                                                                                                                                                                                                                                                                    |
| `CLAUDE_CONFIG_DIR`                           | 自定义 Claude Code 存储其配置和数据文件的位置                                                                                                                                                                                                                                                                                                                           |
| `DISABLE_AUTOUPDATER`                         | 设置为 `1` 以禁用自动更新。                                                                                                                                                                                                                                                                                                                                        |
| `DISABLE_BUG_COMMAND`                         | 设置为 `1` 以禁用 `/bug` 命令                                                                                                                                                                                                                                                                                                                                   |
| `DISABLE_COST_WARNINGS`                       | 设置为 `1` 以禁用成本警告消息                                                                                                                                                                                                                                                                                                                                       |
| `DISABLE_ERROR_REPORTING`                     | 设置为 `1` 以选择退出 Sentry 错误报告                                                                                                                                                                                                                                                                                                                               |
| `DISABLE_INSTALLATION_CHECKS`                 | 设置为 `1` 以禁用安装警告。仅在手动管理安装位置时使用，因为这可能会掩盖标准安装的问题                                                                                                                                                                                                                                                                                                           |
| `DISABLE_NON_ESSENTIAL_MODEL_CALLS`           | 设置为 `1` 以禁用非关键路径（如风味文本）的模型调用                                                                                                                                                                                                                                                                                                                            |
| `DISABLE_PROMPT_CACHING`                      | 设置为 `1` 以禁用所有模型的 prompt caching（优先于每个模型的设置）                                                                                                                                                                                                                                                                                                             |
| `DISABLE_PROMPT_CACHING_HAIKU`                | 设置为 `1` 以禁用 Haiku 模型的 prompt caching                                                                                                                                                                                                                                                                                                                    |
| `DISABLE_PROMPT_CACHING_OPUS`                 | 设置为 `1` 以禁用 Opus 模型的 prompt caching                                                                                                                                                                                                                                                                                                                     |
| `DISABLE_PROMPT_CACHING_SONNET`               | 设置为 `1` 以禁用 Sonnet 模型的 prompt caching                                                                                                                                                                                                                                                                                                                   |
| `DISABLE_TELEMETRY`                           | 设置为 `1` 以选择退出 Statsig 遥测（请注意，Statsig 事件不包括用户数据，如代码、文件路径或 bash 命令）                                                                                                                                                                                                                                                                                       |
| `ENABLE_TOOL_SEARCH`                          | 控制 [MCP tool search](/zh-CN/mcp#scale-with-mcp-tool-search)。值：`auto`（默认，在 10% 上下文处启用）、`auto:N`（自定义阈值，例如 `auto:5` 表示 5%）、`true`（始终开启）、`false`（禁用）                                                                                                                                                                                                        |
| `FORCE_AUTOUPDATE_PLUGINS`                    | 设置为 `true` 以强制 plugin 自动更新，即使主自动更新程序通过 `DISABLE_AUTOUPDATER` 禁用                                                                                                                                                                                                                                                                                         |
| `HTTP_PROXY`                                  | 为网络连接指定 HTTP 代理服务器                                                                                                                                                                                                                                                                                                                                      |
| `HTTPS_PROXY`                                 | 为网络连接指定 HTTPS 代理服务器                                                                                                                                                                                                                                                                                                                                     |
| `IS_DEMO`                                     | 设置为 `true` 以启用演示模式：从 UI 隐藏电子邮件和组织、跳过入职和隐藏内部命令。对于流式传输或录制会话很有用                                                                                                                                                                                                                                                                                            |
| `MAX_MCP_OUTPUT_TOKENS`                       | MCP 工具响应中允许的最大令牌数。当输出超过 10,000 个令牌时，Claude Code 显示警告（默认：25000）                                                                                                                                                                                                                                                                                          |
| `MAX_THINKING_TOKENS`                         | 覆盖 [extended thinking](https://docs.claude.com/en/docs/build-with-claude/extended-thinking) 令牌预算。思考在最大预算（31,999 个令牌）处默认启用。使用此选项限制预算（例如 `MAX_THINKING_TOKENS=10000`）或完全禁用思考（`MAX_THINKING_TOKENS=0`）。扩展思考改进了复杂推理和编码任务的性能，但影响 [prompt caching efficiency](https://docs.claude.com/en/docs/build-with-claude/prompt-caching#caching-with-thinking-blocks)。 |
| `MCP_TIMEOUT`                                 | MCP 服务器启动的超时（以毫秒为单位）                                                                                                                                                                                                                                                                                                                                    |
| `MCP_TOOL_TIMEOUT`                            | MCP 工具执行的超时（以毫秒为单位）                                                                                                                                                                                                                                                                                                                                     |
| `NO_PROXY`                                    | 将直接发出请求的域和 IP 列表，绕过代理                                                                                                                                                                                                                                                                                                                                   |
| `SLASH_COMMAND_TOOL_CHAR_BUDGET`              | 显示给 [Skill tool](/zh-CN/skills#control-who-invokes-a-skill) 的 skill 元数据的最大字符数（默认：15000）。为了向后兼容而保留的旧名称。                                                                                                                                                                                                                                                  |
| `USE_BUILTIN_RIPGREP`                         | 设置为 `0` 以使用系统安装的 `rg` 而不是 Claude Code 附带的 `rg`                                                                                                                                                                                                                                                                                                          |
| `VERTEX_REGION_CLAUDE_3_5_HAIKU`              | 使用 Vertex AI 时覆盖 Claude 3.5 Haiku 的区域                                                                                                                                                                                                                                                                                                                   |
| `VERTEX_REGION_CLAUDE_3_7_SONNET`             | 使用 Vertex AI 时覆盖 Claude 3.7 Sonnet 的区域                                                                                                                                                                                                                                                                                                                  |
| `VERTEX_REGION_CLAUDE_4_0_OPUS`               | 使用 Vertex AI 时覆盖 Claude 4.0 Opus 的区域                                                                                                                                                                                                                                                                                                                    |
| `VERTEX_REGION_CLAUDE_4_0_SONNET`             | 使用 Vertex AI 时覆盖 Claude 4.0 Sonnet 的区域                                                                                                                                                                                                                                                                                                                  |
| `VERTEX_REGION_CLAUDE_4_1_OPUS`               | 使用 Vertex AI 时覆盖 Claude 4.1 Opus 的区域                                                                                                                                                                                                                                                                                                                    |

## Claude 可用的工具

Claude Code 可以访问一组强大的工具，可帮助它理解和修改您的代码库：

| 工具                  | 描述                                                                    | 需要权限 |
| :------------------ | :-------------------------------------------------------------------- | :--- |
| **AskUserQuestion** | 提出多选问题以收集需求或澄清歧义                                                      | 否    |
| **Bash**            | 在您的环境中执行 shell 命令（请参阅下面的 [Bash tool behavior](#bash-tool-behavior)）   | 是    |
| **TaskOutput**      | 从后台任务（bash shell 或 subagent）检索输出                                      | 否    |
| **Edit**            | 对特定文件进行有针对性的编辑                                                        | 是    |
| **ExitPlanMode**    | 提示用户退出 Plan Mode 并开始编码                                                | 是    |
| **Glob**            | 基于模式匹配查找文件                                                            | 否    |
| **Grep**            | 在文件内容中搜索模式                                                            | 否    |
| **KillShell**       | 按 ID 杀死正在运行的后台 bash shell                                             | 否    |
| **MCPSearch**       | 启用 [tool search](/zh-CN/mcp#scale-with-mcp-tool-search) 时搜索和加载 MCP 工具 | 否    |
| **NotebookEdit**    | 修改 Jupyter notebook 单元格                                               | 是    |
| **Read**            | 读取文件的内容                                                               | 否    |
| **Skill**           | 在主对话中执行 [skill](/zh-CN/skills#control-who-invokes-a-skill)            | 是    |
| **Task**            | 运行 sub-agent 以处理复杂的多步骤任务                                              | 否    |
| **TaskCreate**      | 在任务列表中创建新任务                                                           | 否    |
| **TaskGet**         | 检索特定任务的完整详细信息                                                         | 否    |
| **TaskList**        | 列出所有任务及其当前状态                                                          | 否    |
| **TaskUpdate**      | 更新任务状态、依赖项或详细信息                                                       | 否    |
| **WebFetch**        | 从指定的 URL 获取内容                                                         | 是    |
| **WebSearch**       | 执行带有域过滤的网络搜索                                                          | 是    |
| **Write**           | 创建或覆盖文件                                                               | 是    |

权限规则可以使用 `/allowed-tools` 或在 [permission settings](/zh-CN/settings#available-settings) 中配置。另请参阅 [Tool-specific permission rules](/zh-CN/iam#tool-specific-permission-rules)。

### Bash 工具行为

Bash 工具使用以下持久性行为执行 shell 命令：

* **工作目录持久化**：当 Claude 更改工作目录（例如 `cd /path/to/dir`）时，后续 Bash 命令将在该目录中执行。您可以使用 `CLAUDE_BASH_MAINTAIN_PROJECT_WORKING_DIR=1` 在每个命令后重置为项目目录。
* **环境变量不持久化**：在一个 Bash 命令中设置的环境变量（例如 `export MY_VAR=value`）在后续 Bash 命令中**不**可用。每个 Bash 命令在新的 shell 环境中运行。

要使环境变量在 Bash 命令中可用，您有**三个选项**：

**选项 1：在启动 Claude Code 之前激活环境**（最简单的方法）

在启动 Claude Code 之前在您的终端中激活您的虚拟环境：

```bash  theme={null}
conda activate myenv
# 或：source /path/to/venv/bin/activate
claude
```

这适用于 shell 环境，但在 Claude 的 Bash 命令中设置的环境变量不会在命令之间持久化。

**选项 2：在启动 Claude Code 之前设置 CLAUDE\_ENV\_FILE**（持久环境设置）

导出包含您的环境设置的 shell 脚本的路径：

```bash  theme={null}
export CLAUDE_ENV_FILE=/path/to/env-setup.sh
claude
```

其中 `/path/to/env-setup.sh` 包含：

```bash  theme={null}
conda activate myenv
# 或：source /path/to/venv/bin/activate
# 或：export MY_VAR=value
```

Claude Code 将在每个 Bash 命令之前获取此文件，使环境在所有命令中持久化。

**选项 3：使用 SessionStart hook**（项目特定配置）

在 `.claude/settings.json` 中配置：

```json  theme={null}
{
  "hooks": {
    "SessionStart": [{
      "matcher": "startup",
      "hooks": [{
        "type": "command",
        "command": "echo 'conda activate myenv' >> \"$CLAUDE_ENV_FILE\""
      }]
    }]
  }
}
```

hook 写入 `$CLAUDE_ENV_FILE`，然后在每个 Bash 命令之前获取。这对于团队共享的项目配置是理想的。

有关选项 3 的更多详细信息，请参阅 [SessionStart hooks](/zh-CN/hooks#persisting-environment-variables)。

### 使用 hooks 扩展工具

您可以使用 [Claude Code hooks](/zh-CN/hooks-guide) 在任何工具执行前后运行自定义命令。

例如，您可以在 Claude 修改 Python 文件后自动运行 Python 格式化程序，或通过阻止对某些路径的 Write 操作来防止修改生产配置文件。

## 另请参阅

* [Identity and Access Management](/zh-CN/iam#configuring-permissions) - 权限系统概述以及 allow/ask/deny 规则如何相互作用
* [Tool-specific permission rules](/zh-CN/iam#tool-specific-permission-rules) - Bash、Read、Edit、WebFetch、MCP 和 Task 工具的详细模式，包括安全限制
* [Managed settings](/zh-CN/iam#managed-settings) - 组织的 Managed 策略配置
* [Troubleshooting](/zh-CN/troubleshooting) - 常见配置问题的解决方案
解释
