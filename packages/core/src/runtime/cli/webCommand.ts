import { parseTcpPort } from '../network/runtime.js'

export const DEFAULT_WEB_HOST = '127.0.0.1'
export const DEFAULT_WEB_UI_PORT = 3781
export const DEFAULT_WEB_BRIDGE_PORT = 3777
export const DEFAULT_WEB_SETUP_MODE = 'require-config'

export type WebSetupMode = 'require-config' | 'allow'

export type WebCommandOptions = {
  host: string
  uiPort: number
  bridgePort: number
  setupMode: WebSetupMode
}

type ParseWebCommandResult =
  | { ok: true; options: WebCommandOptions }
  | { ok: false; message: string }

export function parseWebCommandArgs(args: string[]): ParseWebCommandResult {
  const options: WebCommandOptions = {
    host: DEFAULT_WEB_HOST,
    uiPort: DEFAULT_WEB_UI_PORT,
    bridgePort: DEFAULT_WEB_BRIDGE_PORT,
    setupMode: DEFAULT_WEB_SETUP_MODE,
  }

  try {
    for (let i = 0; i < args.length; i += 1) {
      const token = args[i]
      if (token === '--host') {
        const value = args[i + 1]
        if (!value) throw new Error('Missing value for --host')
        options.host = value
        i += 1
        continue
      }
      if (token === '--ui-port') {
        const value = args[i + 1]
        if (!value) throw new Error('Missing value for --ui-port')
        options.uiPort = parseTcpPort(value, '--ui-port')
        i += 1
        continue
      }
      if (token === '--bridge-port') {
        const value = args[i + 1]
        if (!value) throw new Error('Missing value for --bridge-port')
        options.bridgePort = parseTcpPort(value, '--bridge-port')
        i += 1
        continue
      }
      if (token === '--setup-mode') {
        const value = args[i + 1]
        if (!value) throw new Error('Missing value for --setup-mode')
        if (value !== 'require-config' && value !== 'allow') {
          throw new Error('Invalid --setup-mode. Expected "require-config" or "allow".')
        }
        options.setupMode = value
        i += 1
        continue
      }
      if (token === '--allow-setup') {
        options.setupMode = 'allow'
        continue
      }
      if (token === '--help' || token === '-h') {
        return { ok: false, message: '__HELP__' }
      }
      throw new Error(`Unknown argument: ${token}`)
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { ok: false, message }
  }

  return { ok: true, options }
}

export function formatWebCommandHelp(): string {
  return (
    `Formax Web UI\n\n` +
    `Usage:\n` +
    `  formax web [--host 127.0.0.1] [--ui-port 3781] [--bridge-port 3777] [--setup-mode require-config|allow]\n\n` +
    `Description:\n` +
    `  Start local Web UI + app-server bridge for browser usage.\n` +
    `  This command hosts a built UI bundle and connects it to formax app-server.\n` +
    `  Use --setup-mode allow (or --allow-setup) when Electron should open Web setup before the main page.\n`
  )
}
