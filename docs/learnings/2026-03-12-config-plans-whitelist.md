# 2026-03-12 config plans 目录白名单

## 背景

在 plan-mode 相关场景里，runtime 需要稳定访问 `FORMAX_CONFIG_DIR/plans` 下的计划文件。  
此前内建白名单只覆盖了 deferred tool exposure 打开时的 auto-memory 目录，导致该 `plans` 路径在部分模式下仍会被判定为 workspace 越界。

## 决策

在 `policyPreflight` 的 effective workspace roots 里，本次明确两个始终生效的内建白名单根：

1. `<FORMAX_CONFIG_DIR>/plans` 始终加入 workspace roots（不受 `FORMAX_DEFERRED_TOOL_EXPOSURE` 影响）。
2. auto-memory 目录白名单改为始终生效，不再受 `FORMAX_DEFERRED_TOOL_EXPOSURE` 影响。

## 防回归点

1. 新增测试覆盖 `FORMAX_DEFERRED_TOOL_EXPOSURE=0` 时读取 `<FORMAX_CONFIG_DIR>/plans/*` 路径可通过 preflight。
2. 新增测试覆盖 `FORMAX_DEFERRED_TOOL_EXPOSURE=1` 时同一路径同样可通过 preflight。
