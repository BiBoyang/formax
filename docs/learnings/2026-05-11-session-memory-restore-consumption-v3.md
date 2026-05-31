# 2026-05-11 - Session memory restore consumption v3

- file-backed restore 现在不再只会 best-effort 刷新 `.memory.json` sidecar；SDK `query(..., { resume })` 与 `query(..., { continue: true })` 也会把 sidecar 派生成一条 **仅下一轮请求可见** 的 session-memory reminder block。
- 这条 reminder block 仍然走 request-time injection 路径：它会影响下一轮 prompt 组装，但不会写回 persisted history，也不会改变 boundary-aware restore 后的 active history。
- `sessionRestore/sessionMemory.ts` 当前提供 canonical restore-artifacts helper，一次 sidecar 读取就能同时产出：
  - `mode`
  - `planPath`
  - `nextTurnInjectedBlocks`
- CLI `resumeLast` 与 SDK file-backed `resume/continue` 现在都会复用这份共享 restore-artifacts，避免重复读取 sidecar 再分别拼装 mode / planPath / reminder block。
