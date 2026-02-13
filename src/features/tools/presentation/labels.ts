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

export function summarizePlanModeStatus(args: {
  kind: 'enter' | 'exit'
  status: PresentationToolStatus
  fallbackSummary: string
}): string {
  if (args.status === 'running') {
    return args.kind === 'enter' ? 'Waiting for confirmation' : 'Waiting for implementation decision'
  }

  const summary = args.fallbackSummary.trim()
  if (!summary) return args.status === 'error' ? 'Failed' : 'Completed'

  if (args.kind === 'exit' && /User has approved your plan/i.test(summary)) {
    return 'Plan approved. You can start coding.'
  }
  if (args.kind === 'enter' && /Entered plan mode/i.test(summary)) return 'Entered plan mode'
  if (args.kind === 'enter' && /declined plan mode/i.test(summary)) return 'Plan mode skipped'
  return summary
}
