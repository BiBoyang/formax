# Electron Setup Wizard Review 问题记录

本文记录在实现 Electron/Web Setup Wizard 期间，`codex review --uncommitted -c model="gpt-5.4" -c model_reasoning_effort="medium"` 反复指出的问题。

当前 `.tmp/codex-review-result/review-latest.txt` 只保留最近一次 review 输出，所以完整时间线是根据本轮执行过程中实际看到的 review 输出，以及每次 review 后立即做过的修复整理出来的。

2026-05-27 已将最终收敛规则写入 `docs/contracts/setup-wizard-contract.md`。后续 review 应优先按该合同判断是否存在真正的阻塞问题。

## 总结

- 主要模式：review 实际上不只是在找代码 bug，而是在不断发现尚未定死的产品语义和安全语义。
- 变动最多的区域：
  - Electron 启动/setup 路由与 managed runtime 模式。
  - Web setup 路由和 status gate 行为。
  - Setup session 生命周期、归属、过期恢复。
  - credential、authRef、env key、provider 切换语义。
  - 异步 RPC echo 下的受控表单输入状态。
- 反复冲突的点：
  - setup status probe 失败时，是 fail open 进入 runtime，还是 fail closed 进入 setup。
  - env-backed setup 是否应该删除、保留、绕过已有 `auth.json` 条目。
  - provider 切换时是否可以复用已有 API key。
  - browser-only setup 写完 config 后是否可以自动进入 RuntimeApp。

## Review Findings 时间线

| # | 优先级 | Review 问题 | 涉及文件 | 类别 | 最终/当前处理 |
|---|---:|---|---|---|---|
| 1 | P1 | 等待 desktop runtime 重启时可能错过 child exit 事件。 | `packages/desktop-electron/src/main.ts` | Electron 生命周期 | 在发送 shutdown signal 前先建立 child exit 等待。 |
| 2 | P2 | fallback 到 runtime app 前没有断开 setup bridge。 | `packages/web-reference-react/src/App.tsx` | Web RPC 生命周期 | setup-mode unavailable 时，在渲染 `RuntimeApp` 前断开 setup `RpcClient`。 |
| 3 | P1 | 跳过 API key 写入时应该清理或轮换 stale auth entry。 | `packages/core/src/adapters/setup/writeSetupFiles.ts` | Credential 语义 | 最初改成删除 stale auth entry，后来发现 global auth store 是共享的，已撤回。最终方向是不删除共享 credential，也不写 synthetic env authRef。 |
| 4 | P2 | RPC action pending 时重复点击会跳过 setup step。 | `packages/web-reference-react/src/App.tsx` | Web UI 状态 | 给 step transition 增加 pending guard，同时保持文本输入响应。 |
| 5 | P2 | 同一个 setup session 可以并发 commit。 | `packages/core/src/core/setup/bridgeService.ts` | Bridge session 生命周期 | 给 setup session 增加 commit-in-progress 锁。 |
| 6 | P1 | env-backed setup 写入时不应该删除共享 auth-store entry。 | `packages/core/src/adapters/setup/writeSetupFiles.ts` | Credential 语义 | 撤回共享 auth 删除逻辑。env-backed setup 不修改共享 stored auth，也不写 synthetic authRef。 |
| 7 | P2 | 离开 `/setup` 时没有保留 base-path trailing slash。 | `packages/web-reference-react/src/App.tsx` | Web 路由 | `resolveRuntimeRouteAfterSetup()` 将 `/app/setup` 映射到 `/app/`，不是 `/app`。 |
| 8 | P1 | setup 切换 provider 时应该持久化 provider-specific auth。 | `packages/core/src/core/setup/bridgeService.ts` | Credential/provider 语义 | 最初让 provider switch 把复用 key 写到新 provider 下；后来 review 指出跨 provider 复用不安全，已反转。 |
| 9 | P2 | setup URL 应该从 app base 推导，而不是从当前 route 推导。 | `packages/desktop-electron/src/main.ts` | Electron 路由 | 曾尝试把深层 extensionless path 折叠到 `/`；后来发现会破坏合法 `/app` base path，已调整。 |
| 10 | P2 | 推导 setup URL 时要保留非 root base path。 | `packages/desktop-electron/src/main.ts` | Electron 路由 | 恢复 extensionless base path 保留规则，使 `/app` 映射到 `/app/setup`。 |
| 11 | P2 | 销毁调用窗口前应先返回 setup IPC reply。 | `packages/desktop-electron/src/main.ts` | Electron IPC 生命周期 | 返回 `true` 给 renderer 后，再用 `setImmediate()` 延迟关闭 setup window。 |
| 12 | P1 | desktop setup-status probe 出错时应该 fail closed。 | `packages/desktop-electron/src/main.ts` | Electron setup 判定 | 最初把失败都当作 setup required；后来为了兼容性细化为：non-local 跳过、unsupported status route 回 runtime、本地 transient failure fail closed。 |
| 13 | P2 | setup session mutation 必须绑定创建它的 websocket。 | `packages/core/src/app-server/devBridge.ts` | Secret/session 隔离 | `action`、`commit`、`dispose` 现在要求 session 归属于当前 websocket。 |
| 14 | P1 | 复用已有 key 时要保留 custom authRef。 | `packages/core/src/core/setup/bridgeService.ts` | Credential/authRef 语义 | runtime auth context 增加 `authRef`；同 provider 复用时保留 `team` 等 custom authRef。 |
| 15 | P2 | Electron setup 完成后 renderer 不应再 redirect。 | `packages/web-reference-react/src/App.tsx` | Electron/Web handoff | Desktop completion 不再执行浏览器 redirect；Electron main process 负责 handoff。 |
| 16 | P2 | 不要从每个 setup RPC echo 重新同步文本输入。 | `packages/web-reference-react/src/App.tsx` | 异步受控输入 | 移除过宽的 effect 依赖，避免旧 RPC echo 把输入值倒退。 |
| 17 | P1 | setup-status probe 失败时 fallback 到 runtime。 | `packages/web-reference-react/src/App.tsx` | Web root gate | 曾临时实现 fail-open，后来因为 first-run setup 会被绕过而撤回。这是一个语义冲突点。 |
| 18 | P1 | setup 中不要复用之前 provider 的 API key。 | `packages/core/src/core/setup/bridgeService.ts` | Credential/provider 语义 | 最终方向：auth-store key 只允许同 provider 复用；切 provider 且 key 为空时 setup incomplete，不写 credential。 |
| 19 | P2 | setup-status probing 不支持时应该回到 runtime URL。 | `packages/desktop-electron/src/main.ts` | Electron 兼容性 | status route 返回 404/405/501 等 unsupported 情况时回 runtime。 |
| 20 | P1 | base-path app route 也应该 rewrite 到 `index.html`。 | `packages/core/src/runtime/web/localUi.ts` | 静态 Web 路由 | SPA shell 现在服务 `/app`、`/app/` 等 extensionless base-path route。 |
| 21 | P2 | 非 local desktop start URL 不应该做 setup-status probe。 | `packages/desktop-electron/src/main.ts` | Electron remote URL 兼容性 | 非 local `FORMAX_ELECTRON_START_URL` 不再 probe 合成 setup endpoint。 |
| 22 | P2 | browser-only setup 不应直接进入 main app。 | `packages/web-reference-react/src/App.tsx` | Browser setup handoff | Browser-only setup 成功后停留在 setup 页面，提示用户重启 web server，而不是进入 stale RuntimeApp。 |
| 23 | P2 | setup action 改变 base URL 时要同步输入框。 | `packages/web-reference-react/src/App.tsx` | 受控输入正确性 | provider/vendor action 现在会把 server reset 的 base URL 同步到输入框。 |
| 24 | P2 | setup field reset model selection 后要同步 model 输入框。 | `packages/web-reference-react/src/App.tsx` | 受控输入正确性 | 只有当用户没有输入更新的本地值时，才同步 model reset 值。 |
| 25 | P1 | status probe 失败时要保持 setup gate 活跃。 | `packages/web-reference-react/src/App.tsx` | Web root gate | 撤回之前的 fail-open 行为。root setup gate 现在显示 error/retry 状态，而不是启动 broken RuntimeApp。 |
| 26 | P3 | 挂载 main app 前要离开 `/setup` route。 | `packages/web-reference-react/src/App.tsx` | Web 路由 | explicit setup fallback 到 RuntimeApp 前会先把 `/setup` 替换为 runtime route。 |
| 27 | P1 | connection test 通过后要锁定 setup fields。 | `packages/web-reference-react/src/App.tsx` | 验证完整性 | 到达 `modelMode`/`model` 后锁定 provider/vendor/base URL/API key；model 字段到 confirm/write 前仍可编辑。 |
| 28 | P2 | `session_not_found` 后要重新创建 setup session。 | `packages/web-reference-react/src/App.tsx` | Session 过期恢复 | Web setup 在旧 session 过期或被 dispose 后会自动创建新 session。 |
| 29 | P2 | setup-status URL 不应走 SPA fallback。 | `packages/core/src/runtime/web/localUi.ts` | 静态 Web 路由 | `/__formax/*` 被排除在 SPA fallback 外；setup mode disabled 时 status endpoint 返回 404。 |
| 30 | P1 | 不要让 desktop embedded runtime 永久处于 setup-allow mode。 | `packages/desktop-electron/src/main.ts` | 安全/runtime mode | Desktop managed runtime 默认使用 `require-config`；只有正常启动失败或需要 setup recovery 时才使用 `allow`。该修复已应用，记录时尚待下一轮 review。 |
| 31 | P2 | server-side normalization 后要重新同步 Base URL 输入框。 | `packages/web-reference-react/src/App.tsx` | 受控输入正确性 | `setBaseUrl` echo 现在只在用户没有输入更新本地值时，同步 normalize 后的值。该修复已应用，记录时尚待下一轮 review。 |
| 32 | P2 | heuristic-only setup 仍会通过 legacy scalar path 写入 `contextWindowTokens`。 | `packages/core/src/core/setup/bridgeService.ts` | Model/context-window provenance | quick setup 只有 heuristic tier source 时，同时清掉 scalar `contextWindowTokens/contextWindowSource` 和 tier metadata，避免把 fallback 写成 authoritative config。该修复已应用，记录时尚待下一轮 review。 |
| 33 | P2 | Electron 把任意 managed-runtime 启动失败都 fallback 成 setup-allow。 | `packages/desktop-electron/src/main.ts` | Electron startup error 分类 | 现在只有 require-config runtime stderr 明确包含 setup-required 提示时才启动 setup-allow fallback；其它启动错误继续抛出，避免掩盖真实失败。该修复已应用，记录时尚待下一轮 review。 |
| 34 | P1/P2 | browser-only setup 写完后不能进 stale RuntimeApp，但普通已配置 allow-mode 也不能被 restart gate 永久挡住。 | `packages/web-reference-react/src/App.tsx` | Browser setup handoff | 只有当前浏览器刚成功写过 setup 时才设置 restart-required marker 并显示 restart gate；没有 pending marker 的已配置 allow-mode 可以进入 RuntimeApp。该修复已应用，记录时尚待下一轮 review。 |
| 35 | P1/P2 | env-backed setup 不应写 synthetic authRef；restart gate 不应提供 stale runtime bypass。 | `packages/core/src/core/setup/bridgeService.ts`, `packages/web-reference-react/src/App.tsx` | Credential/browser handoff | env-backed commit 保留同 provider runtime authRef 或 default，不写 `__formax_env__`；restart gate 移除 Continue bypass。该修复已应用，记录时尚待下一轮 review。 |
| 36 | P1/P2 | browser restart gate 需要后端判断 server 是否从 incomplete 启动；desktop allow fallback 失败不能继续开坏窗口。 | `packages/core/src/core/setup/bridgeService.ts`, `packages/web-reference-react/src/App.tsx`, `packages/desktop-electron/src/main.ts` | Browser handoff/Electron startup | setup status 增加 `restartRequired`：启动时 incomplete、后来 complete 才阻塞 browser-only runtime；allow fallback 失败会继续抛错而不是打开 broken window。该修复已应用，记录时尚待下一轮 review。 |
| 37 | P1/P2/P3 | invalid config 应进 setup recovery；非持久 key 是否刷新 shared auth 再次冲突；direct `/setup` reload 不能绕过 restart gate。 | `packages/desktop-electron/src/main.ts`, `packages/core/src/adapters/setup/writeSetupFiles.ts`, `packages/web-reference-react/src/App.tsx` | Electron recovery/Credential/browser handoff | invalid-config stderr 也进入 setup-allow fallback；direct `/setup` 收到 `restartRequired` 时显示 restart gate。shared auth refresh 与“不删除/不改共享 credential、不写 env secret”合同冲突，暂不采纳。 |

## 冲突最多的 review 区域

### Setup Status Probe 失败语义

review 在这个点上反复拉向两个方向：

- local probe 失败时 fail closed 到 setup，避免 first-run recovery 被绕过。
- probing unsupported/remote runtime 时 fail open 到 runtime，避免破坏已有部署。

已确认目标规则：

- 非 local desktop start URL：不 probe setup status。
- local status route 返回 404/405/501：视为不支持 status endpoint，加载 runtime URL。
- local status route 明确返回 `{ complete: false }`：打开 setup。
- local transient/5xx/invalid JSON/fetch failure：fail closed 到 setup。
- Web root gate status failure：停在可重试的 setup-status error，不启动 RuntimeApp。

### Auth Store 与 Provider Switch

review 在 credential 语义上也出现过相反方向：

- 早期 review 要求 env-backed setup 跳过 API key persistence 时清 stale auth entry。
- 后续 review 正确指出 global auth store 是共享的，setup 不应该删除它。
- 有一轮 review 建议 provider switch 时持久化复用 key。
- 后续 review 正确指出把 Anthropic key 静默复用为 OpenAI key 是不安全的。

已确认目标规则：

- env key 可以用于 setup，但不写入 auth store。
- env-backed setup 不写 synthetic authRef；同 provider 时保留 existing runtime authRef，否则使用 default authRef。
- 同 provider 的 auth-store key 可以复用，并保留原 authRef。
- 跨 provider setup 不能静默复用 stored key；用户必须输入对应 provider 的 key。

### Browser Setup Completion

review 明确了 browser-only setup 和 Electron setup 不能使用同一种完成逻辑：

- Electron 可以重启 managed runtime 并打开 main window。
- browser-only `formax web --setup-mode allow` 无法重启已经运行的 server。

已确认目标规则：

- Electron setup 成功：main process 用 `require-config` 重启 runtime，打开 main window，并在 IPC reply 后关闭 setup window。
- Browser setup 成功：停留在 setup 页面，提示用户重启 web server 后刷新。

## 反复使用过的验证命令

- `bun run test -- packages/core/src/adapters/setup/writeSetupFiles.test.ts packages/core/src/core/setup/bridgeService.test.ts packages/core/src/runtime/cli/webCommand.test.ts packages/core/src/runtime/cli/main.test.ts packages/core/src/runtime/web/localUi.test.ts packages/core/src/app-server/devBridge.test.ts`
- 在 `packages/web-reference-react` 下运行：`bun run test -- src/App.test.tsx`
- `bun run type-check`
- 在 `packages/web-reference-react` 下运行：`bun run type-check`
- 在 `packages/desktop-electron` 下运行：`bun run build:main`
- `codex review --uncommitted -c model="gpt-5.4" -c model_reasoning_effort="medium"`
