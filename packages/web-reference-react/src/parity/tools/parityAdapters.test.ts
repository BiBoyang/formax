import { describe, expect, it } from 'vitest'
import {
  buildAskAnswersFromDraft as buildAskAnswersFromDraftParity,
  fieldIdForAskQuestion as fieldIdForAskQuestionParity,
  normalizeAskQuestions as normalizeAskQuestionsParity,
} from './askQuestions'
import {
  orderToolParamsByToolName as orderToolParamsByToolNameParity,
  parseToolParamsText as parseToolParamsTextParity,
  stringifyToolParams as stringifyToolParamsParity,
} from './paramsText'
import { resolveInteractivePromptModel as resolveInteractivePromptModelParity } from './interactivePrompts'
import { selectToolViewModelFromSegment as selectToolViewModelFromSegmentParity } from './toolViewModel'
import {
  buildAskAnswersFromDraft as buildAskAnswersFromDraftRoot,
  fieldIdForAskQuestion as fieldIdForAskQuestionRoot,
  normalizeAskQuestions as normalizeAskQuestionsRoot,
} from '../../../../core/src/features/tools/presentation/askQuestions'
import {
  orderToolParamsByToolName as orderToolParamsByToolNameRoot,
  parseToolParamsText as parseToolParamsTextRoot,
  stringifyToolParams as stringifyToolParamsRoot,
} from '../../../../core/src/features/tools/presentation/paramsText'
import { resolveInteractivePromptModel as resolveInteractivePromptModelRoot } from '../../../../core/src/features/tools/presentation/interactivePrompts'
import { selectToolViewModelFromSegment as selectToolViewModelFromSegmentRoot } from '../../../../core/src/features/tools/presentation/toolViewModel'

describe('parity adapters', () => {
  it('keeps ask question normalization semantics aligned', () => {
    const payload = {
      questions: [
        {
          question: 'Choose one',
          header: 'Choice',
          fieldId: 'choice',
          options: [
            { label: 'A', description: 'alpha' },
            { label: 'B', description: 'beta' },
          ],
          multiSelect: false,
        },
      ],
    }

    const parity = normalizeAskQuestionsParity(payload)
    const root = normalizeAskQuestionsRoot(payload)
    expect(parity).toEqual(root)
    expect(fieldIdForAskQuestionParity(parity[0]!, 0)).toBe(fieldIdForAskQuestionRoot(root[0]!, 0))
    expect(buildAskAnswersFromDraftParity(parity, { choice: 'A' })).toEqual(
      buildAskAnswersFromDraftRoot(root, { choice: 'A' }),
    )
  })

  it('keeps tool params parsing and ordering aligned', () => {
    const text = 'command="npm run test", cwd="/tmp/repo", token="[REDACTED]"'
    const parityParsed = parseToolParamsTextParity(text)
    const rootParsed = parseToolParamsTextRoot(text)
    expect(parityParsed).toEqual(rootParsed)

    const parityOrdered = orderToolParamsByToolNameParity('Bash', parityParsed)
    const rootOrdered = orderToolParamsByToolNameRoot('Bash', rootParsed)
    expect(parityOrdered).toEqual(rootOrdered)
    expect(stringifyToolParamsParity(parityOrdered)).toEqual(stringifyToolParamsRoot(rootOrdered))
  })

  it('keeps interactive prompt model resolution aligned', () => {
    const askInput = {
      questions: [{ question: 'Q1', header: 'H1', fieldId: 'q1', options: [], multiSelect: false }],
    }
    expect(resolveInteractivePromptModelParity({ toolName: 'AskUserQuestion', input: askInput })).toEqual(
      resolveInteractivePromptModelRoot({ toolName: 'AskUserQuestion', input: askInput }),
    )

    expect(resolveInteractivePromptModelParity({ toolName: 'EnterPlanMode', input: {} })).toEqual(
      resolveInteractivePromptModelRoot({ toolName: 'EnterPlanMode', input: {} }),
    )
  })

  it('keeps tool view-model projection semantics aligned', () => {
    const segment = {
      toolName: 'Task',
      status: 'completed' as const,
      summary: 'Task completed',
      detailLines: ['ok'],
      result: '{"task_id":"task_123","status":"running"}\n\n<system-reminder>\ntrace\n</system-reminder>',
      paramsText: 'description="run checks"',
      inputState: {
        kind: 'ask_user_question' as const,
        status: 'submitted' as const,
      },
    }

    const parity = selectToolViewModelFromSegmentParity(segment)
    const root = selectToolViewModelFromSegmentRoot(segment)
    expect(parity).toEqual(root)
  })
})
