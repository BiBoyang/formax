import React from 'react'
import { Text } from 'ink'
import { getTheme } from '../../../utils/theme'
import { createToolBlocksPresenter } from '../../presenters/types'
import type { Msg } from '../../../components/tool/ToolMessage'
import type { ToolBlocksOutput } from '../../../components/tool/toolUiBlocksTypes'
import { AskUserQuestionToolBlock } from '../../presenters/AskUserQuestionToolBlock'
import { formatQuestionCountLabel, summarizeAskUserQuestionStatus } from '../../../features/tools/presentation/labels'
import { fieldIdForAskQuestion } from '../../../features/tools/presentation/askQuestions'
import { parseAskAnswers } from '../../../features/tools/presentation/askAnswers'
import {
  resolveInteractivePromptModel,
  type AskPromptQuestion,
} from '../../../features/tools/presentation/interactivePrompts'

function buildAnswerLabelMap(questions: AskPromptQuestion[]): Map<string, string> {
  const labels = new Map<string, string>()
  questions.forEach((question, index) => {
    const key = fieldIdForAskQuestion(question, index)
    const header = question.header.trim()
    if (header) labels.set(header, header)
    labels.set(key, header || key)
  })
  return labels
}

export const AskUserQuestionToolPresenter = createToolBlocksPresenter(
  ({ message }: { message: Msg }): ToolBlocksOutput => {
    const theme = getTheme()

    if (!message.toolInfo) {
      return {
        blocks: [{ kind: 'header', status: 'completed', label: 'Unknown tool' }],
      }
    }

    const { input, status } = message.toolInfo

    const promptModel = resolveInteractivePromptModel({
      toolName: message.toolInfo.name,
      input,
    })
    const questions = promptModel?.kind === 'ask_user_question' ? promptModel.questions : []

    const toolUseId =
      message.toolInfo.toolUseId ??
      (message.id.startsWith('tool-') ? message.id.slice('tool-'.length) : message.id)
    const answers = parseAskAnswers(typeof message.toolInfo.result === 'string' ? message.toolInfo.result : '')

    const blocks: ToolBlocksOutput['blocks'] = [
      {
        kind: 'header',
        status,
        label: 'AskUserQuestion',
        params: formatQuestionCountLabel(questions.length),
      },
    ]

    if (status === 'running') {
      blocks.push({
        kind: 'custom',
        node: <AskUserQuestionToolBlock toolUseId={toolUseId} questions={questions} />,
      })
      return { blocks }
    }

    const resultStr = typeof message.toolInfo.result === 'string' ? message.toolInfo.result : ''
    if (status === 'error' && resultStr.includes('Request aborted')) {
      // Return empty blocks for aborted requests
      return { blocks: [] }
    }

    if (answers) {
      const answerLabels = buildAnswerLabelMap(questions)
      const summary = summarizeAskUserQuestionStatus({
        status,
        fallbackSummary: '',
        answerCount: Object.keys(answers).length,
      })
      blocks.push({
        kind: 'subline',
        status: 'completed',
        children: <Text>{summary}</Text>,
      })
      blocks.push({
        kind: 'lines',
        lines: Object.entries(answers).map(([k, v]) => ({
          text: `${answerLabels.get(k) ?? k}: ${v}`,
          tone: 'default' as const,
        })),
      })
    } else {
      blocks.push({
        kind: 'subline',
        status: 'completed',
        children: <Text color={theme.secondaryText}>No answers</Text>,
      })
    }

    return { blocks }
  },
)
