import { beforeEach, describe, expect, it, vi } from 'vitest'
import React from 'react'
import { Text } from 'ink'
import { render } from 'ink-testing-library'
import type { Msg } from '../../../shared/toolMessageTypes'
import { ToolUiBlocks } from '../../../components/tool/ToolUiBlocks'
import { AskUserQuestionToolPresenter } from './presenter'

type MockUserInput = {
  isPending: (toolUseId: string) => boolean
  submitAnswers: (toolUseId: string, answers: unknown) => void
}

let userInput: null | MockUserInput = null
let lastBlockProps: null | { toolUseId: string; questions: unknown[] } = null

vi.mock('../../runtime/userInputContext', () => ({
  useUserInputManager: () => userInput,
}))

vi.mock('../../../components/tool/AskUserQuestionToolBlock', () => ({
  AskUserQuestionToolBlock: (props: { toolUseId: string; questions: unknown[] }) => {
    lastBlockProps = props
    return React.createElement(Text, null, 'AskUserQuestion Interactive')
  },
}))

function createRunningAskMessage(): Msg {
  return {
    id: 'tool-1',
    role: 'tool',
    content: '',
    timestamp: new Date(),
    toolInfo: {
      name: 'AskUserQuestion',
      status: 'running',
      input: {
        questions: [
          {
            question: 'Pick one',
            header: 'Tech',
            multiSelect: false,
            options: [
              { label: 'Option A', description: '' },
              { label: 'Option B', description: '' },
            ],
          },
        ],
      },
    },
  }
}

describe('AskUserQuestionToolPresenter', () => {
  beforeEach(() => {
    userInput = null
    lastBlockProps = null
  })

  it('running/pending shows questions header and interactive block', () => {
    userInput = { isPending: () => true, submitAnswers: vi.fn() }

    const message = createRunningAskMessage()
    const { lastFrame } = render(<ToolUiBlocks blocks={AskUserQuestionToolPresenter({ message }).blocks} />)

    const frame = lastFrame()
    expect(frame).toContain('AskUserQuestion(')
    expect(frame).toContain('1 question')
    expect(frame).toContain('AskUserQuestion Interactive')
    expect(lastBlockProps).not.toBe(null)
    expect(lastBlockProps?.toolUseId).toBe('1')
    expect(lastBlockProps?.questions).toHaveLength(1)
  })

  it('running falls back to message id when toolUseId is absent', () => {
    userInput = { isPending: () => true, submitAnswers: vi.fn() }
    const message = createRunningAskMessage()
    message.id = 'ask-id-without-prefix'

    render(<ToolUiBlocks blocks={AskUserQuestionToolPresenter({ message }).blocks} />)
    expect(lastBlockProps?.toolUseId).toBe('ask-id-without-prefix')
  })

  it('completed shows answered state with answers', () => {
    const message: Msg = {
      id: 'tool-2',
      role: 'tool',
      content: '',
      timestamp: new Date(),
      toolInfo: {
        name: 'AskUserQuestion',
        status: 'completed',
        input: {
          questions: [
            {
              question: 'Pick one',
              header: 'Tech',
              multiSelect: false,
              options: [{ label: 'Option A', description: '' }],
            },
          ],
        },
        result: JSON.stringify({ answers: { Tech: 'Option A' } }),
      },
    }

    const { lastFrame } = render(<ToolUiBlocks blocks={AskUserQuestionToolPresenter({ message }).blocks} />)
    const frame = lastFrame()
    expect(frame).toContain('AskUserQuestion(')
    expect(frame).toContain('Answered')
    expect(frame).toContain('Tech: Option A')
  })

  it('completed uses question header for fieldId-keyed answers', () => {
    const message: Msg = {
      id: 'tool-2b',
      role: 'tool',
      content: '',
      timestamp: new Date(),
      toolInfo: {
        name: 'AskUserQuestion',
        status: 'completed',
        input: {
          questions: [
            {
              question: 'Pick one',
              header: 'Platform',
              fieldId: 'platform',
              multiSelect: false,
              options: [{ label: 'Mac', description: '' }],
            },
          ],
        },
        result: JSON.stringify({ answers: { platform: 'Mac' } }),
      },
    }

    const { lastFrame } = render(<ToolUiBlocks blocks={AskUserQuestionToolPresenter({ message }).blocks} />)
    const frame = lastFrame()
    expect(frame).toContain('Platform: Mac')
    expect(frame).not.toContain('platform: Mac')
  })

  it('completed falls back to raw answer key when no matching label exists', () => {
    const message: Msg = {
      id: 'tool-2c',
      role: 'tool',
      content: '',
      timestamp: new Date(),
      toolInfo: {
        name: 'AskUserQuestion',
        status: 'completed',
        input: {
          questions: [
            {
              question: 'Pick one',
              header: '',
              multiSelect: false,
              options: [{ label: 'A', description: '' }],
            },
          ],
        },
        result: JSON.stringify({ answers: { unknown_key: 'A' } }),
      },
    }

    const { lastFrame } = render(<ToolUiBlocks blocks={AskUserQuestionToolPresenter({ message }).blocks} />)
    const frame = lastFrame()
    expect(frame).toContain('unknown_key: A')
  })

  it('completed without answers shows no answers', () => {
    const message: Msg = {
      id: 'tool-3',
      role: 'tool',
      content: '',
      timestamp: new Date(),
      toolInfo: {
        name: 'AskUserQuestion',
        status: 'completed',
        input: {
          questions: [
            {
              question: 'Pick one',
              header: 'Tech',
              multiSelect: false,
              options: [{ label: 'Option A', description: '' }],
            },
          ],
        },
        result: '',
      },
    }

    const { lastFrame } = render(<ToolUiBlocks blocks={AskUserQuestionToolPresenter({ message }).blocks} />)
    const frame = lastFrame()
    expect(frame).toContain('AskUserQuestion(')
    expect(frame).toContain('No answers')
  })

  it('error with Request aborted returns empty blocks', () => {
    const message: Msg = {
      id: 'tool-4',
      role: 'tool',
      content: '',
      timestamp: new Date(),
      toolInfo: {
        name: 'AskUserQuestion',
        status: 'error',
        input: { questions: [] },
        result: 'Error: Request aborted',
      },
    }

    const result = AskUserQuestionToolPresenter({ message })
    expect(result.blocks).toHaveLength(0)
  })

  it('handles non-ask prompt model and non-string result', () => {
    const message: Msg = {
      id: 'tool-non-ask',
      role: 'tool',
      content: '',
      timestamp: new Date(),
      toolInfo: {
        name: 'Read',
        status: 'error',
        input: { anything: true },
        result: { unexpected: true } as any,
      },
    }

    const { lastFrame } = render(<ToolUiBlocks blocks={AskUserQuestionToolPresenter({ message }).blocks} />)
    const frame = lastFrame()
    expect(frame).toContain('AskUserQuestion(')
    expect(frame).toContain('No answers')
  })

  it('renders fallback when toolInfo is missing', () => {
    const message: Msg = {
      id: 'tool-5',
      role: 'tool',
      content: '',
      timestamp: new Date(),
    }

    const { lastFrame } = render(<ToolUiBlocks blocks={AskUserQuestionToolPresenter({ message }).blocks} />)
    expect(lastFrame()).toContain('Unknown tool')
  })
})
