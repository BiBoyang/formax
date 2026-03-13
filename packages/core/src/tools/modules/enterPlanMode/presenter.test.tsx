import { describe, expect, it, vi } from 'vitest'
import React from 'react'
import { render } from 'ink-testing-library'
import type { Msg } from '../../../shared/toolMessageTypes'
import { InputScopeProvider } from '../../../features/repl/inputScopeContext'
import { UserInputProvider } from '../../runtime/userInputContext'
import type { UserInputManager } from '../../runtime/userInputManager'
import { EnterPlanModeToolPresenter } from './presenter'

function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

function createRunningMessage(): Msg {
  return {
    id: 'tool-1',
    role: 'tool',
    content: '',
    timestamp: new Date(),
    toolInfo: { name: 'EnterPlanMode', status: 'running', input: {} },
  }
}

function createErrorMessage(result: string): Msg {
  return {
    id: 'tool-1',
    role: 'tool',
    content: '',
    timestamp: new Date(),
    toolInfo: { name: 'EnterPlanMode', status: 'error', input: {}, result },
  }
}

function createCompletedMessage(result: string): Msg {
  return {
    id: 'tool-1',
    role: 'tool',
    content: '',
    timestamp: new Date(),
    toolInfo: { name: 'EnterPlanMode', status: 'completed', input: {}, result },
  }
}

function createUserInput(submitAnswers: UserInputManager['submitAnswers']): UserInputManager {
  return {
    requestAnswers: async () => ({}),
    submitAnswers,
    reject: () => true,
    rejectAllPending: () => 0,
    clearBufferedAnswers: () => {},
    isPending: () => true,
  }
}

describe('EnterPlanModeToolPresenter', () => {
  it('falls back when toolInfo is missing', async () => {
    const message: Msg = {
      id: 'tool-missing',
      role: 'tool',
      content: '',
      timestamp: new Date(),
    }

    const { lastFrame } = render(
      <InputScopeProvider>
        <EnterPlanModeToolPresenter message={message} />
      </InputScopeProvider>,
    )

    await tick()
    expect(lastFrame()).toContain('Unknown tool')
  })

  it('shows Preparing… when running without userInput', async () => {
    const message = createRunningMessage()
    const { lastFrame } = render(
      <InputScopeProvider>
        <EnterPlanModeToolPresenter message={message} />
      </InputScopeProvider>,
    )

    await tick()
    expect(lastFrame()).toContain('Preparing…')
  })

  it('submits enter when pressing 1 then Enter', async () => {
    const submitAnswers = vi.fn<UserInputManager['submitAnswers']>(() => true)
    const userInput = createUserInput(submitAnswers)

    const message = createRunningMessage()
    const { stdin } = render(
      <InputScopeProvider>
        <UserInputProvider userInput={userInput}>
          <EnterPlanModeToolPresenter message={message} />
        </UserInputProvider>
      </InputScopeProvider>,
    )

    await tick()
    stdin.write('1')
    await tick()
    stdin.write('\r')
    await tick()

    expect(submitAnswers).toHaveBeenCalledTimes(1)
    expect(submitAnswers).toHaveBeenCalledWith('1', { choice: 'enter' })
  })

  it('uses raw message id when no tool- prefix is present', async () => {
    const submitAnswers = vi.fn<UserInputManager['submitAnswers']>(() => true)
    const userInput = createUserInput(submitAnswers)

    const message = createRunningMessage()
    message.id = 'raw-id'
    const { stdin } = render(
      <InputScopeProvider>
        <UserInputProvider userInput={userInput}>
          <EnterPlanModeToolPresenter message={message} />
        </UserInputProvider>
      </InputScopeProvider>,
    )

    await tick()
    stdin.write('\r')
    await tick()

    expect(submitAnswers).toHaveBeenCalledWith('raw-id', { choice: 'enter' })
  })

  it('prefers explicit toolUseId over canonical message id when submitting', async () => {
    const submitAnswers = vi.fn<UserInputManager['submitAnswers']>(() => true)
    const userInput = createUserInput(submitAnswers)

    const message: Msg = {
      ...createRunningMessage(),
      id: 'turn-1:tool:2:call_enter_456',
      toolInfo: {
        ...createRunningMessage().toolInfo!,
        toolUseId: 'call_enter_456',
      },
    }
    const { stdin } = render(
      <InputScopeProvider>
        <UserInputProvider userInput={userInput}>
          <EnterPlanModeToolPresenter message={message} />
        </UserInputProvider>
      </InputScopeProvider>,
    )

    await tick()
    stdin.write('\r')
    await tick()

    expect(submitAnswers).toHaveBeenCalledWith('call_enter_456', { choice: 'enter' })
  })

  it('submits skip on Escape', async () => {
    const submitAnswers = vi.fn<UserInputManager['submitAnswers']>(() => true)
    const userInput = createUserInput(submitAnswers)

    const message = createRunningMessage()
    const { stdin } = render(
      <InputScopeProvider>
        <UserInputProvider userInput={userInput}>
          <EnterPlanModeToolPresenter message={message} />
        </UserInputProvider>
      </InputScopeProvider>,
    )

    await tick()
    stdin.write('\u001B')
    await tick()

    expect(submitAnswers).toHaveBeenCalledTimes(1)
    expect(submitAnswers).toHaveBeenCalledWith('1', { choice: 'skip' })
  })

  it('moves cursor with arrows and submits skip on Enter', async () => {
    const submitAnswers = vi.fn<UserInputManager['submitAnswers']>(() => true)
    const userInput = createUserInput(submitAnswers)

    const message = createRunningMessage()
    const { stdin } = render(
      <InputScopeProvider>
        <UserInputProvider userInput={userInput}>
          <EnterPlanModeToolPresenter message={message} />
        </UserInputProvider>
      </InputScopeProvider>,
    )

    await tick()
    stdin.write('\u001B[B')
    await tick()
    stdin.write('\r')
    await tick()

    expect(submitAnswers).toHaveBeenCalledTimes(1)
    expect(submitAnswers).toHaveBeenCalledWith('1', { choice: 'skip' })
  })

  it('handles upArrow and keeps cursor at first option', async () => {
    const submitAnswers = vi.fn<UserInputManager['submitAnswers']>(() => true)
    const userInput = createUserInput(submitAnswers)

    const message = createRunningMessage()
    const { stdin } = render(
      <InputScopeProvider>
        <UserInputProvider userInput={userInput}>
          <EnterPlanModeToolPresenter message={message} />
        </UserInputProvider>
      </InputScopeProvider>,
    )

    await tick()
    stdin.write('\u001B[A')
    await tick()
    stdin.write('\r')
    await tick()

    expect(submitAnswers).toHaveBeenCalledWith('1', { choice: 'enter' })
  })

  it('selects option 2 and submits skip on Enter', async () => {
    const submitAnswers = vi.fn<UserInputManager['submitAnswers']>(() => true)
    const userInput = createUserInput(submitAnswers)

    const message = createRunningMessage()
    const { stdin } = render(
      <InputScopeProvider>
        <UserInputProvider userInput={userInput}>
          <EnterPlanModeToolPresenter message={message} />
        </UserInputProvider>
      </InputScopeProvider>,
    )

    await tick()
    stdin.write('2')
    await tick()
    stdin.write('\r')
    await tick()

    expect(submitAnswers).toHaveBeenCalledTimes(1)
    expect(submitAnswers).toHaveBeenCalledWith('1', { choice: 'skip' })
  })

  it('only submits once when Enter is pressed multiple times', async () => {
    const submitAnswers = vi.fn<UserInputManager['submitAnswers']>(() => true)
    const userInput = createUserInput(submitAnswers)

    const message = createRunningMessage()
    const { stdin } = render(
      <InputScopeProvider>
        <UserInputProvider userInput={userInput}>
          <EnterPlanModeToolPresenter message={message} />
        </UserInputProvider>
      </InputScopeProvider>,
    )

    await tick()
    stdin.write('\r')
    stdin.write('\r')
    await tick()

    expect(submitAnswers).toHaveBeenCalledTimes(1)
    expect(submitAnswers).toHaveBeenCalledWith('1', { choice: 'enter' })
  })

  it('ignores additional key input after submission', async () => {
    const submitAnswers = vi.fn<UserInputManager['submitAnswers']>(() => true)
    const userInput = createUserInput(submitAnswers)

    const message = createRunningMessage()
    const { stdin } = render(
      <InputScopeProvider>
        <UserInputProvider userInput={userInput}>
          <EnterPlanModeToolPresenter message={message} />
        </UserInputProvider>
      </InputScopeProvider>,
    )

    await tick()
    stdin.write('\r')
    await tick()
    stdin.write('2')
    stdin.write('\u001B')
    await tick()

    expect(submitAnswers).toHaveBeenCalledTimes(1)
  })

  it('returns null when aborted', async () => {
    const message = createErrorMessage('Error: Request aborted')
    const { lastFrame } = render(
      <InputScopeProvider>
        <EnterPlanModeToolPresenter message={message} />
      </InputScopeProvider>,
    )

    await tick()
    expect(lastFrame()).toBe('')
  })

  it('renders entered plan mode when completed', async () => {
    const message = createCompletedMessage('Entered plan mode.\nClaude is now exploring and designing an implementation approach.')
    const { lastFrame } = render(
      <InputScopeProvider>
        <EnterPlanModeToolPresenter message={message} />
      </InputScopeProvider>,
    )

    await tick()
    expect(lastFrame()).toContain('Entered plan mode')
    expect(lastFrame()).toContain('Claude is now exploring')
  })

  it('renders skipped plan mode when completed', async () => {
    const message = createCompletedMessage('User declined plan mode. Continue implementing now.')
    const { lastFrame } = render(
      <InputScopeProvider>
        <EnterPlanModeToolPresenter message={message} />
      </InputScopeProvider>,
    )

    await tick()
    expect(lastFrame()).toContain('Plan mode skipped')
  })

  it('renders skipped summary when result is non-string', async () => {
    const message: Msg = {
      id: 'tool-1',
      role: 'tool',
      content: '',
      timestamp: new Date(),
      toolInfo: { name: 'EnterPlanMode', status: 'completed', input: {}, result: { ok: true } as any },
    }

    const { lastFrame } = render(
      <InputScopeProvider>
        <EnterPlanModeToolPresenter message={message} />
      </InputScopeProvider>,
    )

    await tick()
    expect(lastFrame()).toContain('Plan mode skipped')
  })
})
