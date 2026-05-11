# 2026-05-11 - Web right rail collapse summary

- `CCA-123` first lands on the existing right-side worktree diff rail instead of creating a new thread detail surface.
- The right rail already acts as an inspection area, so consuming `latestRequestCollapse` there avoids any thread message protocol changes.
- Collapse client consumption should reuse thread-scoped cached state (`activeThreadLatestRequestCollapse`) instead of re-parsing raw RPC payloads in UI leaves.
- History-source gating stays in `useTranscriptDisplayState()`: only show the summary when `transcriptSource === 'history'`, so replay surfaces do not inherit stale history-derived collapse summaries.
