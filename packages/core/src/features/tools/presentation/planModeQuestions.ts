import type { PresentationQuestion } from '../../../shared/interactivePromptContracts'

export type { PresentationQuestion, PresentationQuestionOption } from '../../../shared/interactivePromptContracts'

export const ENTER_PLAN_MODE_PROMPT: PresentationQuestion = {
  header: 'Plan',
  question: 'Enter plan mode?',
  fieldId: 'choice',
  options: [
    { label: 'Yes, enter plan mode', description: 'Explore and design an implementation plan first.' },
    { label: 'No, start implementing now', description: 'Skip planning and start making changes.' },
  ],
  multiSelect: false,
}

export const EXIT_PLAN_MODE_PROMPT: PresentationQuestion = {
  header: 'Submit',
  question: 'Ready to code?',
  fieldId: 'choice',
  options: [
    { label: 'Yes, and auto-accept edits', description: 'Proceed and allow edits without per-edit prompts.' },
    { label: 'Yes, and manually approve edits', description: 'Proceed but confirm each edit.' },
    { label: 'Type here to tell Claude what to change', description: 'Request plan changes and stay in plan mode.' },
  ],
  multiSelect: false,
}

export const ENTER_PLAN_MODE_QUESTIONS: PresentationQuestion[] = [ENTER_PLAN_MODE_PROMPT]
export const EXIT_PLAN_MODE_QUESTIONS: PresentationQuestion[] = [EXIT_PLAN_MODE_PROMPT]
