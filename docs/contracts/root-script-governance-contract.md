# Root Script Governance Contract

Status: Canonical.

Purpose: keep root `package.json` scripts orchestration-oriented and prevent feature-level command sprawl.

## 1. Root script positioning

Root scripts are a controlled interface for:

- repo-level orchestration (`dev`, `build`, `type-check`, `prepack`, `test`)
- release flows (`release:*`)
- governance gates (`check:*`)
- cross-workspace runtime entrypoints (for example `app-server:*`, `desktop:*`)

Root scripts are **not** the default home for feature/package workflows.

## 2. Admission rules

A root script is admissible only when all of the following are true:

1. It matches allowed naming policy (`allowedExactNames` or `allowedPrefixes`).
2. It does not introduce package-local shortcut uplift (`--cwd packages/*` / `--prefix packages/*`) unless explicitly permitted by policy.
3. It exists in the frozen baseline list (`frozenScriptNames`) or has an approved temporary exception entry.

## 3. Exception mechanism (temporary only)

Temporary exceptions must be registered in `scripts/baselines/root-script-governance.json` with:

- `name`
- `owner`
- `reason`
- `replacement`
- `expiresOn`

Rules:

- Exception entries without owner/replacement/expiry are invalid.
- Expired exceptions are invalid.
- Exception rows without an existing matching root script are invalid (stale registration).

## 4. Enforcement

Hard gate command:

```bash
bun run check:root-script-governance
```

Gate implementation:

- `scripts/check-root-script-governance.mjs`
- `scripts/root-script-governance-lib.mjs`
- baseline config: `scripts/baselines/root-script-governance.json`

CI must treat this gate as blocking for code changes.

## 5. Migration policy (staged, non-big-bang)

- Freeze: no new feature-level root aliases without approved exception.
- Migrate: move feature commands to owning package scripts in monthly batches.
- Deprecate: update docs and replace root invocations before removing legacy aliases.
- Operate: quarterly audit root script structure and exception debt.
