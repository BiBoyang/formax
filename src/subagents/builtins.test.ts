import fs from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { __testOnly, getBuiltinSubagents } from './builtins'

describe('getBuiltinSubagents', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('loads prompts, strips leading HTML comments, interpolates, and falls back on read errors', () => {
    const readFileSync = vi.spyOn(fs, 'readFileSync')
    readFileSync.mockImplementation((filePath) => {
      const fileName = path.basename(String(filePath))

      if (fileName === 'agent-prompt-explore.md') {
        return 'Explore uses ${GLOB_TOOL_NAME} + ${GREP_TOOL_NAME}'
      }

      if (fileName === 'agent-prompt-plan-mode-enhanced.md') {
        return '  <!--ignore me-->Plan uses ${READ_TOOL_NAME} + ${UNKNOWN_TOOL}'
      }

      if (fileName === 'agent-prompt-claude-guide-agent.md') {
        return '<!-- missing end\nGuide uses ${WEBSEARCH_TOOL_NAME}'
      }

      if (fileName === 'agent-prompt-status-line-setup.md') {
        throw new Error('missing')
      }

      if (fileName === 'agent-prompt-task-tool.md') {
        return 'Task tool base'
      }

      if (fileName === 'agent-prompt-task-tool-extra-notes.md') {
        return ''
      }

      throw new Error(`Unexpected prompt read: ${fileName}`)
    })

    const agents = getBuiltinSubagents()
    expect(agents.map((a) => a.name)).toEqual([
      'general-purpose',
      'statusline-setup',
      'Explore',
      'Plan',
      'claude-code-guide',
    ])

    const explore = agents.find((a) => a.name === 'Explore')
    expect(explore?.systemPrompt).toContain('Glob')
    expect(explore?.systemPrompt).toContain('Grep')

    const plan = agents.find((a) => a.name === 'Plan')
    expect(plan?.systemPrompt).toContain('Plan uses Read')
    expect(plan?.systemPrompt).toContain('${UNKNOWN_TOOL}')
    expect(plan?.systemPrompt).not.toContain('<!--ignore me-->')

    const guide = agents.find((a) => a.name === 'claude-code-guide')
    expect(guide?.systemPrompt).toContain('<!-- missing end')
    expect(guide?.systemPrompt).toContain('WebSearch')

    const statusline = agents.find((a) => a.name === 'statusline-setup')
    expect(statusline?.systemPrompt).toContain('statusline setup agent')
  })

  it('treats empty vars as no-op interpolation', () => {
    expect(__testOnly.interpolatePrompt('Explore uses ${GLOB_TOOL_NAME}', {})).toBe(
      'Explore uses ${GLOB_TOOL_NAME}',
    )
  })
})
