# App-Server Learning（2026-02-25）：Session Grouping 与 Hidden CWDs

## 背景

在 app-server 与 Web 协同中，线程分组（按 `cwd`）和 folder 隐藏状态如果处理不一致，会造成跨 session 的可见性与过滤偏差。

## 关键结论

1. 线程分组 `cwd` 不能只依赖 `session_meta.cwd`（首次创建目录）。
2. 对 app-server turn 流应优先采用最新 `app_turn_started.cwd`，否则持续使用中的线程可能长期归到历史临时目录（例如 `resume-same-*`）。
3. 覆盖摘要 `cwd` 时必须同步维护 `cwdReal`（realpath），否则 `/resume` 的同项目过滤会在符号链接/别名路径下出现误过滤。

## 行为对齐记录

1. 2026-02-23：`thread/start` 与 REPL 初次进入不再立即创建 session 文件，改为 provisional thread/session（仅内存）并在首个有效 turn 写入时 materialize 到磁盘。该策略避免产生大量“0 消息 session”，并保证 TUI 与 Web 的空会话可见性与持久化时机一致。
2. 2026-02-25：Web 侧“Remove session folder”改为服务端共享标记：`thread/group/hide` 写入 `FORMAX_CONFIG_DIR` 下的本地持久化文件，`thread/list` 返回 `hiddenGroupCwds` 供客户端过滤。该方案不绑定账号，但可在同一 app-server 的多客户端之间共享 folder 隐藏状态。

## 相关文档

- `docs/contracts/app-server-interaction-contract.md`
- `plans/app-server/HANDOFF.md`
