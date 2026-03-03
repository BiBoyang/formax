import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { createNodeFileStore } from '../../adapters/fs/nodeFileStore.js'
import type { AuditLog } from '../../adapters/audit/auditLog.js'
import type { ToolCall } from '../types.js'
import type { LoadedPolicyRules } from '../../core/policy/store.js'
import * as permissionsStore from '../../adapters/permissions/permissionsStore.js'
import { createApprovalService } from './approvalService.js'

describe('ApprovalService', () => {
  it('returns a compact error when userInput is unavailable', async () => {
    const approval = createApprovalService({ fileStore: createNodeFileStore(), userInput: null })

    const res = await approval.ensureApproved({
      call: { id: 't1', name: 'Bash', input: { command: 'ls' } },
      ctx: { cwd: '/tmp', agentDepth: 0 },
      action: { kind: 'bash.exec', command: 'ls' } as any,
      effectiveDecision: 'prompt',
      explained: { decision: 'prompt' } as any,
      loaded: {} as any,
    })

    expect(res.ok).toBe(false)
    if (res.ok !== false) throw new Error('Expected ok=false')
    expect(res.result.is_error).toBe(true)
    expect(res.result.content).toBe('Error: Approval required for bash.exec')
  })

  it('returns aborted error when ctx.signal is already aborted', async () => {
    const userInput = { requestAnswers: vi.fn() }
    const approval = createApprovalService({ fileStore: createNodeFileStore(), userInput: userInput as any })

    const controller = new AbortController()
    controller.abort()

    const res = await approval.ensureApproved({
      call: { id: 't1', name: 'Bash', input: { command: 'ls' } },
      ctx: { cwd: '/tmp', agentDepth: 0, signal: controller.signal },
      action: { kind: 'bash.exec', command: 'ls' } as any,
      effectiveDecision: 'prompt',
      explained: { decision: 'prompt' } as any,
      loaded: {} as any,
    })

    expect(res.ok).toBe(false)
    if (res.ok !== false) throw new Error('Expected ok=false')
    expect(res.result.is_error).toBe(true)
    expect(res.result.content).toBe('Error: Request aborted')
    expect(userInput.requestAnswers).toHaveBeenCalledTimes(0)
  })

  it('logs audit prompt + approve outcome', async () => {
    const auditEntries: any[] = []
    const audit: AuditLog = { append: async (e) => void auditEntries.push(e) }
    const onEvent = vi.fn()

    const approval = createApprovalService({
      fileStore: createNodeFileStore(),
      userInput: {
        requestAnswers: async () => ({ decision: 'approve' }),
      } as any,
      audit,
    })

    const call: ToolCall = { id: 't1', name: 'WebSearch', input: { query: 'x' } } as any
    const res = await approval.ensureApproved({
      call,
      ctx: { cwd: '/tmp', agentDepth: 0, onEvent },
      action: { kind: 'net.search', query: 'hello' },
      effectiveDecision: 'prompt',
      explained: { decision: 'prompt' } as any,
      loaded: {} as any,
    })

    expect(res.ok).toBe(true)
    expect(auditEntries.map((e) => e.kind)).toEqual(['approval.prompt', 'approval.result'])
    expect(auditEntries[1].outcome).toBe('approve')
    expect(onEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'approval_request',
        toolUseId: 't1',
        toolName: 'WebSearch',
      }),
    )
  })

  it('logs patched action in approval.result when updated_input_json is accepted', async () => {
    const auditEntries: any[] = []
    const audit: AuditLog = { append: async (e) => void auditEntries.push(e) }

    const approval = createApprovalService({
      fileStore: createNodeFileStore(),
      userInput: {
        requestAnswers: async () => ({
          decision: 'approve',
          updated_input_json: JSON.stringify({ command: 'echo patched' }),
        }),
      } as any,
      audit,
    })

    const call: ToolCall = { id: 't-audit-updated', name: 'Bash', input: { command: 'echo old' } } as any
    const res = await approval.ensureApproved({
      call,
      ctx: { cwd: '/tmp', agentDepth: 0, onEvent: () => {} },
      action: { kind: 'bash.exec', command: 'echo old' },
      effectiveDecision: 'prompt',
      explained: { decision: 'prompt' } as any,
      loaded: {} as any,
    })

    expect(res.ok).toBe(true)
    const resultAudit = auditEntries.find((entry) => entry.kind === 'approval.result')
    expect(resultAudit?.action).toEqual({ kind: 'bash.exec', command: 'echo patched' })
  })

  it('approve_remember + fs.write switches REPL to acceptEdits (no policy persistence)', async () => {
    const setReplMode = vi.fn()
    const approval = createApprovalService({
      fileStore: createNodeFileStore(),
      userInput: {
        requestAnswers: async () => ({ decision: 'approve_remember', scope: 'project' }),
      } as any,
    })

    const res = await approval.ensureApproved({
      call: { id: 't1', name: 'Write', input: { file_path: 'a.txt', content: 'x' } } as any,
      ctx: { cwd: process.cwd(), agentDepth: 0, setReplMode, onEvent: () => {} },
      action: { kind: 'fs.write', path: '/tmp/a.txt' },
      effectiveDecision: 'prompt',
      explained: { decision: 'prompt' } as any,
      loaded: {} as any,
    })

    expect(res.ok).toBe(true)
    expect(setReplMode).toHaveBeenCalledWith('acceptEdits')
  })

  it('approve_remember + bash.exec persists repo-local permissions.allow (settings.local.json)', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'formax-approval-'))
    const store = createNodeFileStore()

    const approval = createApprovalService({
      fileStore: store,
      userInput: {
        requestAnswers: async () => ({ decision: 'approve_remember' }),
      } as any,
    })

    const command = 'echo hi'
    const res = await approval.ensureApproved({
      call: { id: 't1', name: 'Bash', input: { command } },
      ctx: { cwd: tmp, agentDepth: 0, onEvent: () => {} },
      action: { kind: 'bash.exec', command },
      effectiveDecision: 'prompt',
      explained: { decision: 'prompt' } as any,
      loaded: {} as any,
    })

    expect(res.ok).toBe(true)

    const settingsPath = path.join(tmp, '.formax', 'settings.local.json')
    const settings = JSON.parse(await fs.readFile(settingsPath, 'utf8')) as any
    expect(settings?.permissions?.allow).toEqual(['Bash(echo hi)'])
  })

  it('approve_remember + updated_input_json persists allow key from patched bash command', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'formax-approval-updated-'))
    const store = createNodeFileStore()

    const approval = createApprovalService({
      fileStore: store,
      userInput: {
        requestAnswers: async () => ({
          decision: 'approve_remember',
          updated_input_json: JSON.stringify({ command: 'echo patched' }),
        }),
      } as any,
    })

    const res = await approval.ensureApproved({
      call: { id: 't-updated-remember', name: 'Bash', input: { command: 'echo old' } },
      ctx: { cwd: tmp, agentDepth: 0, onEvent: () => {} },
      action: { kind: 'bash.exec', command: 'echo old' },
      effectiveDecision: 'prompt',
      explained: { decision: 'prompt' } as any,
      loaded: {} as any,
    })

    expect(res.ok).toBe(true)

    const settingsPath = path.join(tmp, '.formax', 'settings.local.json')
    const settings = JSON.parse(await fs.readFile(settingsPath, 'utf8')) as any
    expect(settings?.permissions?.allow).toEqual(['Bash(echo patched)'])
  })

  it('approve_remember + scope=session adds a conservative policy allow into sessionRules', async () => {
    const approval = createApprovalService({
      fileStore: createNodeFileStore(),
      userInput: {
        requestAnswers: async () => ({ decision: 'approve_remember', scope: 'session' }),
      } as any,
    })

    const res = await approval.ensureApproved({
      call: { id: 't1', name: 'WebSearch', input: { query: 'x' } } as any,
      ctx: { cwd: process.cwd(), agentDepth: 0, onEvent: () => {} },
      action: { kind: 'net.search', query: 'hello' },
      effectiveDecision: 'prompt',
      explained: { decision: 'prompt' } as any,
      loaded: {} as any,
    })

    expect(res.ok).toBe(true)
    const rules = approval.getSessionRules()
    expect(rules).toHaveLength(1)
    expect(rules[0].scope).toBe('session')
    expect(rules[0].decision).toBe('allow')
    expect(rules[0].match).toEqual({ kind: 'net.search', queryPrefix: 'hello' })
  })

  it('approve_remember persists a policy rule for project/global scopes and de-dupes by match', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'formax-policy-'))
    const store = createNodeFileStore()

    const loadedProject: LoadedPolicyRules = {
      paths: { globalRulesPath: path.join(tmp, 'global', 'rules.json'), projectRulesPath: path.join(tmp, '.formax', 'rules.json') },
      globalRules: null,
      projectRules: { version: 1, rules: [] },
      mergedRules: [],
      warnings: [],
    }

    const approval = createApprovalService({
      fileStore: store,
      env: { ...process.env, FORMAX_CONFIG_DIR: path.join(tmp, 'global') },
      userInput: {
        requestAnswers: async () => ({ decision: 'approve_remember', scope: 'project' }),
      } as any,
    })

    const res = await approval.ensureApproved({
      call: { id: 't1', name: 'WebSearch', input: { query: 'x' } } as any,
      ctx: { cwd: tmp, agentDepth: 0, onEvent: () => {} },
      action: { kind: 'net.search', query: 'hello' },
      effectiveDecision: 'prompt',
      explained: { decision: 'prompt' } as any,
      loaded: loadedProject,
    })

    expect(res.ok).toBe(true)
    const projectRulesPath = path.join(tmp, '.formax', 'rules.json')
    const projectFile = JSON.parse(await fs.readFile(projectRulesPath, 'utf8')) as any
    expect(projectFile.version).toBe(1)
    expect(projectFile.rules).toHaveLength(1)
    expect(projectFile.rules[0].match).toEqual({ kind: 'net.search', queryPrefix: 'hello' })

    const existing = projectFile.rules[0]
    const loadedWithExisting: LoadedPolicyRules = { ...loadedProject, projectRules: { version: 1, rules: [existing] } }
    const res2 = await approval.ensureApproved({
      call: { id: 't2', name: 'WebSearch', input: { query: 'x' } } as any,
      ctx: { cwd: tmp, agentDepth: 0, onEvent: () => {} },
      action: { kind: 'net.search', query: 'hello' },
      effectiveDecision: 'prompt',
      explained: { decision: 'prompt' } as any,
      loaded: loadedWithExisting,
    })
    expect(res2.ok).toBe(true)
    const projectFile2 = JSON.parse(await fs.readFile(projectRulesPath, 'utf8')) as any
    expect(projectFile2.rules).toHaveLength(1)

    const approvalGlobal = createApprovalService({
      fileStore: store,
      env: { ...process.env, FORMAX_CONFIG_DIR: path.join(tmp, 'global2') },
      userInput: {
        requestAnswers: async () => ({ decision: 'approve_remember', scope: 'global' }),
      } as any,
    })

    const loadedGlobal: LoadedPolicyRules = {
      paths: { globalRulesPath: path.join(tmp, 'global2', 'rules.json'), projectRulesPath },
      globalRules: { version: 1, rules: [] },
      projectRules: null,
      mergedRules: [],
      warnings: [],
    }

    const res3 = await approvalGlobal.ensureApproved({
      call: { id: 't3', name: 'WebSearch', input: { query: 'x' } } as any,
      ctx: { cwd: tmp, agentDepth: 0, onEvent: () => {} },
      action: { kind: 'net.search', query: 'hello' },
      effectiveDecision: 'prompt',
      explained: { decision: 'prompt' } as any,
      loaded: loadedGlobal,
    })

    expect(res3.ok).toBe(true)
    const globalRulesPath = path.join(tmp, 'global2', 'rules.json')
    const globalFile = JSON.parse(await fs.readFile(globalRulesPath, 'utf8')) as any
    expect(globalFile.rules).toHaveLength(1)
    expect(globalFile.rules[0].match).toEqual({ kind: 'net.search', queryPrefix: 'hello' })
  })

  it('returns a compact error when policy rule persistence fails', async () => {
    const fileStore = {
      exists: async () => false,
      readText: async () => '',
      writeTextAtomic: async () => {},
      writeJsonAtomic: async () => {
        throw new Error('boom')
      },
    }

    const approval = createApprovalService({
      fileStore: fileStore as any,
      env: { ...process.env, FORMAX_CONFIG_DIR: '/tmp/does-not-matter' },
      userInput: {
        requestAnswers: async () => ({ decision: 'approve_remember', scope: 'project' }),
      } as any,
    })

    const res = await approval.ensureApproved({
      call: { id: 't1', name: 'WebSearch', input: { query: 'x' } } as any,
      ctx: { cwd: '/tmp', agentDepth: 0, onEvent: () => {} },
      action: { kind: 'net.search', query: 'hello' },
      effectiveDecision: 'prompt',
      explained: { decision: 'prompt' } as any,
      loaded: { projectRules: { version: 1, rules: [] } } as any,
    })

    expect(res.ok).toBe(false)
    if (res.ok !== false) throw new Error('Expected ok=false')
    expect(res.result.is_error).toBe(true)
    expect(res.result.content).toContain('Error: Failed to save policy rule:')
  })

  it('feedback produces a rejected tool result (empty feedback cancels)', async () => {
    const approvalEmpty = createApprovalService({
      fileStore: createNodeFileStore(),
      userInput: {
        requestAnswers: async () => ({ decision: 'feedback', feedback: '' }),
      } as any,
    })

    const resEmpty = await approvalEmpty.ensureApproved({
      call: { id: 't1', name: 'WebSearch', input: { query: 'x' } } as any,
      ctx: { cwd: '/tmp', agentDepth: 0, onEvent: () => {} },
      action: { kind: 'net.search', query: 'hello' },
      effectiveDecision: 'prompt',
      explained: { decision: 'prompt' } as any,
      loaded: {} as any,
    })
    expect(resEmpty.ok).toBe(false)
    if (resEmpty.ok !== false) throw new Error('Expected ok=false')
    expect(resEmpty.result.is_error).toBe(true)
    expect(resEmpty.result.content).toBe('Tool use rejected by user.')

    const approvalMsg = createApprovalService({
      fileStore: createNodeFileStore(),
      userInput: {
        requestAnswers: async () => ({ decision: 'feedback', feedback: ' nope ' }),
      } as any,
    })
    const resMsg = await approvalMsg.ensureApproved({
      call: { id: 't2', name: 'WebSearch', input: { query: 'x' } } as any,
      ctx: { cwd: '/tmp', agentDepth: 0, onEvent: () => {} },
      action: { kind: 'net.search', query: 'hello' },
      effectiveDecision: 'prompt',
      explained: { decision: 'prompt' } as any,
      loaded: {} as any,
    })
    expect(resMsg.ok).toBe(false)
    if (resMsg.ok !== false) throw new Error('Expected ok=false')
    expect(resMsg.result.content).toBe('Tool use rejected with user message: nope')
  })

  it('treats cancel/unknown decision as a reject', async () => {
    const approval = createApprovalService({
      fileStore: createNodeFileStore(),
      userInput: {
        requestAnswers: async () => ({ decision: 'something-else' }),
      } as any,
    })

    const res = await approval.ensureApproved({
      call: { id: 't1', name: 'WebSearch', input: { query: 'x' } } as any,
      ctx: { cwd: '/tmp', agentDepth: 0, onEvent: () => {} },
      action: { kind: 'net.search', query: 'hello' },
      effectiveDecision: 'prompt',
      explained: { decision: 'prompt' } as any,
      loaded: {} as any,
    })

    expect(res.ok).toBe(false)
    if (res.ok !== false) throw new Error('Expected ok=false')
    expect(res.result.is_error).toBe(true)
    expect(res.result.content).toBe('Tool use rejected by user.')
  })

  it('returns Error: <msg> when requestAnswers throws', async () => {
    const approval = createApprovalService({
      fileStore: createNodeFileStore(),
      userInput: {
        requestAnswers: async () => {
          throw new Error('boom')
        },
      } as any,
    })

    const res = await approval.ensureApproved({
      call: { id: 't1', name: 'WebSearch', input: { query: 'x' } } as any,
      ctx: { cwd: '/tmp', agentDepth: 0, onEvent: () => {} },
      action: { kind: 'net.search', query: 'hello' },
      effectiveDecision: 'prompt',
      explained: { decision: 'prompt' } as any,
      loaded: {} as any,
    })

    expect(res.ok).toBe(false)
    if (res.ok !== false) throw new Error('Expected ok=false')
    expect(res.result.is_error).toBe(true)
    expect(res.result.content).toBe('Error: boom')
  })

  it('returns Error: <msg> when requestAnswers throws a non-Error value', async () => {
    const approval = createApprovalService({
      fileStore: createNodeFileStore(),
      userInput: {
        requestAnswers: async () => {
          throw 'boom-non-error'
        },
      } as any,
    })

    const res = await approval.ensureApproved({
      call: { id: 't1b', name: 'WebSearch', input: { query: 'x' } } as any,
      ctx: { cwd: '/tmp', agentDepth: 0, onEvent: () => {} },
      action: { kind: 'net.search', query: 'hello' },
      effectiveDecision: 'prompt',
      explained: { decision: 'prompt' } as any,
      loaded: {} as any,
    })

    expect(res.ok).toBe(false)
    if (res.ok !== false) throw new Error('Expected ok=false')
    expect(res.result.is_error).toBe(true)
    expect(res.result.content).toBe('Error: boom-non-error')
  })

  it('treats missing decision as reject (decision defaults to empty string)', async () => {
    const approval = createApprovalService({
      fileStore: createNodeFileStore(),
      userInput: {
        requestAnswers: async () => ({}),
      } as any,
    })

    const res = await approval.ensureApproved({
      call: { id: 't-missing-decision', name: 'WebSearch', input: { query: 'x' } } as any,
      ctx: { cwd: '/tmp', agentDepth: 0, onEvent: () => {} },
      action: { kind: 'net.search', query: 'hello' },
      effectiveDecision: 'prompt',
      explained: { decision: 'prompt' } as any,
      loaded: {} as any,
    })

    expect(res.ok).toBe(false)
    if (res.ok !== false) throw new Error('Expected ok=false')
    expect(res.result.content).toBe('Tool use rejected by user.')
  })

  it('returns save settings.local.json error when bash remember persistence fails', async () => {
    const failingStore = {
      exists: async () => false,
      readText: async () => '',
      writeTextAtomic: async () => {},
      writeJsonAtomic: async () => {
        throw new Error('disk broken')
      },
    }
    const approval = createApprovalService({
      fileStore: failingStore as any,
      userInput: {
        requestAnswers: async () => ({ decision: 'approve_remember' }),
      } as any,
    })

    const res = await approval.ensureApproved({
      call: { id: 't-bash-fail', name: 'Bash', input: { command: 'echo hi' } } as any,
      ctx: { cwd: '/tmp', agentDepth: 0, onEvent: () => {} },
      action: { kind: 'bash.exec', command: 'echo hi' },
      effectiveDecision: 'prompt',
      explained: { decision: 'prompt' } as any,
      loaded: {} as any,
    })

    expect(res.ok).toBe(false)
    if (res.ok !== false) throw new Error('Expected ok=false')
    expect(res.result.is_error).toBe(true)
    expect(String(res.result.content)).toContain('Failed to save settings.local.json: disk broken')
  })

  it('returns save settings.local.json error for non-Error bash persistence failures and cwd fallback', async () => {
    const persistSpy = vi.spyOn(permissionsStore, 'persistProjectPermissionAllow').mockRejectedValue('disk string fail')
    const approval = createApprovalService({
      fileStore: createNodeFileStore(),
      userInput: {
        requestAnswers: async () => ({ decision: 'approve_remember' }),
      } as any,
    })

    const res = await approval.ensureApproved({
      call: { id: 't-bash-fail-non-error', name: 'Bash', input: { command: 'echo hi' } } as any,
      ctx: { cwd: '', agentDepth: 0, onEvent: () => {} } as any,
      action: { kind: 'bash.exec', command: 'echo hi' },
      effectiveDecision: 'prompt',
      explained: { decision: 'prompt' } as any,
      loaded: {} as any,
    })

    expect(res.ok).toBe(false)
    if (res.ok !== false) throw new Error('Expected ok=false')
    expect(res.result.is_error).toBe(true)
    expect(String(res.result.content)).toContain('Failed to save settings.local.json: disk string fail')
    persistSpy.mockRestore()
  })

  it('writes audit result entries for feedback/cancel rejection paths', async () => {
    const auditEntries: any[] = []
    const audit: AuditLog = { append: async (e) => void auditEntries.push(e) }

    const withDecision = (decision: any) =>
      createApprovalService({
        fileStore: createNodeFileStore(),
        userInput: {
          requestAnswers: async () => decision,
        } as any,
        audit,
      })

    const commonArgs = {
      call: { id: 't-audit', name: 'WebSearch', input: { query: 'x' } } as any,
      ctx: { cwd: '/tmp', agentDepth: 0, onEvent: () => {} },
      action: { kind: 'net.search', query: 'hello' } as any,
      effectiveDecision: 'prompt' as const,
      explained: { decision: 'prompt' } as any,
      loaded: {} as any,
    }

    await withDecision({ decision: 'feedback', feedback: '' }).ensureApproved(commonArgs)
    await withDecision({ decision: 'feedback', feedback: 'stop it' }).ensureApproved(commonArgs)
    await withDecision({ decision: 'weird' }).ensureApproved(commonArgs)

    const results = auditEntries.filter((e) => e.kind === 'approval.result')
    expect(results.map((r) => r.outcome)).toEqual(['cancel', 'feedback', 'cancel'])
  })

  it('handles missing decision/scope defaults and emits approval_request without suggestions', async () => {
    const onEvent = vi.fn()
    const approval = createApprovalService({
      fileStore: createNodeFileStore(),
      userInput: {
        requestAnswers: async () => ({ decision: 'approve_remember', scope: 'weird-scope' }),
      } as any,
    })

    const res = await approval.ensureApproved({
      call: { id: 't-defaults', name: 'WebSearch', input: { query: 'x' } } as any,
      ctx: { cwd: '/tmp', agentDepth: 0, onEvent },
      action: { kind: 'net.search', query: 'hello' },
      effectiveDecision: 'allow',
      explained: { decision: 'allow' } as any,
      loaded: {} as any,
    })
    expect(res.ok).toBe(true)

    const requestEvent = onEvent.mock.calls.find((call) => call[0]?.type === 'approval_request')?.[0]
    expect(requestEvent).toBeTruthy()
    expect(requestEvent.toolUseId).toBe('t-defaults')
  })

  it('emits blockedPath and decisionReason in approval_request event when available', async () => {
    const onEvent = vi.fn()
    const approval = createApprovalService({
      fileStore: createNodeFileStore(),
      userInput: {
        requestAnswers: async () => ({ decision: 'approve' }),
      } as any,
    })

    const res = await approval.ensureApproved({
      call: { id: 't-reason', name: 'Write', input: { file_path: '/tmp/x.txt', content: 'x' } } as any,
      ctx: { cwd: '/tmp', agentDepth: 0, onEvent },
      action: { kind: 'fs.write', path: '/tmp/x.txt' },
      effectiveDecision: 'prompt',
      explained: {
        decision: 'prompt',
        matchedRule: {
          ruleId: 'rule-1',
          scope: 'project',
          decision: 'prompt',
          reason: 'Path escaped workspace',
        },
        suggestions: [],
      } as any,
      loaded: {} as any,
      workspaceRequest: { dir: '/outside/project' },
    })

    expect(res.ok).toBe(true)
    const requestEvent = onEvent.mock.calls.find((call) => call[0]?.type === 'approval_request')?.[0]
    expect(requestEvent).toEqual(
      expect.objectContaining({
        type: 'approval_request',
        toolUseId: 't-reason',
        blockedPath: '/outside/project',
        decisionReason: 'Path escaped workspace',
      }),
    )
  })

  it('applies updated_input_json to tool call input on approve', async () => {
    const approval = createApprovalService({
      fileStore: createNodeFileStore(),
      userInput: {
        requestAnswers: async () => ({
          decision: 'approve',
          updated_input_json: JSON.stringify({ command: 'echo patched', timeout: 2000 }),
        }),
      } as any,
    })

    const call: ToolCall = { id: 't-updated-input', name: 'Bash', input: { command: 'echo old' } } as any
    const res = await approval.ensureApproved({
      call,
      ctx: { cwd: '/tmp', agentDepth: 0, onEvent: () => {} },
      action: { kind: 'bash.exec', command: 'echo old' },
      effectiveDecision: 'prompt',
      explained: { decision: 'prompt' } as any,
      loaded: {} as any,
    })

    expect(res.ok).toBe(true)
    expect(call.input).toEqual({ command: 'echo patched', timeout: 2000 })
  })

  it('rejects updated_input_json that changes fs.write target path', async () => {
    const approval = createApprovalService({
      fileStore: createNodeFileStore(),
      userInput: {
        requestAnswers: async () => ({
          decision: 'approve',
          updated_input_json: JSON.stringify({ file_path: '/tmp/new.txt', content: 'patched' }),
        }),
      } as any,
    })

    const call: ToolCall = { id: 't-updated-fs-path', name: 'Write', input: { file_path: '/tmp/original.txt', content: 'x' } } as any
    const res = await approval.ensureApproved({
      call,
      ctx: { cwd: '/tmp', agentDepth: 0, onEvent: () => {} },
      action: { kind: 'fs.write', path: '/tmp/original.txt' },
      effectiveDecision: 'prompt',
      explained: { decision: 'prompt' } as any,
      loaded: {} as any,
    })

    expect(res.ok).toBe(false)
    if (res.ok !== false) throw new Error('Expected ok=false')
    expect(res.result.is_error).toBe(true)
    expect(String(res.result.content)).toContain('cannot change fs.write path')
    expect(call.input).toEqual({ file_path: '/tmp/original.txt', content: 'x' })
  })

  it('rejects updated_input_json when patched bash command hits deny policy', async () => {
    const approval = createApprovalService({
      fileStore: createNodeFileStore(),
      userInput: {
        requestAnswers: async () => ({
          decision: 'approve',
          updated_input_json: JSON.stringify({ command: 'sudo rm -rf /' }),
        }),
      } as any,
    })

    const call: ToolCall = { id: 't-updated-deny', name: 'Bash', input: { command: 'echo old' } } as any
    const res = await approval.ensureApproved({
      call,
      ctx: { cwd: '/tmp', agentDepth: 0, onEvent: () => {} },
      action: { kind: 'bash.exec', command: 'echo old' },
      effectiveDecision: 'prompt',
      explained: { decision: 'prompt' } as any,
      loaded: {} as any,
    })

    expect(res.ok).toBe(false)
    if (res.ok !== false) throw new Error('Expected ok=false')
    expect(res.result.is_error).toBe(true)
    expect(String(res.result.content)).toContain('updated_input_json denied')
    expect(call.input).toEqual({ command: 'echo old' })
  })

  it('rejects updated_input_json for WebFetch when patched URL matches deny permission rule', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'formax-approval-web-deny-'))
    await fs.mkdir(path.join(tmp, '.formax'), { recursive: true })
    await fs.writeFile(
      path.join(tmp, '.formax', 'settings.local.json'),
      JSON.stringify({
        version: 1,
        permissions: {
          allow: [],
          ask: [],
          deny: ['WebFetch(https://blocked.example/)'],
          workspace: { additionalDirectories: [] },
        },
      }),
      'utf8',
    )
    const loaded: LoadedPolicyRules = {
      paths: {
        globalRulesPath: path.join(tmp, 'global', 'rules.json'),
        projectRulesPath: path.join(tmp, '.formax', 'rules.json'),
      },
      globalRules: null,
      projectRules: null,
      mergedRules: [
        {
          ruleId: 'prompt-all-net-fetch',
          enabled: true,
          createdAt: new Date().toISOString(),
          scope: 'project',
          decision: 'prompt',
          reason: '',
          template: '',
          match: { kind: 'net.fetch', urlPrefix: 'https://' },
        },
      ],
      warnings: [],
    }

    const approval = createApprovalService({
      fileStore: createNodeFileStore(),
      userInput: {
        requestAnswers: async () => ({
          decision: 'approve',
          updated_input_json: JSON.stringify({ url: 'https://blocked.example' }),
        }),
      } as any,
    })

    const call: ToolCall = { id: 't-updated-web-deny', name: 'WebFetch', input: { url: 'https://safe.example' } } as any
    const res = await approval.ensureApproved({
      call,
      ctx: { cwd: tmp, agentDepth: 0, onEvent: () => {} },
      action: { kind: 'net.fetch', url: 'https://safe.example/' },
      effectiveDecision: 'prompt',
      explained: { decision: 'prompt' } as any,
      loaded,
    })

    expect(res.ok).toBe(false)
    if (res.ok !== false) throw new Error('Expected ok=false')
    expect(res.result.is_error).toBe(true)
    expect(String(res.result.content)).toContain('permission rule for WebFetch')
    expect(call.input).toEqual({ url: 'https://safe.example' })
  })

  it('returns error when updated_input_json is invalid', async () => {
    const approval = createApprovalService({
      fileStore: createNodeFileStore(),
      userInput: {
        requestAnswers: async () => ({
          decision: 'approve',
          updated_input_json: '{not-json',
        }),
      } as any,
    })

    const call: ToolCall = { id: 't-invalid-updated-input', name: 'Bash', input: { command: 'echo old' } } as any
    const res = await approval.ensureApproved({
      call,
      ctx: { cwd: '/tmp', agentDepth: 0, onEvent: () => {} },
      action: { kind: 'bash.exec', command: 'echo old' },
      effectiveDecision: 'prompt',
      explained: { decision: 'prompt' } as any,
      loaded: {} as any,
    })

    expect(res.ok).toBe(false)
    if (res.ok !== false) throw new Error('Expected ok=false')
    expect(res.result.is_error).toBe(true)
    expect(String(res.result.content)).toContain('invalid updated_input_json')
  })

  it('approve decision succeeds without audit logger', async () => {
    const approval = createApprovalService({
      fileStore: createNodeFileStore(),
      userInput: {
        requestAnswers: async () => ({ decision: 'approve' }),
      } as any,
    })
    const res = await approval.ensureApproved({
      call: { id: 't-approve-no-audit', name: 'WebSearch', input: { query: 'x' } } as any,
      ctx: { cwd: '/tmp', agentDepth: 0, onEvent: () => {} },
      action: { kind: 'net.search', query: 'hello' },
      effectiveDecision: 'prompt',
      explained: { decision: 'prompt' } as any,
      loaded: {} as any,
    })
    expect(res.ok).toBe(true)
  })

  it('approve_remember with workspaceRequest persists directory and supports fs.read fast-path', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'formax-workspace-'))
    const store = createNodeFileStore()
    const auditEntries: any[] = []
    const audit: AuditLog = { append: async (e) => void auditEntries.push(e) }

    const approval = createApprovalService({
      fileStore: store,
      userInput: {
        requestAnswers: async () => ({ decision: 'approve_remember', scope: 'project' }),
      } as any,
      audit,
    })

    const res = await approval.ensureApproved({
      call: { id: 't-workspace', name: 'Read', input: { file_path: '/tmp/a.txt' } } as any,
      ctx: { cwd: tmp, agentDepth: 0, onEvent: () => {} },
      action: { kind: 'fs.read', path: '/tmp/a.txt' } as any,
      effectiveDecision: 'prompt',
      explained: { decision: 'prompt' } as any,
      loaded: {} as any,
      workspaceRequest: { dir: '/outside/project' },
    })

    expect(res.ok).toBe(true)

    const approvalResult = auditEntries.find((e) => e.kind === 'approval.result')
    expect(approvalResult?.outcome).toBe('approve_remember')
  })

  it('returns error when workspace directory persistence fails', async () => {
    const persistSpy = vi.spyOn(permissionsStore, 'persistWorkspaceDirectory').mockRejectedValue(new Error('workspace save failed'))
    const approval = createApprovalService({
      fileStore: createNodeFileStore(),
      userInput: {
        requestAnswers: async () => ({ decision: 'approve_remember', scope: 'project' }),
      } as any,
    })

    const res = await approval.ensureApproved({
      call: { id: 't-workspace-fail', name: 'Read', input: { file_path: '/tmp/a.txt' } } as any,
      ctx: { cwd: '/tmp', agentDepth: 0, onEvent: () => {} },
      action: { kind: 'fs.read', path: '/tmp/a.txt' } as any,
      effectiveDecision: 'prompt',
      explained: { decision: 'prompt' } as any,
      loaded: {} as any,
      workspaceRequest: { dir: '/outside/project' },
    })

    expect(res.ok).toBe(false)
    if (res.ok !== false) throw new Error('Expected ok=false')
    expect(res.result.is_error).toBe(true)
    expect(String(res.result.content)).toContain('Error: workspace save failed')
    persistSpy.mockRestore()
  })

  it('returns error for non-Error workspace persistence failures and cwd fallback', async () => {
    const persistSpy = vi.spyOn(permissionsStore, 'persistWorkspaceDirectory').mockRejectedValue('workspace string fail')
    const approval = createApprovalService({
      fileStore: createNodeFileStore(),
      userInput: {
        requestAnswers: async () => ({ decision: 'approve_remember', scope: 'project' }),
      } as any,
    })

    const res = await approval.ensureApproved({
      call: { id: 't-workspace-fail-2', name: 'Read', input: { file_path: '/tmp/a.txt' } } as any,
      ctx: { cwd: '', agentDepth: 0, onEvent: () => {} } as any,
      action: { kind: 'fs.read', path: '/tmp/a.txt' } as any,
      effectiveDecision: 'prompt',
      explained: { decision: 'prompt' } as any,
      loaded: {} as any,
      workspaceRequest: { dir: '/outside/project' },
    })

    expect(res.ok).toBe(false)
    if (res.ok !== false) throw new Error('Expected ok=false')
    expect(res.result.is_error).toBe(true)
    expect(String(res.result.content)).toContain('Error: workspace string fail')
    persistSpy.mockRestore()
  })

  it('returns policy save error text when persistence throws non-Error values', async () => {
    const fileStore = {
      exists: async () => false,
      readText: async () => '',
      writeTextAtomic: async () => {},
      writeJsonAtomic: async () => {
        throw 'raw-string-save-error'
      },
    }

    const approval = createApprovalService({
      fileStore: fileStore as any,
      env: { ...process.env, FORMAX_CONFIG_DIR: '/tmp/does-not-matter' },
      userInput: {
        requestAnswers: async () => ({ decision: 'approve_remember', scope: 'project' }),
      } as any,
    })

    const res = await approval.ensureApproved({
      call: { id: 't-policy-non-error', name: 'WebSearch', input: { query: 'x' } } as any,
      ctx: { cwd: '/tmp', agentDepth: 0, onEvent: () => {} },
      action: { kind: 'net.search', query: 'hello' },
      effectiveDecision: 'prompt',
      explained: { decision: 'prompt' } as any,
      loaded: { projectRules: { version: 1, rules: [] } } as any,
    })

    expect(res.ok).toBe(false)
    if (res.ok !== false) throw new Error('Expected ok=false')
    expect(res.result.is_error).toBe(true)
    expect(res.result.content).toContain('Error: Failed to save policy rule: raw-string-save-error')
  })

  it('persists project-scoped allow even when loaded.projectRules is missing', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'formax-policy-missing-loaded-'))
    const approval = createApprovalService({
      fileStore: createNodeFileStore(),
      env: { ...process.env, FORMAX_CONFIG_DIR: path.join(tmp, 'global') },
      userInput: {
        requestAnswers: async () => ({ decision: 'approve_remember', scope: 'project' }),
      } as any,
    })

    const res = await approval.ensureApproved({
      call: { id: 't-missing-loaded', name: 'WebSearch', input: { query: 'x' } } as any,
      ctx: { cwd: tmp, agentDepth: 0, onEvent: () => {} },
      action: { kind: 'net.search', query: 'hello' },
      effectiveDecision: 'prompt',
      explained: { decision: 'prompt' } as any,
      loaded: {} as any,
    })

    expect(res.ok).toBe(true)
    const projectRulesPath = path.join(tmp, '.formax', 'rules.json')
    const projectFile = JSON.parse(await fs.readFile(projectRulesPath, 'utf8')) as any
    expect(projectFile.rules).toHaveLength(1)
  })

  it('persists global-scoped allow even when loaded.globalRules is missing', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'formax-policy-missing-loaded-global-'))
    const globalDir = path.join(tmp, 'global')
    const approval = createApprovalService({
      fileStore: createNodeFileStore(),
      env: { ...process.env, FORMAX_CONFIG_DIR: globalDir },
      userInput: {
        requestAnswers: async () => ({ decision: 'approve_remember', scope: 'global' }),
      } as any,
    })

    const res = await approval.ensureApproved({
      call: { id: 't-missing-loaded-global', name: 'WebSearch', input: { query: 'x' } } as any,
      ctx: { cwd: tmp, agentDepth: 0, onEvent: () => {} },
      action: { kind: 'net.search', query: 'hello' },
      effectiveDecision: 'prompt',
      explained: { decision: 'prompt' } as any,
      loaded: {} as any,
    })

    expect(res.ok).toBe(true)
    const globalRulesPath = path.join(globalDir, 'rules.json')
    const globalFile = JSON.parse(await fs.readFile(globalRulesPath, 'utf8')) as any
    expect(globalFile.rules).toHaveLength(1)
  })
})
