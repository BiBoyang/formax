# 2026-03-08 auto-memory reminder 注入对齐

## 背景

在 `FORMAX_DEFERRED_TOOL_EXPOSURE=1` 下，system prompt 已包含 `# auto memory` 规则段，但请求 payload 里缺少 `MEMORY.md` 正文注入。

抓包对齐结论：Claude Code 的行为是“双轨”：

1. 在 system prompt `fullText` 声明 memory 规则与目录
2. 在每轮 `<system-reminder>#claudeMd` 中注入 `MEMORY.md` 文件内容

## 决策

Formax 采用同样双轨：

1. 继续保留 `packages/core/src/prompts/system.ts` 的 `# auto memory` 规则段
2. 在 `packages/core/src/features/repl/injectedBlocks.ts` 统一注入 `CLAUDE.md` 与 `MEMORY.md`
3. `MEMORY.md` 读取路径与 system prompt 声明路径强绑定（同一 `buildAutoMemoryDirectoryPath`）
4. `MEMORY.md` 注入上限为前 200 行，超出部分截断
5. `MEMORY.md` 注入与 `FORMAX_DEFERRED_TOOL_EXPOSURE` 绑定：仅 `=1` 注入，`=0` 不注入

## 防回归点

1. `injectedBlocks` 增加 memory-only 注入测试（无 `CLAUDE.md` 时也应注入）
2. `ReminderService` 增加 memory 注入测试
3. `claude_md_injection` session event 的 signature 覆盖 memory 元数据，避免仅看 `global/project` 导致遗漏
