import { describe, expect, it, vi } from 'vitest'
import React from 'react'
import { Text } from 'ink'
import { render } from 'ink-testing-library'
import type { UserInputManager } from './userInputManager'
import { UserInputProvider, useUserInputManager } from './userInputContext'

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

    wrapped.clearBufferedAnswers()
    expect(base.clearBufferedAnswers).toHaveBeenCalledTimes(1)
  })
})
