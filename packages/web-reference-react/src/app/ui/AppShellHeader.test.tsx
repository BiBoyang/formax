import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '../i18n/I18nProvider'
import { AppShellHeader } from './AppShellHeader'

function renderHeader(language: 'zh-CN' | 'en-US' = 'en-US') {
  return render(
    <I18nProvider language={language}>
      <AppShellHeader
        isRightRailOpen={false}
        isDesktopClient={false}
        isSidebarOpen={true}
        activeThreadTitle="Thread title"
        activeThreadLatestCompactBoundary={{
          schemaVersion: 1,
          trigger: 'auto',
          preTokens: 2048,
          summaryKind: 'session_memory',
        }}
        activeThreadLatestRequestCollapse={{
          phase: 'reactive_retry',
          collapsedHeadMessageCount: 2,
          estimatedTokensSaved: 64,
          recapFingerprint: 'fp-1',
        }}
        activeWorkspaceLabel="workspace"
        showDevLoadAllButton={false}
        devLoadAllDisabled={true}
        onOpenSettings={vi.fn()}
        selectedCwd={null}
        onOpenFolderInTarget={vi.fn()}
        openFolderActionLabel="Open"
        onToggleTerminal={vi.fn()}
        canToggleTerminal={false}
        onToggleRightRail={vi.fn()}
        onToggleSidebar={vi.fn()}
        activeTurnId={null}
      />
    </I18nProvider>,
  )
}

describe('AppShellHeader', () => {
  it('renders latest request collapse summary text', () => {
    renderHeader('en-US')

    expect(screen.getByTestId('app-shell-collapse-summary')).toHaveTextContent(
      'Collapse saved 64 tok · 2 older msgs · retry',
    )
  })

  it('renders localized latest request collapse summary text', () => {
    renderHeader('zh-CN')

    expect(screen.getByTestId('app-shell-collapse-summary')).toHaveTextContent(
      'Collapse 节省 64 tok · 折叠 2 条旧消息 · 重试',
    )
  })

  it('renders latest compact boundary summary text', () => {
    renderHeader('en-US')

    expect(screen.getByTestId('app-shell-compact-summary')).toHaveTextContent(
      'Latest compact: auto · session memory · 2048 tok',
    )
  })
})
