import { describe, expect, it } from 'vitest'
import type { AuditEventV1 } from '../core/audit/schema.js'
import { appendHookRunAuditEvents } from './audit.js'
import type { HookRun } from './types.js'

describe('appendHookRunAuditEvents', () => {
  it('records status/parsedJson and gates stdoutPreview behind FORMAX_HOOKS_DEBUG', () => {
    const auditEvents: AuditEventV1[] = []
    const run: HookRun = {
      command: 'echo ok',
      exitCode: 0,
      signal: null,
      stdout: 'OUT\n',
      stderr: '',
      durationMs: 1,
      timedOut: false,
      parsedJson: {},
    }

    appendHookRunAuditEvents({
      audit: { append: async (e) => void auditEvents.push(e) } as any,
      env: { FORMAX_HOOKS_DEBUG: '1' } as any,
      tool: { name: 'Bash', toolUseId: 't1' },
      agentDepth: 0,
      eventName: 'PostToolUse',
      runs: [run],
    })

    expect(auditEvents).toHaveLength(1)
    const ev = auditEvents[0] as any
    expect(ev.kind).toBe('hook.run')
    expect(ev.hook.eventName).toBe('PostToolUse')
    expect(ev.hook.status).toBe('ok')
    expect(ev.hook.parsedJson).toBe(true)
    expect(ev.hook.stdoutPreview).toBe('OUT')
    expect(ev.hook.stderrPreview).toBeUndefined()
  })

  it('does not include stdoutPreview when debug is disabled, and maps non-0 exit codes', () => {
    const auditEvents: AuditEventV1[] = []
    const runs: HookRun[] = [
      {
        command: 'echo deny',
        exitCode: 2,
        signal: null,
        stdout: '',
        stderr: 'blocked\n',
        durationMs: 1,
        timedOut: false,
        parsedJson: null,
      },
      {
        command: 'echo abort',
        exitCode: null,
        signal: null,
        stdout: '',
        stderr: 'aborted',
        durationMs: 1,
        timedOut: false,
        parsedJson: null,
      },
    ]

    appendHookRunAuditEvents({
      audit: { append: async (e) => void auditEvents.push(e) } as any,
      env: {} as any,
      tool: { name: 'Write', toolUseId: 't2' },
      agentDepth: 1,
      eventName: 'PermissionRequest',
      runs,
    })

    expect(auditEvents).toHaveLength(2)
    expect((auditEvents[0] as any).hook.status).toBe('blocked')
    expect((auditEvents[0] as any).hook.stderrPreview).toBe('blocked')
    expect((auditEvents[0] as any).hook.stdoutPreview).toBeUndefined()

    expect((auditEvents[1] as any).hook.status).toBe('aborted')
    expect((auditEvents[1] as any).hook.stdoutPreview).toBeUndefined()
  })
})

