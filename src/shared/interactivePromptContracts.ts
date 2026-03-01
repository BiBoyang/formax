export type PresentationAskOption = {
  label: string
  description: string
}

export type PresentationAskQuestion = {
  question: string
  header: string
  fieldId?: string
  options: PresentationAskOption[]
  multiSelect: boolean
}

export type PresentationQuestionOption = {
  label: string
  description: string
}

export type PresentationQuestion = {
  header: string
  question: string
  fieldId: string
  options: PresentationQuestionOption[]
  multiSelect: boolean
}

export type InteractivePromptOption<TChoice extends string = string> = {
  choice: TChoice
  label: string
}

export type AskPromptQuestion = PresentationAskQuestion & {
  header: string
}

export type AskUserQuestionPromptModel = {
  kind: 'ask_user_question'
  questions: AskPromptQuestion[]
}

export type EnterPlanModePromptModel = {
  kind: 'enter_plan_mode'
  question: string
  options: [InteractivePromptOption<'enter'>, InteractivePromptOption<'skip'>]
}

export type ExitPlanModePromptModel = {
  kind: 'exit_plan_mode'
  question: string
  options: [
    InteractivePromptOption<'auto'>,
    InteractivePromptOption<'manual'>,
    InteractivePromptOption<'feedback'>,
  ]
}

export type InteractivePromptModel =
  | AskUserQuestionPromptModel
  | EnterPlanModePromptModel
  | ExitPlanModePromptModel
