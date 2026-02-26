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

const askMultiSelectInput: PendingInput = {
  inputId: 'ask-multi',
  threadId: 'thread-1',
  turnId: 'turn-1',
  toolUseId: 'tool-ask-multi',
  kind: 'ask_user_question',
  status: 'pending',
  createdAt: '2026-02-09T00:00:00.000Z',
  expiresAt: '2030-02-09T00:05:00.000Z',
  payload: {
    questions: [
      {
        header: 'Languages',
        question: 'Which languages do you use often?',
        fieldId: 'languages',
        options: [
          { label: 'TypeScript', description: 'Web and tooling' },
          { label: 'Python', description: 'Automation and scripts' },
          { label: 'Rust', description: 'Systems and performance' },
        ],
        multiSelect: true,
      },
    ],
  },
}

const askMultiSelectCommaLabelInput: PendingInput = {
  inputId: 'ask-multi-comma',
  threadId: 'thread-1',
  turnId: 'turn-1',
  toolUseId: 'tool-ask-multi-comma',
  kind: 'ask_user_question',
  status: 'pending',
  createdAt: '2026-02-09T00:00:00.000Z',
  expiresAt: '2030-02-09T00:05:00.000Z',
  payload: {
    questions: [
      {
        header: 'Languages',
        question: 'Pick all languages you use',
        fieldId: 'languages',
        options: [
          { label: 'C, C++', description: 'Comma in label' },
          { label: 'Rust', description: 'No comma' },
        ],
        multiSelect: true,
      },
    ],
  },
}

const approvalInputBash: PendingInput = {
  inputId: 'approval-bash-1',
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

const approvalInputScopeApplicable: PendingInput = {
  inputId: 'approval-read-1',
  threadId: 'thread-1',
  turnId: 'turn-1',
  toolUseId: 'tool-approval-read-1',
  kind: 'approval',
  status: 'pending',
  createdAt: '2026-02-09T00:00:00.000Z',
  expiresAt: '2030-02-09T00:05:00.000Z',
  payload: {
    toolName: 'Read',
    action: { kind: 'fs.read', path: '/tmp/outside.txt' },
    effectiveDecision: { decision: 'ask' },
  },
}

function AskHarness(props: {
  input?: PendingInput
  onSubmitInput?: (inputId: string, answers: Record<string, string>) => void
}) {
  const input = props.input ?? askInput
  const onSubmitInput = props.onSubmitInput ?? vi.fn()
  const [isOpen, setIsOpen] = useState(true)
  const [pageIndex, setPageIndex] = useState(0)
  const [draftValues, setDraftValues] = useState<Record<string, string>>({})

  return (
    <InputApprovalDock
      input={input}
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

  it('submits bash remember directly without entering scope step', () => {
    const onSubmitInput = vi.fn()
    render(
      <InputApprovalDock
        input={approvalInputBash}
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
    expect(screen.getByLabelText('Approval step')).toHaveTextContent('1 of 1')

    fireEvent.click(screen.getByRole('button', { name: /2\. Approve and remember/i }))
    expect(screen.getByRole('button', { name: 'Submit' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }))

    expect(onSubmitInput).toHaveBeenCalledWith('approval-bash-1', { decision: 'approve_remember' })
  })

  it('uses two-step approval flow and submits selected scope when applicable', () => {
    const onSubmitInput = vi.fn()
    render(
      <InputApprovalDock
        input={approvalInputScopeApplicable}
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

    expect(screen.getByLabelText('Approval step')).toHaveTextContent('1 of 1')

    fireEvent.click(screen.getByRole('button', { name: /2\. Approve and remember/i }))
    expect(screen.getByLabelText('Approval step')).toHaveTextContent('1 of 2')

    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    expect(screen.getByLabelText('Approval step')).toHaveTextContent('2 of 2')

    fireEvent.click(screen.getByRole('button', { name: /2\. Project/i }))
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }))

    expect(onSubmitInput).toHaveBeenCalledWith('approval-read-1', {
      decision: 'approve_remember',
      scope: 'project',
    })
  })

  it('supports multi-select ask and submits comma-separated answer string', () => {
    const onSubmitInput = vi.fn()
    render(<AskHarness input={askMultiSelectInput} onSubmitInput={onSubmitInput} />)

    const submitButton = screen.getByRole('button', { name: 'Submit' })
    expect(submitButton).toBeDisabled()

    fireEvent.click(screen.getByRole('button', { name: /1\. TypeScript/i }))
    fireEvent.click(screen.getByRole('button', { name: /3\. Rust/i }))
    expect(screen.getByRole('button', { name: 'Submit' })).toBeEnabled()

    fireEvent.click(screen.getByRole('button', { name: 'Submit' }))

    expect(onSubmitInput).toHaveBeenCalledWith('ask-multi', {
      languages: 'TypeScript, Rust',
    })
  })

  it('preserves comma-containing labels in multi-select answers', () => {
    const onSubmitInput = vi.fn()
    render(<AskHarness input={askMultiSelectCommaLabelInput} onSubmitInput={onSubmitInput} />)

    fireEvent.click(screen.getByRole('button', { name: /1\. C, C\+\+/i }))
    fireEvent.click(screen.getByRole('button', { name: /2\. Rust/i }))
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }))

    expect(onSubmitInput).toHaveBeenCalledWith('ask-multi-comma', {
      languages: 'C, C++, Rust',
    })
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
