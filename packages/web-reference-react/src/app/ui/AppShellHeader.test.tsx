import type { ComponentProps } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '../i18n/I18nProvider'
import { AppShellHeader } from './AppShellHeader'
import { AppShellTopRightControls } from './AppShellTopRightControls'
import { RightRailWorkspaceHeader } from './RightRailWorkspaceHeader'

function renderHeader(
  language: 'zh-CN' | 'en-US' = 'en-US',
  overrides: Partial<ComponentProps<typeof AppShellHeader>> = {},
) {
  const onOpenFolderInTarget = vi.fn()
  const renderResult = render(
    <I18nProvider language={language}>
      <AppShellHeader
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
        showDevLoadAllButton={false}
        devLoadAllDisabled={true}
        openFolderCwd={null}
        onOpenFolderInTarget={onOpenFolderInTarget}
        openFolderActionLabel="Open"
        onToggleSidebar={vi.fn()}
        activeTurnId={null}
        {...overrides}
      />
    </I18nProvider>
  )
  return { ...renderResult, onOpenFolderInTarget }
}

function renderTopRightControls(props: ComponentProps<typeof AppShellTopRightControls>) {
  return render(
    <I18nProvider language="en-US">
      <AppShellTopRightControls {...props} />
    </I18nProvider>,
  )
}

function renderRightRailWorkspaceHeader(props: ComponentProps<typeof AppShellTopRightControls>) {
  return render(
    <I18nProvider language="en-US">
      <RightRailWorkspaceHeader
        isDesktopClient={props.isDesktopClient}
        controls={<AppShellTopRightControls {...props} />}
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

  it('does not render context meter in header', () => {
    renderHeader('en-US')

    expect(screen.queryByTestId('app-shell-context-meter')).toBeNull()
  })

  it('disables open-folder affordance when there is no current folder owner', () => {
    renderHeader('en-US', {
      openFolderCwd: null,
    })

    expect(screen.getByTestId('app-shell-open-folder-button')).toBeDisabled()
    expect(screen.queryByText('workspace')).toBeNull()
  })

  it('opens the current owner folder when an explicit open-folder cwd is available', () => {
    const { onOpenFolderInTarget } = renderHeader('en-US', {
      openFolderCwd: '/repo-draft',
    })

    fireEvent.click(screen.getByTestId('app-shell-open-folder-button'))

    expect(onOpenFolderInTarget).toHaveBeenCalledWith('/repo-draft')
  })

  it('does not render right-rail diff stats in the center header', () => {
    renderHeader('en-US')

    expect(screen.queryByText('+210')).toBeNull()
    expect(screen.queryByText('-88')).toBeNull()
  })

  it('renders stable terminal and right-rail toggles in the right rail header', () => {
    renderRightRailWorkspaceHeader(
      {
        isRightRailOpen: true,
        isTerminalOpen: false,
        isDesktopClient: true,
        canToggleTerminal: true,
        onToggleTerminal: vi.fn(),
        onToggleRightRail: vi.fn(),
      },
    )

    expect(screen.getByTestId('right-rail-workspace-header')).toBeInTheDocument()
    expect(screen.getByText('Review')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add right rail feature' })).toBeInTheDocument()
    expect(screen.getByTestId('app-shell-top-right-controls')).toBeInTheDocument()
    expect(screen.getByTestId('app-shell-terminal-toggle')).toBeInTheDocument()
    expect(screen.getByTestId('app-shell-right-rail-toggle')).toBeInTheDocument()
    expect(screen.queryByText('+210')).toBeNull()
    expect(screen.queryByText('-88')).toBeNull()
  })

  it('does not render right-rail diff stats in the right rail header', () => {
    renderRightRailWorkspaceHeader(
      {
        isRightRailOpen: true,
        isTerminalOpen: false,
        isDesktopClient: true,
        canToggleTerminal: true,
        onToggleTerminal: vi.fn(),
        onToggleRightRail: vi.fn(),
      },
    )

    expect(screen.queryByText('+0')).toBeNull()
    expect(screen.queryByText('-0')).toBeNull()
  })

  it('keeps the right-rail toggle available when the right rail is closed', () => {
    renderTopRightControls(
      {
        isRightRailOpen: false,
        isTerminalOpen: false,
        isDesktopClient: true,
        canToggleTerminal: true,
        onToggleTerminal: vi.fn(),
        onToggleRightRail: vi.fn(),
      },
    )

    expect(screen.getByTestId('app-shell-top-right-controls')).toBeInTheDocument()
    expect(screen.getByTestId('app-shell-terminal-toggle')).toBeInTheDocument()
    expect(screen.getByTestId('app-shell-right-rail-toggle')).toBeInTheDocument()
    expect(screen.queryByText('Review')).toBeNull()
  })

  it('reflects terminal open state on the terminal toggle', () => {
    const { rerender } = renderTopRightControls(
      {
        isRightRailOpen: false,
        isTerminalOpen: false,
        isDesktopClient: true,
        canToggleTerminal: true,
        onToggleTerminal: vi.fn(),
        onToggleRightRail: vi.fn(),
      },
    )

    expect(screen.getByTestId('app-shell-terminal-toggle')).toHaveAttribute('aria-pressed', 'false')

    rerender(
      <I18nProvider language="en-US">
        <AppShellTopRightControls
          isRightRailOpen={false}
          isTerminalOpen
          isDesktopClient
          canToggleTerminal
          onToggleTerminal={vi.fn()}
          onToggleRightRail={vi.fn()}
        />
      </I18nProvider>,
    )

    expect(screen.getByTestId('app-shell-terminal-toggle')).toHaveAttribute('aria-pressed', 'true')
  })
})
