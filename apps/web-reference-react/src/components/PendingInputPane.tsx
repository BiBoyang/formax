import { useState, type FormEvent } from 'react'
import type { PendingInput } from '../types'
import { Badge } from './ui/badge'
import { Button } from './ui/button'
import { Card } from './ui/card'
import { Input } from './ui/input'
import { Label } from './ui/label'
import { ScrollArea } from './ui/scroll-area'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './ui/select'
import { Separator } from './ui/separator'
import { Textarea } from './ui/textarea'

export type PendingInputPaneProps = {
  pendingInputs: Record<string, PendingInput>
  selectedInputId: string | null
  onSelectInput: (inputId: string) => void
  onSubmitInput: (answers: Record<string, string>) => void
}

export function PendingInputPane(props: PendingInputPaneProps) {
  const { pendingInputs, selectedInputId, onSelectInput, onSubmitInput } = props
  const selectedInput = selectedInputId ? pendingInputs[selectedInputId] : null
  const pendingList = Object.values(pendingInputs)

  return (
    <aside className="right-rail">
      <Card className="h-full gap-0 overflow-hidden py-0">
        <div className="flex items-center justify-between px-4 py-3">
          <h2 className="text-sm font-semibold">Pending Inputs</h2>
          <Badge variant="outline">{pendingList.length}</Badge>
        </div>

        <Separator />

        <ScrollArea className="max-h-56 px-2 py-2">
          <div className="space-y-1 px-1">
            {pendingList.map((input) => {
              const active = selectedInputId === input.inputId
              return (
                <Button
                  key={input.inputId}
                  type="button"
                  variant="ghost"
                  className={`h-auto w-full justify-start rounded-lg border px-3 py-2 text-left ${
                    active ? 'border-primary/35 bg-primary/10 hover:bg-primary/15' : 'border-transparent hover:bg-muted'
                  }`}
                  onClick={() => onSelectInput(input.inputId)}
                >
                  <div className="grid min-w-0 gap-0.5">
                    <span className="truncate text-sm font-medium">{input.kind === 'approval' ? 'Approval' : 'AskUserQuestion'}</span>
                    <span className="truncate text-xs text-muted-foreground">{input.toolUseId}</span>
                  </div>
                </Button>
              )
            })}
            {pendingList.length === 0 ? <div className="empty px-2 py-4">No pending input.</div> : null}
          </div>
        </ScrollArea>

        <Separator />

        {selectedInput ? (
          <div className="min-h-0 flex-1 overflow-auto p-4">
            <div className="mb-3 flex items-center justify-between gap-2">
              <h3 className="text-sm font-semibold">{selectedInput.kind === 'approval' ? 'Approval' : 'AskUserQuestion'}</h3>
              <Badge variant="secondary">{selectedInput.status}</Badge>
            </div>
            <div className="mb-4 grid gap-1 text-xs text-muted-foreground">
              <div>toolUseId: {selectedInput.toolUseId}</div>
              <div>inputId: {selectedInput.inputId}</div>
              <div>expiresAt: {selectedInput.expiresAt}</div>
            </div>

            {selectedInput.kind === 'approval' ? (
              <ApprovalForm key={selectedInput.inputId} input={selectedInput} onSubmit={onSubmitInput} />
            ) : (
              <QuestionForm key={selectedInput.inputId} input={selectedInput} onSubmit={onSubmitInput} />
            )}
          </div>
        ) : (
          <div className="empty p-4">Select an input to answer.</div>
        )}
      </Card>
    </aside>
  )
}

function ApprovalForm({ input, onSubmit }: { input: PendingInput; onSubmit: (answers: Record<string, string>) => void }) {
  const [decision, setDecision] = useState('approve')
  const [scope, setScope] = useState('session')
  const [feedback, setFeedback] = useState('')

  const submit = (event: FormEvent) => {
    event.preventDefault()
    const answers: Record<string, string> = { decision }
    if (decision === 'approve_remember') answers.scope = scope
    if (decision === 'feedback') answers.feedback = feedback
    onSubmit(answers)
  }

  return (
    <form className="grid gap-3" onSubmit={submit}>
      <div className="grid gap-1.5">
        <Label htmlFor={`approval-decision-${input.inputId}`}>Decision</Label>
        <Select value={decision} onValueChange={setDecision}>
          <SelectTrigger id={`approval-decision-${input.inputId}`} aria-label="Decision" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="approve">approve</SelectItem>
            <SelectItem value="approve_remember">approve_remember</SelectItem>
            <SelectItem value="reject">reject</SelectItem>
            <SelectItem value="feedback">feedback</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {decision === 'approve_remember' ? (
        <div className="grid gap-1.5">
          <Label htmlFor={`approval-scope-${input.inputId}`}>Scope</Label>
          <Select value={scope} onValueChange={setScope}>
            <SelectTrigger id={`approval-scope-${input.inputId}`} aria-label="Scope" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="session">session</SelectItem>
              <SelectItem value="workspace">workspace</SelectItem>
            </SelectContent>
          </Select>
        </div>
      ) : null}

      {decision === 'feedback' ? (
        <div className="grid gap-1.5">
          <Label htmlFor={`approval-feedback-${input.inputId}`}>Feedback</Label>
          <Textarea
            id={`approval-feedback-${input.inputId}`}
            value={feedback}
            onChange={(event) => setFeedback(event.target.value)}
          />
        </div>
      ) : null}

      <Button type="submit" className="justify-self-end">
        Submit Input
      </Button>
    </form>
  )
}

function QuestionForm({ input, onSubmit }: { input: PendingInput; onSubmit: (answers: Record<string, string>) => void }) {
  const questions = Array.isArray(input.payload?.questions) ? input.payload.questions : []
  const initial = Object.fromEntries(
    questions.map((question: any) => [String(question.fieldId || question.header || question.question || 'field'), '']),
  ) as Record<string, string>
  const [values, setValues] = useState<Record<string, string>>(initial)

  const submit = (event: FormEvent) => {
    event.preventDefault()
    onSubmit(values)
  }

  return (
    <form className="grid gap-3" onSubmit={submit}>
      {questions.map((question: any) => {
        const key = String(question.fieldId || question.header || question.question || 'field')
        const options = Array.isArray(question.options) ? question.options : []

        return (
          <div key={key} className="grid gap-1.5">
            <Label htmlFor={`question-${input.inputId}-${key}`}>{question.header || question.question || key}</Label>
            {options.length > 0 ? (
              <Select value={values[key] ?? ''} onValueChange={(value) => setValues((prev) => ({ ...prev, [key]: value }))}>
                <SelectTrigger
                  id={`question-${input.inputId}-${key}`}
                  aria-label={String(question.header || question.question || key)}
                  className="w-full"
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
              />
            )}
          </div>
        )
      })}

      <Button type="submit" className="justify-self-end">
        Submit Input
      </Button>
    </form>
  )
}
