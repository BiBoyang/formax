import { useMemo, useState, type FormEvent } from 'react'
import { Button } from '../ui/button'
import { Textarea } from '../ui/textarea'
import { ApprovalOptionButton, ApprovalPanelSurface } from './PanelPrimitives'

type ApprovalSubmitPanelProps = {
  inputId: string
  payload: unknown
  isSubmitting: boolean
  onSubmit: (answers: Record<string, string>) => void
}

type DecisionKey = 'approve' | 'approve_remember' | 'reject' | 'feedback'
type ScopeKey = 'session' | 'project' | 'global'
type StepKey = 'decision' | 'scope'

function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
}

function getActionCommand(payload: Record<string, unknown>): string | null {
  const action = toRecord(payload.action)
  const command = action.command
  if (typeof command !== 'string') return null
  const trimmed = command.trim()
  return trimmed || null
}

function getPanelTitle(payload: Record<string, unknown>): string {
  const prompt = payload.prompt
  if (typeof prompt === 'string' && prompt.trim()) return prompt.trim()
  const title = payload.title
  if (typeof title === 'string' && title.trim()) return title.trim()
  const command = getActionCommand(payload)
  if (command) return 'Do you want to run this command?'
  return 'Do you want to allow this action?'
}

function getRememberDescription(command: string | null): string {
  if (!command) return 'Remember this allow decision so you are not asked again for this action pattern.'
  const prefix = command.split(/\s+/).slice(0, 3).join(' ')
  return `Remember for commands starting with: ${prefix}`
}

function hasWorkspaceDir(payload: Record<string, unknown>): boolean {
  const workspaceRequest = toRecord(payload.workspaceRequest)
  const workspaceDir = workspaceRequest.dir
  return typeof workspaceDir === 'string' && workspaceDir.trim().length > 0
}

function shouldPromptScopeStep(payload: Record<string, unknown>): boolean {
  const action = toRecord(payload.action)
  const actionKind = typeof action.kind === 'string' ? action.kind.trim() : ''

  if (!actionKind) return true
  if (actionKind === 'bash.exec') return false
  if (actionKind === 'fs.write') return false
  if (actionKind === 'fs.read' && hasWorkspaceDir(payload)) return false
  return true
}

export function ApprovalSubmitPanel(props: ApprovalSubmitPanelProps) {
  const { inputId, payload, isSubmitting, onSubmit } = props
  const payloadRecord = toRecord(payload)
  const command = getActionCommand(payloadRecord)
  const toolName = typeof payloadRecord.toolName === 'string' ? payloadRecord.toolName : 'Tool'
  const suggestions = Array.isArray(payloadRecord.suggestions)
    ? payloadRecord.suggestions.filter((line): line is string => typeof line === 'string' && line.trim().length > 0)
    : []

  const [decision, setDecision] = useState<DecisionKey>('approve')
  const [step, setStep] = useState<StepKey>('decision')
  const [scope, setScope] = useState<ScopeKey>('session')
  const [feedback, setFeedback] = useState('')

  const requiresScopeStep = shouldPromptScopeStep(payloadRecord)
  const decisionNeedsScopeStep = decision === 'approve_remember' && requiresScopeStep

  const stepLabel =
    step === 'scope'
      ? '2 of 2'
      : `1 of ${decisionNeedsScopeStep ? 2 : 1}`

  const decisionOptions = useMemo(
    () => [
      { key: 'approve' as const, label: 'Approve once', detail: 'Allow this action this time only.' },
      {
        key: 'approve_remember' as const,
        label: 'Approve and remember',
        detail: getRememberDescription(command),
      },
      { key: 'reject' as const, label: 'Reject', detail: 'Do not run this action.' },
      {
        key: 'feedback' as const,
        label: 'Reject with feedback',
        detail: 'Tell Codex what to do differently before retrying.',
      },
    ],
    [command],
  )

  const canSubmitDecisionStep = decision !== 'feedback' || feedback.trim().length > 0

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (isSubmitting) return

    if (step === 'scope') {
      onSubmit({ decision: 'approve_remember', scope })
      return
    }

    if (!canSubmitDecisionStep) return

    if (decisionNeedsScopeStep) {
      setStep('scope')
      return
    }

    const answers: Record<string, string> = { decision }
    if (decision === 'feedback') answers.feedback = feedback.trim()
    onSubmit(answers)
  }

  return (
    <ApprovalPanelSurface testId={`approval-submit-panel-${inputId}`} onSubmit={submit}>
      <div className="flex items-start justify-between gap-2 px-3">
        <h3 className="py-2 text-[15px] leading-tight font-semibold tracking-tight text-foreground">{getPanelTitle(payloadRecord)}</h3>
        <span aria-label="Approval step" className="pt-2 text-xs text-muted-foreground">
          {stepLabel}
        </span>
      </div>

      <div className="mt-1 rounded-xl bg-muted/35 px-3 py-2">
        {command ? (
          <div className="font-mono text-[12px] leading-relaxed text-foreground/85 [overflow-wrap:anywhere]">{command}</div>
        ) : (
          <div className="text-xs text-muted-foreground">Tool: {toolName}</div>
        )}
      </div>

      {suggestions.length > 0 ? (
        <div className="mt-2 space-y-1 px-1 text-xs text-muted-foreground">
          {suggestions.map((line, index) => (
            <div key={`${inputId}-suggestion-${index}`}>{line}</div>
          ))}
        </div>
      ) : null}

      {step === 'decision' ? (
        <>
          <div className="mt-2 space-y-1">
            {decisionOptions.map((option, index) => {
              const selected = decision === option.key
              return (
                <ApprovalOptionButton
                  key={option.key}
                  onClick={() => setDecision(option.key)}
                  selected={selected}
                  primaryText={`${index + 1}. ${option.label}`}
                  secondaryText={option.detail}
                />
              )
            })}
          </div>

          {decision === 'feedback' ? (
            <div className="mt-2">
              <Textarea
                aria-label="Approval feedback"
                value={feedback}
                onChange={(event) => setFeedback(event.target.value)}
                placeholder="Tell Codex what to do differently"
                className="min-h-[88px]"
              />
            </div>
          ) : null}

          <div className="mt-2 flex justify-end">
            <Button
              type="submit"
              disabled={isSubmitting || !canSubmitDecisionStep}
              className="h-8 rounded-full px-5 text-sm font-medium"
            >
              {isSubmitting ? 'Submitting...' : decisionNeedsScopeStep ? 'Continue' : 'Submit'}
            </Button>
          </div>
        </>
      ) : (
        <>
          <div className="mt-2">
            <div className="mb-2 px-1 text-xs text-muted-foreground">Choose where this remembered allow should apply.</div>
            <div className="space-y-1">
              <ApprovalOptionButton
                onClick={() => setScope('session')}
                selected={scope === 'session'}
                primaryText="1. Session"
                secondaryText="Only this active session."
              />
              <ApprovalOptionButton
                onClick={() => setScope('project')}
                selected={scope === 'project'}
                primaryText="2. Project"
                secondaryText="All sessions in this project folder."
              />
              <ApprovalOptionButton
                onClick={() => setScope('global')}
                selected={scope === 'global'}
                primaryText="3. Global"
                secondaryText="All projects on this machine."
              />
            </div>
          </div>

          <div className="mt-2 flex items-center justify-end gap-2">
            <Button type="button" variant="ghost" className="h-8 px-3 text-sm" onClick={() => setStep('decision')}>
              Back
            </Button>
            <Button type="submit" disabled={isSubmitting} className="h-8 rounded-full px-5 text-sm font-medium">
              {isSubmitting ? 'Submitting...' : 'Submit'}
            </Button>
          </div>
        </>
      )}
    </ApprovalPanelSurface>
  )
}
