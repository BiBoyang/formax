import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useEffect, useMemo } from 'react'
import { useI18n } from '../../app/i18n/I18nProvider'
import { Input } from '../ui/input'
import {
  ApprovalDismissButton,
  ApprovalOptionButton,
  ApprovalPanelSurface,
  ApprovalPrimaryButton,
  approvalPanelBodyClass,
  approvalPanelFooterClass,
  approvalPanelHeaderClass,
  approvalPanelTitleClass,
} from './PanelPrimitives'
import {
  buildAskAnswersFromDraft,
  fieldIdForAskQuestion,
  type PresentationAskQuestion,
} from '../../parity/tools/askQuestions'

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

function parseMultiSelectValue(rawValue: string): string[] {
  const values: string[] = []
  let current = ''
  let escaped = false

  for (const char of rawValue) {
    if (escaped) {
      current += char
      escaped = false
      continue
    }
    if (char === '\\') {
      escaped = true
      continue
    }
    if (char === ',') {
      const normalized = current.trim()
      if (normalized.length > 0) values.push(normalized)
      current = ''
      continue
    }
    current += char
  }

  if (escaped) current += '\\'
  const normalized = current.trim()
  if (normalized.length > 0) values.push(normalized)
  return values
}

function toMultiSelectValue(labels: string[]): string {
  return labels
    .map((label) => label.replace(/\\/g, '\\\\').replace(/,/g, '\\,'))
    .join(', ')
}

function buildAskSubmitAnswers(
  questions: PresentationAskQuestion[],
  draftValues: Record<string, string>,
): Record<string, string> {
  const answers = buildAskAnswersFromDraft(questions, draftValues)
  questions.forEach((question, index) => {
    if (!question.multiSelect) return
    const fieldId = fieldIdForAskQuestion(question, index)
    answers[fieldId] = parseMultiSelectValue(answers[fieldId] ?? '').join(', ')
  })
  return answers
}

function hasQuestionAnswer(question: PresentationAskQuestion, rawValue: string): boolean {
  if (question.multiSelect && question.options.length > 0) {
    return parseMultiSelectValue(rawValue).length > 0
  }
  return rawValue.trim().length > 0
}

export function AskQuestionPagerPanel(props: AskQuestionPagerPanelProps) {
  const { t } = useI18n()
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
  const currentMultiValues = useMemo(() => parseMultiSelectValue(currentValue), [currentValue])
  const canMoveForward = current ? hasQuestionAnswer(current, currentValue) : false
  const isLastPage = clampedPageIndex >= totalPages - 1
  const canSubmitAll = useMemo(
    () =>
      questions.every((question, index) => {
        const fieldId = fieldIdForAskQuestion(question, index)
        return hasQuestionAnswer(question, draftValues[fieldId] ?? '')
      }),
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
        <div className={approvalPanelHeaderClass}>
          <h3 className={approvalPanelTitleClass}>{t('askQuestion.noQuestionsTitle')}</h3>
        </div>
        <p className={`${approvalPanelBodyClass} text-sm text-muted-foreground`}>
          {t('askQuestion.noQuestionsBody')}
        </p>
        <div className={`${approvalPanelFooterClass} justify-between`}>
          <ApprovalDismissButton label={t('askQuestion.dismiss')} onClick={onDismiss} />
        </div>
      </ApprovalPanelSurface>
    )
  }

  const options = Array.isArray(current.options) ? current.options : []
  const title = current.question?.trim() || current.header?.trim() || t('askQuestion.fallbackTitle')

  return (
    <ApprovalPanelSurface testId={`ask-question-panel-${inputId}`}>
      <div className={approvalPanelHeaderClass}>
        <h3 className={approvalPanelTitleClass}>{title}</h3>
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <button
            type="button"
            aria-label={t('askQuestion.previous')}
            onClick={() => onPageChange(Math.max(0, clampedPageIndex - 1))}
            disabled={clampedPageIndex <= 0}
            className="rounded-md p-0.5 transition hover:bg-muted disabled:opacity-40"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </button>
          <span aria-label={t('askQuestion.indexLabel')}>
            {t('askQuestion.indexText', { current: clampedPageIndex + 1, total: totalPages })}
          </span>
          <button
            type="button"
            aria-label={t('askQuestion.next')}
            onClick={() => onPageChange(Math.min(totalPages - 1, clampedPageIndex + 1))}
            disabled={isLastPage || !canMoveForward}
            className="rounded-md p-0.5 transition hover:bg-muted disabled:opacity-40"
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <div className={`${approvalPanelBodyClass} space-y-1`}>
        {options.length > 0 ? (
          <>
            {current.multiSelect ? (
              <div className="px-1 text-xs text-muted-foreground">{t('askQuestion.multiSelectHint')}</div>
            ) : null}
            {options.map((option, optionIndex) => {
              const selected = current.multiSelect
                ? currentMultiValues.includes(option.label)
                : currentValue === option.label
              return (
                <ApprovalOptionButton
                  key={`${currentFieldId}-${option.label}`}
                  onClick={() => {
                    if (current.multiSelect) {
                      const nextValues = currentMultiValues.includes(option.label)
                        ? currentMultiValues.filter((value) => value !== option.label)
                        : [...currentMultiValues, option.label]
                      onDraftChange(currentFieldId, toMultiSelectValue(nextValues))
                      return
                    }
                    onDraftChange(currentFieldId, option.label)
                  }}
                  selected={selected}
                  ordinal={optionIndex + 1}
                  primaryText={option.label}
                  secondaryText={option.description}
                />
              )
            })}
          </>
        ) : (
          <Input
            aria-label={t('askQuestion.answerLabel')}
            value={currentValue}
            onChange={(event) => onDraftChange(currentFieldId, event.target.value)}
            placeholder={t('askQuestion.answerPlaceholder')}
            className="h-9 rounded-xl text-sm"
          />
        )}
      </div>

      <div className={`${approvalPanelFooterClass} justify-between`}>
        <ApprovalDismissButton label={t('askQuestion.dismiss')} onClick={onDismiss} />
        <ApprovalPrimaryButton
          type="button"
          onClick={() => {
            if (isLastPage) {
              onSubmit(buildAskSubmitAnswers(questions, draftValues))
              return
            }
            onPageChange(clampedPageIndex + 1)
          }}
          disabled={isSubmitting || (isLastPage ? !canSubmitAll : !canMoveForward)}
          label={isSubmitting ? t('askQuestion.submitting') : isLastPage ? t('askQuestion.submit') : t('askQuestion.continue')}
        />
      </div>
    </ApprovalPanelSurface>
  )
}
