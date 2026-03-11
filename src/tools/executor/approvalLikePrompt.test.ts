import { describe, expect, it } from 'vitest'
import {
  buildToolUseRejectedContent,
  createApprovalPromptDescriptor,
  resolveApprovalLikeOutcome,
} from './approvalLikePrompt.js'

describe('buildToolUseRejectedContent', () => {
  it('uses default rejection message when feedback is empty', () => {
    expect(buildToolUseRejectedContent({})).toBe('Tool use rejected by user.')
    expect(buildToolUseRejectedContent({ message: '   ' })).toBe('Tool use rejected by user.')
  })

  it('includes user feedback in rejection content', () => {
    expect(buildToolUseRejectedContent({ message: 'no skill' })).toBe('Tool use rejected with user message: no skill')
  })
})

describe('resolveApprovalLikeOutcome', () => {
  it('resolves approve decisions', () => {
    const outcome = resolveApprovalLikeOutcome({
      call: { id: 't-1' },
      decision: 'approve',
      feedback: '',
    })
    expect(outcome).toEqual({ type: 'approve' })
  })

  it('resolves approve_remember decisions', () => {
    const outcome = resolveApprovalLikeOutcome({
      call: { id: 't-2' },
      decision: 'approve_remember',
      feedback: '',
    })
    expect(outcome).toEqual({ type: 'approve_remember' })
  })

  it('resolves feedback decisions with rejection payload', () => {
    const outcome = resolveApprovalLikeOutcome({
      call: { id: 't-3' },
      decision: 'feedback',
      feedback: 'not now',
    })
    expect(outcome).toEqual({
      type: 'feedback',
      result: {
        tool_use_id: 't-3',
        content: 'Tool use rejected with user message: not now',
        is_error: true,
      },
    })
  })

  it('falls back to cancel when feedback decision has empty message', () => {
    const outcome = resolveApprovalLikeOutcome({
      call: { id: 't-4' },
      decision: 'feedback',
      feedback: '',
    })
    expect(outcome).toEqual({
      type: 'cancel',
      result: {
        tool_use_id: 't-4',
        content: 'Tool use rejected by user.',
        is_error: true,
      },
    })
  })

  it('falls back to cancel for unknown decisions', () => {
    const outcome = resolveApprovalLikeOutcome({
      call: { id: 't-5' },
      decision: 'maybe',
      feedback: 'ignored',
    })
    expect(outcome).toEqual({
      type: 'cancel',
      result: {
        tool_use_id: 't-5',
        content: 'Tool use rejected by user.',
        is_error: true,
      },
    })
  })
})

describe('createApprovalPromptDescriptor', () => {
  it('creates an approval descriptor with canonical request payload', () => {
    const descriptor = createApprovalPromptDescriptor({
      call: { id: 'approval-1' },
      toolName: 'Skill',
      action: { kind: 'skill.use', skill: 'typescript' },
      effectiveDecision: 'prompt',
    })
    expect(descriptor).toEqual({
      kind: 'approval',
      requestEvent: {
        type: 'approval_request',
        toolUseId: 'approval-1',
        toolName: 'Skill',
        action: { kind: 'skill.use', skill: 'typescript' },
        effectiveDecision: 'prompt',
      },
    })
  })
})
