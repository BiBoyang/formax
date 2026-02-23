# Golden Principles

以下原则必须可被机器检查。

## P1. 禁止业务层对 UI 层反向依赖

- 业务/runtime/domain 代码不得直接导入 UI 层模块。
- 检查脚本按 baseline 拦截回归。

## P2. 新增审计事件在可用时必须带 trace

- `audit.append({...})` 事件负载应包含 `trace`。
- 缺失 trace 将被视为原则违规。

## P3. 语义关键路径禁止新增 transcript 直接写入旁路

- 语义路径中新出现的 `setMessages(...)` 写入文件会被阻断。
- 既有直接写入 baseline 可下降，不可上升。

## 校验命令

- `bun run check:golden-principles`
