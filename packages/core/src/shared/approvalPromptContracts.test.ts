import { describe, expectTypeOf, it } from 'vitest'
import type {
  BashApprovalDecision,
  ConfirmMenuDecision,
  ConfirmMenuOption,
  EditApprovalDecision,
  FsReadApprovalDecision,
  FsWriteApprovalDecision,
  SkillApprovalDecision,
} from './approvalPromptContracts'

describe('approvalPromptContracts', () => {
  it('keeps confirm-menu option contract stable', () => {
    const choiceOption: ConfirmMenuOption = { kind: 'choice', key: 'approve', label: 'Yes' }
    const feedbackOption: ConfirmMenuOption = {
      kind: 'feedback',
      key: 'feedback',
      label: '',
      placeholder: 'Type feedback',
    }

    expectTypeOf(choiceOption).toMatchTypeOf<ConfirmMenuOption>()
    expectTypeOf(feedbackOption).toMatchTypeOf<ConfirmMenuOption>()
  })

  it('keeps confirm-menu decision contract stable', () => {
    const choice: ConfirmMenuDecision = { kind: 'choice', key: 'approve' }
    const feedback: ConfirmMenuDecision = { kind: 'feedback', key: 'feedback', feedback: 'retry' }
    const cancel: ConfirmMenuDecision = { kind: 'cancel' }

    expectTypeOf(choice).toMatchTypeOf<ConfirmMenuDecision>()
    expectTypeOf(feedback).toMatchTypeOf<ConfirmMenuDecision>()
    expectTypeOf(cancel).toMatchTypeOf<ConfirmMenuDecision>()
  })

  it('keeps approval decision unions stable', () => {
    const editDecision: EditApprovalDecision = { kind: 'approve_remember', scope: 'session' }
    const bashDecision: BashApprovalDecision = { kind: 'approve_remember' }
    const readDecision: FsReadApprovalDecision = { kind: 'approve' }
    const writeDecision: FsWriteApprovalDecision = { kind: 'feedback', feedback: 'narrow scope' }
    const skillDecision: SkillApprovalDecision = { kind: 'cancel' }

    expectTypeOf(editDecision).toMatchTypeOf<EditApprovalDecision>()
    expectTypeOf(bashDecision).toMatchTypeOf<BashApprovalDecision>()
    expectTypeOf(readDecision).toMatchTypeOf<FsReadApprovalDecision>()
    expectTypeOf(writeDecision).toMatchTypeOf<FsWriteApprovalDecision>()
    expectTypeOf(skillDecision).toMatchTypeOf<SkillApprovalDecision>()
  })
})
