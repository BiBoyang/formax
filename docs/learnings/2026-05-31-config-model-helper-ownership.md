# Config Model Helper Ownership

## Context

Layer checks surfaced model/config/setup ownership drift: Config and setup Repo code were importing Service-owned model helpers for context-window extraction, capability metadata, and runtime profile fingerprints.

## Learning

Pure model identity, context-window extraction/inference, conservative known-model hints, runtime profile types, and fingerprint helpers belong in Config-owned modules. Provider fetches and catalog lookups can remain Repo-owned, while Service/Runtime layers consume the resolved runtime profile or compatibility shims.

For low-risk convergence, keep old Service paths as thin re-export shims while moving the implementation and lower-layer imports to Config.

## Verification

- `bun run test -- packages/core/src/config/modelContextWindow.test.ts packages/core/src/config/runtimeModelProfile.test.ts packages/core/src/adapters/setup/connectionTest.test.ts packages/core/src/adapters/setup/writeSetupFiles.test.ts packages/core/src/core/models/models.test.ts packages/core/src/chat/context/modelWindow.test.ts`
- `bun run type-check`
- `bun run check:layer-contracts` still reports the deferred `sessionSave` ownership cluster, but no model/config/setup helper violations remain.
