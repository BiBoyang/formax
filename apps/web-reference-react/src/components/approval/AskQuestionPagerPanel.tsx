import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useEffect, useMemo } from 'react'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
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
      <div data-testid={`ask-question-panel-${inputId}`} className="rounded-[24px] border bg-background/98 px-6 py-5 shadow-[0_18px_50px_rgba(0,0,0,0.10)]">
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
      </div>
    )
  }
  const options = Array.isArray(current.options) ? current.options : []
  const title = current.question?.trim() || current.header?.trim() || 'Question'

  return (
    <div data-testid={`ask-question-panel-${inputId}`} className="rounded-[24px] border bg-background/98 px-6 py-5 shadow-[0_18px_50px_rgba(0,0,0,0.10)]">
      <div className="flex items-start justify-between gap-4">
        <h3 className="text-[26px] leading-tight font-semibold tracking-tight text-foreground">{title}</h3>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <button
            type="button"
            aria-label="Previous question"
            onClick={() => onPageChange(Math.max(0, clampedPageIndex - 1))}
            disabled={clampedPageIndex <= 0}
            className="rounded-md p-1 transition hover:bg-muted disabled:opacity-40"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span aria-label="Question index">{`${clampedPageIndex + 1} of ${totalPages}`}</span>
          <button
            type="button"
            aria-label="Next question"
            onClick={() => onPageChange(Math.min(totalPages - 1, clampedPageIndex + 1))}
            disabled={isLastPage || !canMoveForward}
            className="rounded-md p-1 transition hover:bg-muted disabled:opacity-40"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="mt-4 space-y-2">
        {options.length > 0 ? (
          options.map((option, optionIndex) => {
            const selected = currentValue === option.label
            return (
              <button
                key={`${currentFieldId}-${option.label}`}
                type="button"
                onClick={() => onDraftChange(currentFieldId, option.label)}
                className={[
                  'w-full rounded-xl px-4 py-3 text-left transition',
                  selected ? 'bg-muted text-foreground' : 'hover:bg-muted/60 text-foreground/90',
                ].join(' ')}
              >
                <div className="text-[33px] leading-tight font-medium">
                  {`${optionIndex + 1}. ${option.label}`}
                </div>
                {option.description ? (
                  <div className="mt-0.5 text-[13px] text-muted-foreground">{option.description}</div>
                ) : null}
              </button>
            )
          })
        ) : (
          <Input
            aria-label="Question answer"
            value={currentValue}
            onChange={(event) => onDraftChange(currentFieldId, event.target.value)}
            placeholder="Type your answer"
            className="h-11 rounded-xl"
          />
        )}
      </div>

      <div className="mt-5 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Button type="button" variant="ghost" size="sm" onClick={onDismiss}>
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
          className="rounded-full px-5"
        >
          {isSubmitting ? 'Submitting...' : isLastPage ? 'Submit' : 'Continue'}
        </Button>
      </div>
    </div>
  )
}
