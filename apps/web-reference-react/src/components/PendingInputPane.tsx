import { useState, type FormEvent } from 'react'
import type { PendingInput } from '../types'

export type PendingInputPaneProps = {
  pendingInputs: Record<string, PendingInput>
  selectedInputId: string | null
  onSelectInput: (inputId: string) => void
  onSubmitInput: (answers: Record<string, string>) => void
}

export function PendingInputPane(props: PendingInputPaneProps) {
  const { pendingInputs, selectedInputId, onSelectInput, onSubmitInput } = props
  const selectedInput = selectedInputId ? pendingInputs[selectedInputId] : null

  return (
    <aside className="right-rail">
      <h2>Pending Inputs</h2>
      <div className="pending-list">
        {Object.values(pendingInputs).map((input) => (
          <button
            key={input.inputId}
            className={`pending-item ${selectedInputId === input.inputId ? 'active' : ''}`}
            onClick={() => onSelectInput(input.inputId)}
          >
            <div>{input.kind}</div>
            <div className="pending-meta">{input.toolUseId}</div>
          </button>
        ))}
        {Object.keys(pendingInputs).length === 0 && <div className="empty">No pending input.</div>}
      </div>

      {selectedInput && (
        <div className="input-panel">
          <h3>{selectedInput.kind === 'approval' ? 'Approval' : 'AskUserQuestion'}</h3>
          {selectedInput.kind === 'approval' ? (
            <ApprovalForm key={selectedInput.inputId} input={selectedInput} onSubmit={onSubmitInput} />
          ) : (
            <QuestionForm key={selectedInput.inputId} input={selectedInput} onSubmit={onSubmitInput} />
          )}
        </div>
      )}
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
    <form className="input-form" onSubmit={submit}>
      <p className="pending-meta">{input.toolUseId}</p>
      <label>
        Decision
        <select value={decision} onChange={(event) => setDecision(event.target.value)}>
          <option value="approve">approve</option>
          <option value="approve_remember">approve_remember</option>
          <option value="reject">reject</option>
          <option value="feedback">feedback</option>
        </select>
      </label>
      {decision === 'approve_remember' && (
        <label>
          Scope
          <select value={scope} onChange={(event) => setScope(event.target.value)}>
            <option value="session">session</option>
            <option value="workspace">workspace</option>
          </select>
        </label>
      )}
      {decision === 'feedback' && (
        <label>
          Feedback
          <textarea value={feedback} onChange={(event) => setFeedback(event.target.value)} />
        </label>
      )}
      <button type="submit">Submit Input</button>
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
    <form className="input-form" onSubmit={submit}>
      {questions.map((question: any) => {
        const key = String(question.fieldId || question.header || question.question || 'field')
        const options = Array.isArray(question.options) ? question.options : []

        return (
          <label key={key}>
            {question.header || question.question || key}
            {options.length > 0 ? (
              <select value={values[key] ?? ''} onChange={(event) => setValues((prev) => ({ ...prev, [key]: event.target.value }))}>
                <option value="">Select...</option>
                {options.map((option: any) => (
                  <option key={String(option.label)} value={String(option.label)}>
                    {String(option.label)}
                  </option>
                ))}
              </select>
            ) : (
              <input value={values[key] ?? ''} onChange={(event) => setValues((prev) => ({ ...prev, [key]: event.target.value }))} />
            )}
          </label>
        )
      })}

      <button type="submit">Submit Input</button>
    </form>
  )
}
