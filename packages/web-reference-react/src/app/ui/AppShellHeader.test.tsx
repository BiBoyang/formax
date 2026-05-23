import type { ComponentProps } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '../i18n/I18nProvider'
import { AppShellHeader } from './AppShellHeader'

function renderHeader(
  language: 'zh-CN' | 'en-US' = 'en-US',
  showContextMeter = true,
  overrides: Partial<ComponentProps<typeof AppShellHeader>> = {},
) {
  const onOpenFolderInTarget = vi.fn()
  const renderResult = render(
    <I18nProvider language={language}>
      <AppShellHeader
        isRightRailOpen={false}
        showRightRailDivider={false}
        showRightRailToggle={true}
        isDesktopClient={true}
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
        activeContextMeter={{
          available: true,
          source: 'usage',
          usedTokens: 1000,
          limitTokens: 95000,
          percentUsed: 1,
          percentRemaining: 99,
          shouldAutoCompact: false,
          label: '1% used (1k/95k, usage)',
          tone: 'normal',
        }}
        showContextMeter={showContextMeter}
        activeWorkspaceLabel="workspace"
        showDevLoadAllButton={false}
        devLoadAllDisabled={true}
        onOpenSettings={vi.fn()}
        openFolderCwd={null}
        onOpenFolderInTarget={onOpenFolderInTarget}
        openFolderActionLabel="Open"
        onToggleTerminal={vi.fn()}
        canToggleTerminal={false}
        onToggleRightRail={vi.fn()}
        onToggleSidebar={vi.fn()}
        activeTurnId={null}
        {...overrides}
      />
    </I18nProvider>
  )
  return { ...renderResult, onOpenFolderInTarget }
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

  it('does not render context meter in header', () => {
    renderHeader('en-US', true)

    expect(screen.queryByTestId('app-shell-context-meter')).toBeNull()
  })

  it('disables open-folder affordance when there is no current folder owner', () => {
    renderHeader('en-US', true, {
      activeWorkspaceLabel: null,
      openFolderCwd: null,
    })

    expect(screen.getByTestId('app-shell-open-folder-button')).toBeDisabled()
    expect(screen.queryByText('workspace')).toBeNull()
  })

  it('opens the current owner folder when an explicit open-folder cwd is available', () => {
    const { onOpenFolderInTarget } = renderHeader('en-US', true, {
      openFolderCwd: '/repo-draft',
    })

    fireEvent.click(screen.getByTestId('app-shell-open-folder-button'))

    expect(onOpenFolderInTarget).toHaveBeenCalledWith('/repo-draft')
  })

  it('renders right-rail diff stats from props instead of hardcoded values', () => {
    renderHeader('en-US', true, {
      rightRailDiffStats: { additions: 210, deletions: 88 },
    })

    expect(screen.getByText('+210')).toBeInTheDocument()
    expect(screen.getByText('-88')).toBeInTheDocument()
  })

  it('hides right-rail diff stats when there are no changes', () => {
    renderHeader('en-US', true, {
      rightRailDiffStats: { additions: 0, deletions: 0 },
    })

    expect(screen.queryByText('+0')).toBeNull()
    expect(screen.queryByText('-0')).toBeNull()
  })
})
