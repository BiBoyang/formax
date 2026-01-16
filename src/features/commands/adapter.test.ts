import { describe, expect, it } from 'vitest'
import { slashEffectToCommandResult } from './adapter'

describe('slashEffectToCommandResult', () => {
  it('returns consumed=false for null', () => {
    expect(slashEffectToCommandResult(null)).toEqual({ consumed: false })
  })

  it('maps local effect to appendMessages + local data', () => {
    const result = slashEffectToCommandResult({
      kind: 'local',
      stdout: 'hello',
      recordForNextTurn: { commandName: '/todos', commandMessage: 'todos', commandArgs: '', stdout: 'out' },
    })

    expect(result.consumed).toBe(true)
    expect(result).toMatchObject({
      ui: [{ type: 'appendMessages', messages: [{ role: 'assistant', content: 'hello' }] }],
      data: { kind: 'local' },
    })
  })

  it('maps open_agents_dialog effect to openOverlay', () => {
    const result = slashEffectToCommandResult({ kind: 'open_agents_dialog' })
    expect(result).toEqual({
      consumed: true,
      ui: [{ type: 'openOverlay', overlay: { kind: 'agents' } }],
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
      ui: [{ type: 'appendMessages', messages: [{ role: 'assistant', content: 'Diagnosing...' }] }],
      data: { kind: 'local_async', loadingText: 'Diagnosing' },
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
})
