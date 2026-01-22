import { describe, expect, it, vi } from 'vitest'
import React from 'react'
import { render } from 'ink-testing-library'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { Msg } from '../../../components/tool/ToolMessage'
import { UserInputProvider } from '../../runtime/userInputContext'
import type { UserInputManager } from '../../runtime/userInputManager'
import { InputScopeProvider } from '../../../features/repl/inputScopeContext'
import { PlanProvider } from '../../../features/repl/planContext'
import type { PlanSessionManager } from '../../../features/repl/planSession'
import { ExitPlanModeToolPresenter } from './presenter'

function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
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
      await tick()
      stdin.write('fix this')
      await tick()
      stdin.write('\r')
      await tick()

      expect(submitAnswers).toHaveBeenCalledTimes(1)
      expect(submitAnswers).toHaveBeenCalledWith('1', { choice: 'feedback', feedback: 'fix this' })
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
      await tick()

      expect(lastFrame()).toContain('x')
      expect(submitAnswers).toHaveBeenCalledTimes(0)
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
      await tick()

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
})
