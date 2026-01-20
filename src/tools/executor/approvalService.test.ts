import { describe, expect, it } from 'vitest'
import { createNodeFileStore } from '../../adapters/fs/nodeFileStore.js'
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
})
