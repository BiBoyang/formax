export type CliFlags = {
  json: boolean
  help: boolean
  version: boolean
  noColor: boolean
  bundle: boolean
  bundleTar: boolean
  resumeLast: boolean
}

export type CliArgs = {
  positionals: string[]
  flags: CliFlags
}

export function parseCliArgs(argv: string[]): CliArgs {
  const flags: CliFlags = {
    json: false,
    help: false,
    version: false,
    noColor: false,
    bundle: false,
    bundleTar: false,
    resumeLast: false,
  }
  const positionals: string[] = []

  for (const arg of argv) {
    if (arg === '--json') {
      flags.json = true
      continue
    }
    if (arg === '--version' || arg === '-v') {
      flags.version = true
      continue
    }
    if (arg === '--bundle') {
      flags.bundle = true
      continue
    }
    if (arg === '--bundle-tar') {
      flags.bundle = true
      flags.bundleTar = true
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
    if (arg === '--continue' || arg === '-c') {
      flags.resumeLast = true
      continue
    }
    positionals.push(arg)
  }

  return { positionals, flags }
}
