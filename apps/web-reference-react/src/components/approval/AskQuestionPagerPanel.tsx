import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useEffect, useMemo } from 'react'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { ApprovalOptionButton, ApprovalPanelSurface } from './PanelPrimitives'
import {
  buildAskAnswersFromDraft,
  fieldIdForAskQuestion,
  type PresentationAskQuestion,
} from '../../../../../src/features/tools/presentation/askQuestions'

type AskQuestionPagerPanelProps = {
  inputId: string
  questions: PresentationAskQuestion[]
  pageIndex: number
  draftValues: Record<string, string>
  isSubmitting: boolean
  onDismiss: () => void
  onPageChange: (page: number) => void
  onDraftChange: (fieldId: string, value: string) => void
  onSubmit: (answers: Record<string, string>) => void
}

export function AskQuestionPagerPanel(props: AskQuestionPagerPanelProps) {
  const {
    inputId,
    questions,
    pageIndex,
    draftValues,
    isSubmitting,
    onDismiss,
    onPageChange,
    onDraftChange,
    onSubmit,
  } = props

  const totalPages = questions.length
  const clampedPageIndex = Math.max(0, Math.min(pageIndex, Math.max(0, totalPages - 1)))
  const current = questions[clampedPageIndex]
  const currentFieldId = current ? fieldIdForAskQuestion(current, clampedPageIndex) : ''
  const currentValue = currentFieldId ? (draftValues[currentFieldId] ?? '') : ''
  const canMoveForward = currentValue.trim().length > 0
  const isLastPage = clampedPageIndex >= totalPages - 1
  const canSubmitAll = useMemo(
    () => questions.every((question, index) => (draftValues[fieldIdForAskQuestion(question, index)] ?? '').trim().length > 0),
    [draftValues, questions],
  )

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      onDismiss()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [onDismiss])

  if (!current) {
    return (
      <ApprovalPanelSurface testId={`ask-question-panel-${inputId}`}>
        <h3 className="text-xl font-semibold tracking-tight text-foreground">No questions available</h3>
        <p className="mt-2 text-sm text-muted-foreground">
          This request does not include any valid questions. You can dismiss it and continue in composer.
        </p>
        <div className="mt-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Button type="button" variant="ghost" size="sm" onClick={onDismiss}>
              Dismiss
            </Button>
            <span className="rounded-md bg-muted px-2 py-0.5 text-xs font-medium">ESC</span>
          </div>
        </div>
      </ApprovalPanelSurface>
    )
  }
  const options = Array.isArray(current.options) ? current.options : []
  const title = current.question?.trim() || current.header?.trim() || 'Question'

  return (
    <ApprovalPanelSurface testId={`ask-question-panel-${inputId}`}>
      <div className="flex items-start justify-between gap-2 px-3">
        <h3 className="py-2 text-[15px] leading-tight font-semibold tracking-tight text-foreground">{title}</h3>
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <button
            type="button"
            aria-label="Previous question"
            onClick={() => onPageChange(Math.max(0, clampedPageIndex - 1))}
            disabled={clampedPageIndex <= 0}
            className="rounded-md p-0.5 transition hover:bg-muted disabled:opacity-40"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </button>
          <span aria-label="Question index">{`${clampedPageIndex + 1} of ${totalPages}`}</span>
          <button
            type="button"
            aria-label="Next question"
            onClick={() => onPageChange(Math.min(totalPages - 1, clampedPageIndex + 1))}
            disabled={isLastPage || !canMoveForward}
            className="rounded-md p-0.5 transition hover:bg-muted disabled:opacity-40"
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <div className="mt-1 space-y-0.5">
        {options.length > 0 ? (
          options.map((option, optionIndex) => {
            const selected = currentValue === option.label
            return (
              <ApprovalOptionButton
                key={`${currentFieldId}-${option.label}`}
                onClick={() => onDraftChange(currentFieldId, option.label)}
                selected={selected}
                primaryText={`${optionIndex + 1}. ${option.label}`}
                secondaryText={option.description}
              />
            )
          })
        ) : (
          <Input
            aria-label="Question answer"
            value={currentValue}
            onChange={(event) => onDraftChange(currentFieldId, event.target.value)}
            placeholder="Type your answer"
            className="h-9 rounded-xl text-sm"
          />
        )}
      </div>

      <div className="mt-1.5 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Button type="button" variant="ghost" size="sm" className="h-8 px-3 text-sm" onClick={onDismiss}>
            Dismiss
          </Button>
          <span className="rounded-md bg-muted px-2 py-0.5 text-xs font-medium">ESC</span>
        </div>
        <Button
          type="button"
          onClick={() => {
            if (isLastPage) {
              onSubmit(buildAskAnswersFromDraft(questions, draftValues))
              return
            }
            onPageChange(clampedPageIndex + 1)
          }}
          disabled={isSubmitting || (isLastPage ? !canSubmitAll : !canMoveForward)}
          className="h-8 rounded-full px-6 text-sm font-medium"
        >
          {isSubmitting ? 'Submitting...' : isLastPage ? 'Submit' : 'Continue'}
        </Button>
      </div>
    </ApprovalPanelSurface>
  )
}
