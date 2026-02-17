import { describe, expect, it, vi } from 'vitest'
import type { PromptBlock } from '../../../../prompts'
import type { ConfigDialogExit } from '../../../../ui/config/ConfigDialog.js'
import type { SessionWriter } from '../../sessionSave/writer'
import { applyConfigExitInjection, getLocalCommandInjectionStats } from './localCommandInjection'

describe('localCommandInjection', () => {
  it('computes local command injection stats', () => {
    const stats = getLocalCommandInjectionStats({
      commandName: '/config',
      commandMessage: 'config',
      commandArgs: '',
      stdout: 'Set output style to Explanatory',
    })

    expect(stats.stdoutChars).toBe(31)
    expect(stats.stdoutBytes).toBe(31)
    expect(stats.injectedBlocks).toBeGreaterThan(0)
    expect(stats.injectedChars).toBeGreaterThan(0)
  })

  it('injects /config output-style change and appends events', () => {
    const appendEvent = vi.fn()
    const writer: Pick<SessionWriter, 'appendEvent'> = { appendEvent }
    const pendingInjectedBlocksRef = { current: [] as PromptBlock[] }
    const exit: ConfigDialogExit = {
      kind: 'changed',
      message: 'Set output style to Learning',
    }

    applyConfigExitInjection({
      exit,
      sessionSaveEnabled: true,
      writer,
      pendingInjectedBlocksRef,
    })

    expect(appendEvent).toHaveBeenCalledWith('config_exit', {
      kind: 'changed',
      message: 'Set output style to Learning',
    })
    expect(appendEvent).toHaveBeenCalledWith(
      'output_style_changed',
      expect.objectContaining({ style: 'learning', label: 'Learning' }),
    )
    expect(appendEvent).toHaveBeenCalledWith(
      'local_command_injection',
      expect.objectContaining({ source: 'config_output_style', commandName: '/config' }),
    )
    expect(pendingInjectedBlocksRef.current.length).toBeGreaterThan(0)
  })
})
