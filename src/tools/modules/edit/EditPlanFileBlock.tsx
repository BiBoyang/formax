import React from 'react'
import { Box, Text } from 'ink'
import { ToolSubline } from '../../presenters/ToolUiPrimitives'
import { formatPlanPathForDisplay } from '../../../shared/utils/planMode'
import { usePlanSession } from '../../../features/repl/planContext'
import { getTheme } from '../../../utils/theme'
import type { Msg } from '../../../shared/toolMessageTypes'

export function EditPlanFileBlock({ message }: { message: Msg }): React.ReactNode {
  const theme = getTheme()
  const planSession = usePlanSession()
  const planPath = planSession?.getPlanPath() ?? null

  if (!planPath) return null

  const status = message.toolInfo?.status ?? 'completed'

  return (
    <Box flexDirection="column" marginTop={0} marginBottom={0}>
      {status !== 'running' && (
        <ToolSubline status={status === 'error' ? 'error' : 'completed'}>
          {status === 'error' ? (
            <Text color={theme.error}>{message.content}</Text>
          ) : (
            <Text color={theme.secondaryText}>
              /plan to preview · {formatPlanPathForDisplay(planPath)}
            </Text>
          )}
        </ToolSubline>
      )}
    </Box>
  )
}
