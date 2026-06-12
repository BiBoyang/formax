import { describe, expect, it, vi } from 'vitest'
import React from 'react'
import { Text } from 'ink'
import { render } from 'ink-testing-library'
import type { UserInputManager } from './userInputManager'
import { createUserInputManager } from './userInputManager'
import { UserInputProvider, useUserInputManager } from './userInputContext'
import type { ApprovalPromptDescriptor } from './interactivePromptDescriptor'

function tick(ms = 10): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function Probe({ onManager }: { onManager: (manager: UserInputManager | null) => void }): React.ReactNode {
  const manager = useUserInputManager()
  onManager(manager)
  return <Text>{manager ? 'ready' : 'none'}</Text>
}

function createManager(overrides: Partial<UserInputManager> = {}): UserInputManager {
  return {
    requestAnswers: vi.fn(async () => ({ choice: 'y' })),
    submitAnswers: vi.fn(() => true),
    reject: vi.fn(() => true),
    rejectAllPending: vi.fn(() => 1),
    isPending: vi.fn(() => false),
    clearBufferedAnswers: vi.fn(),
    ...overrides,
  }
}

function approvalDescriptor(toolUseId: string): ApprovalPromptDescriptor {
  return {
    kind: 'approval',
    requestEvent: {
      type: 'approval_request',
      toolUseId,
      toolName: 'Bash',
      action: { kind: 'bash.exec', command: 'pwd' },
      effectiveDecision: 'ask',
    },
    ui: { promptVariant: 'bash', title: 'Approve command?', command: 'pwd', cwd: '/repo' },
  }
}

describe('UserInputProvider / useUserInputManager', () => {
  it('returns null outside provider', () => {
    const onManager = vi.fn()
    const { lastFrame } = render(<Probe onManager={onManager} />)
    expect(lastFrame() || '').toContain('none')
    expect(onManager).toHaveBeenLastCalledWith(null)
  })

  it('bumps version after successful mutating operations', async () => {
    const base = createManager()
    const onManager = vi.fn()
    render(
      <UserInputProvider userInput={base}>
        <Probe onManager={onManager} />
      </UserInputProvider>,
    )

    const wrapped = onManager.mock.lastCall?.[0] as UserInputManager
    expect(wrapped).toBeTruthy()
    expect(wrapped).not.toBe(base)

    const renders0 = onManager.mock.calls.length
    const answers = await wrapped.requestAnswers({ toolUseId: 't1', questions: [] })
    await tick()
    expect(answers).toEqual({ choice: 'y' })
    expect(base.requestAnswers).toHaveBeenCalledWith({ toolUseId: 't1', questions: [] })
    expect(onManager.mock.calls.length).toBe(renders0 + 1)

    const renders1 = onManager.mock.calls.length
    expect(wrapped.submitAnswers('t1', { a: '1' })).toBe(true)
    await tick()
    expect(base.submitAnswers).toHaveBeenCalledWith('t1', { a: '1' })
    expect(onManager.mock.calls.length).toBe(renders1 + 1)

    const renders2 = onManager.mock.calls.length
    expect(wrapped.reject('t1', new Error('stop'))).toBe(true)
    await tick()
    expect(base.reject).toHaveBeenCalled()
    expect(onManager.mock.calls.length).toBe(renders2 + 1)

    const renders3 = onManager.mock.calls.length
    expect(wrapped.rejectAllPending(new Error('cancel all'))).toBe(1)
    await tick()
    expect(base.rejectAllPending).toHaveBeenCalled()
    expect(onManager.mock.calls.length).toBe(renders3 + 1)
  })

  it('does not bump version for noop reject paths and proxies non-mutating helpers', async () => {
    const base = createManager({
      reject: vi.fn(() => false),
      rejectAllPending: vi.fn(() => 0),
      isPending: vi.fn(() => true),
    })
    const onManager = vi.fn()
    render(
      <UserInputProvider userInput={base}>
        <Probe onManager={onManager} />
      </UserInputProvider>,
    )

    const wrapped = onManager.mock.lastCall?.[0] as UserInputManager
    const renders0 = onManager.mock.calls.length

    expect(wrapped.reject('t2', new Error('x'))).toBe(false)
    await tick()
    expect(onManager.mock.calls.length).toBe(renders0)

    expect(wrapped.rejectAllPending(new Error('x'))).toBe(0)
    await tick()
    expect(onManager.mock.calls.length).toBe(renders0)

    expect(wrapped.isPending('t2')).toBe(true)
    expect(base.isPending).toHaveBeenCalledWith('t2')
    expect(wrapped.isActivePrompt?.('t2')).toBe(true)
    expect(base.isPending).toHaveBeenCalledWith('t2')

    wrapped.clearBufferedAnswers()
    expect(base.clearBufferedAnswers).toHaveBeenCalledTimes(1)
  })

  it('re-renders when a base manager advances the active prompt outside the wrapper', async () => {
    const base = createUserInputManager()
    const onManager = vi.fn()
    render(
      <UserInputProvider userInput={base}>
        <Probe onManager={onManager} />
      </UserInputProvider>,
    )
    await tick()

    const renders0 = onManager.mock.calls.length
    const p1 = base.requestAnswers({ toolUseId: 'a', questions: [] })
    const p2 = base.requestAnswers({ toolUseId: 'b', questions: [] })
    await tick()
    expect(onManager.mock.calls.length).toBeGreaterThan(renders0)

    const wrapped = onManager.mock.lastCall?.[0] as UserInputManager
    expect(wrapped.isPending('a')).toBe(true)
    expect(wrapped.isPending('b')).toBe(false)
    expect(wrapped.isActivePrompt?.('a')).toBe(true)
    expect(wrapped.isActivePrompt?.('b')).toBe(false)

    const renders1 = onManager.mock.calls.length
    base.submitAnswers('a', { A: '1' })
    await expect(p1).resolves.toEqual({ A: '1' })
    await tick()

    expect(onManager.mock.calls.length).toBeGreaterThan(renders1)
    expect(wrapped.isPending('a')).toBe(false)
    expect(wrapped.isPending('b')).toBe(true)
    expect(wrapped.isActivePrompt?.('a')).toBe(false)
    expect(wrapped.isActivePrompt?.('b')).toBe(true)

    base.submitAnswers('b', { B: '2' })
    await expect(p2).resolves.toEqual({ B: '2' })
  })

  it('exposes active prompt descriptor through the provider wrapper', async () => {
    const base = createUserInputManager()
    const onManager = vi.fn()
    render(
      <UserInputProvider userInput={base}>
        <Probe onManager={onManager} />
      </UserInputProvider>,
    )
    await tick()

    const p1 = base.requestAnswers({
      toolUseId: 'a',
      questions: [],
      descriptor: approvalDescriptor('a'),
    })
    const p2 = base.requestAnswers({
      toolUseId: 'b',
      questions: [],
      descriptor: { ...approvalDescriptor('b'), ui: { promptVariant: 'bash', title: 'Second' } },
    })
    await tick()

    const wrapped = onManager.mock.lastCall?.[0] as UserInputManager
    expect(wrapped.getActivePrompt?.()?.requestEvent.toolUseId).toBe('a')
    expect(wrapped.getActivePrompt?.()?.ui?.title).toBe('Approve command?')

    base.submitAnswers('a', { decision: 'approve' })
    await expect(p1).resolves.toEqual({ decision: 'approve' })
    await tick()

    expect(wrapped.getActivePrompt?.()?.requestEvent.toolUseId).toBe('b')
    expect(wrapped.getActivePrompt?.()?.ui?.title).toBe('Second')

    base.submitAnswers('b', { decision: 'approve' })
    await expect(p2).resolves.toEqual({ decision: 'approve' })
  })
})
