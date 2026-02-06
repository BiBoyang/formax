import { describe, expect, it, vi } from 'vitest'

import type { ToolResult } from '../tools/types.js'
import type { HookRun, MergedHooks } from './types.js'

vi.mock('./store.js', () => ({
  loadMergedHooks: vi.fn(),
}))

vi.mock('./runner.js', async () => {
  const actual = await vi.importActual<typeof import('./runner.js')>('./runner.js')
  return { ...actual, runCommandHooks: vi.fn() }
})

import { createHooksRuntime } from './runtime.js'
import { runCommandHooks } from './runner.js'
import { loadMergedHooks } from './store.js'

function mergedHooksWithCommand(args: {
  eventName: keyof Pick<
    MergedHooks,
    'PreToolUse' | 'PermissionRequest' | 'PostToolUse' | 'UserPromptSubmit' | 'SessionStart' | 'Stop'
  >
  matcher?: string
  command?: string
}): MergedHooks {
  const entry = {
    source: 'projectLocal' as const,
    matcher: args.matcher ?? 'Bash',
    command: args.command ?? 'echo hook',
    timeoutMs: null,
  }

  return {
    PreToolUse: args.eventName === 'PreToolUse' ? [entry] : [],
    PermissionRequest: args.eventName === 'PermissionRequest' ? [entry] : [],
    PostToolUse: args.eventName === 'PostToolUse' ? [entry] : [],
    UserPromptSubmit: args.eventName === 'UserPromptSubmit' ? [entry] : [],
    SessionStart: args.eventName === 'SessionStart' ? [entry] : [],
    Stop: args.eventName === 'Stop' ? [entry] : [],
    warnings: [],
  }
}

function mergedHooksWithPostToolUseCommand(command = 'echo hook'): MergedHooks {
  return {
    PreToolUse: [],
    PermissionRequest: [],
    PostToolUse: [
      {
        source: 'projectLocal',
        matcher: 'Bash',
        command,
        timeoutMs: null,
      },
    ],
    UserPromptSubmit: [],
    SessionStart: [],
    Stop: [],
    warnings: [],
  }
}

describe('HooksRuntime', () => {
  it('treats exitCode=2 as blocked for PreToolUse', async () => {
    ;(loadMergedHooks as any).mockResolvedValue(mergedHooksWithCommand({ eventName: 'PreToolUse' }))

    const runs: HookRun[] = [
      {
        command: 'echo deny',
        exitCode: 2,
        signal: null,
        stdout: '',
        stderr: 'blocked',
        durationMs: 1,
        timedOut: false,
        parsedJson: null,
      },
    ]
    ;(runCommandHooks as any).mockResolvedValue(runs)

    const runtime = createHooksRuntime({ fileStore: {} as any })
    const res = await runtime.runPreToolUse({ toolName: 'Bash', toolInput: { command: 'echo hi' }, cwd: '/tmp' })

    expect(res.blocked).toBe(true)
    expect(res.blockedBy?.exitCode).toBe(2)
    expect(res.blockedBy?.stderr).toContain('blocked')
  })

  it('treats exitCode=2 as blocked for PermissionRequest', async () => {
    ;(loadMergedHooks as any).mockResolvedValue(mergedHooksWithCommand({ eventName: 'PermissionRequest' }))

    const runs: HookRun[] = [
      {
        command: 'echo deny',
        exitCode: 2,
        signal: null,
        stdout: '',
        stderr: 'blocked',
        durationMs: 1,
        timedOut: false,
        parsedJson: null,
      },
    ]
    ;(runCommandHooks as any).mockResolvedValue(runs)

    const runtime = createHooksRuntime({ fileStore: {} as any })
    const res = await runtime.runPermissionRequest({
      toolName: 'Bash',
      toolInput: { command: 'echo hi' },
      cwd: '/tmp',
    })

    expect(res.blocked).toBe(true)
    expect(res.blockedBy?.exitCode).toBe(2)
    expect(res.blockedBy?.stderr).toContain('blocked')
  })

  it('does not block when a hook fails with non-0/2 exitCode', async () => {
    ;(loadMergedHooks as any).mockResolvedValue(mergedHooksWithCommand({ eventName: 'PreToolUse' }))

    const runs: HookRun[] = [
      {
        command: 'echo fail',
        exitCode: 1,
        signal: null,
        stdout: '',
        stderr: 'oops',
        durationMs: 1,
        timedOut: false,
        parsedJson: null,
      },
    ]
    ;(runCommandHooks as any).mockResolvedValue(runs)

    const runtime = createHooksRuntime({ fileStore: {} as any })
    const res = await runtime.runPreToolUse({ toolName: 'Bash', toolInput: { command: 'echo hi' }, cwd: '/tmp' })

    expect(res.blocked).toBe(false)
    expect(res.blockedBy).toBeUndefined()
    expect(res.runs).toHaveLength(1)
    expect(res.runs[0].exitCode).toBe(1)
  })

  it('extracts PostToolUse.additionalContext from camelCase stdout JSON', async () => {
    ;(loadMergedHooks as any).mockResolvedValue(mergedHooksWithPostToolUseCommand())

    const runs: HookRun[] = [
      {
        command: 'echo hook',
        exitCode: 0,
        signal: null,
        stdout: '{"hookSpecificOutput":{"hookEventName":"PostToolUse","additionalContext":"CTX_CAMEL"}}',
        stderr: '',
        durationMs: 1,
        timedOut: false,
        parsedJson: { hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: 'CTX_CAMEL' } },
      },
    ]

    ;(runCommandHooks as any).mockResolvedValue(runs)

    const runtime = createHooksRuntime({ fileStore: {} as any })

    const toolResult: ToolResult = { tool_use_id: 't1', content: 'ok' }
    const res = await runtime.runPostToolUse({
      toolUseId: 't1',
      toolName: 'Bash',
      toolInput: { command: 'echo ok' },
      toolResult,
      cwd: '/tmp',
    })

    expect(res.additionalContext).toEqual(['CTX_CAMEL'])
  })

  it('extracts PostToolUse.additionalContext from snake_case stdout JSON', async () => {
    ;(loadMergedHooks as any).mockResolvedValue(mergedHooksWithPostToolUseCommand())

    const runs: HookRun[] = [
      {
        command: 'echo hook',
        exitCode: 0,
        signal: null,
        stdout: '{"hook_specific_output":{"hook_event_name":"PostToolUse","additional_context":"CTX_SNAKE"}}',
        stderr: '',
        durationMs: 1,
        timedOut: false,
        parsedJson: { hook_specific_output: { hook_event_name: 'PostToolUse', additional_context: 'CTX_SNAKE' } },
      },
    ]

    ;(runCommandHooks as any).mockResolvedValue(runs)

    const runtime = createHooksRuntime({ fileStore: {} as any })

    const toolResult: ToolResult = { tool_use_id: 't1', content: 'ok' }
    const res = await runtime.runPostToolUse({
      toolUseId: 't1',
      toolName: 'Bash',
      toolInput: { command: 'echo ok' },
      toolResult,
      cwd: '/tmp',
    })

    expect(res.additionalContext).toEqual(['CTX_SNAKE'])
  })

  it('does not treat non-0/2 PostToolUse failures as blocking', async () => {
    ;(loadMergedHooks as any).mockResolvedValue(mergedHooksWithPostToolUseCommand())

    const runs: HookRun[] = [
      {
        command: 'echo fail',
        exitCode: 1,
        signal: null,
        stdout: '',
        stderr: 'oops',
        durationMs: 1,
        timedOut: false,
        parsedJson: null,
      },
    ]
    ;(runCommandHooks as any).mockResolvedValue(runs)

    const runtime = createHooksRuntime({ fileStore: {} as any })

    const toolResult: ToolResult = { tool_use_id: 't1', content: 'ok' }
    const res = await runtime.runPostToolUse({
      toolUseId: 't1',
      toolName: 'Bash',
      toolInput: { command: 'echo ok' },
      toolResult,
      cwd: '/tmp',
    })

    expect(res.additionalContext).toEqual([])
    expect(res.blockingErrors).toEqual([])
    expect(res.runs).toHaveLength(1)
    expect(res.runs[0].exitCode).toBe(1)
  })

  it('injects stdout as additionalContext for UserPromptSubmit (when stdout is not JSON)', async () => {
    ;(loadMergedHooks as any).mockResolvedValue(mergedHooksWithCommand({ eventName: 'UserPromptSubmit', matcher: '*' }))

    const runs: HookRun[] = [
      {
        command: 'echo ok',
        exitCode: 0,
        signal: null,
        stdout: 'CTX_STDOUT\n',
        stderr: '',
        durationMs: 1,
        timedOut: false,
        parsedJson: null,
      },
    ]
    ;(runCommandHooks as any).mockResolvedValue(runs)

    const runtime = createHooksRuntime({ fileStore: {} as any })
    const res = await runtime.runUserPromptSubmit({ prompt: 'hi', cwd: '/tmp' })

    expect(res.additionalContext).toEqual(['CTX_STDOUT'])
    expect(res.blocked).toBe(false)
  })

  it('extracts UserPromptSubmit.additionalContext from stdout JSON', async () => {
    ;(loadMergedHooks as any).mockResolvedValue(mergedHooksWithCommand({ eventName: 'UserPromptSubmit', matcher: '*' }))

    const runs: HookRun[] = [
      {
        command: 'echo ok',
        exitCode: 0,
        signal: null,
        stdout: '{"hookSpecificOutput":{"hookEventName":"UserPromptSubmit","additionalContext":"CTX_JSON"}}',
        stderr: '',
        durationMs: 1,
        timedOut: false,
        parsedJson: { hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: 'CTX_JSON' } },
      },
    ]
    ;(runCommandHooks as any).mockResolvedValue(runs)

    const runtime = createHooksRuntime({ fileStore: {} as any })
    const res = await runtime.runUserPromptSubmit({ prompt: 'hi', cwd: '/tmp' })

    expect(res.additionalContext).toEqual(['CTX_JSON'])
    expect(res.blocked).toBe(false)
  })

  it('injects stdout as additionalContext for SessionStart (when stdout is not JSON)', async () => {
    ;(loadMergedHooks as any).mockResolvedValue(mergedHooksWithCommand({ eventName: 'SessionStart', matcher: '*' }))

    const runs: HookRun[] = [
      {
        command: 'echo ok',
        exitCode: 0,
        signal: null,
        stdout: 'CTX_SESSION\n',
        stderr: '',
        durationMs: 1,
        timedOut: false,
        parsedJson: null,
      },
    ]
    ;(runCommandHooks as any).mockResolvedValue(runs)

    const runtime = createHooksRuntime({ fileStore: {} as any })
    const res = await runtime.runSessionStart({ sessionId: 's1', cwd: '/tmp' })

    expect(res.additionalContext).toEqual(['CTX_SESSION'])
    expect(res.blocked).toBe(false)
  })

  it('extracts SessionStart.additionalContext from stdout JSON', async () => {
    ;(loadMergedHooks as any).mockResolvedValue(mergedHooksWithCommand({ eventName: 'SessionStart', matcher: '*' }))

    const runs: HookRun[] = [
      {
        command: 'echo ok',
        exitCode: 0,
        signal: null,
        stdout: '{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"CTX_JSON"}}',
        stderr: '',
        durationMs: 1,
        timedOut: false,
        parsedJson: { hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: 'CTX_JSON' } },
      },
    ]
    ;(runCommandHooks as any).mockResolvedValue(runs)

    const runtime = createHooksRuntime({ fileStore: {} as any })
    const res = await runtime.runSessionStart({ sessionId: 's1', cwd: '/tmp' })

    expect(res.additionalContext).toEqual(['CTX_JSON'])
    expect(res.blocked).toBe(false)
  })

  it('does not block SessionStart on exitCode=2', async () => {
    ;(loadMergedHooks as any).mockResolvedValue(mergedHooksWithCommand({ eventName: 'SessionStart', matcher: '*' }))

    const runs: HookRun[] = [
      {
        command: 'echo deny',
        exitCode: 2,
        signal: null,
        stdout: '',
        stderr: 'not applicable',
        durationMs: 1,
        timedOut: false,
        parsedJson: null,
      },
    ]
    ;(runCommandHooks as any).mockResolvedValue(runs)

    const runtime = createHooksRuntime({ fileStore: {} as any })
    const res = await runtime.runSessionStart({ sessionId: 's1', cwd: '/tmp' })

    expect(res.blocked).toBe(false)
    expect(res.additionalContext).toEqual([])
    expect(res.runs).toHaveLength(1)
    expect(res.runs[0].exitCode).toBe(2)
  })

  it('filters SessionStart hooks by source matcher', async () => {
    ;(loadMergedHooks as any).mockResolvedValue({
      PreToolUse: [],
      PermissionRequest: [],
      PostToolUse: [],
      UserPromptSubmit: [],
      SessionStart: [
        { source: 'projectLocal', matcher: 'clear', command: 'echo clear-only', timeoutMs: null },
        { source: 'projectLocal', matcher: '*', command: 'echo always', timeoutMs: null },
      ],
      Stop: [],
      warnings: [],
    } satisfies MergedHooks)

    ;(runCommandHooks as any).mockResolvedValue([])

    const runtime = createHooksRuntime({ fileStore: {} as any })
    await runtime.runSessionStart({ sessionId: 's1', source: 'resume', cwd: '/tmp' })

    expect(runCommandHooks).toHaveBeenCalled()
    const call = (runCommandHooks as any).mock.calls.at(-1)[0]
    expect(call.hooks.map((hook: { command: string }) => hook.command)).toEqual(['echo always'])
    expect(call.payload.source).toBe('resume')
  })

  it('injects stdout as additionalContext for Stop (when stdout is not JSON)', async () => {
    ;(loadMergedHooks as any).mockResolvedValue(mergedHooksWithCommand({ eventName: 'Stop', matcher: '*' }))

    const runs: HookRun[] = [
      {
        command: 'echo ok',
        exitCode: 0,
        signal: null,
        stdout: 'CTX_STOP\n',
        stderr: '',
        durationMs: 1,
        timedOut: false,
        parsedJson: null,
      },
    ]
    ;(runCommandHooks as any).mockResolvedValue(runs)

    const runtime = createHooksRuntime({ fileStore: {} as any })
    const res = await runtime.runStop({ sessionId: 's1', cwd: '/tmp', stopHookActive: false })

    expect(res.additionalContext).toEqual(['CTX_STOP'])
    expect(res.blocked).toBe(false)
  })

  it('extracts Stop.additionalContext from stdout JSON', async () => {
    ;(loadMergedHooks as any).mockResolvedValue(mergedHooksWithCommand({ eventName: 'Stop', matcher: '*' }))

    const runs: HookRun[] = [
      {
        command: 'echo ok',
        exitCode: 0,
        signal: null,
        stdout: '{"hookSpecificOutput":{"hookEventName":"Stop","additionalContext":"CTX_JSON"}}',
        stderr: '',
        durationMs: 1,
        timedOut: false,
        parsedJson: { hookSpecificOutput: { hookEventName: 'Stop', additionalContext: 'CTX_JSON' } },
      },
    ]
    ;(runCommandHooks as any).mockResolvedValue(runs)

    const runtime = createHooksRuntime({ fileStore: {} as any })
    const res = await runtime.runStop({ sessionId: 's1', cwd: '/tmp', stopHookActive: false })

    expect(res.additionalContext).toEqual(['CTX_JSON'])
    expect(res.blocked).toBe(false)
  })

  it('does not block Stop on exitCode=2', async () => {
    ;(loadMergedHooks as any).mockResolvedValue(mergedHooksWithCommand({ eventName: 'Stop', matcher: '*' }))

    const runs: HookRun[] = [
      {
        command: 'echo deny',
        exitCode: 2,
        signal: null,
        stdout: '',
        stderr: 'not applicable',
        durationMs: 1,
        timedOut: false,
        parsedJson: null,
      },
    ]
    ;(runCommandHooks as any).mockResolvedValue(runs)

    const runtime = createHooksRuntime({ fileStore: {} as any })
    const res = await runtime.runStop({ sessionId: 's1', cwd: '/tmp', stopHookActive: false })

    expect(res.blocked).toBe(false)
    expect(res.additionalContext).toEqual([])
    expect(res.runs).toHaveLength(1)
    expect(res.runs[0].exitCode).toBe(2)
  })
})
