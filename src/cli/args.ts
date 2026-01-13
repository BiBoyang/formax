export type CliFlags = {
  json: boolean
  help: boolean
  noColor: boolean
  bundle: boolean
}

export type CliArgs = {
  positionals: string[]
  flags: CliFlags
}

export function parseCliArgs(argv: string[]): CliArgs {
  const flags: CliFlags = { json: false, help: false, noColor: false, bundle: false }
  const positionals: string[] = []

  for (const arg of argv) {
    if (arg === '--json') {
      flags.json = true
      continue
    }
    if (arg === '--bundle') {
      flags.bundle = true
      continue
    }
    if (arg === '--no-color') {
      flags.noColor = true
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
