import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  patchToolsForTurnWithSkillDescriptions,
  resolveDeferredToolExposureForTurn,
} from './deferredToolExposureResolver'
import { getDeferredToolExposureStore } from './deferredToolExposure'
import {
  buildAvailableSkillsSystemReminderText,
  buildSkillToolSpecForCwdWithOptions,
} from '../modules/skill'

vi.mock('../modules/skill', () => ({
  buildSkillToolSpecForCwdWithOptions: vi.fn(),
  buildAvailableSkillsSystemReminderText: vi.fn(),
}))

describe('deferredToolExposureResolver', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(buildSkillToolSpecForCwdWithOptions).mockReturnValue({
      name: 'Skill',
      description: 'patched-skill',
      input_schema: {},
    } as any)
    vi.mocked(buildAvailableSkillsSystemReminderText).mockReturnValue(
      '<system-reminder>\nThe following skills are available for use with the Skill tool:\n\n- alpha: Alpha skill\n</system-reminder>',
    )
  })

  it('patches Skill spec with includeAvailableSkillsInDescription control', () => {
    const out = patchToolsForTurnWithSkillDescriptions({
      cwd: '/repo',
      includeAvailableSkillsInDescription: true,
      tools: [
        { name: 'Skill', description: 'skill', input_schema: {} },
        { name: 'Read', description: 'read', input_schema: {} },
      ],
    })

    expect(out.map((tool) => tool.name)).toEqual(['Skill', 'Read'])
    expect(buildSkillToolSpecForCwdWithOptions).toHaveBeenCalledWith('/repo', {
      includeAvailableSkillsInDescription: true,
    })
  })

  it('builds deferred exposure blocks and lazy tool resolver', () => {
    const sessionKey = 'resolver-session'
    getDeferredToolExposureStore().resetSession(sessionKey)

    const out = resolveDeferredToolExposureForTurn({
      cwd: '/repo',
      tools: [
        { name: 'Skill', description: 'skill', input_schema: {} },
        { name: 'Bash', description: 'run shell', input_schema: {} },
      ],
      deferredToolExposureEnabled: true,
      explicitSessionKey: sessionKey,
    })

    expect(out.toolsForTurn.map((tool) => tool.name)).toEqual(['ToolSearch'])
    expect(typeof out.resolveToolsForCall).toBe('function')
    expect(buildSkillToolSpecForCwdWithOptions).toHaveBeenCalledWith('/repo', {
      includeAvailableSkillsInDescription: false,
    })
    expect(out.injectedPromptBlocks).toHaveLength(2)
    const combinedText = out.injectedPromptBlocks
      .map((block: any) => block?.text ?? '')
      .join('\n')
    expect(combinedText).toContain('<available-deferred-tools>')
    expect(combinedText).toContain('Bash')
    expect(combinedText).toContain('The following skills are available for use with the Skill tool:')

    getDeferredToolExposureStore().searchAndLoad({
      sessionKey,
      query: 'select:Bash',
    })
    expect(out.resolveToolsForCall?.().map((tool) => tool.name)).toEqual(['ToolSearch', 'Bash'])
    expect(out.resolveToolsForCall?.()[1]?.defer_loading).toBe(true)
  })

  it('does not inject deferred metadata when there are no tools', () => {
    const out = resolveDeferredToolExposureForTurn({
      cwd: '/repo',
      tools: [],
      deferredToolExposureEnabled: true,
      explicitSessionKey: 'empty-session',
    })

    expect(out.toolsForTurn).toEqual([])
    expect(out.resolveToolsForCall).toBeUndefined()
    expect(out.injectedPromptBlocks).toEqual([])
  })
})
