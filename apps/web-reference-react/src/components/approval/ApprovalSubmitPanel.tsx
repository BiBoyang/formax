import { useMemo, useState, type FormEvent } from 'react'
import { Button } from '../ui/button'
import { Textarea } from '../ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select'

type ApprovalSubmitPanelProps = {
  inputId: string
  payload: unknown
  isSubmitting: boolean
  onSubmit: (answers: Record<string, string>) => void
}

type DecisionKey = 'approve' | 'approve_remember' | 'reject' | 'feedback'

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

function getRememberLabel(command: string | null): string {
  if (!command) return "Yes, and don't ask again in this session"
  const prefix = command.split(/\s+/).slice(0, 3).join(' ')
  return `Yes, and don't ask again for commands that start with ${prefix}`
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
  const [scope, setScope] = useState('session')
  const [feedback, setFeedback] = useState('')

  const decisionOptions = useMemo(
    () => [
      { key: 'approve' as const, label: 'Yes' },
      { key: 'approve_remember' as const, label: getRememberLabel(command) },
      { key: 'reject' as const, label: 'No' },
      { key: 'feedback' as const, label: 'No, and tell Codex what to do differently' },
    ],
    [command],
  )

  const canSubmit = decision !== 'feedback' || feedback.trim().length > 0

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (isSubmitting || !canSubmit) return
    const answers: Record<string, string> = { decision }
    if (decision === 'approve_remember') answers.scope = scope
    if (decision === 'feedback') answers.feedback = feedback.trim()
    onSubmit(answers)
  }

  return (
    <form
      data-testid={`approval-submit-panel-${inputId}`}
      onSubmit={submit}
      className="rounded-[24px] border bg-background/98 px-6 py-5 shadow-[0_18px_50px_rgba(0,0,0,0.10)]"
    >
      <h3 className="text-[38px] leading-tight font-semibold tracking-tight text-foreground">{getPanelTitle(payloadRecord)}</h3>

      <div className="mt-4 rounded-xl bg-muted/35 px-4 py-3">
        {command ? (
          <div className="font-mono text-[32px] text-foreground/85 [overflow-wrap:anywhere]">{command}</div>
        ) : (
          <div className="text-sm text-muted-foreground">Tool: {toolName}</div>
        )}
      </div>

      {suggestions.length > 0 ? (
        <div className="mt-3 space-y-1 text-xs text-muted-foreground">
          {suggestions.map((line, index) => (
            <div key={`${inputId}-suggestion-${index}`}>{line}</div>
          ))}
        </div>
      ) : null}

      <div className="mt-4 space-y-2">
        {decisionOptions.map((option, index) => {
          const selected = decision === option.key
          return (
            <button
              key={option.key}
              type="button"
              onClick={() => setDecision(option.key)}
              className={[
                'w-full rounded-xl px-4 py-3 text-left transition',
                selected ? 'bg-muted text-foreground' : 'hover:bg-muted/60 text-foreground/90',
              ].join(' ')}
            >
              <span className="text-[33px] leading-tight font-medium">{`${index + 1}. ${option.label}`}</span>
            </button>
          )
        })}
      </div>

      {decision === 'approve_remember' ? (
        <div className="mt-3">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Scope</div>
          <Select value={scope} onValueChange={setScope}>
            <SelectTrigger aria-label="Approval scope" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="session">Session</SelectItem>
              <SelectItem value="project">Project</SelectItem>
              <SelectItem value="global">Global</SelectItem>
            </SelectContent>
          </Select>
        </div>
      ) : null}

      {decision === 'feedback' ? (
        <div className="mt-3">
          <Textarea
            aria-label="Approval feedback"
            value={feedback}
            onChange={(event) => setFeedback(event.target.value)}
            placeholder="Tell Codex what to do differently"
            className="min-h-[88px]"
          />
        </div>
      ) : null}

      <div className="mt-5 flex justify-end">
        <Button type="submit" disabled={isSubmitting || !canSubmit} className="rounded-full px-6">
          {isSubmitting ? 'Submitting...' : 'Submit'}
        </Button>
      </div>
    </form>
  )
}
