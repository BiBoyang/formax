import { describe, expect, it, vi } from 'vitest'
import type { PromptBlock } from '../../../../prompts'
import type { ConfigDialogExit } from '../../../../tui/config/ConfigDialog.js'
import type { SessionWriter } from '../../sessionSave/writer'
import * as injectedBlocks from '../../injectedBlocks'
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

  it('handles non-text injected blocks when computing stats', () => {
    const spy = vi.spyOn(injectedBlocks, 'buildLocalCommandInjectedBlocks').mockReturnValue([
      { type: 'text', text: 'abc' } as any,
      { type: 'text', text: 42 } as any,
      { type: 'other' } as any,
    ])

    const stats = getLocalCommandInjectionStats({
      commandName: '/config',
      commandMessage: 'config',
      commandArgs: '',
      stdout: 'ok',
    })

    expect(stats.injectedChars).toBe(3)
    expect(stats.injectedBlocks).toBe(3)
    spy.mockRestore()
  })

  it('writes only config_exit for dismissed exits when saving is enabled', () => {
    const appendEvent = vi.fn()
    const pendingInjectedBlocksRef = { current: [] as PromptBlock[] }
    applyConfigExitInjection({
      exit: { kind: 'dismissed' },
      sessionSaveEnabled: true,
      writer: { appendEvent } as Pick<SessionWriter, 'appendEvent'>,
      pendingInjectedBlocksRef,
    })

    expect(appendEvent).toHaveBeenCalledWith('config_exit', { kind: 'dismissed' })
    expect(appendEvent).toHaveBeenCalledTimes(1)
    expect(pendingInjectedBlocksRef.current).toEqual([])
  })

  it('injects style blocks without session event writes when save is disabled', () => {
    const appendEvent = vi.fn()
    const pendingInjectedBlocksRef = { current: [] as PromptBlock[] }
    applyConfigExitInjection({
      exit: { kind: 'changed', message: 'Set output style to Concise' },
      sessionSaveEnabled: false,
      writer: { appendEvent } as Pick<SessionWriter, 'appendEvent'>,
      pendingInjectedBlocksRef,
    })

    expect(appendEvent).not.toHaveBeenCalled()
    expect(pendingInjectedBlocksRef.current.length).toBeGreaterThan(0)
  })

  it('does not inject for non-style config changes', () => {
    const appendEvent = vi.fn()
    const pendingInjectedBlocksRef = { current: [] as PromptBlock[] }
    applyConfigExitInjection({
      exit: { kind: 'changed', message: 'Changed timeout' },
      sessionSaveEnabled: true,
      writer: { appendEvent } as Pick<SessionWriter, 'appendEvent'>,
      pendingInjectedBlocksRef,
    })

    expect(appendEvent).toHaveBeenCalledWith('config_exit', { kind: 'changed', message: 'Changed timeout' })
    expect(appendEvent).toHaveBeenCalledTimes(1)
    expect(pendingInjectedBlocksRef.current).toEqual([])
  })
})
