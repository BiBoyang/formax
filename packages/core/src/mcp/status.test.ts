import { describe, expect, it } from 'vitest'
import { projectMcpServerStatus } from './status.js'

describe('MCP server status projection', () => {
  it('projects read-only status without requiring a live manager', () => {
    expect(projectMcpServerStatus({
      serverId: 'github',
      lifecycleState: 'ready',
      toolCount: 3,
    })).toEqual({
      serverId: 'github',
      state: 'ready',
      enabled: true,
      toolCount: 3,
    })
  })

  it('reports disabled config before lifecycle state', () => {
    expect(projectMcpServerStatus({
      serverId: 'local',
      config: { type: 'stdio', command: 'server', enabled: false },
      lifecycleState: 'ready',
    })).toEqual({
      serverId: 'local',
      state: 'disabled',
      enabled: false,
    })
  })
})
