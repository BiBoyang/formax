# 2026-05-12 - App-server session-memory restore consumption v4

- app-server `thread/resume` 现在不再只沿用 sidecar 里的 `mode` / `planPath` 做 best-effort `.memory.json` refresh；它也会复用 canonical restore artifacts 里的 `nextTurnInjectedBlocks`。
- 这些 session-memory reminder blocks 当前不会暴露成新的 persisted authority，也不会写回 session JSONL；服务端会把它们缓存成 **next-turn-only injected blocks**，并在下一次成功的 `turn/start` / turn-dispatch 上消费一次。
- `TurnRunner` 当前把这类 pending restore blocks 当成 injected content 参与模型请求，但在写回 history snapshot 时会把它们 strip 掉，所以 persisted history 仍然只保留真实 user input。
- app-server `/context` local diagnostics 现在会把这批 blocks 暴露为 `Pending restore injected blocks` fixed group，这样 restore-consumption 语义对客户端是可解释的，而不是 hidden server state。
