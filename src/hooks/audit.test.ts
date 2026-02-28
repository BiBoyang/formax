import { describe, expect, it } from 'vitest'
import type { AuditEventV1 } from '../core/audit/schema.js'
import { appendHookRunAuditEvents } from './audit.js'
import type { HookRun } from './types.js'

describe('appendHookRunAuditEvents', () => {
  it('returns early when audit is missing or runs are empty', () => {
    const auditEvents: AuditEventV1[] = []
    appendHookRunAuditEvents({
      audit: null,
      tool: { name: 'Bash', toolUseId: 't0' },
      agentDepth: 0,
      eventName: 'PreToolUse',
      runs: [],
    })
    appendHookRunAuditEvents({
      audit: { append: async (e) => void auditEvents.push(e) } as any,
      tool: { name: 'Bash', toolUseId: 't0' },
      agentDepth: 0,
      eventName: 'PreToolUse',
      runs: [],
    })
    expect(auditEvents).toHaveLength(0)
  })

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
      {
        command: 'echo fail',
        exitCode: 1,
        signal: null,
        stdout: '',
        stderr: 'failed',
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

    expect(auditEvents).toHaveLength(3)
    expect((auditEvents[0] as any).hook.status).toBe('blocked')
    expect((auditEvents[0] as any).hook.stderrPreview).toBe('blocked')
    expect((auditEvents[0] as any).hook.stdoutPreview).toBeUndefined()

    expect((auditEvents[1] as any).hook.status).toBe('aborted')
    expect((auditEvents[1] as any).hook.stdoutPreview).toBeUndefined()
    expect((auditEvents[2] as any).hook.status).toBe('failed')
  })

  it('supports trace and optional hook fields, and trims preview by limit', () => {
    const auditEvents: AuditEventV1[] = []
    const run: HookRun = {
      source: 'project',
      matcher: '*',
      timeoutMs: null,
      command: 'echo long',
      exitCode: 1,
      signal: null,
      stdout: '123456',
      stderr: 'abcdef',
      stdoutTruncated: true,
      stderrTruncated: false,
      durationMs: 5,
      timedOut: false,
      parsedJson: null,
    }

    appendHookRunAuditEvents({
      audit: { append: async (e) => void auditEvents.push(e) } as any,
      tool: { name: 'Read', toolUseId: 't3' },
      agentDepth: 2,
      eventName: 'PostToolUse',
      runs: [run],
      trace: { turnId: 'turn-1' } as any,
      hooksDebugEnabled: true,
      previewLimit: 3,
    })

    const ev = auditEvents[0] as any
    expect(ev.trace.turnId).toBe('turn-1')
    expect(ev.hook.source).toBe('project')
    expect(ev.hook.matcher).toBe('*')
    expect(ev.hook.timeoutMs).toBeNull()
    expect(ev.hook.stdoutPreview).toBe('456')
    expect(ev.hook.stderrPreview).toBe('def')
    expect(ev.hook.stdoutTruncated).toBe(true)
    expect(ev.hook.stderrTruncated).toBe(false)
  })

  it('does not mark null-exit run as aborted when stderr is empty/undefined', () => {
    const auditEvents: AuditEventV1[] = []
    const run: HookRun = {
      command: 'echo maybe-abort',
      exitCode: null,
      signal: null,
      stdout: '',
      stderr: undefined as unknown as string,
      durationMs: 1,
      timedOut: false,
      parsedJson: null,
    }

    appendHookRunAuditEvents({
      audit: { append: async (e) => void auditEvents.push(e) } as any,
      hooksDebugEnabled: true,
      tool: { name: 'Write', toolUseId: 't4' },
      agentDepth: 0,
      eventName: 'PermissionRequest',
      runs: [run],
    })

    expect((auditEvents[0] as any).hook.status).toBe('failed')
    expect((auditEvents[0] as any).hook.stdoutPreview).toBeUndefined()
    expect((auditEvents[0] as any).hook.stderrPreview).toBeUndefined()
  })
})
