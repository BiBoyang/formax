# Setup Wizard Contract

本文定义 Electron/Web Setup Wizard 的长期行为边界。Setup Wizard 只负责配置、认证、模型初始化；它不是 transcript、turn、replay、canonical semantics、线程状态或 Web parity reducer 的一部分。

本合同在 2026-05-27 收敛确认：后续实现、review、测试以本文规则为准。

## Scope

- Setup Wizard 必须复用 core setup session、connection test、config/auth persistence 路径。
- Web Setup 页面是现有 Vite Web 客户端中的顶层 `/setup` route，不是独立手写 HTML，也不是第二套 renderer stack。
- `/setup` 必须在主 RuntimeApp 初始化前分流，不得触发 `initialize`、`thread/list`、`thread/messages`、`thread/replay`、`turn/start`、diff refresh、transcript projection 或 replay cursor 更新。
- `bridge/setup/*` 是 WebSocket bridge side-channel，不是 app-server thread/turn protocol。
- Setup RPC response 不得携带 `replaySeq`、`traceId`、`seq`、`eventId` 或 app-server notification envelope 字段。

## Required Config Gate

- 没有可用配置、没有可用 API key、没有 base URL、或没有 active/default tier 的显式 model 配置时，Electron 不能打开主页面。
- 已配置完成时，Electron 才能打开当前主页面。
- 配置不完整时，Electron 必须进入 SetupWizard route 或 setup recovery/retry 状态。
- `formax web` 默认仍然是 `require-config` 行为，不能因为浏览器 setup 支持而静默变成 first-run setup server。
- `--setup-mode allow` 和 `--allow-setup` 是显式 setup-capable 启动模式；其中 `--allow-setup` 只是 shorthand，不是新的产品语义。

## Configured Status Semantics

- Setup configured 的唯一长期定义是：API key 可用、base URL 非空、且 active/default tier 有显式 model 配置。
- 显式 model source 包括 `tier_env`、`tier_model`，以及 active/default tier 为 `sonnet` 时的 `legacy_sonnet_model`。
- 内置 default model fallback（`default_model`）不算 configured，必须映射为 `missing_model`。
- active/default tier 为 `haiku` 或 `opus` 时，仅配置 legacy `llm.model` 不配置对应 tier model，仍然是 `missing_model`。
- CLI `formax web --setup-mode require-config`、`bridge/setup/status`、Electron setup handoff re-probe 必须共享同一 configured-status 判定；不得各自手写 API-key-only 或其它局部判断。

## Electron Runtime Orchestration

- Electron managed runtime 正常启动必须使用 `setupMode='require-config'`。
- 只有当正常 `require-config` 启动无法满足 first-run/setup recovery 时，Electron 才能启动 `setupMode='allow'` 的 setup-capable runtime。
- Setup 成功后，Electron main process 必须重启 managed runtime，并恢复为 `setupMode='require-config'`。
- Setup 成功后的 handoff 由 Electron main process 负责：重启 managed runtime、重新 probe status，然后在 desktop host 中加载 main route；实现可以复用同一个 BrowserWindow，也可以在原窗口不存在时创建替代窗口。
- Electron renderer 在 setup 成功后不得自行 redirect 到 RuntimeApp。
- 如果 setup 成功后重新 probe 仍然显示 incomplete，必须回到/focus setup route，而不是打开 main route。
- 非 local desktop start URL 不做 setup-status probe，也不合成 setup endpoint；它按外部/远端 runtime 处理。

## Setup Status Probe

- setup status 的只读 HTTP endpoint 是 `GET /__formax/setup/status`。
- status response 必须是 redacted schema，不得包含 raw API key 或 secret material。
- `/__formax/*` 是内部 endpoint namespace，不能走 SPA fallback。
- local status route 返回 404、405、501 时，视为 runtime 不支持 setup status，允许加载 runtime URL。
- local status route 明确返回 `{ complete: false }` 时，必须进入 setup。
- local status route 返回 5xx、invalid JSON、fetch failure 或其他 transient failure 时，Electron fail closed 到 setup/recovery。
- Web root setup gate probe 失败时，停在可重试的 setup-status error，不得启动 RuntimeApp。

## Browser-Only Setup

- Browser-only setup 指用户通过浏览器访问 `formax web --setup-mode allow` 或 `formax web --allow-setup` 启动的 setup-capable Web server；没有 Electron main process 负责重启 runtime 和窗口 handoff。
- Browser-only setup commit 成功后，不自动进入 RuntimeApp。
- Browser-only setup commit 成功后，页面必须提示用户重启 Web server 或刷新到新 runtime config 后再继续。
- `setupMode=allow` server 如果启动时 setup incomplete、随后 status 变为 complete，`bridge/setup/status` 必须报告 `restartRequired: true`；浏览器 root gate 必须继续停在 restart gate。
- `setupMode=allow` server 如果启动时 setup 已 complete，则浏览器 root gate 可以进入 RuntimeApp。

## Credential Semantics

- Raw API key 只能存在于 server-side ephemeral setup session secret slot。
- Raw API key 不得出现在 `SetupSessionView`、status response、action history、diagnostics、audit details、logs、JSON-RPC errors 或 test fixture 输出中。
- Secret cleanup 必须覆盖 commit、cancel、dispose、stale-session timeout、socket close 和 service shutdown。
- env-provided API key 可以让 setup status complete，也可以用于 setup connection test/write config，但不得写回 auth store。
- env-backed setup 不写入 auth store，也不写入 synthetic/dangling auth reference。
- env-backed setup 应保留同 provider 的 existing runtime `authRef`，没有 existing authRef 时使用默认 authRef；如果之后 env key 消失，则由正常 runtime config/auth resolution 决定是否仍然 configured。
- setup 不得删除 shared/global auth store 中的既有 credential。
- 同 provider 的 auth-store key 可以复用，并且必须保留原 runtime `authRef`，例如 `team`。
- 跨 provider setup 不能静默复用 stored key；切换 provider 且没有 env key 或用户输入 key 时，setup 必须保持 incomplete。

## Setup Session Semantics

- setup session 必须有 redacted view、TTL/max lifetime、active session 上限和 stale-session 行为。
- setup session mutation 必须绑定创建该 session 的 WebSocket owner。
- WebSocket 关闭时必须 dispose 该 socket 拥有的 setup sessions。
- setup commit 必须有 per-session concurrency lock；并发 commit 应返回稳定错误，例如 `commit_in_progress`。
- session 过期、被 dispose 或 owner mismatch 时，UI 可以创建新 session 并提示旧 session 已失效。
- `bridge/setup/session/create`、`action`、`commit`、`dispose` 等 mutation 只能在 `setupMode='allow'` 下启用。
- redacted read-only status 可以在非 setup mutation path 中使用，但仍不得泄露 secret。

## Web Setup UI Semantics

- `/setup` 顶层 route 必须先于 `RuntimeApp` 和 `useAppRuntime` 初始化。
- Managed desktop `/setup` 收到 complete 或 setup mutation unavailable 时，不得从 `SetupEntrypoint` 直接渲染 `RuntimeApp`；必须停在 host-handoff/already-configured 或 setup-unavailable 状态，让 Electron main process 拥有 managed handoff。
- provider、vendor、base URL、API key 在 connection test 通过并进入 model/modelMode 阶段后应锁定，避免 post-test mutation 绕过验证。
- model mode/model selection 可以在 confirm/write 前继续编辑，但 commit 必须重新基于 session state 做 server-side validation。
- 文本输入必须防旧 RPC echo 回写覆盖用户较新的本地输入。
- provider/vendor action 导致的 base URL reset 必须同步到输入框。
- server-side base URL normalization 可以同步回输入框，但仅当用户没有在提交后继续输入更新值。
- model reset 也只能在用户没有输入更新本地值时同步。

## Static Route Semantics

- `/setup` 以及 extensionless base path route 可以服务 Vite SPA shell。
- `GET /__formax/setup/status` 在 setup status 未启用时应返回 404，而不是被 SPA fallback 捕获。
- 只读 status endpoint 与 `bridge/setup/status` 应共享同一 status 服务或同一 redaction/schema 规则。

## Review Acceptance

- Review 必须优先判断是否违反本文 contract。
- UI polish、最终 screenshots、packaged smoke、copy parity 可以作为后续 loop 内容，除非它们暴露本文定义的安全、配置 gate、secret redaction、runtime mode 或 `/setup` isolation 违规。
- 如果 review 发现的问题属于本文尚未定义的新语义，先更新本合同并让用户确认，再继续扩大实现。
