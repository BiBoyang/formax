import { describe, expectTypeOf, it } from 'vitest'
import type {
  AskPromptQuestion,
  AskUserQuestionPromptModel,
  EnterPlanModePromptModel,
  ExitPlanModePromptModel,
  InteractivePromptModel,
  PresentationAskQuestion,
  PresentationQuestion,
} from './interactivePromptContracts'

describe('interactivePromptContracts', () => {
  it('keeps ask-question contracts stable', () => {
    const question: PresentationAskQuestion = {
      question: 'Pick',
      header: 'Q1',
      options: [{ label: 'A', description: 'desc' }],
      multiSelect: false,
    }
    const askPromptQuestion: AskPromptQuestion = {
      ...question,
      header: 'Q1',
    }
    const askModel: AskUserQuestionPromptModel = {
      kind: 'ask_user_question',
      questions: [askPromptQuestion],
    }

    expectTypeOf(question).toMatchTypeOf<PresentationAskQuestion>()
    expectTypeOf(askPromptQuestion).toMatchTypeOf<AskPromptQuestion>()
    expectTypeOf(askModel).toMatchTypeOf<AskUserQuestionPromptModel>()
  })

  it('keeps plan-mode prompt contracts stable', () => {
    const planQuestion: PresentationQuestion = {
      header: 'Plan',
      question: 'Enter plan mode?',
      fieldId: 'choice',
      options: [{ label: 'Yes', description: 'enter' }],
      multiSelect: false,
    }
    const enterModel: EnterPlanModePromptModel = {
      kind: 'enter_plan_mode',
      question: planQuestion.question,
      options: [
        { choice: 'enter', label: 'Yes' },
        { choice: 'skip', label: 'No' },
      ],
    }
    const exitModel: ExitPlanModePromptModel = {
      kind: 'exit_plan_mode',
      question: 'Ready?',
      options: [
        { choice: 'auto', label: 'Auto' },
        { choice: 'manual', label: 'Manual' },
        { choice: 'feedback', label: 'Feedback' },
      ],
    }

    expectTypeOf(planQuestion).toMatchTypeOf<PresentationQuestion>()
    expectTypeOf(enterModel).toMatchTypeOf<EnterPlanModePromptModel>()
    expectTypeOf(exitModel).toMatchTypeOf<ExitPlanModePromptModel>()
  })

  it('keeps interactive prompt union stable', () => {
    const model: InteractivePromptModel = {
      kind: 'enter_plan_mode',
      question: 'Enter?',
      options: [
        { choice: 'enter', label: 'Yes' },
        { choice: 'skip', label: 'No' },
      ],
    }

    expectTypeOf(model).toMatchTypeOf<InteractivePromptModel>()
  })
})
