import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { createNodeFileStore } from '../../adapters/fs/nodeFileStore.js'
import type { AuditLog } from '../../adapters/audit/auditLog.js'
import type { ToolCall } from '../types.js'
import type { LoadedPolicyRules } from '../../core/policy/store.js'
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
})
