import React, { useState } from 'react'
import { Box, Text } from 'ink'
import { getTheme } from '../../utils/theme'
import { ConfirmMenu, type ConfirmMenuDecision } from '../../components/ui/ConfirmMenu.js'

export type EditApprovalDecision =
  | { kind: 'approve' }
  | { kind: 'approve_remember'; scope: 'session' | 'project' | 'global' }
  | { kind: 'feedback'; feedback: string }
  | { kind: 'cancel' }

export function EditApprovalPrompt({
  title,
  onDecision,
}: {
  title: string
  onDecision: (decision: EditApprovalDecision) => void
}): React.ReactNode {
  const theme = getTheme()
  const [rememberScope, setRememberScope] = useState<'session' | 'project' | 'global'>('session')
  const handleDecision = (d: ConfirmMenuDecision): void => {
    if (d.kind === 'cancel') onDecision({ kind: 'cancel' })
    else if (d.kind === 'feedback') onDecision({ kind: 'feedback', feedback: d.feedback })
    else if (d.key === 'approve') onDecision({ kind: 'approve' })
    else if (d.key === 'approve_remember') onDecision({ kind: 'approve_remember', scope: rememberScope })
  }

  return (
    <Box flexDirection="column" marginTop={1}>
      <Box marginBottom={1}>
        <Text bold>{title}</Text>
      </Box>

      <ConfirmMenu
        options={[
          { kind: 'choice', key: 'approve', label: 'Yes' },
          {
            kind: 'choice',
            key: 'approve_remember',
            label: `Yes, remember for ${rememberScope} (shift+tab to cycle)`,
          },
          {
            kind: 'feedback',
            key: 'feedback',
            label: '',
            placeholder: 'Type here to tell Claude what to do differently',
          },
        ]}
        onDecision={handleDecision}
        onShiftTab={() =>
          setRememberScope((s) => (s === 'session' ? 'project' : s === 'project' ? 'global' : 'session'))
        }
        shiftTabCursor={1}
      />

      <Box marginTop={1}>
        <Text color={theme.secondaryText}>Esc to cancel</Text>
      </Box>
    </Box>
  )
}
