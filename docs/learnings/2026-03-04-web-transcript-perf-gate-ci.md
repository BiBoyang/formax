# 2026-03-04: Transcript performance gate CI integration

## What changed

- Updated `apps/web-reference-react/e2e/transcript-performance-gate.spec.js`:
  - input latency and tool-toggle latency now use repeated sampling (`3` runs) with median-based budget assertion.
  - keeps the existing long-transcript load-earlier duration gate.
- Updated CI workflow:
  - `.github/workflows/ci.yml` now runs `bun run --cwd apps/web-reference-react test:perf:gate` on `web_reference` changes.
- Updated README testing commands and e2e spec list.

## Why

- Single-sample browser perf checks are noisier and easier to flake.
- Median sampling keeps the gate strict enough for regressions while reducing incidental jitter noise.
- Running the gate in CI ensures long-transcript rendering performance is continuously monitored.

## Notes

- Queue stability guard (`test:e2e:queue:guard`) and transcript perf gate are complementary:
  - queue guard focuses transport/backpressure regressions.
  - perf gate focuses UI interaction latency under large transcript loads.
