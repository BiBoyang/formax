import { describe, expect, it, vi } from 'vitest'
import { createExitPlanModeToolHandler } from './handler'

function createStubUserInput(overrides: {
  requestAnswers?: (args: any) => Promise<Record<string, string>>
} = {}) {
  return {
    requestAnswers: overrides.requestAnswers ?? (async () => ({})),
    submitAnswers: () => true,
    reject: () => true,
    rejectAllPending: () => 0,
    isPending: () => false,
    clearBufferedAnswers: () => {},
  }
}

describe('ExitPlanMode tool handler', () => {
  it('rejects interactive use from sub-agents', async () => {
    const handler = createExitPlanModeToolHandler(createStubUserInput() as any)

    const res = await handler.execute(
      { id: 't1', name: 'ExitPlanMode', input: {} },
      { cwd: '/tmp', agentDepth: 1, replMode: 'plan' },
    )

    expect(res.is_error).toBe(true)
    expect(res.content).toContain('cannot be used in this context')
  })

  it('returns a no-op message when not in plan mode', async () => {
    const handler = createExitPlanModeToolHandler(createStubUserInput() as any)

    const res = await handler.execute(
      { id: 't1', name: 'ExitPlanMode', input: {} },
      { cwd: '/tmp', agentDepth: 0, replMode: 'normal' },
    )

    expect(res.is_error).toBeUndefined()
    expect(res.content).toBe('Not in plan mode.')
  })

  it('exits plan mode into acceptEdits when user chooses auto', async () => {
    const setReplMode = vi.fn()
    const handler = createExitPlanModeToolHandler(
      createStubUserInput({
        requestAnswers: async () => ({ choice: 'auto' }),
      }) as any,
    )

    const res = await handler.execute(
      { id: 't1', name: 'ExitPlanMode', input: {} },
      { cwd: '/tmp', agentDepth: 0, replMode: 'plan', setReplMode, planPath: '/tmp/plan.md' },
    )

    expect(setReplMode).toHaveBeenCalledWith('acceptEdits')
    expect(res.is_error).toBeUndefined()
    expect(res.content).toContain('User has approved your plan.')
    expect(res.content).toContain('Your plan has been saved to: /tmp/plan.md')
    expect(res.content).toContain('Approved. Exited plan mode with auto-accept edits.')
  })

  it('emits ask_user_question before waiting for answers', async () => {
    const onEvent = vi.fn()
    const handler = createExitPlanModeToolHandler(
      createStubUserInput({
        requestAnswers: async () => ({ choice: 'auto' }),
      }) as any,
    )

    await handler.execute(
      { id: 't1', name: 'ExitPlanMode', input: {} },
      { cwd: '/tmp', agentDepth: 0, replMode: 'plan', onEvent },
    )

    expect(onEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'ask_user_question',
        toolUseId: 't1',
        questions: expect.any(Array),
      }),
    )
  })

  it('accepts web-style label answers for auto/manual options', async () => {
    const setReplModeAuto = vi.fn()
    const autoHandler = createExitPlanModeToolHandler(
      createStubUserInput({
        requestAnswers: async () => ({ choice: 'Yes, and auto-accept edits' }),
      }) as any,
    )
    await autoHandler.execute(
      { id: 't-auto', name: 'ExitPlanMode', input: {} },
      { cwd: '/tmp', agentDepth: 0, replMode: 'plan', setReplMode: setReplModeAuto },
    )
    expect(setReplModeAuto).toHaveBeenCalledWith('acceptEdits')

    const setReplModeManual = vi.fn()
    const manualHandler = createExitPlanModeToolHandler(
      createStubUserInput({
        requestAnswers: async () => ({ choice: 'Yes, and manually approve edits' }),
      }) as any,
    )
    await manualHandler.execute(
      { id: 't-manual', name: 'ExitPlanMode', input: {} },
      { cwd: '/tmp', agentDepth: 0, replMode: 'plan', setReplMode: setReplModeManual },
    )
    expect(setReplModeManual).toHaveBeenCalledWith('normal')
  })

  it('exits plan mode into normal when user chooses manual', async () => {
    const setReplMode = vi.fn()
    const handler = createExitPlanModeToolHandler(
      createStubUserInput({
        requestAnswers: async () => ({ choice: 'manual' }),
      }) as any,
    )

    const res = await handler.execute(
      { id: 't1', name: 'ExitPlanMode', input: {} },
      { cwd: '/tmp', agentDepth: 0, replMode: 'plan', setReplMode, planPath: null },
    )

    expect(setReplMode).toHaveBeenCalledWith('normal')
    expect(res.is_error).toBeUndefined()
    expect(res.content).toContain('User has approved your plan.')
    expect(res.content).toContain('Approved. Exited plan mode with manual edit approvals.')
  })

  it('stays in plan mode and returns feedback when user requests plan changes', async () => {
    const handler = createExitPlanModeToolHandler(
      createStubUserInput({
        requestAnswers: async () => ({ choice: 'feedback', feedback: 'Please add more tests.' }),
      }) as any,
    )

    const res = await handler.execute(
      { id: 't1', name: 'ExitPlanMode', input: {} },
      { cwd: '/tmp', agentDepth: 0, replMode: 'plan' },
    )

    expect(res.is_error).toBeUndefined()
    expect(res.content).toContain('Stay in plan mode')
    expect(res.content).toContain('User feedback: Please add more tests.')
  })

  it('treats free-text web answers as feedback instead of canceling', async () => {
    const handler = createExitPlanModeToolHandler(
      createStubUserInput({
        requestAnswers: async () => ({ choice: 'Please add tests for edge cases.' }),
      }) as any,
    )

    const res = await handler.execute(
      { id: 't1', name: 'ExitPlanMode', input: {} },
      { cwd: '/tmp', agentDepth: 0, replMode: 'plan' },
    )

    expect(res.is_error).toBeUndefined()
    expect(res.content).toContain('Stay in plan mode')
    expect(res.content).toContain('User feedback: Please add tests for edge cases.')
  })

  it('preserves free-text feedback that includes change keywords', async () => {
    const handler = createExitPlanModeToolHandler(
      createStubUserInput({
        requestAnswers: async () => ({ choice: 'Please change the plan to include rollback steps.' }),
      }) as any,
    )

    const res = await handler.execute(
      { id: 't1', name: 'ExitPlanMode', input: {} },
      { cwd: '/tmp', agentDepth: 0, replMode: 'plan' },
    )

    expect(res.is_error).toBeUndefined()
    expect(res.content).toContain('Stay in plan mode')
    expect(res.content).toContain('User feedback: Please change the plan to include rollback steps.')
  })

  it('treats unknown non-empty choices as feedback', async () => {
    const handler = createExitPlanModeToolHandler(
      createStubUserInput({
        requestAnswers: async () => ({ choice: 'wat' }),
      }) as any,
    )

    const res = await handler.execute(
      { id: 't1', name: 'ExitPlanMode', input: {} },
      { cwd: '/tmp', agentDepth: 0, replMode: 'plan' },
    )

    expect(res.is_error).toBeUndefined()
    expect(res.content).toContain('Stay in plan mode')
    expect(res.content).toContain('User feedback: wat')
  })

  it('returns an error result when prompting fails', async () => {
    const handler = createExitPlanModeToolHandler(
      createStubUserInput({
        requestAnswers: async () => {
          throw new Error('boom')
        },
      }) as any,
    )

    const res = await handler.execute(
      { id: 't1', name: 'ExitPlanMode', input: {} },
      { cwd: '/tmp', agentDepth: 0, replMode: 'plan' },
    )

    expect(res.is_error).toBe(true)
    expect(res.content).toContain('Error: boom')
  })
})
