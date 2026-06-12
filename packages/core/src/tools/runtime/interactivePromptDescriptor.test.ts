import { describe, expect, it } from 'vitest'
import {
  createApprovalPromptDescriptor,
  createAskUserQuestionPromptDescriptor,
} from './interactivePromptDescriptor.js'

describe('interactive prompt descriptor builders', () => {
  it('creates generic ask_user_question descriptor with event payload', () => {
    const descriptor = createAskUserQuestionPromptDescriptor({
      call: { id: 'ask-1' },
      questions: [{ question: 'Pick one?', header: 'Choice', options: [{ label: 'A', description: 'Option A' }], multiSelect: false }],
      emitToolUpdate: false,
    })
    expect(descriptor).toEqual({
      kind: 'ask_user_question',
      questions: [{ question: 'Pick one?', header: 'Choice', options: [{ label: 'A', description: 'Option A' }], multiSelect: false }],
      emitToolUpdate: false,
      requestEvent: {
        type: 'ask_user_question',
        toolUseId: 'ask-1',
        questions: [{ question: 'Pick one?', header: 'Choice', options: [{ label: 'A', description: 'Option A' }], multiSelect: false }],
      },
    })
  })

  it('creates exit_plan_mode descriptor with required snapshot data', () => {
    const descriptor = createAskUserQuestionPromptDescriptor({
      call: { id: 'exit-1' },
      questions: [{ question: 'Exit?', header: 'Plan', options: [{ label: 'Auto', description: 'Accept edits automatically' }], multiSelect: false }],
      ui: { promptVariant: 'exit_plan_mode' },
      promptData: {
        kind: 'exit_plan_mode',
        planPath: '/tmp/plan.md',
        planContentState: { status: 'loaded', text: 'plan body' },
      },
    })

    expect(descriptor).toEqual({
      kind: 'ask_user_question',
      questions: [{ question: 'Exit?', header: 'Plan', options: [{ label: 'Auto', description: 'Accept edits automatically' }], multiSelect: false }],
      requestEvent: {
        type: 'ask_user_question',
        toolUseId: 'exit-1',
        questions: [{ question: 'Exit?', header: 'Plan', options: [{ label: 'Auto', description: 'Accept edits automatically' }], multiSelect: false }],
      },
      ui: { promptVariant: 'exit_plan_mode' },
      promptData: {
        kind: 'exit_plan_mode',
        planPath: '/tmp/plan.md',
        planContentState: { status: 'loaded', text: 'plan body' },
      },
    })
  })

  it('rejects promptData for generic ask_user_question descriptors', () => {
    expect(() =>
      createAskUserQuestionPromptDescriptor({
        call: { id: 'ask-invalid' },
        questions: [{ question: 'Pick one?', header: 'Choice', options: [{ label: 'A', description: 'Option A' }], multiSelect: false }],
        promptData: {
          kind: 'exit_plan_mode',
          planPath: '/tmp/plan.md',
          planContentState: { status: 'loaded', text: 'plan body' },
        },
      } as any),
    ).toThrowError('promptData is only supported for domain prompt variants that require snapshot data')
  })

  it('rejects exit_plan_mode descriptors without matching snapshot data', () => {
    expect(() =>
      createAskUserQuestionPromptDescriptor({
        call: { id: 'exit-invalid' },
        questions: [{ question: 'Exit?', header: 'Plan', options: [{ label: 'Auto', description: 'Accept edits automatically' }], multiSelect: false }],
        ui: { promptVariant: 'exit_plan_mode' },
      } as any),
    ).toThrowError('exit_plan_mode descriptors require matching promptData')
  })

  it('creates approval descriptor with optional metadata', () => {
    const descriptor = createApprovalPromptDescriptor({
      call: { id: 'approval-1' },
      toolName: 'Skill',
      action: { kind: 'skill.use', skill: 'typescript' },
      effectiveDecision: 'prompt',
      suggestions: ['allow'],
      workspaceRequest: { dir: '/tmp/project' },
      blockedPath: '/tmp/project',
      decisionReason: 'outside workspace',
      agentID: 'agent-1',
    })
    expect(descriptor).toEqual({
      kind: 'approval',
      requestEvent: {
        type: 'approval_request',
        toolUseId: 'approval-1',
        toolName: 'Skill',
        action: { kind: 'skill.use', skill: 'typescript' },
        effectiveDecision: 'prompt',
        suggestions: ['allow'],
        workspaceRequest: { dir: '/tmp/project' },
        blockedPath: '/tmp/project',
        decisionReason: 'outside workspace',
        agentID: 'agent-1',
      },
    })
  })
})
