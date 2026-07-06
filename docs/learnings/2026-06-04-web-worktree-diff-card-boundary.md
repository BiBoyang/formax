# Web Worktree Diff Card Boundary

## Summary

- Worktree diff file-list ownership belongs to `packages/web-reference-react/src/components/WorktreeDiffPane.tsx`.
- `WorktreeDiffPane` owns React file cards, toggle state, sticky file headers, and unified/split view-mode state.
- `packages/web-reference-react/src/components/diff/DiffPatchView.tsx` is the single-file `@pierre/diffs` `PatchDiff` adapter.
- Collapsed files should not mount `DiffPatchView` and should not create `<diffs-container>` nodes.
- `WorkerPoolContextProvider` belongs at the visible Worktree diff pane/file-list boundary, not at the app root and not as a cold-start wrapper around each individual `PatchDiff`.

## Why

Mixing a React-owned outer file list with a library-owned multi-file `CodeView` list creates two competing owners for collapse, layout, sticky headers, and scroll reconciliation. The stable boundary is one React card per file, with the library renderer mounted only inside expanded card bodies.

The diff worker pool has a similar ownership boundary. App-root ownership starts workers for users who never open the diff viewer. Per-`PatchDiff` cold-start ownership can leave Chromium with an empty `<pre>` while worker setup catches up. Pane-level ownership keeps startup scoped to the visible diff UI while giving expanded files a stable worker context.

## Validation

- `bun run --cwd packages/web-reference-react test src/components/WorktreeDiffPane.test.tsx src/components/diff/DiffPatchView.test.tsx`
- `bun run --cwd packages/web-reference-react type-check`
- `bun run --cwd packages/web-reference-react build`
- `PLAYWRIGHT_SKIP_WEBSERVER=1 PLAYWRIGHT_BASE_URL=http://127.0.0.1:3881 bun run --cwd packages/web-reference-react test:e2e -- e2e/diff-collapsible.spec.js --project=chromium`
