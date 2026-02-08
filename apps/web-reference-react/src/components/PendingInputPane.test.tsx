import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { PendingInputPane } from './PendingInputPane'

function selectOption(name: string, value: string) {
  fireEvent.click(screen.getByRole('combobox', { name }))
  const candidates = screen.getAllByText(value)
  fireEvent.click(candidates[candidates.length - 1]!)
}

describe('PendingInputPane', () => {
  it('submits approval answers with remember scope', () => {
    const onSelectInput = vi.fn()
    const onSubmitInput = vi.fn()

    const approvalInput = {
      inputId: 'input-approval',
      threadId: 'thread-1',
      turnId: 'turn-1',
      toolUseId: 'tool-approval-1',
      kind: 'approval' as const,
      status: 'pending' as const,
      createdAt: '2026-02-09T00:00:00.000Z',
      expiresAt: '2026-02-09T00:05:00.000Z',
      payload: {
        toolName: 'Bash',
        action: { kind: 'bash.exec' },
        effectiveDecision: { decision: 'ask' },
      },
    }

    render(
      <PendingInputPane
        pendingInputs={{ [approvalInput.inputId]: approvalInput }}
        selectedInputId={approvalInput.inputId}
        onSelectInput={onSelectInput}
        onSubmitInput={onSubmitInput}
      />,
    )

    selectOption('Decision', 'approve_remember')
    selectOption('Scope', 'workspace')
    fireEvent.click(screen.getByRole('button', { name: 'Submit Input' }))

    expect(onSubmitInput).toHaveBeenCalledWith({
      decision: 'approve_remember',
      scope: 'workspace',
    })
  })

  it('submits ask_user_question answers from select options', () => {
    const onSelectInput = vi.fn()
    const onSubmitInput = vi.fn()

    const questionInput = {
      inputId: 'input-question',
      threadId: 'thread-1',
      turnId: 'turn-1',
      toolUseId: 'tool-question-1',
      kind: 'ask_user_question' as const,
      status: 'pending' as const,
      createdAt: '2026-02-09T00:00:00.000Z',
      expiresAt: '2026-02-09T00:05:00.000Z',
      payload: {
        questions: [
          {
            header: 'Choice',
            question: 'Pick one',
            fieldId: 'choice',
            options: [
              { label: 'A', description: 'Option A' },
              { label: 'B', description: 'Option B' },
            ],
            multiSelect: false,
          },
        ],
      },
    }

    render(
      <PendingInputPane
        pendingInputs={{ [questionInput.inputId]: questionInput }}
        selectedInputId={questionInput.inputId}
        onSelectInput={onSelectInput}
        onSubmitInput={onSubmitInput}
      />,
    )

    selectOption('Choice', 'B')
    fireEvent.click(screen.getByRole('button', { name: 'Submit Input' }))

    expect(onSubmitInput).toHaveBeenCalledWith({ choice: 'B' })
  })
})
