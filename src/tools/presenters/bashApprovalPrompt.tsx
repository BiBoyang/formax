import React from 'react'
import { Box, Text } from 'ink'
import { getTheme } from '../../utils/theme'
import { ConfirmMenu, type ConfirmMenuDecision } from './ConfirmMenu'
import { ApprovalHeader } from './ApprovalHeader'

export type BashApprovalDecision =
  | { kind: 'approve' }
  | { kind: 'approve_remember' }
  | { kind: 'feedback'; feedback: string }
  | { kind: 'cancel' }

export function BashApprovalPrompt({
  title,
  command,
  cwd,
  onDecision,
}: {
  title: string
  command: string
  cwd: string
  onDecision: (decision: BashApprovalDecision) => void
}): React.ReactNode {
  const theme = getTheme()
  const handleDecision = (d: ConfirmMenuDecision): void => {
    if (d.kind === 'cancel') onDecision({ kind: 'cancel' })
    else if (d.kind === 'feedback') onDecision({ kind: 'feedback', feedback: d.feedback })
    else onDecision(d.key === 'approve_remember' ? { kind: 'approve_remember' } : { kind: 'approve' })
  }

  return (
    <Box flexDirection="column" marginTop={1}>
      <ApprovalHeader title={title} />

      <Box marginBottom={1} flexDirection="column">
        <Text color={theme.secondaryText}>Command:</Text>
        <Text>{command || '(empty)'}</Text>
        <Text color={theme.secondaryText}>Cwd:</Text>
        <Text color={theme.secondaryText}>{cwd}</Text>
      </Box>

      <ConfirmMenu
        options={[
          { kind: 'choice', key: 'approve', label: 'Yes' },
          { kind: 'choice', key: 'approve_remember', label: "Yes, don't ask again for this command in this repo" },
          {
            kind: 'feedback',
            key: 'feedback',
            label: '',
            placeholder: 'Type here to tell Claude what to do differently',
          },
        ]}
        onDecision={handleDecision}
        activeColor={theme.permission}
      />

      <Box marginTop={1}>
        <Text color={theme.secondaryText}>Esc to cancel</Text>
      </Box>
    </Box>
  )
}
