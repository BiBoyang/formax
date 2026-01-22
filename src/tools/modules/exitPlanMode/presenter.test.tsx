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
    cleanup()
  })

  it('submits manual when pressing 2 then Enter', async () => {
    const { filePath, cleanup } = createTempPlanFile('Step 1\n')
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
    cleanup()
  })

  it('submits cancel on Escape', async () => {
    const { filePath, cleanup } = createTempPlanFile('Step 1\n')
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
    cleanup()
  })
})

