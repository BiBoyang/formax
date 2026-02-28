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
  it('matches only ExitPlanMode tool name', async () => {
    const handler = createExitPlanModeToolHandler(createStubUserInput() as any)
    expect(handler.canHandle('ExitPlanMode')).toBe(true)
    expect(handler.canHandle('EnterPlanMode')).toBe(false)
  })

  it('rejects interactive use from sub-agents', async () => {
    const handler = createExitPlanModeToolHandler(createStubUserInput() as any)

    const res = await handler.execute(
      { id: 't1', name: 'ExitPlanMode', input: {} },
      { cwd: '/tmp', agentDepth: 1, replMode: 'plan' },
    )

    expect(res.is_error).toBe(true)
    expect(res.content).toContain('cannot be used in this context')
  })

  it('treats missing agentDepth as 0', async () => {
    const handler = createExitPlanModeToolHandler(
      createStubUserInput({
        requestAnswers: async () => ({ choice: 'cancel' }),
      }) as any,
    )

    const res = await handler.execute(
      { id: 't-depth-missing', name: 'ExitPlanMode', input: {} },
      { cwd: '/tmp', replMode: 'plan', agentDepth: undefined as any },
    )

    expect(res.is_error).toBeUndefined()
    expect(res.content).toContain('Exit plan mode cancelled')
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

  it('stays in plan mode for feedback choice without feedback text', async () => {
    const handler = createExitPlanModeToolHandler(
      createStubUserInput({
        requestAnswers: async () => ({ choice: 'feedback' }),
      }) as any,
    )

    const res = await handler.execute(
      { id: 't-feedback-empty', name: 'ExitPlanMode', input: {} },
      { cwd: '/tmp', agentDepth: 0, replMode: 'plan' },
    )

    expect(res.is_error).toBeUndefined()
    expect(res.content).toContain('Stay in plan mode')
    expect(res.content).not.toContain('User feedback:')
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

  it('returns an error result when prompting throws non-Error', async () => {
    const handler = createExitPlanModeToolHandler(
      createStubUserInput({
        requestAnswers: async () => {
          throw 'boom'
        },
      }) as any,
    )

    const res = await handler.execute(
      { id: 't-err-non-error', name: 'ExitPlanMode', input: {} },
      { cwd: '/tmp', agentDepth: 0, replMode: 'plan' },
    )

    expect(res.is_error).toBe(true)
    expect(res.content).toContain('Error: boom')
  })

  it('cancels when only non-keyword feedback is provided', async () => {
    const handler = createExitPlanModeToolHandler(
      createStubUserInput({
        requestAnswers: async () => ({ feedback: 'just notes without trigger words' }),
      }) as any,
    )

    const res = await handler.execute(
      { id: 't-cancel', name: 'ExitPlanMode', input: {} },
      { cwd: '/tmp', agentDepth: 0, replMode: 'plan' },
    )

    expect(res.is_error).toBeUndefined()
    expect(res.content).toContain('Exit plan mode cancelled. Stay in plan mode.')
  })

  it('cancels when answers are empty', async () => {
    const handler = createExitPlanModeToolHandler(
      createStubUserInput({
        requestAnswers: async () => ({}),
      }) as any,
    )

    const res = await handler.execute(
      { id: 't-empty-answers', name: 'ExitPlanMode', input: {} },
      { cwd: '/tmp', agentDepth: 0, replMode: 'plan' },
    )

    expect(res.is_error).toBeUndefined()
    expect(res.content).toContain('Exit plan mode cancelled. Stay in plan mode.')
  })

  it('cancels when merged text includes cancel', async () => {
    const handler = createExitPlanModeToolHandler(
      createStubUserInput({
        requestAnswers: async () => ({ note: 'cancel please' }),
      }) as any,
    )

    const res = await handler.execute(
      { id: 't-cancel-merged', name: 'ExitPlanMode', input: {} },
      { cwd: '/tmp', agentDepth: 0, replMode: 'plan' },
    )

    expect(res.is_error).toBeUndefined()
    expect(res.content).toContain('Exit plan mode cancelled. Stay in plan mode.')
  })

  it('uses feedback field when choice is feedback option label', async () => {
    const handler = createExitPlanModeToolHandler(
      createStubUserInput({
        requestAnswers: async () => ({
          choice: 'Type here to tell Claude what to change',
          feedback: 'Please add rollback steps.',
        }),
      }) as any,
    )

    const res = await handler.execute(
      { id: 't-feedback-label', name: 'ExitPlanMode', input: {} },
      { cwd: '/tmp', agentDepth: 0, replMode: 'plan' },
    )

    expect(res.is_error).toBeUndefined()
    expect(res.content).toContain('User feedback: Please add rollback steps.')
  })
})
