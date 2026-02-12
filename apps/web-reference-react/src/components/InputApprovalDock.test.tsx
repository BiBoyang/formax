import { fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import type { PendingInput } from '../types'
import { InputApprovalDock } from './InputApprovalDock'

const askInput: PendingInput = {
  inputId: 'ask-1',
  threadId: 'thread-1',
  turnId: 'turn-1',
  toolUseId: 'tool-ask-1',
  kind: 'ask_user_question',
  status: 'pending',
  createdAt: '2026-02-09T00:00:00.000Z',
  expiresAt: '2030-02-09T00:05:00.000Z',
  payload: {
    questions: [
      {
        header: 'Environment',
        question: 'Which OS do you use most?',
        fieldId: 'os',
        options: [
          { label: 'macOS', description: 'Apple device' },
          { label: 'Windows', description: 'PC device' },
        ],
        multiSelect: false,
      },
      {
        header: 'Theme',
        question: 'Light or dark?',
        fieldId: 'theme',
        options: [
          { label: 'Light', description: 'Bright UI' },
          { label: 'Dark', description: 'Low-light UI' },
        ],
        multiSelect: false,
      },
    ],
  },
}

const approvalInput: PendingInput = {
  inputId: 'approval-1',
  threadId: 'thread-1',
  turnId: 'turn-1',
  toolUseId: 'tool-approval-1',
  kind: 'approval',
  status: 'pending',
  createdAt: '2026-02-09T00:00:00.000Z',
  expiresAt: '2030-02-09T00:05:00.000Z',
  payload: {
    toolName: 'Bash',
    action: { kind: 'bash.exec', command: 'rm -rf a.js && ls -l a.js' },
    effectiveDecision: { decision: 'ask' },
  },
}

function AskHarness(props: { onSubmitInput?: (inputId: string, answers: Record<string, string>) => void }) {
  const onSubmitInput = props.onSubmitInput ?? vi.fn()
  const [isOpen, setIsOpen] = useState(true)
  const [pageIndex, setPageIndex] = useState(0)
  const [draftValues, setDraftValues] = useState<Record<string, string>>({})

  return (
    <InputApprovalDock
      input={askInput}
      isAskOpen={isOpen}
      askPageIndex={pageIndex}
      askDraftValues={draftValues}
      isSubmitting={false}
      onAskOpen={() => setIsOpen(true)}
      onAskDismiss={() => setIsOpen(false)}
      onAskPageChange={setPageIndex}
      onAskDraftChange={(fieldId, value) => {
        setDraftValues((prev) => ({ ...prev, [fieldId]: value }))
      }}
      onSubmitInput={onSubmitInput}
    />
  )
}

describe('InputApprovalDock', () => {
  it('renders ask_user_question as pager with 1 of N and submits all answers on last page', () => {
    const onSubmitInput = vi.fn()
    render(<AskHarness onSubmitInput={onSubmitInput} />)

    expect(screen.getByLabelText('Question index')).toHaveTextContent('1 of 2')
    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled()

    fireEvent.click(screen.getByRole('button', { name: /1\. macOS/i }))
    expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled()
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))

    expect(screen.getByLabelText('Question index')).toHaveTextContent('2 of 2')
    fireEvent.click(screen.getByRole('button', { name: /1\. Light/i }))
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }))

    expect(onSubmitInput).toHaveBeenCalledWith('ask-1', { os: 'macOS', theme: 'Light' })
  })

  it('supports ask dismiss and esc collapse while keeping draft', () => {
    render(<AskHarness />)

    fireEvent.click(screen.getByRole('button', { name: /1\. macOS/i }))
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(screen.getByTestId('ask-dock-collapsed')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Resume' }))
    expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled()

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.getByTestId('ask-dock-collapsed')).toBeInTheDocument()
  })

  it('renders approval without pager or dismiss and submits decision', () => {
    const onSubmitInput = vi.fn()
    render(
      <InputApprovalDock
        input={approvalInput}
        isAskOpen
        askPageIndex={0}
        askDraftValues={{}}
        isSubmitting={false}
        onAskOpen={vi.fn()}
        onAskDismiss={vi.fn()}
        onAskPageChange={vi.fn()}
        onAskDraftChange={vi.fn()}
        onSubmitInput={onSubmitInput}
      />,
    )

    expect(screen.queryByLabelText('Question index')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Dismiss' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /3\. No/i }))
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }))
    expect(onSubmitInput).toHaveBeenCalledWith('approval-1', { decision: 'reject' })
  })

  it('renders recoverable fallback when ask payload has no questions', () => {
    render(
      <InputApprovalDock
        input={{ ...askInput, inputId: 'ask-empty', payload: { questions: [] } }}
        isAskOpen
        askPageIndex={0}
        askDraftValues={{}}
        isSubmitting={false}
        onAskOpen={vi.fn()}
        onAskDismiss={vi.fn()}
        onAskPageChange={vi.fn()}
        onAskDraftChange={vi.fn()}
        onSubmitInput={vi.fn()}
      />,
    )

    expect(screen.getByText('No questions available')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Dismiss' })).toBeInTheDocument()
  })
})
