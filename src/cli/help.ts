export function formatCliHelp(): string {
  return (
    `Formax\n\n` +
    `Usage:\n` +
    `  formax                     Start the REPL\n` +
    `  formax repl                Start the REPL\n` +
    `  formax web                 Start local Web UI (bridge + static host)\n` +
    `  formax app-server          Start JSON-RPC app server over stdio\n` +
    `  formax --version\n` +
    `  formax version [--json]\n` +
    `  formax help\n` +
    `  formax config show [--json]\n` +
    `  formax config migrate [--json]\n` +
    `  formax auth list [--json]\n` +
    `  formax auth set <provider> <authRef> <apiKey> [--json]\n` +
    `  formax auth delete <provider> <authRef> [--json]\n\n` +
    `  formax status [--json]\n` +
    `  formax doctor [--json] [--bundle] [--bundle-tar]\n` +
    `  formax setup\n` +
    `  formax policy list [--json]\n` +
    `  formax policy explain --action <kind> [--cmd/--path/--url/--query <value>] [--json]\n` +
    `  formax policy test --bash <cmd> [--json]\n` +
    `  formax policy disable <ruleId> [--json]\n` +
    `  formax policy delete <ruleId> [--json]\n\n` +
    `Flags:\n` +
    `  --json     Output machine-readable JSON\n` +
    `  --resume-last Resume the latest session for this cwd\n` +
    `  --bundle   Write a redacted debug bundle (doctor only)\n` +
    `  --bundle-tar Also write <bundleDir>.tgz (doctor only)\n` +
    `  --no-color Disable ANSI colors\n` +
    `  -v, --version Print version\n` +
    `  -h, --help Show help\n\n` +
    `Tips:\n` +
    `  - If you hit a bug, run: formax doctor --bundle\n` +
    `  - See docs/troubleshooting.md for common issues\n\n` +
    `Exit codes:\n` +
    `  0 Success\n` +
    `  1 Error\n` +
    `  2 Usage error\n\n` +
    `Environment:\n` +
    `  FORMAX_CONFIG_DIR Override global config directory (default: ~/.formax)\n`
  )
}
