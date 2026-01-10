# Repository Guidelines

## Project Structure & Module Organization
- `src/` contains TypeScript source.
  - `entrypoints/` CLI entrypoints (`cli.tsx`, `tool-examples.tsx`).
  - `screens/` Ink screens; `components/` reusable UI.
  - `tools/` tool registry, modules, handlers, presenters, runtime managers.
  - `streaming/` Anthropic streaming client and parsers.
  - `subagents/` registry/runner for sub-agent tools.
  - `prompts/`, `env/`, `services/`, `utils/` supporting code.
- Tests live next to source as `*.test.ts`/`*.test.tsx`.
- `docs/` holds architecture notes and guides; `plans/` captures refactor plans.
- `proxy/` contains the proxy logger (`proxy/index.js`), tool specs, and traffic/log artifacts used by runtime defaults.

## Build, Test, and Development Commands
- `bun install` or `npm install` installs dependencies.
- `bun run dev` / `npm run dev` runs the CLI via `tsx`.
- `bun run toole` / `npm run toole` runs the tool examples entrypoint.
- `bun run build` bundles the CLI to `dist/cli.js` (requires Bun).
- `npm run type-check` runs TypeScript type checks (no emit).
- `npm test` runs `vitest run`; `npm run test:watch` runs Vitest in watch mode.
- Single test: `npm test -- src/tools/registry.test.ts` or `npm run test:watch -- -t "registry"`.

## Coding Style & Naming Conventions
- TypeScript ESM (`"type": "module"`, bundler module resolution).
- Match existing formatting: 2-space indentation, single quotes, no semicolons.
- `PascalCase` for components/classes (`REPL`, `StreamClient`), `camelCase` for functions/hooks (`useReplController`).
- Tool modules follow `src/tools/modules/<name>/{index,handler,presenter}.ts(x)` and `createXToolModule` factory naming.

## Testing Guidelines
- Framework: Vitest; Ink UI tests use `ink-testing-library`.
- Property-based tests use `fast-check` where appropriate.
- Keep tests colocated with source and use `*.test.ts`/`*.test.tsx`.

## Commit & Pull Request Guidelines
- Commits follow Conventional Commit style in history: `feat:`, `fix:`, `refactor:`, `docs:`, `chore:` with optional scope (`refactor(chat): ...`).
- Avoid placeholder messages like `tmp`; keep summaries imperative and specific.
- PRs should include a concise description, link relevant issues/plans, list tests run, and add terminal screenshots for Ink UI changes.

## Configuration & Runtime Notes
- Runtime config comes from env vars loaded via `dotenv/config` in `src/entrypoints/cli.tsx`.
- Key vars: `ANTHROPIC_API_KEY2`, `ANTHROPIC_BASE_URL2`, `ANTHROPIC_MODEL`, `ANTHROPIC_TIMEOUT_MS`, and `FORMAX_*` path overrides (defaults to `proxy/logs`, `.agent/subagents`).

## Pitfalls & Gotchas (Keep Updated)
When you hit a non-obvious pitfall (tooling quirks, repo conventions, environment traps), record it here **and** in `CLAUDE.md` so future agents can avoid re-discovering it.

- **Repomix + `.gitignore`**: Repomix respects `.gitignore` by default. If you export with repomix and files under `proxy/` (e.g. `proxy/tools.json`) go missing, use `--no-gitignore` (and keep using `--include`/`--ignore` per `.cursor/commands/repomix.md`).
- **Repomix default ignore patterns**: Repomix may exclude lockfiles (e.g. `bun.lock`) unless you add `--no-default-patterns`. Only enable this when you explicitly need lockfiles in the export.
