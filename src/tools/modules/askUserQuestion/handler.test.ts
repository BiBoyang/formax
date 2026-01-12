import { describe, it, expect } from 'vitest'
import { createUserInputManager } from '../../runtime/userInputManager'
import { createAskUserQuestionToolHandler } from './handler'

describe('AskUserQuestionToolHandler', () => {
  it('returns collected answers', async () => {
    const userInput = createUserInputManager()
    const handler = createAskUserQuestionToolHandler(userInput)

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

    const exec = handler.execute(call, { cwd: process.cwd(), agentDepth: 0 })
    userInput.submitAnswers('ask-1', { Choice: 'A' })

    const res = await exec
    const parsed = JSON.parse(res.content)
    expect(parsed).toEqual({ answers: { Choice: 'A' } })
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
})
