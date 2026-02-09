import { AlertCircle } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import type { PendingInput } from '../types'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Label } from './ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select'
import { Textarea } from './ui/textarea'

export function statusVariant(status: string, kind: 'success' | 'error'): 'default' | 'secondary' | 'outline' | 'destructive' {
  if (kind === 'error') return 'destructive'
  if (status === 'already_submitted_same') return 'secondary'
  if (status === 'conflict_already_submitted') return 'outline'
  return 'default'
}

export function formatRemainingTime(expiresAt: string, now: number): string {
  const expiresMs = Date.parse(expiresAt)
  if (!Number.isFinite(expiresMs)) return 'unknown'
  const delta = expiresMs - now
  if (delta <= 0) return 'expired'
  const seconds = Math.floor(delta / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`
  const hours = Math.floor(minutes / 60)
  return `${hours}h ${minutes % 60}m`
}

export function isExpiredText(remainingText: string): boolean {
  return remainingText === 'expired'
}

function ApprovalContext({ input }: { input: PendingInput }) {
  const payload = input.payload ?? {}
  return (
    <div className="grid gap-2 rounded-lg border bg-muted/20 px-3 py-3">
      <div className="text-[11px] font-semibold text-foreground/70 flex items-center gap-2 uppercase tracking-wider">
          <AlertCircle className="h-3 w-3 text-primary" />
          Approval Context
      </div>
      <div className="grid gap-2 text-xs text-muted-foreground">
        <div className="flex items-center gap-2">
            <span className="font-medium text-foreground/60">Tool:</span> 
            <span className="font-mono bg-background px-1.5 py-0.5 rounded border border-border/50">{String(payload.toolName ?? 'unknown')}</span>
        </div>
        <div className="space-y-1.5">
            <span className="font-medium text-foreground/60">Action:</span>
            <pre className="max-h-40 overflow-auto rounded-md border bg-background/50 p-2.5 text-[10px] whitespace-pre-wrap font-mono leading-relaxed ring-1 ring-border/50">
             {JSON.stringify(payload.action ?? null, null, 2)}
            </pre>
        </div>
      </div>
    </div>
  )
}

export function ApprovalForm({
  input,
  onSubmit,
  isSubmitting,
  remainingText,
}: {
  input: PendingInput
  onSubmit: (answers: Record<string, string>) => void
  isSubmitting: boolean
  remainingText: string
}) {
  const [decision, setDecision] = useState('approve')
  const [scope, setScope] = useState('session')
  const [feedback, setFeedback] = useState('')
  const expired = isExpiredText(remainingText)

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (expired || isSubmitting) return
    const answers: Record<string, string> = { decision }
    if (decision === 'approve_remember') answers.scope = scope
    if (decision === 'feedback') answers.feedback = feedback
    onSubmit(answers)
  }

  return (
    <form className="grid gap-4" onSubmit={submit}>
      <div className="grid gap-2">
        <Label htmlFor={`approval-decision-${input.inputId}`} className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">Decision</Label>
        <Select value={decision} onValueChange={setDecision}>
          <SelectTrigger id={`approval-decision-${input.inputId}`} aria-label="Decision" className="w-full bg-background shadow-none border-border/60">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="approve">Approve</SelectItem>
            <SelectItem value="approve_remember">Approve & Remember</SelectItem>
            <SelectItem value="reject">Reject</SelectItem>
            <SelectItem value="feedback">Reject with Feedback</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {decision === 'approve_remember' ? (
        <div className="grid gap-2 animate-in fade-in slide-in-from-top-1 duration-200">
          <Label htmlFor={`approval-scope-${input.inputId}`} className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">Scope</Label>
          <Select value={scope} onValueChange={setScope}>
            <SelectTrigger id={`approval-scope-${input.inputId}`} aria-label="Scope" className="w-full bg-background shadow-none border-border/60">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="session">Session (Reset on reload)</SelectItem>
              <SelectItem value="workspace">Workspace (Persist)</SelectItem>
            </SelectContent>
          </Select>
        </div>
      ) : null}

      {decision === 'feedback' ? (
        <div className="grid gap-2 animate-in fade-in slide-in-from-top-1 duration-200">
          <Label htmlFor={`approval-feedback-${input.inputId}`} className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">Feedback</Label>
          <Textarea
            id={`approval-feedback-${input.inputId}`}
            value={feedback}
            onChange={(event) => setFeedback(event.target.value)}
            placeholder="Tell the agent why you rejected this..."
            className="min-h-[80px] bg-background shadow-none border-border/60"
          />
        </div>
      ) : null}

      <ApprovalContext input={input} />

      <Button type="submit" className="w-full h-10 shadow-sm transition-all active:scale-[0.98]" disabled={expired || isSubmitting}>
        {isSubmitting ? 'Submitting...' : 'Submit Decision'}
      </Button>
    </form>
  )
}

export function QuestionForm({
  input,
  onSubmit,
  isSubmitting,
  remainingText,
}: {
  input: PendingInput
  onSubmit: (answers: Record<string, string>) => void
  isSubmitting: boolean
  remainingText: string
}) {
  const questions = Array.isArray(input.payload?.questions) ? input.payload.questions : []
  const initial = Object.fromEntries(
    questions.map((question: any) => [String(question.fieldId || question.header || question.question || 'field'), '']),
  ) as Record<string, string>
  const [values, setValues] = useState<Record<string, string>>(initial)
  const expired = isExpiredText(remainingText)

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (expired || isSubmitting) return
    onSubmit(values)
  }

  return (
    <form className="grid gap-4" onSubmit={submit}>
      {questions.map((question: any) => {
        const key = String(question.fieldId || question.header || question.question || 'field')
        const options = Array.isArray(question.options) ? question.options : []

        return (
          <div key={key} className="grid gap-2">
            <Label htmlFor={`question-${input.inputId}-${key}`} className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">
                {question.header || question.question || key}
            </Label>
            {options.length > 0 ? (
              <Select value={values[key] ?? ''} onValueChange={(value) => setValues((prev) => ({ ...prev, [key]: value }))}>
                <SelectTrigger
                  id={`question-${input.inputId}-${key}`}
                  aria-label={String(question.header || question.question || key)}
                  className="w-full bg-background shadow-none border-border/60"
                >
                  <SelectValue placeholder="Select..." />
                </SelectTrigger>
                <SelectContent>
                  {options.map((option: any) => (
                    <SelectItem key={String(option.label)} value={String(option.label)}>
                      {String(option.label)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <Input
                id={`question-${input.inputId}-${key}`}
                value={values[key] ?? ''}
                onChange={(event) => setValues((prev) => ({ ...prev, [key]: event.target.value }))}
                className="bg-background shadow-none border-border/60"
              />
            )}
          </div>
        )
      })}

      <Button type="submit" className="w-full h-10 shadow-sm transition-all active:scale-[0.98]" disabled={expired || isSubmitting}>
        {isSubmitting ? 'Submitting...' : 'Submit Answer'}
      </Button>
    </form>
  )
}
