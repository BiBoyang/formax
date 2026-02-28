import React from 'react'
import { SetupWizardImpl, type SetupWizardProps } from './SetupWizardImpl.js'

export type { SetupWizardProps }

export function SetupWizard(props: SetupWizardProps): React.ReactNode {
  return <SetupWizardImpl {...props} />
}
