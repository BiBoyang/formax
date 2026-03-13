import { describe, expect, it } from 'vitest'
import { SUBAGENT_DENY_TOOLS, SUBAGENT_DENY_TOOLS_SET, isSubagentDeniedTool } from './subagentDenyTools.js'

describe('subagentDenyTools', () => {
  it('exports deny-list as array and set with matching members', () => {
    expect(SUBAGENT_DENY_TOOLS).toContain('Task')
    expect(SUBAGENT_DENY_TOOLS).toContain('AskUserQuestion')
    expect(SUBAGENT_DENY_TOOLS_SET.has('TaskOutput')).toBe(true)
    expect(SUBAGENT_DENY_TOOLS_SET.has('SlashCommand')).toBe(false)
  })

  it('checks membership using isSubagentDeniedTool', () => {
    expect(isSubagentDeniedTool('Task')).toBe(true)
    expect(isSubagentDeniedTool('KillShell')).toBe(true)
    expect(isSubagentDeniedTool('Read')).toBe(false)
    expect(isSubagentDeniedTool('SlashCommand')).toBe(false)
  })
})
