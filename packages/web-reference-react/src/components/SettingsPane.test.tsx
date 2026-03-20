import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '../app/i18n/I18nProvider'
import type { UserSettings } from '../app/core/userSettings'
import { SettingsPane } from './SettingsPane'

const baseSettings: UserSettings = {
  defaultOpenTarget: 'vscode',
  language: 'zh-CN',
  preventSleep: true,
  longTextRequireCmdEnter: false,
}

describe('SettingsPane i18n', () => {
  it('renders zh-CN labels by default', () => {
    render(
      <I18nProvider language="zh-CN">
        <SettingsPane
          settings={baseSettings}
          onSettingChange={vi.fn()}
          availableOpenTargets={[{ id: 'vscode', label: 'VS Code' }]}
        />
      </I18nProvider>,
    )

    expect(screen.getByText('常规')).toBeInTheDocument()
    expect(screen.getByText('默认打开目标')).toBeInTheDocument()
    expect(screen.getByText('语言')).toBeInTheDocument()
  })

  it('switches to en-US labels and keeps language setting writable', () => {
    const onSettingChange = vi.fn()
    render(
      <I18nProvider language="en-US">
        <SettingsPane
          settings={{ ...baseSettings, language: 'en-US' }}
          onSettingChange={onSettingChange}
          availableOpenTargets={[{ id: 'vscode', label: 'VS Code' }]}
        />
      </I18nProvider>,
    )

    expect(screen.getByText('General')).toBeInTheDocument()
    expect(screen.getByText('Default open target')).toBeInTheDocument()
    expect(screen.getByText('Language')).toBeInTheDocument()

    fireEvent.change(screen.getByDisplayValue('English (US)'), { target: { value: 'zh-CN' } })
    expect(onSettingChange).toHaveBeenCalledWith('language', 'zh-CN')
  })
})
