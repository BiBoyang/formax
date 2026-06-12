import { describe, it, expect, vi } from 'vitest'
import { createUserInputManager } from './userInputManager'
import type { InteractivePromptDescriptor } from './interactivePromptDescriptor'

function approvalDescriptor(toolUseId: string, title = 'Approve?'): Extract<InteractivePromptDescriptor, { kind: 'approval' }> {
  return {
    kind: 'approval',
    requestEvent: {
      type: 'approval_request',
      toolUseId,
      toolName: 'Bash',
      action: { kind: 'bash.exec', command: 'ls' },
      effectiveDecision: 'ask',
    },
    ui: {
      promptVariant: 'bash',
      title,
      command: 'ls',
      cwd: '/repo',
    },
  }
}

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

  it('returns the same pending promise when requesting the same toolUseId twice', async () => {
    const mgr = createUserInputManager()

    const p1 = mgr.requestAnswers({
      toolUseId: 'same',
      questions: [],
    })
    const p2 = mgr.requestAnswers({
      toolUseId: 'same',
      questions: [],
    })

    expect(p1).toBe(p2)
    mgr.submitAnswers('same', { A: '1' })
    await expect(p1).resolves.toEqual({ A: '1' })
    await expect(p2).resolves.toEqual({ A: '1' })
  })

  it('tracks pending request order for UI projection', async () => {
    const mgr = createUserInputManager()

    const p1 = mgr.requestAnswers({ toolUseId: 'a', questions: [] })
    const p2 = mgr.requestAnswers({ toolUseId: 'b', questions: [] })

    expect(mgr.isPending('a')).toBe(true)
    expect(mgr.isPending('b')).toBe(true)
    expect(mgr.getPendingToolUseIds?.()).toEqual(['a', 'b'])

    mgr.submitAnswers('a', { A: '1' })
    await expect(p1).resolves.toEqual({ A: '1' })

    expect(mgr.isPending('a')).toBe(false)
    expect(mgr.isPending('b')).toBe(true)
    expect(mgr.getPendingToolUseIds?.()).toEqual(['b'])

    mgr.submitAnswers('b', { B: '2' })
    await expect(p2).resolves.toEqual({ B: '2' })
    expect(mgr.isPending('b')).toBe(false)
    expect(mgr.getPendingToolUseIds?.()).toEqual([])
  })

  it('returns the FIFO head descriptor as the active prompt', async () => {
    const mgr = createUserInputManager()

    const p1 = mgr.requestAnswers({
      toolUseId: 'a',
      questions: [],
      descriptor: approvalDescriptor('a', 'Approve A?'),
    })
    const p2 = mgr.requestAnswers({
      toolUseId: 'b',
      questions: [],
      descriptor: approvalDescriptor('b', 'Approve B?'),
    })

    expect(mgr.getActivePrompt?.()?.requestEvent.toolUseId).toBe('a')
    expect(mgr.getActivePrompt?.()?.ui?.title).toBe('Approve A?')

    mgr.submitAnswers('a', { decision: 'approve' })
    await expect(p1).resolves.toEqual({ decision: 'approve' })

    expect(mgr.getActivePrompt?.()?.requestEvent.toolUseId).toBe('b')
    expect(mgr.getActivePrompt?.()?.ui?.title).toBe('Approve B?')

    mgr.submitAnswers('b', { decision: 'approve' })
    await expect(p2).resolves.toEqual({ decision: 'approve' })
    expect(mgr.getActivePrompt?.()).toBeNull()
  })

  it('does not return descriptor-less pending requests as active prompts', async () => {
    const mgr = createUserInputManager()

    const p = mgr.requestAnswers({ toolUseId: 'legacy', questions: [] })

    expect(mgr.isPending('legacy')).toBe(true)
    expect(mgr.getPendingToolUseIds?.()).toEqual(['legacy'])
    expect(mgr.getActivePrompt?.()).toBeNull()

    mgr.submitAnswers('legacy', { ok: '1' })
    await expect(p).resolves.toEqual({ ok: '1' })
  })

  it('captures descriptor metadata as a stable snapshot', async () => {
    const mgr = createUserInputManager()
    const descriptor = approvalDescriptor('snap', 'Original title')
    descriptor.requestEvent.suggestions = ['first']
    descriptor.requestEvent.action = { kind: 'bash.exec', command: 'ls', metadata: { cwd: '/before' } } as any
    descriptor.requestEvent.workspaceRequest = { kind: 'read', dir: '/before' } as any
    descriptor.promptData = {
      kind: 'exit_plan_mode',
      planPath: '/before/plan.md',
      planContentState: { status: 'loaded', text: 'before body' },
    }

    const p = mgr.requestAnswers({
      toolUseId: 'snap',
      questions: [],
      descriptor,
    })

    descriptor.ui!.title = 'Mutated title'
    descriptor.requestEvent.suggestions.push('second')
    ;(descriptor.requestEvent.action as any).metadata.cwd = '/after'
    ;(descriptor.requestEvent.workspaceRequest as any).dir = '/after'
    ;(descriptor.promptData as any).planPath = '/after/plan.md'
    ;(descriptor.promptData as any).planContentState.text = 'after body'

    const active = mgr.getActivePrompt?.()
    expect(active?.kind).toBe('approval')
    if (!active || active.kind !== 'approval') throw new Error('Expected approval descriptor')
    expect(active.ui?.title).toBe('Original title')
    expect(active.requestEvent.suggestions).toEqual(['first'])
    expect((active.requestEvent.action as any).metadata.cwd).toBe('/before')
    expect((active.requestEvent.workspaceRequest as any).dir).toBe('/before')
    expect((active.promptData as any).planPath).toBe('/before/plan.md')
    expect((active.promptData as any).planContentState.text).toBe('before body')

    mgr.submitAnswers('snap', { decision: 'approve' })
    await expect(p).resolves.toEqual({ decision: 'approve' })
  })

  it('clears active descriptor atomically when rejecting and aborting requests', async () => {
    const mgr = createUserInputManager()
    const ac = new AbortController()

    const p1 = mgr.requestAnswers({
      toolUseId: 'reject-me',
      questions: [],
      descriptor: approvalDescriptor('reject-me'),
    })
    const p2 = mgr.requestAnswers({
      toolUseId: 'abort-me',
      questions: [],
      signal: ac.signal,
      descriptor: approvalDescriptor('abort-me'),
    })

    expect(mgr.getActivePrompt?.()?.requestEvent.toolUseId).toBe('reject-me')
    mgr.reject('reject-me', new Error('nope'))
    await expect(p1).rejects.toThrow('nope')
    expect(mgr.getActivePrompt?.()?.requestEvent.toolUseId).toBe('abort-me')

    ac.abort()
    await expect(p2).rejects.toThrow('Request aborted')
    expect(mgr.getActivePrompt?.()).toBeNull()
  })

  it('removes rejected requests from pending order', async () => {
    const mgr = createUserInputManager()

    const p1 = mgr.requestAnswers({ toolUseId: 'a', questions: [] })
    const p2 = mgr.requestAnswers({ toolUseId: 'b', questions: [] })

    expect(mgr.isPending('a')).toBe(true)
    expect(mgr.isPending('b')).toBe(true)
    expect(mgr.getPendingToolUseIds?.()).toEqual(['a', 'b'])

    mgr.reject('a', new Error('Canceled'))
    await expect(p1).rejects.toThrow('Canceled')

    expect(mgr.isPending('a')).toBe(false)
    expect(mgr.isPending('b')).toBe(true)
    expect(mgr.getPendingToolUseIds?.()).toEqual(['b'])

    mgr.submitAnswers('b', { B: '2' })
    await expect(p2).resolves.toEqual({ B: '2' })
  })

  it('allows programmatic answers for later pending requests', async () => {
    const mgr = createUserInputManager()

    const p1 = mgr.requestAnswers({ toolUseId: 'a', questions: [] })
    const p2 = mgr.requestAnswers({ toolUseId: 'b', questions: [] })

    expect(mgr.isPending('b')).toBe(true)
    expect(mgr.submitAnswers('b', { B: 'early' })).toBe(true)
    await expect(p2).resolves.toEqual({ B: 'early' })
    expect(mgr.isPending('b')).toBe(false)
    expect(mgr.getPendingToolUseIds?.()).toEqual(['a'])

    expect(mgr.submitAnswers('a', { A: '1' })).toBe(true)
    await expect(p1).resolves.toEqual({ A: '1' })
  })

  it('notifies subscribers when pending order changes', async () => {
    const mgr = createUserInputManager()
    const onChange = vi.fn()
    const unsubscribe = mgr.subscribe?.(onChange)

    expect(onChange).toHaveBeenCalledTimes(1)

    const p1 = mgr.requestAnswers({ toolUseId: 'a', questions: [] })
    const p2 = mgr.requestAnswers({ toolUseId: 'b', questions: [] })

    expect(onChange).toHaveBeenCalledTimes(3)
    expect(mgr.isPending('a')).toBe(true)
    expect(mgr.isPending('b')).toBe(true)

    mgr.submitAnswers('a', { A: '1' })
    await expect(p1).resolves.toEqual({ A: '1' })
    expect(onChange).toHaveBeenCalledTimes(4)
    expect(mgr.isPending('b')).toBe(true)

    unsubscribe?.()
    mgr.submitAnswers('b', { B: '2' })
    await expect(p2).resolves.toEqual({ B: '2' })
    expect(onChange).toHaveBeenCalledTimes(4)
  })

  it('evicts the oldest buffered answers when exceeding the cap', async () => {
    const mgr = createUserInputManager()

    for (let i = 0; i < 51; i += 1) {
      mgr.submitAnswers(`id${i}`, { i: String(i) })
    }

    const kept = mgr.requestAnswers({
      toolUseId: 'id50',
      questions: [],
    })
    await expect(kept).resolves.toEqual({ i: '50' })

    const evicted = mgr.requestAnswers({
      toolUseId: 'id0',
      questions: [],
    })
    expect(mgr.isPending('id0')).toBe(true)
    mgr.reject('id0', new Error('Request aborted'))
    await expect(evicted).rejects.toThrow('Request aborted')
  })

  it('evicts only as many buffered entries as required to fit max size', async () => {
    const mgr = createUserInputManager()

    for (let i = 0; i < 51; i += 1) {
      mgr.submitAnswers(`k${i}`, { i: String(i) })
    }

    // k0 should be evicted, but k1 should still be buffered.
    const k1 = mgr.requestAnswers({ toolUseId: 'k1', questions: [] })
    await expect(k1).resolves.toEqual({ i: '1' })
  })

  it('drops buffered answers after TTL', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2000-01-01T00:00:00.000Z'))

    const mgr = createUserInputManager()
    mgr.submitAnswers('ttl', { X: 'Y' })

    vi.setSystemTime(new Date('2000-01-01T00:02:00.000Z'))

    const p = mgr.requestAnswers({
      toolUseId: 'ttl',
      questions: [],
    })

    expect(mgr.isPending('ttl')).toBe(true)
    mgr.reject('ttl', new Error('Request aborted'))
    await expect(p).rejects.toThrow('Request aborted')

    vi.useRealTimers()
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

  it('rejects immediately when signal is already aborted', async () => {
    const mgr = createUserInputManager()
    const ac = new AbortController()
    ac.abort()

    await expect(
      mgr.requestAnswers({
        toolUseId: 'already-aborted',
        questions: [],
        signal: ac.signal,
      }),
    ).rejects.toThrow('Request aborted')
    expect(mgr.isPending('already-aborted')).toBe(false)
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

  it('returns false when rejecting a non-pending request', () => {
    const mgr = createUserInputManager()
    expect(mgr.reject('none', new Error('x'))).toBe(false)
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
