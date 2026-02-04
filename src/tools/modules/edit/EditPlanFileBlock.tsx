import React from 'react'
import { Box, Text } from 'ink'
import { ToolHeaderLine } from '../../../components/tool/ToolHeaderLine'
import { ToolSubline } from '../../../components/tool/ToolSubline'
import { formatPlanPathForDisplay } from '../../../utils/planMode'
import { usePlanSession } from '../../../features/repl/planContext'
import { getTheme } from '../../../utils/theme'
import type { Msg } from '../../../components/tool/ToolMessage'

export function EditPlanFileBlock({ message }: { message: Msg }): React.ReactNode {
  const theme = getTheme()
  const planSession = usePlanSession()
  const planPath = planSession?.getPlanPath() ?? null

  if (!planPath) return null

  const status = message.toolInfo?.status ?? 'completed'

  return (
    <Box flexDirection="column" marginTop={1} marginBottom={0}>
      <ToolHeaderLine status={status} label="Updated plan" />

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
