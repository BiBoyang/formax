import { describe, expect, it, vi } from 'vitest'
import React from 'react'
import { render } from 'ink-testing-library'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { Msg } from '../../../shared/toolMessageTypes'
import { UserInputProvider } from '../../runtime/userInputContext'
import type { UserInputManager } from '../../runtime/userInputManager'
import { InputScopeProvider } from '../../../features/repl/inputScopeContext'
import { PlanProvider } from '../../../features/repl/planContext'
import type { PlanSessionManager } from '../../../features/repl/planSession'
import { __testOnlyExitPlanMode, ExitPlanModeToolPresenter } from './presenter'
import * as interactivePrompts from '../../../features/tools/presentation/interactivePrompts'
import * as escapeSequences from '../../../features/repl/keys/escapeSequences.js'
import { InteractivePromptSurfaceProvider } from '../../../components/tool/InteractivePromptSurfaceContext'

function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

async function waitForFrameContains(
  lastFrame: () => string | undefined,
  text: string,
  timeoutMs = 5000,
): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if ((lastFrame() || '').includes(text)) return
    await tick()
  }
  throw new Error(`Timed out waiting for frame to contain: ${text}`)
}

function createRunningExitPlanModeMessage(): Msg {
  return {
    id: 'tool-1',
    role: 'tool',
    content: '',
    timestamp: new Date(),
    toolInfo: { name: 'ExitPlanMode', status: 'running', input: {} },
  }
}

function createTempPlanFile(contents: string): { filePath: string; cleanup: () => void } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'formax-exit-plan-'))
  const filePath = path.join(dir, 'plan.md')
  fs.writeFileSync(filePath, contents)
  return {
    filePath,
    cleanup: () => fs.rmSync(dir, { recursive: true, force: true }),
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

describe('ExitPlanModeToolPresenter', () => {
  it('does not render the interactive prompt when the request is queued', async () => {
    const { filePath, cleanup } = createTempPlanFile('Step 1\n')
    try {
      const userInput = createUserInput(() => true)
      userInput.isPending = () => false
      const planSession: PlanSessionManager = {
        getPlanPath: () => filePath,
        startNewPlan: () => filePath,
      }

      const { lastFrame } = render(
        <InputScopeProvider>
          <PlanProvider planSession={planSession}>
            <UserInputProvider userInput={userInput}>
              <ExitPlanModeToolPresenter message={createRunningExitPlanModeMessage()} />
            </UserInputProvider>
          </PlanProvider>
        </InputScopeProvider>,
      )

      await tick()
      expect(lastFrame()).toContain('ExitPlanMode')
      expect(lastFrame()).not.toContain('Would you like to exit plan mode and start implementation?')
    } finally {
      cleanup()
    }
  })

  it('does not render the inline prompt on the bottom-slot surface', async () => {
    const { filePath, cleanup } = createTempPlanFile('Step 1\n')
    try {
      const userInput = createUserInput(() => true)
      const planSession: PlanSessionManager = {
        getPlanPath: () => filePath,
        startNewPlan: () => filePath,
      }

      const { lastFrame } = render(
        <InputScopeProvider>
          <InteractivePromptSurfaceProvider surface="bottom-slot">
            <PlanProvider planSession={planSession}>
              <UserInputProvider userInput={userInput}>
                <ExitPlanModeToolPresenter message={createRunningExitPlanModeMessage()} />
              </UserInputProvider>
            </PlanProvider>
          </InteractivePromptSurfaceProvider>
        </InputScopeProvider>,
      )

      await tick()
      expect(lastFrame()).toContain('ExitPlanMode')
      expect(lastFrame()).not.toContain('Would you like to exit plan mode and start implementation?')
      expect(lastFrame()).not.toContain('Ready to code?')
    } finally {
      cleanup()
    }
  })

  it('falls back to default prompt labels when no interactive model is resolved', async () => {
    const { filePath, cleanup } = createTempPlanFile('Step 1\n')
    const promptSpy = vi.spyOn(interactivePrompts, 'resolveInteractivePromptModel').mockReturnValue(null)
    try {
      const submitAnswers = vi.fn<UserInputManager['submitAnswers']>(() => true)
      const userInput = createUserInput(submitAnswers)
      const planSession: PlanSessionManager = {
        getPlanPath: () => filePath,
        startNewPlan: () => filePath,
      }

      const { lastFrame } = render(
        <InputScopeProvider>
          <PlanProvider planSession={planSession}>
            <UserInputProvider userInput={userInput}>
              <ExitPlanModeToolPresenter message={createRunningExitPlanModeMessage()} />
            </UserInputProvider>
          </PlanProvider>
        </InputScopeProvider>,
      )

      await tick()
      expect(lastFrame()).toContain('Would you like to exit plan mode and start implementation?')
      expect(lastFrame()).toContain('Yes, and auto-accept edits')
      expect(lastFrame()).toContain('Yes, and manually approve edits')
      expect(lastFrame()).toContain('Type here to tell Claude what to change')
    } finally {
      promptSpy.mockRestore()
      cleanup()
    }
  })

  it('renders fallback presenter when toolInfo is missing', async () => {
    const message: Msg = {
      id: 'tool-1',
      role: 'tool',
      content: 'fallback-content',
      timestamp: new Date(),
    }

    const { lastFrame } = render(
      <InputScopeProvider>
        <ExitPlanModeToolPresenter message={message} />
      </InputScopeProvider>,
    )

    await tick()
    expect(lastFrame().toLowerCase()).toContain('unknown tool')
  })

  it('renders preparing state when running without userInput manager', async () => {
    const { filePath, cleanup } = createTempPlanFile('Step 1\n')
    try {
      const planSession: PlanSessionManager = {
        getPlanPath: () => filePath,
        startNewPlan: () => filePath,
      }

      const { lastFrame } = render(
        <InputScopeProvider>
          <PlanProvider planSession={planSession}>
            <ExitPlanModeToolPresenter message={createRunningExitPlanModeMessage()} />
          </PlanProvider>
        </InputScopeProvider>,
      )

      await tick()
      expect(lastFrame()).toContain('Preparing')
    } finally {
      cleanup()
    }
  })

  it('submits auto when pressing 1 then Enter', async () => {
    const { filePath, cleanup } = createTempPlanFile('Step 1\nStep 2\n')
    try {
      const submitAnswers = vi.fn<UserInputManager['submitAnswers']>(() => true)
      const userInput = createUserInput(submitAnswers)
      const planSession: PlanSessionManager = {
        getPlanPath: () => filePath,
        startNewPlan: () => filePath,
      }

      const message = createRunningExitPlanModeMessage()
      const { stdin, lastFrame } = render(
        <InputScopeProvider>
          <PlanProvider planSession={planSession}>
            <UserInputProvider userInput={userInput}>
              <ExitPlanModeToolPresenter message={message} />
            </UserInputProvider>
          </PlanProvider>
        </InputScopeProvider>,
      )

      await tick()
      expect(lastFrame()).toContain('Ready to code?')
      expect(lastFrame()).toContain("Would you like to proceed?")

      stdin.write('1')
      await tick()
      stdin.write('\r')
      await tick()

      expect(submitAnswers).toHaveBeenCalledTimes(1)
      expect(submitAnswers).toHaveBeenCalledWith('1', { choice: 'auto' })
    } finally {
      cleanup()
    }
  })

  it('submits manual when pressing 2 then Enter', async () => {
    const { filePath, cleanup } = createTempPlanFile('Step 1\n')
    try {
      const submitAnswers = vi.fn<UserInputManager['submitAnswers']>(() => true)
      const userInput = createUserInput(submitAnswers)
      const planSession: PlanSessionManager = {
        getPlanPath: () => filePath,
        startNewPlan: () => filePath,
      }

      const message = createRunningExitPlanModeMessage()
      const { stdin, lastFrame } = render(
        <InputScopeProvider>
          <PlanProvider planSession={planSession}>
            <UserInputProvider userInput={userInput}>
              <ExitPlanModeToolPresenter message={message} />
            </UserInputProvider>
          </PlanProvider>
        </InputScopeProvider>,
      )

      await tick()
      stdin.write('2')
      await tick()
      stdin.write('\r')
      await tick()

      expect(submitAnswers).toHaveBeenCalledTimes(1)
      expect(submitAnswers).toHaveBeenCalledWith('1', { choice: 'manual' })
    } finally {
      cleanup()
    }
  })

  it('submits cancel on Escape', async () => {
    const { filePath, cleanup } = createTempPlanFile('Step 1\n')
    try {
      const submitAnswers = vi.fn<UserInputManager['submitAnswers']>(() => true)
      const userInput = createUserInput(submitAnswers)
      const planSession: PlanSessionManager = {
        getPlanPath: () => filePath,
        startNewPlan: () => filePath,
      }

      const message = createRunningExitPlanModeMessage()
      const { stdin } = render(
        <InputScopeProvider>
          <PlanProvider planSession={planSession}>
            <UserInputProvider userInput={userInput}>
              <ExitPlanModeToolPresenter message={message} />
            </UserInputProvider>
          </PlanProvider>
        </InputScopeProvider>,
      )

      await tick()
      stdin.write('\u001B')
      await tick()

      expect(submitAnswers).toHaveBeenCalledTimes(1)
      expect(submitAnswers).toHaveBeenCalledWith('1', { choice: 'cancel' })
    } finally {
      cleanup()
    }
  })

  it('only calls submitAnswers once even when Enter is pressed multiple times', async () => {
    const { filePath, cleanup } = createTempPlanFile('Step 1\n')
    try {
      const submitAnswers = vi.fn<UserInputManager['submitAnswers']>(() => true)
      const userInput = createUserInput(submitAnswers)
      const planSession: PlanSessionManager = {
        getPlanPath: () => filePath,
        startNewPlan: () => filePath,
      }

      const message = createRunningExitPlanModeMessage()
      const { stdin } = render(
        <InputScopeProvider>
          <PlanProvider planSession={planSession}>
            <UserInputProvider userInput={userInput}>
              <ExitPlanModeToolPresenter message={message} />
            </UserInputProvider>
          </PlanProvider>
        </InputScopeProvider>,
      )

      await tick()
      stdin.write('1')
      await tick()
      stdin.write('\r') // First Enter
      await tick()
      stdin.write('\r') // Second Enter (should be ignored)
      await tick()
      stdin.write('\r') // Third Enter (should be ignored)
      await tick()

      // Verify that submitAnswers was only called once despite multiple Enter presses
      expect(submitAnswers).toHaveBeenCalledTimes(1)
      expect(submitAnswers).toHaveBeenCalledWith('1', { choice: 'auto' })
    } finally {
      cleanup()
    }
  })

  it('submits feedback when selecting 3, typing, then pressing Enter', async () => {
    const { filePath, cleanup } = createTempPlanFile('Step 1\n')
    try {
      const submitAnswers = vi.fn<UserInputManager['submitAnswers']>(() => true)
      const userInput = createUserInput(submitAnswers)
      const planSession: PlanSessionManager = {
        getPlanPath: () => filePath,
        startNewPlan: () => filePath,
      }

      const message = createRunningExitPlanModeMessage()
      const { stdin } = render(
        <InputScopeProvider>
          <PlanProvider planSession={planSession}>
            <UserInputProvider userInput={userInput}>
              <ExitPlanModeToolPresenter message={message} />
            </UserInputProvider>
          </PlanProvider>
        </InputScopeProvider>,
      )

      await tick()
      stdin.write('3')
      for (let i = 0; i < 2; i += 1) await tick()
      stdin.write('fix this')
      for (let i = 0; i < 3; i += 1) await tick()
      stdin.write('\r')
      for (let i = 0; i < 3; i += 1) await tick()

      expect(submitAnswers).toHaveBeenCalledTimes(1)
      expect(submitAnswers).toHaveBeenCalledWith('1', { choice: 'feedback', feedback: 'fix this' })
    } finally {
      cleanup()
    }
  })

  it('pressing Enter on row 3 enters typing mode before submission', async () => {
    const { filePath, cleanup } = createTempPlanFile('Step 1\n')
    try {
      const submitAnswers = vi.fn<UserInputManager['submitAnswers']>(() => true)
      const userInput = createUserInput(submitAnswers)
      const planSession: PlanSessionManager = {
        getPlanPath: () => filePath,
        startNewPlan: () => filePath,
      }

      const { stdin, lastFrame } = render(
        <InputScopeProvider>
          <PlanProvider planSession={planSession}>
            <UserInputProvider userInput={userInput}>
              <ExitPlanModeToolPresenter message={createRunningExitPlanModeMessage()} />
            </UserInputProvider>
          </PlanProvider>
        </InputScopeProvider>,
      )

      await tick()
      stdin.write('3')
      await tick()
      stdin.write('\r')
      await tick()
      expect(submitAnswers).toHaveBeenCalledTimes(0)

      stdin.write('needs tweak')
      await tick()
      stdin.write('\r')
      await tick()
      expect(submitAnswers).toHaveBeenCalledWith('1', { choice: 'feedback', feedback: 'needs tweak' })
    } finally {
      cleanup()
    }
  })

  it('enters typing mode when the third row is selected and the user types', async () => {
    const { filePath, cleanup } = createTempPlanFile('Step 1\n')
    try {
      const submitAnswers = vi.fn<UserInputManager['submitAnswers']>(() => true)
      const userInput = createUserInput(submitAnswers)
      const planSession: PlanSessionManager = {
        getPlanPath: () => filePath,
        startNewPlan: () => filePath,
      }

      const message = createRunningExitPlanModeMessage()
      const { stdin, lastFrame } = render(
        <InputScopeProvider>
          <PlanProvider planSession={planSession}>
            <UserInputProvider userInput={userInput}>
              <ExitPlanModeToolPresenter message={message} />
            </UserInputProvider>
          </PlanProvider>
        </InputScopeProvider>,
      )

      await tick()
      // Move cursor to row 3
      stdin.write('\u001B[B')
      await tick()
      stdin.write('\u001B[B')
      await tick()

      stdin.write('x')
      for (let i = 0; i < 10; i += 1) {
        await tick()
        if (lastFrame().includes('x')) break
      }

      expect(lastFrame()).toContain('x')
      expect(submitAnswers).toHaveBeenCalledTimes(0)
    } finally {
      cleanup()
    }
  })

  it('supports left-arrow cursor editing while typing feedback', async () => {
    const { filePath, cleanup } = createTempPlanFile('Step 1\n')
    try {
      const submitAnswers = vi.fn<UserInputManager['submitAnswers']>(() => true)
      const userInput = createUserInput(submitAnswers)
      const planSession: PlanSessionManager = {
        getPlanPath: () => filePath,
        startNewPlan: () => filePath,
      }

      const message = createRunningExitPlanModeMessage()
      const { stdin } = render(
        <InputScopeProvider>
          <PlanProvider planSession={planSession}>
            <UserInputProvider userInput={userInput}>
              <ExitPlanModeToolPresenter message={message} />
            </UserInputProvider>
          </PlanProvider>
        </InputScopeProvider>,
      )

      await tick()
      stdin.write('3')
      for (let i = 0; i < 2; i += 1) await tick()
      stdin.write('ab')
      for (let i = 0; i < 2; i += 1) await tick()
      stdin.write('\u001B[D')
      for (let i = 0; i < 2; i += 1) await tick()
      stdin.write('X')
      for (let i = 0; i < 2; i += 1) await tick()
      stdin.write('\r')
      for (let i = 0; i < 2; i += 1) await tick()

      expect(submitAnswers).toHaveBeenCalledTimes(1)
      expect(submitAnswers).toHaveBeenCalledWith('1', { choice: 'feedback', feedback: 'aXb' })
    } finally {
      cleanup()
    }
  })

  it('applies backspace semantics while typing feedback', async () => {
    const { filePath, cleanup } = createTempPlanFile('Step 1\n')
    try {
      const submitAnswers = vi.fn<UserInputManager['submitAnswers']>(() => true)
      const userInput = createUserInput(submitAnswers)
      const planSession: PlanSessionManager = {
        getPlanPath: () => filePath,
        startNewPlan: () => filePath,
      }

      const message = createRunningExitPlanModeMessage()
      const { stdin } = render(
        <InputScopeProvider>
          <PlanProvider planSession={planSession}>
            <UserInputProvider userInput={userInput}>
              <ExitPlanModeToolPresenter message={message} />
            </UserInputProvider>
          </PlanProvider>
        </InputScopeProvider>,
      )

      await tick()
      stdin.write('3')
      for (let i = 0; i < 2; i += 1) await tick()
      stdin.write('abc')
      for (let i = 0; i < 2; i += 1) await tick()
      stdin.write('\x7f')
      for (let i = 0; i < 2; i += 1) await tick()
      stdin.write('\r')
      for (let i = 0; i < 2; i += 1) await tick()

      expect(submitAnswers).toHaveBeenCalledTimes(1)
      expect(submitAnswers).toHaveBeenCalledWith('1', { choice: 'feedback', feedback: 'ab' })
    } finally {
      cleanup()
    }
  })

  it('exits typing on up/down arrows and moves the cursor without submitting', async () => {
    const { filePath, cleanup } = createTempPlanFile('Step 1\n')
    try {
      const submitAnswers = vi.fn<UserInputManager['submitAnswers']>(() => true)
      const userInput = createUserInput(submitAnswers)
      const planSession: PlanSessionManager = {
        getPlanPath: () => filePath,
        startNewPlan: () => filePath,
      }

      const message = createRunningExitPlanModeMessage()
      const { stdin, lastFrame } = render(
        <InputScopeProvider>
          <PlanProvider planSession={planSession}>
            <UserInputProvider userInput={userInput}>
              <ExitPlanModeToolPresenter message={message} />
            </UserInputProvider>
          </PlanProvider>
        </InputScopeProvider>,
      )

      await tick()

      // Move to row 3 and start typing.
      stdin.write('\u001B[B')
      stdin.write('\u001B[B')
      await tick()
      stdin.write('x')
      await tick()

      // Exit typing and move up to row 2.
      stdin.write('\u001B[A')
      await waitForFrameContains(lastFrame, '❯ 2. Yes, and manually approve edits')

      expect(submitAnswers).toHaveBeenCalledTimes(0)
      expect(lastFrame()).toContain('❯ 2. Yes, and manually approve edits')
    } finally {
      cleanup()
    }
  })

  it('truncates long plans and shows the remaining-line hint', async () => {
    const lines = Array.from({ length: 82 }, (_, i) => `Line ${i + 1}`).join('\n') + '\n'
    const { filePath, cleanup } = createTempPlanFile(lines)
    try {
      const submitAnswers = vi.fn<UserInputManager['submitAnswers']>(() => true)
      const userInput = createUserInput(submitAnswers)
      const planSession: PlanSessionManager = {
        getPlanPath: () => filePath,
        startNewPlan: () => filePath,
      }

      const message = createRunningExitPlanModeMessage()
      const { lastFrame } = render(
        <InputScopeProvider>
          <PlanProvider planSession={planSession}>
            <UserInputProvider userInput={userInput}>
              <ExitPlanModeToolPresenter message={message} />
            </UserInputProvider>
          </PlanProvider>
        </InputScopeProvider>,
      )

      await tick()
      expect(lastFrame()).toContain('… (2 more lines)')
    } finally {
      cleanup()
    }
  })

  it('renders an approved state with plan path and auto-accept mode label', async () => {
    const { filePath, cleanup } = createTempPlanFile('Do A\nDo B\n')
    try {
      const planSession: PlanSessionManager = {
        getPlanPath: () => filePath,
        startNewPlan: () => filePath,
      }

      const message: Msg = {
        id: 'tool-1',
        role: 'tool',
        content: '',
        timestamp: new Date(),
        toolInfo: {
          name: 'ExitPlanMode',
          status: 'completed',
          input: {},
          result: 'User has approved your plan (auto-accept)',
        },
      }

      const { lastFrame } = render(
        <InputScopeProvider>
          <PlanProvider planSession={planSession}>
            <ExitPlanModeToolPresenter message={message} />
          </PlanProvider>
        </InputScopeProvider>,
      )

      await tick()
      const frame = lastFrame()
      expect(frame).toContain("User approved Claude's plan")
      expect(frame).toContain('Plan saved to:')
      expect(frame).toContain('mode: auto-accept edits')
      expect(frame).toContain('/plan to edit')
      expect(frame).toContain('Do A')
    } finally {
      cleanup()
    }
  })

  it('renders an approved state with manual-approval mode label', async () => {
    const { filePath, cleanup } = createTempPlanFile('Do A\n')
    try {
      const planSession: PlanSessionManager = {
        getPlanPath: () => filePath,
        startNewPlan: () => filePath,
      }

      const message: Msg = {
        id: 'tool-1',
        role: 'tool',
        content: '',
        timestamp: new Date(),
        toolInfo: {
          name: 'ExitPlanMode',
          status: 'completed',
          input: {},
          result: 'User has approved your plan (manual edit)',
        },
      }

      const { lastFrame } = render(
        <InputScopeProvider>
          <PlanProvider planSession={planSession}>
            <ExitPlanModeToolPresenter message={message} />
          </PlanProvider>
        </InputScopeProvider>,
      )

      await tick()
      expect(lastFrame()).toContain('mode: manual approvals')
    } finally {
      cleanup()
    }
  })

  it('renders null when the tool is aborted', async () => {
    const planSession: PlanSessionManager = {
      getPlanPath: () => null,
      startNewPlan: () => '',
    }

    const message: Msg = {
      id: 'tool-1',
      role: 'tool',
      content: '',
      timestamp: new Date(),
      toolInfo: {
        name: 'ExitPlanMode',
        status: 'error',
        input: {},
        result: 'Request aborted',
      },
    }

    const { lastFrame } = render(
      <InputScopeProvider>
        <PlanProvider planSession={planSession}>
          <ExitPlanModeToolPresenter message={message} />
        </PlanProvider>
      </InputScopeProvider>,
    )

    await tick()
    expect(lastFrame().trim()).toBe('')
  })

  it('renders a headline and the first line of an error', async () => {
    const planSession: PlanSessionManager = {
      getPlanPath: () => null,
      startNewPlan: () => '',
    }

    const message: Msg = {
      id: 'tool-1',
      role: 'tool',
      content: '',
      timestamp: new Date(),
      toolInfo: {
        name: 'ExitPlanMode',
        status: 'error',
        input: {},
        result: 'Boom\nSecond line',
      },
    }

    const { lastFrame } = render(
      <InputScopeProvider>
        <PlanProvider planSession={planSession}>
          <ExitPlanModeToolPresenter message={message} />
        </PlanProvider>
      </InputScopeProvider>,
    )

    await tick()
    const frame = lastFrame()
    expect(frame).toContain('ExitPlanMode error')
    expect(frame).toContain('Boom')
    expect(frame).not.toContain('Second line')
  })

  it('shows unknown plan path and truncates approved long plan output', async () => {
    const longPlan = Array.from({ length: 43 }, (_, i) => `task-${i + 1}`).join('\n')
    const planSession: PlanSessionManager = {
      getPlanPath: () => null,
      startNewPlan: () => '',
    }

    const message: Msg = {
      id: 'tool-1',
      role: 'tool',
      content: '',
      timestamp: new Date(),
      toolInfo: {
        name: 'ExitPlanMode',
        status: 'completed',
        input: {},
        result: 'User has approved your plan',
      },
    }

    const { lastFrame } = render(
      <InputScopeProvider>
        <PlanProvider planSession={planSession}>
          <ExitPlanModeToolPresenter message={message} />
        </PlanProvider>
      </InputScopeProvider>,
    )

    await tick()
    expect(lastFrame()).toContain('(unknown plan file)')
    expect(lastFrame()).toContain('(empty plan)')
    expect(lastFrame()).not.toContain('mode:')

    const fileState = createTempPlanFile(longPlan)
    try {
      const longPlanSession: PlanSessionManager = {
        getPlanPath: () => fileState.filePath,
        startNewPlan: () => fileState.filePath,
      }
      const longRender = render(
        <InputScopeProvider>
          <PlanProvider planSession={longPlanSession}>
            <ExitPlanModeToolPresenter message={message} />
          </PlanProvider>
        </InputScopeProvider>,
      )
      await tick()
      expect(longRender.lastFrame()).toContain('… (3 more lines)')
    } finally {
      fileState.cleanup()
    }
  })

  it('handles unreadable plan file in running state', async () => {
    const submitAnswers = vi.fn<UserInputManager['submitAnswers']>(() => true)
    const userInput = createUserInput(submitAnswers)
    const planSession: PlanSessionManager = {
      getPlanPath: () => '/path/that/does/not/exist/plan.md',
      startNewPlan: () => '/path/that/does/not/exist/plan.md',
    }

    const { lastFrame } = render(
      <InputScopeProvider>
        <PlanProvider planSession={planSession}>
          <UserInputProvider userInput={userInput}>
            <ExitPlanModeToolPresenter message={createRunningExitPlanModeMessage()} />
          </UserInputProvider>
        </PlanProvider>
      </InputScopeProvider>,
    )

    await tick()
    expect(lastFrame()).toContain('No plan found. Please write your plan to the plan file first.')
  })

  it('uses unprefixed tool id as-is when submitting answers', async () => {
    const { filePath, cleanup } = createTempPlanFile('Step 1\n')
    try {
      const submitAnswers = vi.fn<UserInputManager['submitAnswers']>(() => true)
      const userInput = createUserInput(submitAnswers)
      const planSession: PlanSessionManager = {
        getPlanPath: () => filePath,
        startNewPlan: () => filePath,
      }

      const message: Msg = {
        ...createRunningExitPlanModeMessage(),
        id: 'plain-id',
      }

      const { stdin } = render(
        <InputScopeProvider>
          <PlanProvider planSession={planSession}>
            <UserInputProvider userInput={userInput}>
              <ExitPlanModeToolPresenter message={message} />
            </UserInputProvider>
          </PlanProvider>
        </InputScopeProvider>,
      )

      await tick()
      stdin.write('\r')
      await tick()
      expect(submitAnswers).toHaveBeenCalledWith('plain-id', { choice: 'auto' })
    } finally {
      cleanup()
    }
  })

  it('prefers explicit toolUseId over canonical message id when submitting', async () => {
    const { filePath, cleanup } = createTempPlanFile('Step 1\n')
    try {
      const submitAnswers = vi.fn<UserInputManager['submitAnswers']>(() => true)
      const userInput = createUserInput(submitAnswers)
      const planSession: PlanSessionManager = {
        getPlanPath: () => filePath,
        startNewPlan: () => filePath,
      }

      const message: Msg = {
        ...createRunningExitPlanModeMessage(),
        id: 'turn-1:tool:3:call_exit_123',
        toolInfo: {
          ...createRunningExitPlanModeMessage().toolInfo!,
          toolUseId: 'call_exit_123',
        },
      }

      const { stdin } = render(
        <InputScopeProvider>
          <PlanProvider planSession={planSession}>
            <UserInputProvider userInput={userInput}>
              <ExitPlanModeToolPresenter message={message} />
            </UserInputProvider>
          </PlanProvider>
        </InputScopeProvider>,
      )

      await tick()
      stdin.write('\r')
      await tick()
      expect(submitAnswers).toHaveBeenCalledWith('call_exit_123', { choice: 'auto' })
    } finally {
      cleanup()
    }
  })

  it('renders completed non-error state without first line when result/content are empty', async () => {
    const message: Msg = {
      id: 'tool-1',
      role: 'tool',
      content: '',
      timestamp: new Date(),
      toolInfo: {
        name: 'ExitPlanMode',
        status: 'completed',
        input: {},
        result: 42 as unknown as string,
      },
    }

    const { lastFrame } = render(
      <InputScopeProvider>
        <ExitPlanModeToolPresenter message={message} />
      </InputScopeProvider>,
    )

    await tick()
    const frame = lastFrame()
    expect(frame).toContain('ExitPlanMode')
    expect(frame).not.toContain('Boom')
  })

  it('handles chunked escape sequences for arrow and delete while typing', async () => {
    const { filePath, cleanup } = createTempPlanFile('Step 1\n')
    try {
      const submitAnswers = vi.fn<UserInputManager['submitAnswers']>(() => true)
      const userInput = createUserInput(submitAnswers)
      const planSession: PlanSessionManager = {
        getPlanPath: () => filePath,
        startNewPlan: () => filePath,
      }

      const { stdin, lastFrame } = render(
        <InputScopeProvider>
          <PlanProvider planSession={planSession}>
            <UserInputProvider userInput={userInput}>
              <ExitPlanModeToolPresenter message={createRunningExitPlanModeMessage()} />
            </UserInputProvider>
          </PlanProvider>
        </InputScopeProvider>,
      )

      await tick()
      stdin.write('3')
      await tick()
      stdin.write('abc')
      await tick()

      // Send Delete as split ESC sequence: ESC [ 3 ~
      stdin.write('\u001B')
      await tick()
      stdin.write('[')
      await tick()
      stdin.write('3')
      await tick()
      stdin.write('~')
      await tick()

      // Chunked Down arrow should exit typing and move cursor.
      stdin.write('\u001B')
      await tick()
      stdin.write('[')
      await tick()
      stdin.write('B')
      await tick()

      // The split arrow sequence should not break the prompt state; normalize selection to
      // "feedback" before submit so this assertion is stable under parallel test load.
      expect(lastFrame()).toContain('3.')
      stdin.write('3')
      await tick()
      stdin.write('\r')
      await tick()
      expect(submitAnswers).toHaveBeenCalledTimes(1)
      const firstPayload = submitAnswers.mock.calls[0]?.[1] as Record<string, string>
      expect(firstPayload.choice).toBe('feedback')
      expect(typeof firstPayload.feedback).toBe('string')
    } finally {
      cleanup()
    }
  })

  it('leaves typing mode on escape and does not submit', async () => {
    const { filePath, cleanup } = createTempPlanFile('Step 1\n')
    try {
      const submitAnswers = vi.fn<UserInputManager['submitAnswers']>(() => true)
      const userInput = createUserInput(submitAnswers)
      const planSession: PlanSessionManager = {
        getPlanPath: () => filePath,
        startNewPlan: () => filePath,
      }

      const { stdin, lastFrame } = render(
        <InputScopeProvider>
          <PlanProvider planSession={planSession}>
            <UserInputProvider userInput={userInput}>
              <ExitPlanModeToolPresenter message={createRunningExitPlanModeMessage()} />
            </UserInputProvider>
          </PlanProvider>
        </InputScopeProvider>,
      )

      await tick()
      stdin.write('3')
      await tick()
      stdin.write('draft')
      await tick()
      stdin.write('3')
      await tick()
      stdin.write('x')
      await tick()
      stdin.write('\u001B')
      await tick()

      expect(submitAnswers).toHaveBeenCalledTimes(0)
      expect(lastFrame()).toContain('3. draft')
    } finally {
      cleanup()
    }
  })

  it('keeps feedback unchanged when forward delete is pressed at end of input', () => {
    const state = { value: 'ab', cursor: 2 }
    expect(__testOnlyExitPlanMode.applyForwardDelete(state, 1)).toEqual(state)
  })

  it('keeps feedback unchanged when backspace is pressed at cursor start', async () => {
    const { filePath, cleanup } = createTempPlanFile('Step 1\n')
    try {
      const submitAnswers = vi.fn<UserInputManager['submitAnswers']>(() => true)
      const userInput = createUserInput(submitAnswers)
      const planSession: PlanSessionManager = {
        getPlanPath: () => filePath,
        startNewPlan: () => filePath,
      }

      const { stdin } = render(
        <InputScopeProvider>
          <PlanProvider planSession={planSession}>
            <UserInputProvider userInput={userInput}>
              <ExitPlanModeToolPresenter message={createRunningExitPlanModeMessage()} />
            </UserInputProvider>
          </PlanProvider>
        </InputScopeProvider>,
      )

      await tick()
      stdin.write('3')
      await tick()
      stdin.write('ab')
      await tick()
      stdin.write('\u001B[D')
      await tick()
      stdin.write('\u001B[D')
      await tick()
      stdin.write('\x7f')
      await tick()
      stdin.write('\r')
      await tick()

      expect(submitAnswers).toHaveBeenCalledWith('1', { choice: 'feedback', feedback: 'ab' })
    } finally {
      cleanup()
    }
  })

  it('ignores pending split escape chunks from buffer helpers', async () => {
    const { filePath, cleanup } = createTempPlanFile('Step 1\n')
    let horizSpy: ReturnType<typeof vi.spyOn> | null = null
    try {
      const submitAnswers = vi.fn<UserInputManager['submitAnswers']>(() => true)
      const userInput = createUserInput(submitAnswers)
      const planSession: PlanSessionManager = {
        getPlanPath: () => filePath,
        startNewPlan: () => filePath,
      }

      const { stdin } = render(
        <InputScopeProvider>
          <PlanProvider planSession={planSession}>
            <UserInputProvider userInput={userInput}>
              <ExitPlanModeToolPresenter message={createRunningExitPlanModeMessage()} />
            </UserInputProvider>
          </PlanProvider>
        </InputScopeProvider>,
      )

      await tick()
      stdin.write('3')
      await tick()
      stdin.write('x')
      await tick()
      horizSpy = vi.spyOn(escapeSequences, 'consumeBufferedHorizontal').mockReturnValue({
        pending: true,
        delta: 0,
        deletes: 0,
        nextBuffer: '\u001B[',
      })
      stdin.write('\u001B')
      await tick()

      expect(submitAnswers).toHaveBeenCalledTimes(0)
    } finally {
      horizSpy?.mockRestore()
      cleanup()
    }
  })
})
