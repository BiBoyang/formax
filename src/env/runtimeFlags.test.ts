import { describe, expect, it } from 'vitest'
import { createRuntimeFlags } from './runtimeFlags'

describe('createRuntimeFlags', () => {
  it('defaults to session save enabled and no optional flags', () => {
    const flags = createRuntimeFlags({})
    expect(flags.sessionSaveEnabled).toBe(true)
    expect(flags.isVitest).toBe(false)
    expect(flags.toolLoopLimit).toBe(null)
    expect(flags.hooksDebugEnabled).toBe(false)
    expect(flags.bashModeShellOverride).toBe(null)
    expect(flags.userShellPath).toBe(null)
  })

  it('parses truthy flags and normalized shell values', () => {
    const flags = createRuntimeFlags({
      FORMAX_HOOKS_DEBUG: 'Yes',
      FORMAX_BASH_MODE_SHELL: ' /bin/zsh ',
      SHELL: ' /bin/bash ',
    })
    expect(flags.hooksDebugEnabled).toBe(true)
    expect(flags.bashModeShellOverride).toBe('/bin/zsh')
    expect(flags.userShellPath).toBe('/bin/bash')
  })

  it('parses session save flags with disabled taking precedence', () => {
    expect(createRuntimeFlags({ FORMAX_SESSION_SAVE: '0' }).sessionSaveEnabled).toBe(false)
    expect(createRuntimeFlags({ FORMAX_SESSION_SAVE: 'false' }).sessionSaveEnabled).toBe(false)
    expect(createRuntimeFlags({ FORMAX_SESSION_SAVE: 'yes' }).sessionSaveEnabled).toBe(true)
    expect(
      createRuntimeFlags({
        FORMAX_SESSION_SAVE: '1',
        FORMAX_SESSION_SAVE_DISABLED: 'true',
      }).sessionSaveEnabled,
    ).toBe(false)
  })

  it('parses and caps tool loop limit', () => {
    expect(createRuntimeFlags({ FORMAX_TOOL_LOOP_LIMIT: '2' }).toolLoopLimit).toBe(2)
    expect(createRuntimeFlags({ FORMAX_TOOL_LOOP_LIMIT: '0' }).toolLoopLimit).toBe(null)
    expect(createRuntimeFlags({ FORMAX_TOOL_LOOP_LIMIT: '-3' }).toolLoopLimit).toBe(null)
    expect(createRuntimeFlags({ FORMAX_TOOL_LOOP_LIMIT: 'abc' }).toolLoopLimit).toBe(null)
    expect(createRuntimeFlags({ FORMAX_TOOL_LOOP_LIMIT: '999999' }).toolLoopLimit).toBe(2000)
  })

  it('detects vitest mode when VITEST is present', () => {
    expect(createRuntimeFlags({ VITEST: '1' }).isVitest).toBe(true)
    expect(createRuntimeFlags({ VITEST: '  ' }).isVitest).toBe(false)
  })
})
