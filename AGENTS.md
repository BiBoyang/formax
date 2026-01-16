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
- `bun install` or `npm install` installs dependencies.
- `bun run dev` / `npm run dev` runs the CLI via `tsx` (entry: `src/entrypoints/cli.tsx`).
- `bun run toole` / `npm run toole` runs the tool examples entrypoint.
- `bun run loade` / `npm run loade` runs loading examples.
- `bun run build` bundles the CLI to `dist/cli.js` (requires Bun).
- `bun run type-check` / `npm run type-check` runs TypeScript checks + core boundary checks.
- `bun run test` / `npm test` runs `vitest run`; `bun run test:watch` / `npm run test:watch` runs Vitest watch.
- Single test: `bun run test -- src/tools/registry.test.ts` (or `npm test -- src/tools/registry.test.ts`).

## Coding Style & Naming Conventions
- TypeScript ESM (`"type": "module"`, bundler module resolution).
- Match existing formatting: 2-space indentation, single quotes, no semicolons.
- `PascalCase` for components/classes (`REPL`, `StreamClient`), `camelCase` for functions/hooks (`useReplController`).
- Tool modules follow `src/tools/modules/<name>/{index,handler,presenter}.ts(x)` and `createXToolModule` factory naming.

## Testing Guidelines
- Framework: Vitest; Ink UI tests use `ink-testing-library`.
- Property-based tests use `fast-check` where appropriate.
- Keep tests colocated with source and use `*.test.ts`/`*.test.tsx`.

## Tool Contract Checks
If you modify tool specs/contracts or tool module coverage, consider running:
- `bun run tools:parity` (or `npm run tools:parity`)
- `bun run tools:coverage` (or `npm run tools:coverage`)

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
- Treat `docs/LEARNINGS/` as the long-term “how Claude Code works (as observed) + how Formax maps to it” knowledge base; when you ship a behavior-alignment change, add/update a short learning note there.
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
  - Anthropic: `ANTHROPIC_API_KEY2`, `ANTHROPIC_BASE_URL2`, `ANTHROPIC_MODEL`, `ANTHROPIC_TIMEOUT_MS`
  - Paths: `FORMAX_CONFIG_DIR`, `FORMAX_LOGS_DIR`, `FORMAX_SUBAGENTS_DIR`, `FORMAX_PLAN_DIR`
  - Setup: `FORMAX_FORCE_SETUP=1` (force the setup wizard)

## Security & Config Tips
- Do not commit secrets. Local config uses `.env` (e.g., `ANTHROPIC_API_KEY2`); keep `.env` and traffic logs out of git.
- When sharing context with other AIs/tools, double-check exports for accidental secrets (API keys, tokens, cookies) before pasting.

## Pitfalls & Gotchas (Keep Updated)
When you hit a non-obvious pitfall (tooling quirks, repo conventions, environment traps), record it:
1) in `pitfalls.md` (canonical long-term log), and
2) here **and** in `CLAUDE.md` if it affects day-to-day agent behavior.

- **Repomix + `.gitignore`**: Repomix respects `.gitignore` by default. If you export with repomix and files under `proxy/` (e.g. `proxy/tools.json`) go missing, use `--no-gitignore` (and keep using `--include`/`--ignore` per `.cursor/commands/repomix.md`).
- **Repomix default ignore patterns**: Repomix may exclude lockfiles (e.g. `bun.lock`) unless you add `--no-default-patterns`. Only enable this when you explicitly need lockfiles in the export.

## Codex local project path
- /Users/david/Documents/github/codex

## OpenCode local project path
- /Users/david/Documents/github/opencode
