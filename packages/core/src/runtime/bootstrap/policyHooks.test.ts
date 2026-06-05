import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  createToolExecutor,
  createApprovalService,
  createPolicyPreflight,
  createSkillPreflight,
  createNodeAuditLog,
  createHooksRuntime,
} = vi.hoisted(() => ({
  createToolExecutor: vi.fn(),
  createApprovalService: vi.fn(),
  createPolicyPreflight: vi.fn(),
  createSkillPreflight: vi.fn(),
  createNodeAuditLog: vi.fn(),
  createHooksRuntime: vi.fn(),
}))

vi.mock('../../tools/executor/index.js', () => ({
  createToolExecutor,
}))
vi.mock('../../tools/executor/approvalService.js', () => ({
  createApprovalService,
}))
vi.mock('../../tools/executor/policyPreflight.js', () => ({
  createPolicyPreflight,
}))
vi.mock('../../tools/executor/skillPreflight.js', () => ({
  createSkillPreflight,
}))
vi.mock('../../adapters/audit/nodeAuditLog.js', () => ({
  createNodeAuditLog,
}))
vi.mock('../../hooks/runtime.js', () => ({
  createHooksRuntime,
}))

import { createPolicyAndHooksRuntime } from './policyHooks.js'

describe('createPolicyAndHooksRuntime', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('wires audit/approval/hooks and falls back from skill to policy preflight', async () => {
    const audit = { kind: 'audit' }
    const approval = { kind: 'approval' }
    const hooks = { kind: 'hooks' }
    const skillPreflight = vi.fn(async () => undefined)
    const policyPreflight = vi.fn(async () => ({ action: 'allow' }))
    const executor = { kind: 'executor' }

    createNodeAuditLog.mockReturnValue(audit)
    createApprovalService.mockReturnValue(approval)
    createHooksRuntime.mockReturnValue(hooks)
    createSkillPreflight.mockReturnValue(skillPreflight)
    createPolicyPreflight.mockReturnValue(policyPreflight)
    createToolExecutor.mockReturnValue(executor)

    const toolRegistry = { getHandlers: vi.fn(() => ({ Read: vi.fn() })) }
    const userInputManager = { submitAnswers: vi.fn() }
    const fileStore = { readFile: vi.fn() }
    const env = { NODE_ENV: 'test' }
    const mcpServerManager = {
      getCatalog: vi.fn(() => ({
        bindings: [{
          modelName: 'mcp__github__create_issue',
          definition: { input_schema: { type: 'object', properties: { title: { type: 'string' } } } },
        }],
        diagnostics: [],
      })),
    }

    const out = createPolicyAndHooksRuntime({
      cfgPathsLogsDir: '/tmp/logs',
      fileStore: fileStore as any,
      userInputManager: userInputManager as any,
      toolRegistry: toolRegistry as any,
      mcpServerManager: mcpServerManager as any,
      env,
    })

    expect(createNodeAuditLog).toHaveBeenCalledWith({ logsDir: '/tmp/logs' })
    expect(createApprovalService).toHaveBeenCalledWith({ fileStore, userInput: userInputManager, audit })
    expect(createPolicyPreflight).toHaveBeenCalledWith({
      fileStore,
      approval,
      audit,
      env,
      isKnownMcpToolName: expect.any(Function),
      getMcpToolInputSchema: expect.any(Function),
    })
    const { isKnownMcpToolName, getMcpToolInputSchema } = createPolicyPreflight.mock.calls[0][0]
    expect(isKnownMcpToolName('mcp__github__create_issue')).toBe(true)
    expect(isKnownMcpToolName('mcp__github__missing_tool')).toBe(false)
    expect(getMcpToolInputSchema('mcp__github__create_issue')).toEqual({
      type: 'object',
      properties: { title: { type: 'string' } },
    })
    expect(getMcpToolInputSchema('mcp__github__missing_tool')).toBeUndefined()
    expect(createSkillPreflight).toHaveBeenCalledWith({ fileStore, userInput: userInputManager })
    expect(createHooksRuntime).toHaveBeenCalledWith({ fileStore, env })

    const result = await out.preflight({ tool: 'Read' } as any, { cwd: '/repo' } as any)
    expect(skillPreflight).toHaveBeenCalledTimes(1)
    expect(policyPreflight).toHaveBeenCalledTimes(1)
    expect(result).toEqual({ action: 'allow' })

    const created = out.createExecutor()
    expect(toolRegistry.getHandlers).toHaveBeenCalledTimes(1)
    expect(createToolExecutor).toHaveBeenCalledWith({ Read: expect.any(Function) }, { preflight: out.preflight, audit })
    expect(created).toBe(executor)
    expect(out.audit).toBe(audit)
    expect(out.hooks).toBe(hooks)
  })

  it('returns skill preflight result without calling policy preflight', async () => {
    const skillResult = { action: 'deny', reason: 'blocked-skill' }
    const skillPreflight = vi.fn(async () => skillResult)
    const policyPreflight = vi.fn(async () => ({ action: 'allow' }))

    createNodeAuditLog.mockReturnValue({})
    createApprovalService.mockReturnValue({})
    createHooksRuntime.mockReturnValue({})
    createSkillPreflight.mockReturnValue(skillPreflight)
    createPolicyPreflight.mockReturnValue(policyPreflight)
    createToolExecutor.mockReturnValue({})

    const out = createPolicyAndHooksRuntime({
      cfgPathsLogsDir: '/tmp/logs',
      fileStore: {} as any,
      userInputManager: {} as any,
      toolRegistry: { getHandlers: vi.fn(() => ({})) } as any,
      env: {},
    })

    const result = await out.preflight({ tool: 'Write' } as any, { cwd: '/repo' } as any)
    expect(result).toBe(skillResult)
    expect(policyPreflight).not.toHaveBeenCalled()
  })
})
