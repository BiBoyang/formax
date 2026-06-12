import { describe, expect, it } from 'vitest'
import {
  createApprovalPromptDescriptor,
  createAskUserQuestionPromptDescriptor,
} from './interactivePromptDescriptor.js'

describe('interactive prompt descriptor builders', () => {
  it('creates ask_user_question descriptor with event payload', () => {
    const descriptor = createAskUserQuestionPromptDescriptor({
      call: { id: 'ask-1' },
      questions: [{ question: 'Pick one?', header: 'Choice', options: [{ label: 'A', description: 'Option A' }], multiSelect: false }],
      promptData: {
        kind: 'exit_plan_mode',
        planPath: '/tmp/plan.md',
        planContentState: { status: 'loaded', text: 'plan body' },
      },
      emitToolUpdate: false,
    })
    expect(descriptor).toEqual({
      kind: 'ask_user_question',
      questions: [{ question: 'Pick one?', header: 'Choice', options: [{ label: 'A', description: 'Option A' }], multiSelect: false }],
      emitToolUpdate: false,
      promptData: {
        kind: 'exit_plan_mode',
        planPath: '/tmp/plan.md',
        planContentState: { status: 'loaded', text: 'plan body' },
      },
      requestEvent: {
        type: 'ask_user_question',
        toolUseId: 'ask-1',
        questions: [{ question: 'Pick one?', header: 'Choice', options: [{ label: 'A', description: 'Option A' }], multiSelect: false }],
      },
    })
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
      promptData: {
        kind: 'exit_plan_mode',
        planPath: '/tmp/plan.md',
        planContentState: { status: 'error', message: 'Unable to load plan' },
      },
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
      promptData: {
        kind: 'exit_plan_mode',
        planPath: '/tmp/plan.md',
        planContentState: { status: 'error', message: 'Unable to load plan' },
      },
    })
  })
})
