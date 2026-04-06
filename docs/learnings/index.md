# Learnings Index

`docs/learnings/` 保存决策史、经验沉淀与实现对齐记录。

它的角色是：

- 记录“为什么这样做”
- 保留排查和对齐过程中的关键观察
- 为后续将成熟规则升格到 `contracts/`、`runbooks/`、`references/` 提供来源

它不是默认的唯一事实源。
当某条 learning 变成长期规则时，应把规则升格到 canonical doc，并在 learning 中保留回链。

## Governance / App-Server / Semantics

- `docs/learnings/2026-02-23-harness-governance.md`
- `docs/learnings/2026-02-25-app-server-session-grouping-and-hidden-cwds.md`
- `docs/learnings/2026-02-26-web-user-message-canonical.md`
- `docs/learnings/2026-03-04-app-server-bounded-queues-and-overload.md`
- `docs/learnings/2026-03-12-app-server-plan-path-parity.md`
- `docs/learnings/2026-03-12-interactive-preflight-unified-orchestration.md`
- `docs/learnings/2026-03-12-skill-preflight-protocolized-approval.md`

## Prompt / Capture / Tool Exposure

- `docs/learnings/2026-03-05-cc-current-capture-keypoints-toolsearch-and-prompts.md`
- `docs/learnings/2026-03-05-formax-capture-224737-vs-cc-deferred-tool-exposure.md`
- `docs/learnings/2026-03-06-deferred-prompt-variant-and-skills-reminder.md`
- `docs/learnings/2026-03-06-deferred-tool-exposure-shared-resolver.md`
- `docs/learnings/2026-03-06-request-dry-run-preview.md`
- `docs/learnings/2026-03-07-anthropic-prompt-caching-alignment.md`
- `docs/learnings/2026-03-08-auto-memory-reminder-injection-parity.md`
- `docs/learnings/2026-03-08-auto-memory-permission-whitelist.md`
- `docs/learnings/2026-03-12-auto-memory-whitelist-unconditional.md`
- `docs/learnings/2026-03-12-config-plans-whitelist.md`
- `docs/learnings/2026-04-03-context-microcompact-mvp.md`
- `docs/learnings/2026-04-03-context-diagnostics-command.md`
- `docs/learnings/2026-04-04-explicit-compact-boundary.md`
- `docs/learnings/2026-04-04-boundary-first-continuation-view.md`
- `docs/learnings/2026-04-04-boundary-aware-session-restore.md`
- `docs/learnings/2026-04-04-app-server-compact-boundary-event.md`
- `docs/learnings/2026-04-04-memory-first-auto-compact.md`
- `docs/learnings/2026-04-04-partial-compact-no-go.md`
- `docs/learnings/2026-04-04-preserved-segment-metadata.md`
- `docs/learnings/2026-04-04-rolling-session-memory-sidecar.md`
- `docs/learnings/2026-04-04-session-memory-draft-schema.md`
- `docs/learnings/2026-04-05-partial-compact-mvp.md`
- `docs/learnings/2026-04-05-context-diagnostics-payload-contract.md`
- `docs/learnings/2026-04-05-context-collapse-mvp.md`
- `docs/learnings/2026-04-05-reactive-compact-mvp.md`
- `docs/learnings/2026-04-06-per-system-section-diagnostics.md`
- `docs/learnings/2026-04-06-context-lifecycle-markers.md`
- `docs/learnings/2026-04-06-compact-prune-trigger-reasons.md`
- `docs/learnings/2026-04-06-contributor-identity-drilldown.md`
- `docs/learnings/2026-04-06-session-memory-restore-refresh.md`
- `docs/learnings/2026-04-06-app-server-session-memory-resume-refresh.md`
- `docs/learnings/2026-04-06-session-memory-restore-context-reuse.md`
- `docs/learnings/2026-04-06-request-history-projection-seed.md`
- `docs/learnings/2026-04-06-request-time-context-collapse-mvp.md`
- `docs/learnings/2026-04-06-context-collapse-impact-diagnostics.md`
- `docs/learnings/2026-04-06-collapse-recap-contributor-kind.md`
- `docs/learnings/2026-04-06-collapse-recap-metadata.md`
- `docs/learnings/2026-04-07-runtime-collapse-state-plumbing.md`
- `docs/learnings/2026-04-07-request-collapse-session-event.md`
- `docs/learnings/2026-04-07-app-server-thread-read-latest-collapse.md`
- `docs/learnings/2026-04-07-context-diagnostics-latest-request-collapse.md`
- `docs/learnings/2026-04-07-thread-messages-collapse-summary.md`
- `docs/learnings/2026-04-07-thread-collapse-inspection-helper.md`
- `docs/learnings/2026-04-07-working-set-keep-strategy-v2.md`
- `docs/learnings/2026-04-07-web-header-latest-request-collapse.md`

## Web Reference Runtime / Performance

- `docs/learnings/2026-03-04-web-bundle-report-baseline.md`
- `docs/learnings/2026-03-04-web-entry-chunk-split-and-markdown-e2e.md`
- `docs/learnings/2026-03-04-web-history-cache-write-dedup.md`
- `docs/learnings/2026-03-04-web-left-rail-group-stabilization.md`
- `docs/learnings/2026-03-04-web-markdown-render-dedup.md`
- `docs/learnings/2026-03-04-web-markdown-shiki-runtime-slimming.md`
- `docs/learnings/2026-03-04-web-parity-browser-safe-adapters.md`
- `docs/learnings/2026-03-04-web-reducer-noop-guards.md`
- `docs/learnings/2026-03-04-web-render-hotpath-optimization.md`
- `docs/learnings/2026-03-04-web-rpc-queue-guard-coverage.md`
- `docs/learnings/2026-03-04-web-runtime-ref-sync-scope-reduction.md`
- `docs/learnings/2026-03-04-web-runtime-refs-effect-consolidation.md`
- `docs/learnings/2026-03-04-web-thread-actions-stable-context.md`
- `docs/learnings/2026-03-04-web-transcript-perf-gate-ci.md`
- `docs/learnings/2026-03-05-web-appshell-props-partition-and-folder-toggle-stability-m.md`
- `docs/learnings/2026-03-05-web-left-rail-row-memoization.md`
- `docs/learnings/2026-03-05-web-runtime-composition-polish-r.md`
- `docs/learnings/2026-03-05-web-runtime-dev-loadall-and-scroll-sync-l.md`
- `docs/learnings/2026-03-05-web-runtime-domain-boundary-consolidation-p.md`
- `docs/learnings/2026-03-05-web-runtime-state-dedup-batch-k.md`
- `docs/learnings/2026-03-05-web-thread-selection-cwd-options-stability.md`
- `docs/learnings/2026-03-05-web-transcript-render-view-single-filter-path.md`
- `docs/learnings/2026-03-05-web-transcript-rpc-error-details-cache-safety.md`
- `docs/learnings/2026-03-05-web-useappruntime-composition-root-slimming-q.md`
- `docs/learnings/2026-03-05-web-useappruntime-domain-handler-stability-n.md`
- `docs/learnings/2026-04-07-session-memory-restore-reminder.md`
- `docs/learnings/2026-04-07-thread-latest-compact-boundary-surface.md`
