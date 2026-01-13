# Troubleshooting

This document helps you diagnose common issues and produce a debug bundle that you can share for support.

## Quick triage (recommended)

Run:

```bash
formax doctor --bundle --bundle-tar
```

It prints a summary and writes a **redacted** debug bundle under your logs directory, e.g.:

```
.../proxy/logs/bundles/doctor-bundle-<timestamp>/
```

You will get:
- the bundle directory
- a `.tgz` archive you can share directly

The bundle includes:
- `doctor.json` / `status.json` / `config-show.json`
- redacted config/rules/auth files (if present)
- `logs/audit.ndjson` (if present; redacted)

Secrets are masked (e.g. `sk-...`, `Authorization: Bearer ...`, `x-api-key: ...`, `apiKey`, `token`, etc.).

## Common problems

### 1) `zsh: command not found: formax`

Formax is a local repo tool. You have a few options:

**Run directly from the repo**
```bash
node bin/formax.js --help
node bin/formax.js doctor --bundle
```

**Or link it globally (local-only)**
```bash
npm link
formax --help
```

### 2) Setup / missing API key

If `doctor` reports no API key, run:

```bash
formax setup
```

Or write credentials to your auth store:

```bash
formax auth set anthropic default <apiKey>
```

### 3) Network / base URL issues

If `doctor` reports connectivity failures:
- verify base URL and credentials
- check proxy / VPN settings
- re-run `formax setup`

### 4) “Policy denied …” / “Approval required …”

Policy may block file/network actions by default. Use:

```bash
formax policy explain --action <kind> --path/--cmd/--url/--query <value>
formax policy list
```

If you accidentally created a bad rule:

```bash
formax policy disable <ruleId>
formax policy delete <ruleId>
```

## Sub-agent behavior

Sub-agents cannot request interactive approvals. If a sub-agent hits an approval boundary, it will receive a structured error instead of hanging.

## How to submit a bug report (with bundle)

1) Generate a bundle:
```bash
formax doctor --bundle --bundle-tar
```

2) Share:
- the `.tgz` (or the directory)
- what you ran (command line)
- expected vs actual behavior
- OS + Node version (`node -v`)
