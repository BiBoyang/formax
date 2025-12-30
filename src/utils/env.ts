import { join } from 'path'
import { homedir } from 'os'

// Config directory: ~/.formax
export const FORMAX_CONFIG_DIR =
  process.env.FORMAX_CONFIG_DIR ?? join(homedir(), '.formax')

// Config file path: ~/.formax/config.json
export const FORMAX_CONFIG_FILE = join(FORMAX_CONFIG_DIR, 'config.json')