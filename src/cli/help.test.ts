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
        formax doctor [--json]
        formax setup
        formax policy [--json]

      Flags:
        --json     Output machine-readable JSON
        --no-color Disable ANSI colors
        -h, --help Show help

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
