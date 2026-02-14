# Repository Guidelines

## Project Structure & Module Organization
- `src/` contains TypeScript source.
  - `entrypoints/` CLI entrypoints (`cli.tsx`, `tool-examples.tsx`, `loading-examples.tsx`).
  - `cli/` argument parsing + command dispatch for the CLI wrapper.
  - `core/` productized app core (config resolution, setup flows, boundaries checks).
  - `ui/` Ink “wizard” UIs (first-run setup, selectors, forms).
  - `legacy/` current REPL bootstrap + wiring (loads config, tools, subagents, renders `REPL`).
  - `adapters/` filesystem + setup adapters (config files, setup persistence).
  - `screens/` Ink screens; `components/` reusable UI.
  - `tools/` tool registry, modules, handlers, presenters, runtime managers.
  - `streaming/` Anthropic streaming client and parsers.
  - `subagents/` registry/runner for sub-agent tools.
  - `prompts/`, `env/`, `services/`, `utils/` supporting code.
- Tests live next to source as `*.test.ts`/`*.test.tsx`.
- `docs/` holds architecture notes and guides; `plans/` captures refactor plans.
- `proxy/` contains proxy/logger scripts plus traffic/log artifacts used for parity/reference during development.
- `CODEMAP.md` is the “where to change what” index (entrypoints, main loop, tools, plan mode, sub-tasks).

## Build, Test, and Development Commands
- `bun install` installs dependencies.
- `bun run dev` runs the CLI via `tsx` (entry: `src/entrypoints/cli.tsx`).
- `bun run toole` runs the tool examples entrypoint.
- `bun run loade` runs loading examples.
- `bun run build` bundles the CLI to `dist/cli.js` (requires Bun).
- `bun run type-check` runs TypeScript checks + boundary checks (`core` + `ui`).
- `bun run ui:boundaries` runs UI boundary checks (guards `src/ui/`, `src/screens/`, `src/components/` from importing forbidden layers).
- `bun run test` runs `vitest run`; `bun run test:watch` runs Vitest watch.
- Single test: `bun run test -- src/tools/registry.test.ts`.

## Coding Style & Naming Conventions
- TypeScript ESM (`"type": "module"`, bundler module resolution).
- Match existing formatting: 2-space indentation, single quotes, no semicolons.
- `PascalCase` for components/classes (`REPL`, `StreamClient`), `camelCase` for functions/hooks (`useReplController`).
- Tool modules follow `src/tools/modules/<name>/{index,handler,presenter}.ts(x)` and `createXToolModule` factory naming.
- **GLOBAL CLARIFICATION RULE (MANDATORY)**: In ANY task, if user intent is ambiguous (UI, behavior, scope, risk, tradeoff, or acceptance criteria), you MUST ask the user BEFORE making directional choices. DO NOT infer beyond explicit requirements.
- **QUESTION TOOL RULE (MANDATORY)**: When clarification is needed, you MUST use the user-input question tool first (e.g. `request_user_input`) when available. If that tool is unavailable in the current mode, you MUST ask the user directly in chat instead of guessing.

## Testing Guidelines
- Framework: Vitest; Ink UI tests use `ink-testing-library`.
- Property-based tests use `fast-check` where appropriate.
- Keep tests colocated with source and use `*.test.ts`/`*.test.tsx`.
- **Coverage mindset**: Prioritize adding/strengthening tests when behavior is user-visible or stability-critical (tools, permissions, hooks, REPL input, UI flows). Avoid “happy-path only” tests—cover edge cases and regressions you’ve already seen.
- **Refactor safety**: Before refactoring, add/extend tests to lock current behavior. Do not rely on “tests pass” if manual behavior regresses.
- **Code review (mandatory in loops)**: After tests pass, run review using the **Review Profile (Single Source of Truth)** below before committing; fix all high/medium findings (and any low-risk issues that are clearly correct and low-churn).

### Review Profile (Single Source of Truth)
- Review command: `codex review --uncommitted -c model="gpt-5.3-codex" -c model_reasoning_effort="high"`
- Tool-call timeout for review: `timeout_ms >= 1200000`
- Apply this profile everywhere (skills/plans/docs). Do not redefine model/reasoning/timeout in other files.

## Refactor Guardrails (Important)
- **Refactor != rewrite**: refactors must preserve existing functionality and user-visible behavior; do not add/remove features as a side-effect.
- **Tests are not the spec**: before refactoring, first check whether missing/weak tests can be added to lock current behavior; use those tests to validate the refactor.
- **UI parity**: UI refactors must keep layout/spacing/keys/interaction the same unless the user explicitly requests a UI change; do not “improve” UI by default.
- **When uncertain**: if expectations are unclear (not limited to UI), ask the user before changing behavior.
- **UI refactor workflow (mandatory)**:
  - Before refactor: write/extend `ink-testing-library` tests that lock the current UI text + key paths (Enter/Esc/Tab/↑↓/←→/Backspace).
  - During refactor: do not change copy/spacing/colors unless explicitly requested; treat “simplifying UI” as a behavior change.
  - After refactor: run the targeted UI test file(s) + do a quick manual spot-check in `bun run dev` for the overlay(s) you touched.
- **No “test-only” refactors**: a passing test suite is not sufficient if manual UI behavior regresses; prioritize user-visible parity over internal cleanup.

## Tool Contract Checks
If you modify tool specs/contracts or tool module coverage, consider running:
- `bun run tools:parity`
- `bun run tools:coverage`

## Commit & Pull Request Guidelines
- Commits follow Conventional Commit style in history: `feat:`, `fix:`, `refactor:`, `docs:`, `chore:` with optional scope (`refactor(chat): ...`).
- Avoid placeholder messages like `tmp`; keep summaries imperative and specific.
- PRs should include a concise description, link relevant issues/plans, list tests run, and add terminal screenshots for Ink UI changes.
- **Commit workflow (when user says “commit”)**: assume the user already ran `git add`. Do:
  - `git status --short` and `git diff --cached` (or `git diff --cached --stat`)
  - Generate a Conventional Commit message: `type(scope): summary` (≤72 chars, imperative)
  - Run `git commit -m "<message>"`

## Documentation Hygiene
- Treat `CODEMAP.md` as a “where to change what” index; update it when key entrypoints or ownership move.
- **CODEMAP update triggers**: If you (a) add a new entrypoint/wiring point, (b) extract a cross-cutting helper used by multiple subsystems (e.g. audit/logging), or (c) move/rename user-facing UI/tool files, update `CODEMAP.md` in the same commit so future debugging follows the new “go-to” path.
- When you ship a behavior-alignment change, add/update a short learning note in the active planning docs under `plans/app-server/` so mapping decisions remain traceable.
- For complex subsystems that have a local deep-dive README, keep it in sync when you change boundaries, control-flow, invariants, or extension points:
  - `src/tools/README.md`
  - `src/core/README.md`
  - `src/streaming/README.md`
  - `src/subagents/README.md`
- Prefer linking to source files over duplicating code; keep diagrams high-level to reduce churn.

## Configuration & Runtime Notes
- Runtime config is loaded via `loadRuntimeConfig()` (`src/env/config.ts`) and supports:
  - env vars (loaded via `dotenv/config` in `src/entrypoints/cli.tsx`)
  - global config files under `FORMAX_CONFIG_DIR` (default `~/.formax/`)
  - per-project overrides under `<repo>/.formax/`
- Key env vars:
  - LLM: `FORMAX_API_KEY`, `FORMAX_BASE_URL`, `FORMAX_MODEL`, `FORMAX_TIMEOUT_MS`
  - Paths: `FORMAX_CONFIG_DIR`, `FORMAX_LOGS_DIR`, `FORMAX_SUBAGENTS_DIR`, `FORMAX_PLAN_DIR`
  - Setup: `FORMAX_FORCE_SETUP=1` (force the setup wizard)

## Security & Config Tips
- Do not commit secrets. Local config uses `.env` (e.g., `FORMAX_API_KEY`); keep `.env` and traffic logs out of git.
- When sharing context with other AIs/tools, double-check exports for accidental secrets (API keys, tokens, cookies) before pasting.

## Pitfalls & Gotchas (Keep Updated)
When you hit a non-obvious pitfall (tooling quirks, repo conventions, environment traps), record it:
1) in `pitfalls.md` (canonical long-term log), and
2) here **and** in `CLAUDE.md` if it affects day-to-day agent behavior.

- **Repomix + `.gitignore`**: Repomix respects `.gitignore` by default. If you export with repomix and files under `src/tools/specs/reference/` (e.g. `src/tools/specs/reference/tools-copy.json`) go missing, use `--no-gitignore` (and keep using `--include`/`--ignore` per `.cursor/commands/repomix.md`).
- **Repomix default ignore patterns**: Repomix may exclude lockfiles (e.g. `bun.lock`) unless you add `--no-default-patterns`. Only enable this when you explicitly need lockfiles in the export.
- **Compact + Ctrl+O duplicated rows**: If `HeaderBanner`/compact banner repeats after toggles, do not “fix” by moving header/messages out of `Static`; treat it as surface-transition ownership/race first.
- **Static test parity**: default Vitest can miss real TTY regressions; for compact/expanded changes, validate forced-Static + terminal-model smoke (`surfaceSmoke` and `test:surface-screen-model`).
- **Clear vs reset on Static paths**: for view-return paths touching `Static`, avoid clear-only behavior; use reset-style clear+remount transactions to prevent stale append artifacts.

## Local Paths
- Avoid hardcoding machine-specific absolute paths in repo docs.
