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
    warnings: [],
  }
}

describe('HooksRuntime', () => {
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
})

