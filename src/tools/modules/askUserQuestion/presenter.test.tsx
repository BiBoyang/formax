import { beforeEach, describe, expect, it, vi } from 'vitest'
import React from 'react'
import { Text } from 'ink'
import { render } from 'ink-testing-library'
import type { Msg } from '../../../components/tool/ToolMessage'
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

vi.mock('../../presenters/AskUserQuestionToolBlock', () => ({
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
