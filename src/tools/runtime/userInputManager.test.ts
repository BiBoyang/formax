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

  it('rejects all pending requests', async () => {
    const mgr = createUserInputManager()

    const p1 = mgr.requestAnswers({ toolUseId: 'a', questions: [] })
    const p2 = mgr.requestAnswers({ toolUseId: 'b', questions: [] })

    const n = mgr.rejectAllPending(new Error('Canceled'))
    expect(n).toBe(2)

    await expect(p1).rejects.toThrow('Canceled')
    await expect(p2).rejects.toThrow('Canceled')
    expect(mgr.isPending('a')).toBe(false)
    expect(mgr.isPending('b')).toBe(false)
  })

  it('clears buffered answers', async () => {
    const mgr = createUserInputManager()

    mgr.submitAnswers('early', { X: 'Y' })
    mgr.clearBufferedAnswers()

    const p = mgr.requestAnswers({ toolUseId: 'early', questions: [] })
    expect(mgr.isPending('early')).toBe(true)

    mgr.reject('early', new Error('Request aborted'))
    await expect(p).rejects.toThrow('Request aborted')
  })
})
