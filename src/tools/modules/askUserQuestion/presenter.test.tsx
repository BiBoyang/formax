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
let lastBlockProps: null | { toolUseId: string; questions: any[] } = null

vi.mock('../../runtime/userInputContext', () => ({
  useUserInputManager: () => userInput,
}))

vi.mock('../../presenters/AskUserQuestionToolBlock', () => ({
  AskUserQuestionToolBlock: (props: any) => {
    lastBlockProps = props
    return React.createElement(Text, null, 'AskUserQuestion Interactive')
  },
  parseQuestions: (input: any) => {
    const raw = Array.isArray(input?.questions) ? input.questions : []
    return raw.map((q: any, i: number) => ({
      question: String(q?.question ?? ''),
      header: String(q?.header || `Q${i + 1}`),
      options: Array.isArray(q?.options)
        ? q.options.map((o: any) => ({
            label: String(o?.label ?? ''),
            description: String(o?.description ?? ''),
          }))
        : [],
      multiSelect: Boolean(q?.multiSelect),
    }))
  },
  parseAnswers: (raw: string) => {
    const trimmed = (raw || '').trim()
    if (!trimmed) return null
    try {
      const parsed = JSON.parse(trimmed)
      const answers = parsed?.answers
      if (!answers || typeof answers !== 'object') return null
      const out: Record<string, string> = {}
      for (const [k, v] of Object.entries(answers)) out[String(k)] = String(v)
      return out
    } catch {
      return null
    }
  },
}))

function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 5))
}

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
    expect(frame).toContain('1 questions')
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
