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
  eventName: keyof Pick<MergedHooks, 'PreToolUse' | 'PermissionRequest' | 'PostToolUse' | 'UserPromptSubmit'>
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
})
