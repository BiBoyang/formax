# Web Reference Client (React + Vite)

This is an isolated React client for Formax app-server development validation.
It uses its own `package.json` and does not share dependencies with the repo root.

## Run

1. Start app-server bridge (from repo root):

```bash
bun run app-server:bridge -- --host 127.0.0.1 --port 3777
```

2. In this folder:

```bash
npm install
npm run dev
```

3. Open the URL printed by Vite (default `http://127.0.0.1:3781`).

## Test

```bash
npm run test
```

Watch mode:

```bash
npm run test:watch
```

Current test coverage focus:

- state reducer transitions (`inputRequested -> inputResolved`, assistant delta merge)
- key component interactions (thread actions, send/interrupt states, input submit payload)
- guard against UI refactors breaking protocol-facing behavior

## Scope

- JSON-RPC initialize/initialized handshake
- thread/list + thread/start
- turn/start + turn/interrupt
- streaming transcript notifications
- pending input (`approval` / `ask_user_question`) and `turn/input/submit`

This client is for protocol verification, not production UI.
