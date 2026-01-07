import { describe, it, expect } from 'vitest'
import { createUserInputManager } from './userInputManager'

describe('UserInputManager', () => {
  it('resolves answers when submitted', async () => {
    const mgr = createUserInputManager()

    const p = mgr.requestAnswers({
      toolUseId: '1',
      questions: [],
    })

    mgr.submitAnswers('1', { Choice: 'A' })
    await expect(p).resolves.toEqual({ Choice: 'A' })
  })

  it('buffers answers submitted early', async () => {
    const mgr = createUserInputManager()

    mgr.submitAnswers('early', { X: 'Y' })

    const p = mgr.requestAnswers({
      toolUseId: 'early',
      questions: [],
    })

    await expect(p).resolves.toEqual({ X: 'Y' })
  })

  it('rejects when aborted', async () => {
    const mgr = createUserInputManager()
    const ac = new AbortController()

    const p = mgr.requestAnswers({
      toolUseId: 'abort',
      questions: [],
      signal: ac.signal,
    })

    ac.abort()
    await expect(p).rejects.toThrow('Request aborted')
  })
})

