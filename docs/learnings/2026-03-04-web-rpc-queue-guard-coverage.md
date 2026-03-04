# 2026-03-04: Web RPC queue overload/drop guard coverage

## What changed

- Added an e2e regression guard for queue stability:
  - `apps/web-reference-react/e2e/rpc-queue-dev-tools.spec.js`
  - new scenario constrains queue capacity and triggers request burst + same-tick inbound notification flood.
- Extended mock bridge helper:
  - `apps/web-reference-react/e2e/helpers/mockRpc.js`
  - supports runtime queue injection via `rpcQueueConfig`.
  - supports synchronous notification emission via `emitMode: "sync"` for deterministic inbound saturation tests.
- Added a unit regression test:
  - `apps/web-reference-react/src/rpcClient.test.ts`
  - verifies exact dropped inbound count under same-tick burst.
- Added dedicated Playwright guard script:
  - `npm --prefix apps/web-reference-react run test:e2e:queue:guard`
- Wired queue guard into CI:
  - `.github/workflows/ci.yml` now installs Playwright Chromium and runs queue guard when `web_reference` paths change.

## Why

- Queue regressions are easy to miss in happy-path tests.
- Existing tests covered helper presence and simple burst success, but not deterministic overload/drop behavior under tight queue capacities.
- CI now enforces this path to catch accidental changes in queue semantics early.

## Notes

- The guard intentionally uses small capacities (`outbound=2`, `inbound=1`) and burst concurrency to force pressure.
- Assertions target both metrics (`overloadedRequests`, `droppedInboundNotifications`) and visible warning logs in UI transcript.
