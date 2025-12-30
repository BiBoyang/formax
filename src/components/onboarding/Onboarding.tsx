import React, { useState, useCallback } from 'react'
import { Box, Text, useInput } from 'ink'
import { useSetAtom } from 'jotai'
import { hasCompletedOnboardingAtom } from '../../store/configAtoms'
import { saveGlobalConfig, getGlobalConfig } from '../../utils/config'
import { ThemeStep } from './ThemeStep'
import { UsageStep } from './UsageStep'
import { ModelStep } from './ModelStep'
import { clearTerminal } from '../../utils/terminal'

type StepId = 'theme' | 'usage' | 'model'

interface OnboardingStep {
  id: StepId
  component: React.ReactNode
}

type Props = {
  onDone: () => void
}

export function Onboarding({ onDone }: Props) {
  const [currentStepIndex, setCurrentStepIndex] = useState(0)
  const setHasCompletedOnboarding = useSetAtom(hasCompletedOnboardingAtom)

  const goToNextStep = useCallback(() => {
    const totalSteps = getSteps().length
    setCurrentStepIndex((prev) => {
      if (prev < totalSteps - 1) {
        return prev + 1
      }
      // This is the last step, complete onboarding
      // Mark onboarding as complete in atom
      setHasCompletedOnboarding(true)
      // Save to file - read latest config to ensure we have all fields (theme, model, etc.)
      const config = getGlobalConfig()
      saveGlobalConfig({
        ...config,
        hasCompletedOnboarding: true,
      })
      // Call onDone to exit onboarding
      onDone()
      return prev
    })
  }, [onDone, setHasCompletedOnboarding])

  const goToNextStepWithClear = useCallback(async () => {
    await clearTerminal()
    goToNextStep()
  }, [goToNextStep])

  // 定义步骤组件（使用函数来避免依赖问题）
  const getSteps = (): OnboardingStep[] => [
    { id: 'theme', component: <ThemeStep onNext={goToNextStepWithClear} /> },
    { id: 'usage', component: <UsageStep onNext={goToNextStepWithClear} /> },
    { id: 'model', component: <ModelStep onNext={goToNextStepWithClear} /> },
  ]

  const steps = getSteps()

  // 处理键盘输入（仅用于 usage 步骤）
  // 注意：theme 步骤的输入由 Select 组件处理
  // model 步骤的输入由 ModelSelector 组件处理，这里不拦截
  useInput((_input, key) => {
    const currentStep = steps[currentStepIndex]
    // 只处理 usage 步骤的 Enter 键，不处理 theme 和 model 步骤
    if (key.return && currentStep && currentStep.id === 'usage') {
      goToNextStepWithClear()
    }
  })

  return (
    <Box flexDirection="column" gap={1}>
      <Box flexDirection="column" gap={1}>
        <Text bold>Formax</Text>
        {steps[currentStepIndex]?.component}
      </Box>
    </Box>
  )
}
