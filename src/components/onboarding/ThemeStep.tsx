import React, { useState } from 'react'
import { Box, Text } from 'ink'
import { useAtom, useAtomValue } from 'jotai'
import { configAtom, themeAtom, type ThemeName } from '../../store/configAtoms'
import { saveGlobalConfig, getGlobalConfig } from '../../utils/config'
import { Select } from '../ui/Select'
import { CodePreview } from '../ui/CodePreview'

type ThemeStepProps = {
  onNext: () => void
}

export function ThemeStep({ onNext }: ThemeStepProps) {
  const [, setConfig] = useAtom(configAtom)
  const currentTheme = useAtomValue(themeAtom)
  const [previewTheme, setPreviewTheme] = useState<ThemeName>(currentTheme)

  // 当 currentTheme 变化时，同步更新 previewTheme
  React.useEffect(() => {
    setPreviewTheme(currentTheme)
  }, [currentTheme])

  const themeOptions = [
    { label: 'Light text', value: 'dark' },
    { label: 'Dark text', value: 'light' },
    {
      label: 'Light text (colorblind-friendly)',
      value: 'dark-daltonized',
    },
    {
      label: 'Dark text (colorblind-friendly)',
      value: 'light-daltonized',
    },
  ]

  const handleThemeSelection = (newTheme: string) => {
    const theme = newTheme as ThemeName
    // Update atom
    setConfig((draft) => {
      draft.theme = theme
    })
    // Save to file
    const globalConfig = getGlobalConfig()
    saveGlobalConfig({
      ...globalConfig,
      theme,
    })
    onNext()
  }

  const handleThemePreview = React.useCallback((newTheme: string) => {
    setPreviewTheme(newTheme as ThemeName)
  }, [])

  return (
    <Box flexDirection="column" gap={1} paddingLeft={1}>
      <Text>Let&apos;s get started.</Text>
      <Box flexDirection="column">
        <Text bold>Choose the option that looks best when you select it:</Text>
        <Text dimColor>To change this later, run /config</Text>
      </Box>
      <Select
        options={themeOptions}
        defaultValue={currentTheme}
        onFocus={handleThemePreview}
        onChange={handleThemeSelection}
      />
      <Box flexDirection="column">
        <CodePreview theme={previewTheme} width={40} />
      </Box>
    </Box>
  )
}

