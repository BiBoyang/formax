import type {
  PresentationAskOption,
  PresentationAskQuestion,
} from '../contracts/interactivePromptContracts'

export type { PresentationAskOption, PresentationAskQuestion } from '../contracts/interactivePromptContracts'

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null
}

export function normalizeAskQuestions(input: unknown): PresentationAskQuestion[] {
  const record = asRecord(input)
  const questions = Array.isArray(record?.questions) ? record.questions : []
  const normalized: PresentationAskQuestion[] = []

  for (const question of questions) {
    const row = asRecord(question)
    if (!row) continue

    const questionText = typeof row.question === 'string' ? row.question : ''
    const header = typeof row.header === 'string' && row.header.trim() ? row.header : ''
    const fieldId = typeof row.fieldId === 'string' && row.fieldId.trim() ? row.fieldId : undefined
    const options = Array.isArray(row.options)
      ? row.options
          .map((option) => {
            const optionRow = asRecord(option)
            if (!optionRow) return null
            const label = typeof optionRow.label === 'string' ? optionRow.label : ''
            if (!label.trim()) return null
            const description = typeof optionRow.description === 'string' ? optionRow.description : ''
            return { label, description }
          })
          .filter((option): option is PresentationAskOption => Boolean(option))
      : []

    normalized.push({
      question: questionText,
      header,
      fieldId,
      options,
      multiSelect: Boolean(row.multiSelect),
    })
  }

  return normalized
}

export function fieldIdForAskQuestion(question: PresentationAskQuestion, index: number): string {
  const fieldId = typeof question.fieldId === 'string' ? question.fieldId.trim() : ''
  if (fieldId) return fieldId
  const header = typeof question.header === 'string' ? question.header.trim() : ''
  if (header) return header
  const text = typeof question.question === 'string' ? question.question.trim() : ''
  if (text) return text
  return `question_${index + 1}`
}

export function buildAskAnswersFromDraft(
  questions: PresentationAskQuestion[],
  draftValues: Record<string, string>,
): Record<string, string> {
  const answers: Record<string, string> = {}
  questions.forEach((question, index) => {
    const key = fieldIdForAskQuestion(question, index)
    answers[key] = draftValues[key] ?? ''
  })
  return answers
}
