import type { McpServerConfig } from './types.js'

export type McpServerLifecycleState =
  | 'pending'
  | 'connecting'
  | 'ready'
  | 'failed'
  | 'closed'

export type McpServerStatusProjection = {
  serverId: string
  state: McpServerLifecycleState | 'disabled'
  enabled: boolean
  toolCount?: number
  errorMessage?: string
}

export function projectMcpServerStatus(input: {
  serverId: string
  config?: McpServerConfig
  lifecycleState?: McpServerLifecycleState
  toolCount?: number
  error?: unknown
}): McpServerStatusProjection {
  const enabled = input.config?.enabled ?? true
  const errorMessage = input.error instanceof Error
    ? input.error.message
    : typeof input.error === 'string'
      ? input.error
      : undefined

  return {
    serverId: input.serverId,
    state: enabled ? input.lifecycleState ?? 'pending' : 'disabled',
    enabled,
    ...(input.toolCount !== undefined ? { toolCount: input.toolCount } : {}),
    ...(errorMessage ? { errorMessage } : {}),
  }
}
