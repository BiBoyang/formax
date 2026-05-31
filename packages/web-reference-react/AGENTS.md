# Repository Guidelines

## Scope
This guide applies to `packages/web-reference-react/**`, the isolated React + Vite reference client used for app-server protocol and UI parity verification. Follow repo-wide rules in `../../AGENTS.md`; use this file for package-local workflow, commands, and guardrails.

## Project Structure & Module Organization
`src/app/` contains runtime orchestration, RPC flow, and the app shell. `src/components/` holds transcript, terminal, left-rail, diff, and shared UI pieces. Keep protocol-facing logic in `src/app/core/` or `src/parity/`, and keep layout wiring in `src/app/ui/`. Styling lives in `src/css/` and `src/styles.css`. Unit tests live beside source as `*.test.ts(x)`, broader integration coverage sits in `src/__tests__/`, browser E2E specs live in `e2e/`, and helper scripts plus bundle baselines live in `scripts/` and `perf/`. Use `CODEMAP.md` as the package navigation index before broad searching.

## Build, Test, and Development Commands
Start the bridge from the repo root with `bun run app-server:bridge -- --host 127.0.0.1 --port 3777`, then use this package with `npm install` and `npm run dev`. `npm run build` runs `tsc -b` and creates the production bundle, and `npm run type-check` validates TypeScript without emitting files. Use `npm run test` for Vitest, `npm run test:e2e:install` once per machine for Playwright browsers, and `npm run test:e2e` for browser flows against the in-page mock RPC server. For queue and performance checks, use `npm run test:e2e:queue:guard`, `npm run test:perf:gate`, and `npm run perf:bundle:report` after a build. Capture acceptance evidence with `npm run evidence:after -- --task=TASK-123`; add `npm run evidence:before -- --task=TASK-123` only when the repro is stable and meaningful.

## Coding Style & Naming Conventions
Use TypeScript ESM and the existing React 19 patterns. Match the surrounding 2-space indentation, use `PascalCase` for components, `camelCase` for hooks and helpers, and keep tests colocated with the code they cover. There is no package-local lint script, so `type-check`, Vitest, and Playwright are the main quality gates. For list items, sidebar rows, and top-header buttons, use the translucent tokens `hover:bg-[var(--sidebar-row-hover)]` and `bg-[var(--sidebar-row-active)]`; do not replace them with solid hover or active fills.

## CSS Token Architecture
Keep the CSS layers clear. `src/css/theme.css` is the shadcn/tweakcn primitive theme layer (`--background`, `--foreground`, `--accent`, shadcn sidebar primitives). `src/css/design-tokens.css` is the app semantic token layer (`--sidebar-*`, `--control-*`, `--menu-*`). Component CSS such as `src/css/sidebar.css` turns semantic tokens into reusable classes. TSX should prefer structure classes plus semantic classes, not scattered visual decisions like `h-8 px-3 gap-2 rounded-md hover:bg-*`.

For sidebar work, treat `--sidebar-*` as the source of truth. Main sidebar rows use `--sidebar-row-height`, `--sidebar-row-padding-x`, `--sidebar-row-gap`, `--sidebar-row-hover`, and `--sidebar-row-active`. Sidebar dropdown menu rows use the separate `--sidebar-menu-item-height` plus `--menu-item-hover`/`--menu-item-active`, so menu density can differ from the main rail. Sidebar icons should flow through `--sidebar-icon-size`; folder and action icons should alias that token unless the user explicitly asks for a different hierarchy.

Do not reintroduce the old `--sidebar-list-*` variables. Use `--sidebar-row-*` for left-rail row states. If a surface is not semantically sidebar, do not borrow sidebar tokens directly: Settings/Setup form controls should use `--control-*`, dropdown menus should use `--menu-*`, and app chrome/header controls should get a chrome-level token before diverging from sidebar behavior. If a new component only happens to look like the sidebar, alias through a semantic token first instead of coupling it to `--sidebar-*`.

When tuning CSS, change one axis per pass: geometry/density, color/state, or motion. Preserve existing behavior unless the user explicitly requests a UI change, and run the nearest focused test (`LeftRail.test.tsx` for sidebar, `App.test.tsx` for app-shell level changes) plus `type-check` when TSX or shared CSS changes.

## Testing Guidelines
Prefer focused Vitest coverage for runtime state, adapter behavior, and user-visible regressions. Name tests `*.test.ts` or `*.test.tsx`. For UI or protocol changes, run the nearest unit tests plus the relevant Playwright spec. `evidence:after` is the default acceptance artifact; add `before` only when a bug repro is stable. If entrypoints, ownership, or key data flow move, update `CODEMAP.md` in the same change.

## Runtime & Documentation Notes
This package runs in browser-only mode by default. Sidebar styling should use the app-specific token layer in `src/css/design-tokens.css` plus semantic classes in `src/css/sidebar.css`, while shadcn/tweakcn theme primitives stay in `src/css/theme.css`. When changing stable protocol behavior, web parity adapters, reducer/cursor semantics, or app-server UI expectations, update the canonical docs first: `docs/contracts/semantics-contract.md`, `docs/contracts/app-server-interaction-contract.md`, `docs/contracts/web-parity-adapter-contract.md`, and `docs/frontend/app-server-ui-spec.md`.

## Commit & Pull Request Guidelines
Follow Conventional Commits, matching recent history such as `fix(web): ...` and `refactor(web-reference-react): ...`. Keep commit messages imperative and scoped. Pull requests should include a short summary, linked issue or plan, tests run, and screenshots for UI changes.
