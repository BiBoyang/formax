export type PresentationToolStatus = 'pending' | 'running' | 'completed' | 'error'

function formatCount(count: number, singular: string, plural: string): string {
  const n = Number.isFinite(count) ? Math.max(0, Math.trunc(count)) : 0
  return `${n} ${n === 1 ? singular : plural}`
}

export function formatQuestionCountLabel(count: number): string {
  return formatCount(count, 'question', 'questions')
}

export function formatItemCountLabel(count: number): string {
  return formatCount(count, 'item', 'items')
}

export function summarizeAskUserQuestionStatus(args: {
  status: PresentationToolStatus
  fallbackSummary: string
  answerCount: number | null
}): string {
  if (args.status === 'running') return 'Waiting for answers'
  if (args.status !== 'completed') return args.fallbackSummary

  if (typeof args.answerCount === 'number') {
    if (args.answerCount <= 0) return 'Answered'
    return `Answered ${formatQuestionCountLabel(args.answerCount)}`
  }

  if (args.fallbackSummary.trim()) return args.fallbackSummary
  return 'Answered'
}

export function summarizeTodoWriteStatus(args: {
  status: PresentationToolStatus
  fallbackSummary: string
}): string {
  if (args.status === 'running') return 'Updating todo list'
  if (args.status === 'completed') return 'Updated todo list'
  return args.fallbackSummary
}
