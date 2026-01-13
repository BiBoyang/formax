import { describe, expect, it } from 'vitest'
import { formatCliHelp } from './help.js'

describe('formatCliHelp', () => {
  it('matches snapshot', () => {
    expect(formatCliHelp()).toMatchInlineSnapshot(`
      "Formax

      Usage:
        formax                     Start the REPL
        formax repl                Start the REPL
        formax help
        formax config show [--json]
        formax config migrate [--json]
        formax auth list [--json]
        formax auth set <provider> <authRef> <apiKey> [--json]
        formax auth delete <provider> <authRef> [--json]

        formax status [--json]
        formax doctor [--json] [--bundle]
        formax setup
        formax policy list [--json]
        formax policy explain --action <kind> [--cmd/--path/--url/--query <value>] [--json]
        formax policy test --bash <cmd> [--json]
        formax policy disable <ruleId> [--json]
        formax policy delete <ruleId> [--json]

      Flags:
        --json     Output machine-readable JSON
        --bundle   Write a redacted debug bundle (doctor only)
        --no-color Disable ANSI colors
        -h, --help Show help

      Tips:
        - If you hit a bug, run: formax doctor --bundle
        - See docs/troubleshooting.md for common issues

      Exit codes:
        0 Success
        1 Error
        2 Usage error

      Environment:
        FORMAX_CONFIG_DIR Override global config directory (default: ~/.formax)
      "
    `)
  })
})
