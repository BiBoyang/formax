import { describe, expect, it } from 'vitest'
import { isSlashCommandResultData, slashEffectToCommandResult } from './adapter'

describe('slashEffectToCommandResult', () => {
  it('returns consumed=false for null', () => {
    expect(slashEffectToCommandResult(null)).toEqual({ consumed: false })
  })

  it('maps local effect to appendMessages + injectNextTurn', () => {
    const result = slashEffectToCommandResult({
      kind: 'local',
      stdout: 'hello',
      recordForNextTurn: { commandName: '/todos', commandMessage: 'todos', commandArgs: '', stdout: 'out' },
    })

    expect(result.consumed).toBe(true)
    expect(result).toMatchObject({
      ui: [
        {
          type: 'appendMessages',
          messages: [
            { role: 'assistant', ui: { kind: 'command_subline' }, content: 'hello' },
          ],
        },
      ],
      model: [{ type: 'injectNextTurn' }],
    })
  })

  it('renders local output as command sublines (no injectNextTurn when recordForNextTurn is absent)', () => {
    const result = slashEffectToCommandResult({
      kind: 'local',
      stdout: 'hello',
    })

    expect(result).toMatchObject({
      ui: [{ type: 'appendMessages', messages: [{ role: 'assistant', ui: { kind: 'command_subline' }, content: 'hello' }] }],
    })
    expect((result as any).model).toBeUndefined()
  })

  it('maps open_agents_dialog effect to openOverlay', () => {
    const result = slashEffectToCommandResult({ kind: 'open_agents_dialog' })
    expect(result).toEqual({
      consumed: true,
      ui: [{ type: 'openOverlay', overlay: { kind: 'agents' } }],
    })
  })

  it('maps open_permissions_dialog effect to openOverlay', () => {
    const result = slashEffectToCommandResult({ kind: 'open_permissions_dialog' })
    expect(result).toEqual({
      consumed: true,
      ui: [{ type: 'openOverlay', overlay: { kind: 'permissions' } }],
    })
  })

  it('maps open_model_dialog effect to openOverlay', () => {
    const result = slashEffectToCommandResult({ kind: 'open_model_dialog' })
    expect(result).toEqual({
      consumed: true,
      ui: [{ type: 'openOverlay', overlay: { kind: 'model' } }],
    })
  })

  it('maps hooks/config/resume dialogs to openOverlay', () => {
    expect(slashEffectToCommandResult({ kind: 'open_hooks_dialog' })).toEqual({
      consumed: true,
      ui: [{ type: 'openOverlay', overlay: { kind: 'hooks' } }],
    })
    expect(slashEffectToCommandResult({ kind: 'open_config_dialog' })).toEqual({
      consumed: true,
      ui: [{ type: 'openOverlay', overlay: { kind: 'config' } }],
    })
    expect(slashEffectToCommandResult({ kind: 'open_resume_dialog' })).toEqual({
      consumed: true,
      ui: [{ type: 'openOverlay', overlay: { kind: 'resume' } }],
    })
  })

  it('maps unimplemented effect to appendMessages', () => {
    const result = slashEffectToCommandResult({ kind: 'unimplemented', message: 'Nope' })
    expect(result).toEqual({
      consumed: true,
      ui: [{ type: 'appendMessages', messages: [{ role: 'assistant', content: 'Nope' }] }],
    })
  })

  it('maps local_async effect to appendMessages + local_async data', () => {
    const run = async () => ({ stdout: 'ok' })
    const result = slashEffectToCommandResult({ kind: 'local_async', loadingText: 'Diagnosing', run })
    expect(result).toMatchObject({
      consumed: true,
      ui: [{ type: 'appendMessages', messages: [{ role: 'assistant', ui: { kind: 'command_subline' }, content: 'Diagnosing...' }] }],
      data: { kind: 'local_async', loadingText: 'Diagnosing' },
    })
  })

  it('uses default loading text when local_async.loadingText is absent', () => {
    const run = async () => ({ stdout: 'ok' })
    const result = slashEffectToCommandResult({ kind: 'local_async', run })
    expect(result).toMatchObject({
      consumed: true,
      ui: [{ type: 'appendMessages', messages: [{ content: 'Working...' }] }],
      data: { kind: 'local_async' },
    })
  })

  it('maps llm effect to consumed result with llm data', () => {
    const result = slashEffectToCommandResult({
      kind: 'llm',
      loadingText: 'Spelunking',
      blocks: [{ type: 'text', text: 'hi' }],
    })
    expect(result).toMatchObject({
      consumed: true,
      data: { kind: 'llm', loadingText: 'Spelunking' },
    })
  })

  it('handles undefined local stdout and validates slash result data guard', () => {
    const local = slashEffectToCommandResult({ kind: 'local', stdout: undefined as any })
    expect(local).toMatchObject({
      consumed: true,
      ui: [{ type: 'appendMessages', messages: [{ content: '' }] }],
    })

    expect(isSlashCommandResultData({ kind: 'llm', blocks: [] })).toBe(true)
    expect(isSlashCommandResultData({ kind: 'local_async', run: async () => ({ stdout: 'x' }) })).toBe(true)
    expect(isSlashCommandResultData({ kind: 'other' })).toBe(false)
    expect(isSlashCommandResultData(null)).toBe(false)
    expect(isSlashCommandResultData(123)).toBe(false)
  })
})
