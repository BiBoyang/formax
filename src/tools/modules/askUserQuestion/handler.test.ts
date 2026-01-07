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
})

