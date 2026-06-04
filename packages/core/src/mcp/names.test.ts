import { describe, expect, it } from 'vitest'
import {
  buildMcpModelToolName,
  isMcpModelToolName,
  normalizeMcpServerId,
  normalizeMcpToolName,
  parseMcpModelToolName,
} from './names.js'

describe('MCP tool names', () => {
  it('builds fully-qualified MCP model tool names without hash suffixes', () => {
    expect(buildMcpModelToolName('github', 'create_issue')).toBe('mcp__github__create_issue')
  })

  it('normalizes invalid provider-facing characters deterministically', () => {
    expect(normalizeMcpServerId('github enterprise')).toBe('github_enterprise')
    expect(normalizeMcpToolName('issues/create')).toBe('issues_create')
    expect(buildMcpModelToolName('GitHub Enterprise', 'ReadIssue')).toBe('mcp__github_enterprise__readissue')
    expect(buildMcpModelToolName(' @ ', ' / ')).toBe('mcp__server__tool')
  })

  it('parses only MCP model tool names', () => {
    expect(isMcpModelToolName('mcp__github__create_issue')).toBe(true)
    expect(parseMcpModelToolName('mcp__github__create_issue')).toEqual({
      serverId: 'github',
      toolName: 'create_issue',
    })
    expect(parseMcpModelToolName('Bash')).toBeNull()
  })
})
