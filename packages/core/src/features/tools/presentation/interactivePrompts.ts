import {
  type InteractivePromptModel,
} from '../../../shared/interactivePromptContracts'
import { normalizeAskQuestions } from './askQuestions'
import { ENTER_PLAN_MODE_PROMPT, EXIT_PLAN_MODE_PROMPT } from './planModeQuestions'
import { getToolPresentationSemantic } from './toolSemantics'

export type {
  AskPromptQuestion,
  AskUserQuestionPromptModel,
  EnterPlanModePromptModel,
  ExitPlanModePromptModel,
  InteractivePromptModel,
  InteractivePromptOption,
} from '../../../shared/interactivePromptContracts'

function readOptionLabel(raw: unknown, fallback: string): string {
  if (typeof raw === 'string' && raw.trim()) return raw
  return fallback
}

export function resolveInteractivePromptModel(args: {
  toolName: string | null | undefined
  input: unknown
}): InteractivePromptModel | null {
  const semantic = getToolPresentationSemantic(args.toolName)

  if (semantic === 'ask_user_question') {
    const questions = normalizeAskQuestions(args.input).map((question, index) => ({
      ...question,
      header: question.header || `Q${index + 1}`,
    }))
    return { kind: 'ask_user_question', questions }
  }

  if (semantic === 'enter_plan_mode') {
    return {
      kind: 'enter_plan_mode',
      question: ENTER_PLAN_MODE_PROMPT.question,
      options: [
        {
          choice: 'enter',
          label: readOptionLabel(ENTER_PLAN_MODE_PROMPT.options[0]?.label, 'Yes, enter plan mode'),
        },
        {
          choice: 'skip',
          label: readOptionLabel(ENTER_PLAN_MODE_PROMPT.options[1]?.label, 'No, start implementing now'),
        },
      ],
    }
  }

  if (semantic === 'exit_plan_mode') {
    return {
      kind: 'exit_plan_mode',
      question: EXIT_PLAN_MODE_PROMPT.question,
      options: [
        {
          choice: 'auto',
          label: readOptionLabel(
            EXIT_PLAN_MODE_PROMPT.options[0]?.label,
            'Yes, and auto-accept edits',
          ),
        },
        {
          choice: 'manual',
          label: readOptionLabel(
            EXIT_PLAN_MODE_PROMPT.options[1]?.label,
            'Yes, and manually approve edits',
          ),
        },
        {
          choice: 'feedback',
          label: readOptionLabel(
            EXIT_PLAN_MODE_PROMPT.options[2]?.label,
            'Type here to tell Claude what to change',
          ),
        },
      ],
    }
  }

  return null
}
