import { describe, expect, it } from 'vitest'
import { createRuntimeFlags } from './runtimeFlags'

describe('createRuntimeFlags', () => {
  it('defaults to session save enabled and no optional flags', () => {
    const flags = createRuntimeFlags({})
    expect(flags.sessionSaveEnabled).toBe(true)
    expect(flags.isVitest).toBe(false)
    expect(flags.hooksDebugEnabled).toBe(false)
    expect(flags.userShellPath).toBe(null)
    expect(flags.deferredToolExposureEnabled).toBe(false)
    expect(flags.requestDryRunEnabled).toBe(false)
    expect(flags.requestDryRunOutputDir).toBe(null)
  })

  it('parses truthy flags and normalized shell values', () => {
    const flags = createRuntimeFlags({
      FORMAX_HOOKS_DEBUG: 'Yes',
      FORMAX_DEFERRED_TOOL_EXPOSURE: '1',
      FORMAX_REQUEST_DRY_RUN: 'true',
      FORMAX_REQUEST_DRY_RUN_DIR: ' proxy/preview ',
      SHELL: ' /bin/bash ',
    })
    expect(flags.hooksDebugEnabled).toBe(true)
    expect(flags.deferredToolExposureEnabled).toBe(true)
    expect(flags.requestDryRunEnabled).toBe(true)
    expect(flags.requestDryRunOutputDir).toBe('proxy/preview')
    expect(flags.userShellPath).toBe('/bin/bash')
  })

  it('treats blank shell strings as null', () => {
    const flags = createRuntimeFlags({ SHELL: '   ' })
    expect(flags.userShellPath).toBe(null)
  })

  it('parses session save flags with default enabled', () => {
    expect(createRuntimeFlags({}).sessionSaveEnabled).toBe(true)
    expect(createRuntimeFlags({ FORMAX_SESSION_SAVE: '0' }).sessionSaveEnabled).toBe(false)
    expect(createRuntimeFlags({ FORMAX_SESSION_SAVE: 'false' }).sessionSaveEnabled).toBe(false)
    expect(createRuntimeFlags({ FORMAX_SESSION_SAVE: 'yes' }).sessionSaveEnabled).toBe(true)
  })

  it('detects vitest mode when VITEST is present', () => {
    expect(createRuntimeFlags({ VITEST: '1' }).isVitest).toBe(true)
    expect(createRuntimeFlags({ VITEST: '  ' }).isVitest).toBe(false)
  })
})
