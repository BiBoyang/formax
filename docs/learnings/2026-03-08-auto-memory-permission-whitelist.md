# 2026-03-08 auto-memory 路径权限白名单

## 背景

在 `FORMAX_DEFERRED_TOOL_EXPOSURE=1` 下，模型会按 system prompt 访问 auto-memory 路径。  
该路径位于全局配置目录下，不在项目 workspace roots 内，因此 preflight 可能触发 `workspaceRequest` 交互。

## 决策

在 `policyPreflight` 中新增内建白名单：

1. 当 `FORMAX_DEFERRED_TOOL_EXPOSURE=1` 时，将当前 `cwd` 对应的 auto-memory 目录加入 effective workspace roots。
2. 当 `FORMAX_DEFERRED_TOOL_EXPOSURE=0` 时，不加入该白名单。
3. 当 `FORMAX_DEFERRED_TOOL_EXPOSURE=1` 且写入目标位于 auto-memory 目录时，`fs.write` 的默认 `prompt` 提升为 `allow`（显式 `prompt/deny` 保持不变）。

## 防回归点

1. 新增测试覆盖 deferred=1 时 `MEMORY.md` 路径读取不再触发 workspace 越界。
2. 新增测试覆盖 deferred=1 时写入 `MEMORY.md` 路径不再触发 approval。
3. 新增测试覆盖 deferred=1 下显式 `prompt fs.write` 仍然生效。
4. 新增测试覆盖 deferred=1 下显式 `deny fs.write` 仍然生效。
5. 新增测试覆盖 deferred=0 时相同路径仍按 workspace 越界处理。
