import React from 'react'
import { Text } from 'ink'
import { getTheme } from '../../../utils/theme'
import { createToolBlocksPresenter } from '../../presenters/types'
import type { Msg } from '../../../components/tool/ToolMessage'
import type { ToolBlocksOutput } from '../../../components/tool/toolUiBlocksTypes'
import { AskUserQuestionToolBlock, parseQuestions, parseAnswers } from '../../presenters/AskUserQuestionToolBlock'

export const AskUserQuestionToolPresenter = createToolBlocksPresenter(
  ({ message }: { message: Msg }): ToolBlocksOutput => {
    const theme = getTheme()

    if (!message.toolInfo) {
      return {
        blocks: [{ kind: 'header', status: 'completed', label: 'Unknown tool' }],
      }
    }

    const { input, status } = message.toolInfo

    const toolUseId =
      message.toolInfo.toolUseId ??
      (message.id.startsWith('tool-') ? message.id.slice('tool-'.length) : message.id)
    const questions = parseQuestions(input)
    const answers = parseAnswers(typeof message.toolInfo.result === 'string' ? message.toolInfo.result : '')

    const blocks: ToolBlocksOutput['blocks'] = [
      {
        kind: 'header',
        status,
        label: 'AskUserQuestion',
        params: `${String(questions.length || 1)} questions`,
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
      blocks.push({
        kind: 'subline',
        status: 'completed',
        children: <Text>Answered</Text>,
      })
      blocks.push({
        kind: 'lines',
        lines: Object.entries(answers).map(([k, v]) => ({
          text: `${k}: ${v}`,
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
