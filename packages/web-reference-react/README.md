# Web Reference Client (React + Vite)

This package is the isolated React reference client used to verify Formax app-server protocol and UI parity behavior.

Start here:
- Contributor workflow, commands, evidence rules, and package guardrails: [AGENTS.md](./AGENTS.md)
- Code navigation and “where to change what”: [CODEMAP.md](./CODEMAP.md)
- Canonical behavior docs:
  - [semantics contract](../../docs/contracts/semantics-contract.md)
  - [app-server interaction contract](../../docs/contracts/app-server-interaction-contract.md)
  - [web parity adapter contract](../../docs/contracts/web-parity-adapter-contract.md)
  - [app-server UI spec](../../docs/frontend/app-server-ui-spec.md)

Quick start:
1. From the repo root, run `bun run app-server:bridge -- --host 127.0.0.1 --port 3777`.
2. In this package, run `npm install` and `npm run dev`.

This client is for protocol verification rather than production deployment. For tests, performance checks, acceptance evidence, and package-specific UI/runtime notes, use [AGENTS.md](./AGENTS.md).
