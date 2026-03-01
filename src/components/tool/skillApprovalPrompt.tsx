import React from 'react'
import { Box, Text } from 'ink'
import { getTheme } from '../../shared/utils/theme'
import type { ConfirmMenuDecision, SkillApprovalDecision } from '../../shared/approvalPromptContracts'
import { ConfirmMenu } from '../../components/ui/ConfirmMenu'
import { ApprovalHeader } from '../../components/ui/ApprovalHeader'

export type { SkillApprovalDecision } from '../../shared/approvalPromptContracts'

export function SkillApprovalPrompt({
  title,
  rememberLabel,
  onDecision,
}: {
  title: string
  rememberLabel: string
  onDecision: (decision: SkillApprovalDecision) => void
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

      <ConfirmMenu
        options={[
          { kind: 'choice', key: 'approve', label: 'Yes' },
          { kind: 'choice', key: 'approve_remember', label: rememberLabel },
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
