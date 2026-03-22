# Repository Guidelines

## Scope
This guide applies to `packages/web-reference-react/**`, the isolated React + Vite reference client used for app-server protocol and UI parity verification. Follow repo-wide rules in `../../AGENTS.md`; use this file for package-local workflow, commands, and guardrails.

## Project Structure & Module Organization
`src/app/` contains runtime orchestration, RPC flow, and the app shell. `src/components/` holds transcript, terminal, left-rail, diff, and shared UI pieces. Keep protocol-facing logic in `src/app/core/` or `src/parity/`, and keep layout wiring in `src/app/ui/`. Styling lives in `src/css/` and `src/styles.css`. Unit tests live beside source as `*.test.ts(x)`, broader integration coverage sits in `src/__tests__/`, browser E2E specs live in `e2e/`, and helper scripts plus bundle baselines live in `scripts/` and `perf/`. Use `CODEMAP.md` as the package navigation index before broad searching.

## Build, Test, and Development Commands
Start the bridge from the repo root with `bun run app-server:bridge -- --host 127.0.0.1 --port 3777`, then use this package with `npm install` and `npm run dev`. `npm run build` runs `tsc -b` and creates the production bundle, and `npm run type-check` validates TypeScript without emitting files. Use `npm run test` for Vitest, `npm run test:e2e:install` once per machine for Playwright browsers, and `npm run test:e2e` for browser flows against the in-page mock RPC server. For queue and performance checks, use `npm run test:e2e:queue:guard`, `npm run test:perf:gate`, and `npm run perf:bundle:report` after a build. Capture acceptance evidence with `npm run evidence:after -- --task=TASK-123`; add `npm run evidence:before -- --task=TASK-123` only when the repro is stable and meaningful.

## Coding Style & Naming Conventions
Use TypeScript ESM and the existing React 19 patterns. Match the surrounding 2-space indentation, use `PascalCase` for components, `camelCase` for hooks and helpers, and keep tests colocated with the code they cover. There is no package-local lint script, so `type-check`, Vitest, and Playwright are the main quality gates. For list items, sidebar rows, and top-header buttons, use the translucent tokens `hover:bg-[var(--sidebar-list-hover)]` and `bg-[var(--sidebar-list-active)]`; do not replace them with solid hover or active fills.

## Testing Guidelines
Prefer focused Vitest coverage for runtime state, adapter behavior, and user-visible regressions. Name tests `*.test.ts` or `*.test.tsx`. For UI or protocol changes, run the nearest unit tests plus the relevant Playwright spec. `evidence:after` is the default acceptance artifact; add `before` only when a bug repro is stable. If entrypoints, ownership, or key data flow move, update `CODEMAP.md` in the same change.

## Runtime & Documentation Notes
This package runs in browser-only mode by default. The `Threads` header still shows `Add project`, but without `window.formaxDesktop.pickProjectFolder` it should stay tooltip-only (`仅桌面客户端可用`) rather than attempting native folder selection. When changing stable protocol behavior, web parity adapters, reducer/cursor semantics, or app-server UI expectations, update the canonical docs first: `docs/contracts/semantics-contract.md`, `docs/contracts/app-server-interaction-contract.md`, `docs/contracts/web-parity-adapter-contract.md`, and `docs/frontend/app-server-ui-spec.md`.

## Commit & Pull Request Guidelines
Follow Conventional Commits, matching recent history such as `fix(web): ...` and `refactor(web-reference-react): ...`. Keep commit messages imperative and scoped. Pull requests should include a short summary, linked issue or plan, tests run, and screenshots for UI changes.
