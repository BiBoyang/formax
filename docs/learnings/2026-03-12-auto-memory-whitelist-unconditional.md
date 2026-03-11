# 2026-03-12 auto-memory 白名单改为无条件

## 背景

此前 auto-memory 目录仅在 `FORMAX_DEFERRED_TOOL_EXPOSURE=1` 时加入 workspace 白名单。  
这会导致同一 memory 路径在不同 deferred 配置下出现不一致的 workspace 越界判定。

## 决策

在 `policyPreflight` 中将 auto-memory 白名单改为无条件：

1. 不再通过 `FORMAX_DEFERRED_TOOL_EXPOSURE` 控制 auto-memory 是否加入 workspace roots。
2. 继续保留 auto-memory 写入的默认免交互行为：当命中 auto-memory 且仅是默认 `prompt` 时，可提升为 `allow`。
3. 显式 policy `prompt` / `deny` 仍优先，不会被 auto-memory 默认放宽覆盖。

## 防回归点

1. `FORMAX_DEFERRED_TOOL_EXPOSURE=0` 时，读取 auto-memory 路径可通过 preflight。
2. `FORMAX_DEFERRED_TOOL_EXPOSURE=0` 时，写入 auto-memory 路径可通过 preflight（默认规则下）。
3. 显式 `prompt` / `deny` 的 auto-memory 写入规则仍生效。
