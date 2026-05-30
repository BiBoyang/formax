# Reactive Compact Drainage

Date: 2026-05-31

Reactive compact is a send-path fallback, not another middle-layer reducer. The fallback should only run after a real provider context-overflow error, should retry once, and should recompute request projection and cache edit planning from the reactive-prepared baseline.

The important ordering fix is pending request-collapse drainage. If the initial request projection already produced a durable context-collapse commit candidate before the provider overflowed, the runtime should try to record that commit before `runReactiveCompact()` runs. Otherwise the deterministic request-collapse work is lost when the runtime falls through to heavier full compact fallback.

That drainage attempt must not make overflow recovery less recoverable. If session persistence rejects while writing the pending collapse fact, the runtime should still attempt the reactive compact retry; the loss is a diagnostics/durable-state failure, not a reason to suppress the fallback request.

The `reactive_compact_applied` session event remains intentionally small. It means "fallback prepared and retry attempted", not "retry succeeded" and not "persisted history was rewritten". Readers keep latest-valid semantics: malformed or unknown reactive compact events do not clear the previous valid event.
