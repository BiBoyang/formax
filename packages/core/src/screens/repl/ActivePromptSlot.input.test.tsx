import React from 'react'
import { describe, expect, it } from 'vitest'
import { render } from 'ink-testing-library'
import { InputScopeProvider } from '../../features/repl/inputScopeContext'
import { UserInputProvider } from '../../tools/runtime/userInputContext'
import { createUserInputManager } from '../../tools/runtime/userInputManager'
import type { InteractivePromptDescriptor } from '../../tools/runtime/interactivePromptDescriptor'
import { ActivePromptSlot } from './ActivePromptSlot'

function searchDescriptor(toolUseId: string): InteractivePromptDescriptor {
  return {
    kind: 'approval',
    requestEvent: {
      type: 'approval_request',
      toolUseId,
      toolName: 'Glob',
      action: { kind: 'fs.read', path: '/Users/david' },
      effectiveDecision: 'ask',
    },
    ui: {
      promptVariant: 'fs_read',
      title: 'Approve this Search call?',
      directoryPath: '/Users/david',
    },
  }
}

function tick(ms = 0): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function expectResolved<T>(promise: Promise<T>): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_resolve, reject) => setTimeout(() => reject(new Error('Timed out waiting for prompt answer')), 250)),
  ])
}

describe('ActivePromptSlot keyboard input', () => {
  it('remounts the confirm menu when advancing between queued prompts of the same variant', async () => {
    const userInput = createUserInputManager()
    const first = userInput.requestAnswers({
      toolUseId: 'search-1',
      questions: [],
      descriptor: searchDescriptor('search-1'),
    })
    const second = userInput.requestAnswers({
      toolUseId: 'search-2',
      questions: [],
      descriptor: searchDescriptor('search-2'),
    })

    const view = render(
      <InputScopeProvider>
        <UserInputProvider userInput={userInput}>
          <ActivePromptSlot />
        </UserInputProvider>
      </InputScopeProvider>,
    )

    await tick()
    view.stdin.write('\u001B[B')
    await tick()
    view.stdin.write('\r')
    await expect(expectResolved(first)).resolves.toEqual({ decision: 'approve_remember' })

    await tick()
    expect(view.lastFrame() ?? '').toContain('Approve this Search call?')
    expect(userInput.getActivePrompt?.()?.requestEvent.toolUseId).toBe('search-2')

    view.stdin.write('\u001B[B')
    await tick()
    view.stdin.write('\r')
    await expect(expectResolved(second)).resolves.toEqual({ decision: 'approve_remember' })
    expect(userInput.getActivePrompt?.()).toBeNull()
  })
})
