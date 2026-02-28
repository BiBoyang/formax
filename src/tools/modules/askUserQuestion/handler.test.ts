import { describe, it, expect, vi } from 'vitest'
import { createUserInputManager } from '../../runtime/userInputManager'
import { createAskUserQuestionToolHandler } from './handler'

describe('AskUserQuestionToolHandler', () => {
  it('matches only AskUserQuestion tool name', () => {
    const userInput = createUserInputManager()
    const handler = createAskUserQuestionToolHandler(userInput)
    expect(handler.canHandle('AskUserQuestion')).toBe(true)
    expect(handler.canHandle('Read')).toBe(false)
  })

  it('returns collected answers', async () => {
    const userInput = createUserInputManager()
    const handler = createAskUserQuestionToolHandler(userInput)
    const onEvent = vi.fn()

    const call = {
      id: 'ask-1',
      name: 'AskUserQuestion',
      input: {
        questions: [
          {
            question: 'Pick one?',
            header: 'Choice',
            options: [
              { label: 'A', description: 'Option A' },
              { label: 'B', description: 'Option B' },
            ],
            multiSelect: false,
          },
        ],
      },
    } as any

    const exec = handler.execute(call, { cwd: process.cwd(), agentDepth: 0, onEvent })
    userInput.submitAnswers('ask-1', { Choice: 'A' })

    const res = await exec
    const parsed = JSON.parse(res.content)
    expect(parsed).toEqual({ answers: { Choice: 'A' } })
    expect(onEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'ask_user_question',
        toolUseId: 'ask-1',
      }),
    )
  })

  it('accepts prefilled answers in input', async () => {
    const userInput = createUserInputManager()
    const handler = createAskUserQuestionToolHandler(userInput)

    const res = await handler.execute(
      {
        id: 'ask-prefill',
        name: 'AskUserQuestion',
        input: {
          questions: [
            {
              question: 'Pick one?',
              header: 'Choice',
              options: [
                { label: 'A', description: 'Option A' },
                { label: 'B', description: 'Option B' },
              ],
              multiSelect: false,
            },
          ],
          answers: { Choice: 'B' },
        },
      } as any,
      { cwd: process.cwd(), agentDepth: 0 },
    )

    expect(res.is_error).toBeUndefined()
    expect(JSON.parse(res.content)).toEqual({ answers: { Choice: 'B' } })
  })

  it('returns error when questions are missing', async () => {
    const userInput = createUserInputManager()
    const handler = createAskUserQuestionToolHandler(userInput)

    const res = await handler.execute(
      { id: '1', name: 'AskUserQuestion', input: {} } as any,
      { cwd: process.cwd(), agentDepth: 0 },
    )

    expect(res.is_error).toBe(true)
    expect(res.content).toContain('Missing required field questions')
  })

  it('returns error when input is omitted', async () => {
    const userInput = createUserInputManager()
    const handler = createAskUserQuestionToolHandler(userInput)

    const res = await handler.execute({ id: '1b', name: 'AskUserQuestion' } as any, {
      cwd: process.cwd(),
      agentDepth: 0,
    })

    expect(res.is_error).toBe(true)
    expect(res.content).toContain('Missing required field questions')
  })

  it('works inside a sub-agent', async () => {
    const userInput = createUserInputManager()
    const handler = createAskUserQuestionToolHandler(userInput)

    const exec = handler.execute(
      {
        id: 'ask-2',
        name: 'AskUserQuestion',
        input: {
          questions: [
            {
              question: 'Pick one?',
              header: 'Choice',
              options: [
                { label: 'A', description: 'Option A' },
                { label: 'B', description: 'Option B' },
              ],
              multiSelect: false,
            },
          ],
        },
      } as any,
      { cwd: process.cwd(), agentDepth: 1 },
    )

    userInput.submitAnswers('ask-2', { Choice: 'B' })
    const res = await exec
    expect(res.is_error).toBeUndefined()
    const parsed = JSON.parse(res.content)
    expect(parsed.answers).toEqual({ Choice: 'B' })
  })

  it('passes through optional fieldId for compatibility', async () => {
    const userInput = createUserInputManager()
    const handler = createAskUserQuestionToolHandler(userInput)
    const onEvent = vi.fn()

    const exec = handler.execute(
      {
        id: 'ask-3',
        name: 'AskUserQuestion',
        input: {
          questions: [
            {
              question: 'Pick one?',
              header: 'Choice',
              fieldId: 'choice_id',
              options: [{ label: 'A', description: 'Option A' }],
              multiSelect: false,
            },
          ],
        },
      } as any,
      { cwd: process.cwd(), agentDepth: 0, onEvent },
    )

    userInput.submitAnswers('ask-3', { choice_id: 'A' })
    await exec

    expect(onEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'ask_user_question',
        questions: [expect.objectContaining({ fieldId: 'choice_id', header: 'Choice' })],
      }),
    )
  })

  it('normalizes malformed question fields and options in prefilled mode', async () => {
    const userInput = createUserInputManager()
    const handler = createAskUserQuestionToolHandler(userInput)

    const res = await handler.execute(
      {
        id: 'ask-normalize',
        name: 'AskUserQuestion',
        input: {
          questions: [
            null,
            {
              question: 123,
              header: null,
              fieldId: '   ',
              options: [{}],
              multiSelect: 'yes',
            },
            {
              question: 'Q',
              header: 'H',
              options: 'not-array',
              multiSelect: false,
            },
          ],
          answers: { existing: 1 },
        },
      } as any,
      { cwd: process.cwd(), agentDepth: 0 },
    )

    expect(res.is_error).toBeUndefined()
    expect(JSON.parse(res.content)).toEqual({ answers: { existing: '1' } })
  })

  it('returns error when input includes unknown fields', async () => {
    const userInput = createUserInputManager()
    const handler = createAskUserQuestionToolHandler(userInput)

    const res = await handler.execute(
      {
        id: 'ask-extra',
        name: 'AskUserQuestion',
        input: { questions: [{ question: 'Q', header: 'H' }], extra: true },
      } as any,
      { cwd: process.cwd(), agentDepth: 0 },
    )

    expect(res.is_error).toBe(true)
    expect(res.content).toContain('unknown field')
  })

  it('converts non-Error throwables into error text', async () => {
    const userInput = createUserInputManager()
    const handler = createAskUserQuestionToolHandler(userInput)
    const call = { id: 'ask-err', name: 'AskUserQuestion' } as any
    Object.defineProperty(call, 'input', {
      get() {
        throw 'boom'
      },
    })

    const res = await handler.execute(call, { cwd: process.cwd(), agentDepth: 0 })
    expect(res.is_error).toBe(true)
    expect(res.content).toContain('Error: boom')
  })
})
