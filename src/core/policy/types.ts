import type { ProviderId } from '../config/schema.js'

export type PolicyAction =
  | { kind: 'fs.read'; path: string }
  | { kind: 'fs.write'; path: string }
  | { kind: 'bash.exec'; command: string }
  | { kind: 'net.fetch'; url: string }
  | { kind: 'net.search'; query: string }
  | { kind: 'tool.install'; tool: string }

export type PolicyDecision = 'allow' | 'prompt' | 'deny'

export type PolicyContext = {
  cwd: string
  workspaceRoots: string[]
  provider: ProviderId
}
