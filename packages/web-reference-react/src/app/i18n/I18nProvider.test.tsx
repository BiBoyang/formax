import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { I18nProvider, useI18n } from './I18nProvider'

function Probe() {
  const { t } = useI18n()
  return (
    <div>
      <span data-testid="general">{t('settings.generalTitle')}</span>
      <span data-testid="follow">{t('settings.followBehavior.label')}</span>
      <span data-testid="open-target">{t('leftRail.openInTarget', { target: 'VS Code' })}</span>
    </div>
  )
}

describe('I18nProvider', () => {
  it('renders zh-CN catalog text', () => {
    render(
      <I18nProvider language="zh-CN">
        <Probe />
      </I18nProvider>,
    )

    expect(screen.getByTestId('general')).toHaveTextContent('常规')
    expect(screen.getByTestId('follow')).toHaveTextContent('跟进行为')
    expect(screen.getByTestId('open-target')).toHaveTextContent('Open in VS Code')
  })

  it('renders en-US catalog text', () => {
    render(
      <I18nProvider language="en-US">
        <Probe />
      </I18nProvider>,
    )

    expect(screen.getByTestId('general')).toHaveTextContent('General')
    expect(screen.getByTestId('follow')).toHaveTextContent('Follow-up behavior')
    expect(screen.getByTestId('open-target')).toHaveTextContent('Open in VS Code')
  })
})
