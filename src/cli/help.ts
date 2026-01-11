export function formatCliHelp(): string {
  return (
    `Formax\n\n` +
    `Usage:\n` +
    `  formax                     Start the REPL\n` +
    `  formax repl                Start the REPL\n` +
    `  formax config show [--json]\n` +
    `  formax config migrate [--json]\n` +
    `  formax auth list [--json]\n` +
    `  formax auth set <provider> <authRef> <apiKey> [--json]\n` +
    `  formax auth delete <provider> <authRef> [--json]\n\n` +
    `Flags:\n` +
    `  --json     Output machine-readable JSON\n` +
    `  -h, --help Show help\n\n` +
    `Exit codes:\n` +
    `  0 Success\n` +
    `  1 Error\n` +
    `  2 Usage error\n\n` +
    `Environment:\n` +
    `  FORMAX_CONFIG_DIR Override global config directory (default: ~/.formax)\n`
  )
}
