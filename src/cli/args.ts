export type CliFlags = {
  json: boolean
  help: boolean
}

export type CliArgs = {
  positionals: string[]
  flags: CliFlags
}

export function parseCliArgs(argv: string[]): CliArgs {
  const flags: CliFlags = { json: false, help: false }
  const positionals: string[] = []

  for (const arg of argv) {
    if (arg === '--json') {
      flags.json = true
      continue
    }
    if (arg === '--help' || arg === '-h') {
      flags.help = true
      continue
    }
    positionals.push(arg)
  }

  return { positionals, flags }
}

