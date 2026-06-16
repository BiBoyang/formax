import type { PendingInput } from '../types'
import { useI18n } from '../app/i18n/I18nProvider'
import { AskQuestionPagerPanel } from './approval/AskQuestionPagerPanel'
import { ApprovalSubmitPanel } from './approval/ApprovalSubmitPanel'
import { Button } from './ui/button'
import { normalizeAskQuestions } from '../parity/tools/askQuestions'

type SubmitUiStatus = {
  status: string
  kind: 'success' | 'error'
  message?: string
}

export type InputApprovalDockProps = {
  input: PendingInput | null
  isAskOpen: boolean
  askPageIndex: number
  askDraftValues: Record<string, string>
  submitStatus?: SubmitUiStatus | null
  isSubmitting: boolean
  onAskOpen: () => void
  onCancelInput: (inputId: string) => void
  onAskPageChange: (page: number) => void
  onAskDraftChange: (fieldId: string, value: string) => void
  onSubmitInput: (inputId: string, answers: Record<string, string>) => void
}

export function InputApprovalDock(props: InputApprovalDockProps) {
  const { t } = useI18n()
  const {
    input,
    isAskOpen,
    askPageIndex,
    askDraftValues,
    submitStatus = null,
    isSubmitting,
    onAskOpen,
    onCancelInput,
    onAskPageChange,
    onAskDraftChange,
    onSubmitInput,
  } = props

  if (!input) return null
  const isAskInput = input.kind === 'ask_user_question'

  return (
    <div data-testid="input-approval-dock-host" className="absolute inset-x-0 bottom-4 px-4 pointer-events-none">
      <div className="mx-auto w-full max-w-[var(--input-approval-dock-max-width)] pointer-events-auto">
        {submitStatus ? (
          <div className="mb-3 rounded-xl border bg-background/95 px-3 py-2 text-xs text-muted-foreground">
            <span className={submitStatus.kind === 'error' ? 'text-red-600' : 'text-emerald-700'}>
              {submitStatus.status}
            </span>
            {submitStatus.message ? <span className="ml-2">{submitStatus.message}</span> : null}
          </div>
        ) : null}

        {isAskInput ? (
          isAskOpen ? (
            <AskQuestionPagerPanel
              inputId={input.inputId}
              questions={normalizeAskQuestions(input.payload)}
              pageIndex={askPageIndex}
              draftValues={askDraftValues}
              isSubmitting={isSubmitting}
              onDismiss={() => onCancelInput(input.inputId)}
              onPageChange={onAskPageChange}
              onDraftChange={onAskDraftChange}
              onSubmit={(answers) => onSubmitInput(input.inputId, answers)}
            />
          ) : (
            <div data-testid="ask-dock-collapsed" className="rounded-2xl border bg-background/95 px-4 py-3 shadow-sm">
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm text-muted-foreground">{t('inputApproval.pending')}</span>
                <Button type="button" size="sm" onClick={onAskOpen}>
                  {t('inputApproval.resume')}
                </Button>
              </div>
            </div>
          )
        ) : (
          <ApprovalSubmitPanel
            key={input.inputId}
            inputId={input.inputId}
            payload={input.payload}
            isSubmitting={isSubmitting}
            onSubmit={(answers) => onSubmitInput(input.inputId, answers)}
          />
        )}
      </div>
    </div>
  )
}
