import { useCallback, useEffect, useRef, useState } from 'react'
import { FitAddon } from '@xterm/addon-fit'
import { Terminal } from '@xterm/xterm'
import { X } from 'lucide-react'
import { Button } from './ui/button'
import { useI18n } from '../app/i18n/I18nProvider'

type DesktopTerminalBridge = NonNullable<NonNullable<Window['formaxDesktop']>['terminal']>
type XtermTheme = NonNullable<NonNullable<ConstructorParameters<typeof Terminal>[0]>['theme']>

type TerminalPaneProps = {
  threadId: string
  bridge: DesktopTerminalBridge
  onClose: () => void
}

const TERMINAL_RESIZE_DEBOUNCE_MS = 80
const NULL_EXIT_CODE_LABEL = 'null'
const ROOT_THEME_OBSERVER_ATTRIBUTES = ['class', 'data-theme', 'data-window-transparency'] as const
const FALLBACK_TERMINAL_THEME: XtermTheme = {
  background: '#0f1115',
  foreground: '#f5f7fa',
  cursor: '#f5f7fa',
  cursorAccent: '#0f1115',
  selectionBackground: 'rgba(245, 247, 250, 0.24)',
  selectionForeground: '#f5f7fa',
  black: '#1c1f26',
  red: '#e86671',
  green: '#7ecb6f',
  yellow: '#e5c76b',
  blue: '#6aa6ff',
  magenta: '#c38bff',
  cyan: '#68d4e5',
  white: '#d8dee9',
  brightBlack: '#5d6675',
  brightRed: '#ff8d96',
  brightGreen: '#a7e58f',
  brightYellow: '#f6de92',
  brightBlue: '#93c0ff',
  brightMagenta: '#d7a8ff',
  brightCyan: '#9ce9f6',
  brightWhite: '#ffffff',
}

function readCssColorToken(styles: CSSStyleDeclaration, tokenName: string, fallback: string): string {
  const value = styles.getPropertyValue(tokenName).trim()
  return value.length > 0 ? value : fallback
}

function resolveTerminalThemeFromCss(): XtermTheme {
  if (typeof window === 'undefined' || typeof getComputedStyle !== 'function') {
    return FALLBACK_TERMINAL_THEME
  }
  const styles = window.getComputedStyle(document.documentElement)
  return {
    background: readCssColorToken(styles, '--terminal-bg', FALLBACK_TERMINAL_THEME.background ?? '#0f1115'),
    foreground: readCssColorToken(styles, '--terminal-fg', FALLBACK_TERMINAL_THEME.foreground ?? '#f5f7fa'),
    cursor: readCssColorToken(styles, '--terminal-cursor', FALLBACK_TERMINAL_THEME.cursor ?? '#f5f7fa'),
    cursorAccent: readCssColorToken(
      styles,
      '--terminal-cursor-accent',
      FALLBACK_TERMINAL_THEME.cursorAccent ?? '#0f1115',
    ),
    selectionBackground: readCssColorToken(
      styles,
      '--terminal-selection-bg',
      FALLBACK_TERMINAL_THEME.selectionBackground ?? 'rgba(245, 247, 250, 0.24)',
    ),
    selectionForeground: readCssColorToken(
      styles,
      '--terminal-selection-fg',
      FALLBACK_TERMINAL_THEME.selectionForeground ?? '#f5f7fa',
    ),
    black: readCssColorToken(styles, '--terminal-ansi-black', FALLBACK_TERMINAL_THEME.black ?? '#1c1f26'),
    red: readCssColorToken(styles, '--terminal-ansi-red', FALLBACK_TERMINAL_THEME.red ?? '#e86671'),
    green: readCssColorToken(styles, '--terminal-ansi-green', FALLBACK_TERMINAL_THEME.green ?? '#7ecb6f'),
    yellow: readCssColorToken(styles, '--terminal-ansi-yellow', FALLBACK_TERMINAL_THEME.yellow ?? '#e5c76b'),
    blue: readCssColorToken(styles, '--terminal-ansi-blue', FALLBACK_TERMINAL_THEME.blue ?? '#6aa6ff'),
    magenta: readCssColorToken(styles, '--terminal-ansi-magenta', FALLBACK_TERMINAL_THEME.magenta ?? '#c38bff'),
    cyan: readCssColorToken(styles, '--terminal-ansi-cyan', FALLBACK_TERMINAL_THEME.cyan ?? '#68d4e5'),
    white: readCssColorToken(styles, '--terminal-ansi-white', FALLBACK_TERMINAL_THEME.white ?? '#d8dee9'),
    brightBlack: readCssColorToken(
      styles,
      '--terminal-ansi-bright-black',
      FALLBACK_TERMINAL_THEME.brightBlack ?? '#5d6675',
    ),
    brightRed: readCssColorToken(styles, '--terminal-ansi-bright-red', FALLBACK_TERMINAL_THEME.brightRed ?? '#ff8d96'),
    brightGreen: readCssColorToken(
      styles,
      '--terminal-ansi-bright-green',
      FALLBACK_TERMINAL_THEME.brightGreen ?? '#a7e58f',
    ),
    brightYellow: readCssColorToken(
      styles,
      '--terminal-ansi-bright-yellow',
      FALLBACK_TERMINAL_THEME.brightYellow ?? '#f6de92',
    ),
    brightBlue: readCssColorToken(
      styles,
      '--terminal-ansi-bright-blue',
      FALLBACK_TERMINAL_THEME.brightBlue ?? '#93c0ff',
    ),
    brightMagenta: readCssColorToken(
      styles,
      '--terminal-ansi-bright-magenta',
      FALLBACK_TERMINAL_THEME.brightMagenta ?? '#d7a8ff',
    ),
    brightCyan: readCssColorToken(
      styles,
      '--terminal-ansi-bright-cyan',
      FALLBACK_TERMINAL_THEME.brightCyan ?? '#9ce9f6',
    ),
    brightWhite: readCssColorToken(
      styles,
      '--terminal-ansi-bright-white',
      FALLBACK_TERMINAL_THEME.brightWhite ?? '#ffffff',
    ),
  }
}

export function TerminalPane(props: TerminalPaneProps) {
  const { t } = useI18n()
  const terminalHostRef = useRef<HTMLDivElement | null>(null)
  const terminalRef = useRef<Terminal | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const snapshotHydratingRef = useRef(false)
  const bufferedEventsDuringSnapshotRef = useRef<DesktopTerminalEvent[]>([])
  const [statusLine, setStatusLine] = useState<string | null>(null)

  const syncTerminalSize = useCallback(() => {
    const terminal = terminalRef.current
    const fitAddon = fitAddonRef.current
    if (!terminal || !fitAddon) return
    fitAddon.fit()
    void props.bridge.resize(props.threadId, terminal.cols, terminal.rows).catch(() => undefined)
  }, [props.bridge, props.threadId])

  const syncTerminalTheme = useCallback(() => {
    const terminal = terminalRef.current
    if (!terminal) return
    terminal.options.theme = resolveTerminalThemeFromCss()
  }, [])

  useEffect(() => {
    const host = terminalHostRef.current
    if (!host) return

    const terminal = new Terminal({
      convertEol: false,
      cursorBlink: true,
      fontSize: 12,
      lineHeight: 1.25,
      scrollback: 5000,
      fontFamily:
        'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
      theme: resolveTerminalThemeFromCss(),
    })
    const fitAddon = new FitAddon()
    terminal.loadAddon(fitAddon)
    terminal.open(host)
    terminalRef.current = terminal
    fitAddonRef.current = fitAddon

    const inputDisposable = terminal.onData((data: string) => {
      void props.bridge.write(props.threadId, data).catch(() => undefined)
    })

    return () => {
      inputDisposable.dispose()
      terminal.dispose()
      terminalRef.current = null
      fitAddonRef.current = null
    }
  }, [props.bridge, props.threadId])

  useEffect(() => {
    const root = document.documentElement
    syncTerminalTheme()
    if (typeof MutationObserver !== 'function') return

    const observer = new MutationObserver(() => {
      syncTerminalTheme()
    })
    observer.observe(root, {
      attributes: true,
      attributeFilter: [...ROOT_THEME_OBSERVER_ATTRIBUTES],
    })
    return () => {
      observer.disconnect()
    }
  }, [syncTerminalTheme, props.threadId])

  useEffect(() => {
    let cancelled = false
    const terminal = terminalRef.current
    if (!terminal) return

    const applyDataChunk = (chunk: string) => {
      if (!chunk) return
      terminal.write(chunk)
    }

    const applyBufferedEvents = (snapshotDataSeq: number) => {
      if (bufferedEventsDuringSnapshotRef.current.length === 0) return
      for (const event of bufferedEventsDuringSnapshotRef.current) {
        if (event.type === 'data') {
          if (event.dataSeq <= snapshotDataSeq) continue
          applyDataChunk(event.chunk)
          setStatusLine(null)
          continue
        }
        setStatusLine(t('appShell.terminalExited', { code: event.exitCode ?? NULL_EXIT_CODE_LABEL }))
      }
      bufferedEventsDuringSnapshotRef.current = []
    }

    snapshotHydratingRef.current = true
    bufferedEventsDuringSnapshotRef.current = []
    void props.bridge
      .getSnapshot(props.threadId)
      .then((snapshot) => {
        if (cancelled) return
        terminal.reset()
        if (snapshot.output) {
          terminal.write(snapshot.output)
        }
        if (snapshot.exists) {
          setStatusLine(null)
        } else if (snapshot.exitCode !== undefined) {
          setStatusLine(t('appShell.terminalExited', { code: snapshot.exitCode ?? NULL_EXIT_CODE_LABEL }))
        } else {
          setStatusLine(null)
        }
        const snapshotDataSeq =
          typeof snapshot.dataSeq === 'number' && Number.isFinite(snapshot.dataSeq)
            ? Math.max(0, Math.floor(snapshot.dataSeq))
            : 0
        applyBufferedEvents(snapshotDataSeq)
        syncTerminalSize()
        terminal.focus()
      })
      .catch(() => {
        if (cancelled) return
        applyBufferedEvents(-1)
      })
      .finally(() => {
        snapshotHydratingRef.current = false
      })

    return () => {
      cancelled = true
      snapshotHydratingRef.current = false
      bufferedEventsDuringSnapshotRef.current = []
    }
  }, [props.bridge, props.threadId, syncTerminalSize, t])

  useEffect(() => {
    const unsubscribe = props.bridge.subscribe((event) => {
      if (event.threadId !== props.threadId) return
      const terminal = terminalRef.current
      if (!terminal) return

      if (event.type === 'data') {
        if (snapshotHydratingRef.current) {
          bufferedEventsDuringSnapshotRef.current.push(event)
          return
        }
        terminal.write(event.chunk)
        setStatusLine(null)
        return
      }

      if (event.type === 'exit') {
        if (snapshotHydratingRef.current) {
          bufferedEventsDuringSnapshotRef.current.push(event)
          return
        }
        setStatusLine(t('appShell.terminalExited', { code: event.exitCode ?? NULL_EXIT_CODE_LABEL }))
      }
    })
    return unsubscribe
  }, [props.bridge, props.threadId, t])

  useEffect(() => {
    const host = terminalHostRef.current
    if (!host) return

    let timer: ReturnType<typeof setTimeout> | null = null
    const scheduleSync = () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        syncTerminalSize()
      }, TERMINAL_RESIZE_DEBOUNCE_MS)
    }

    if (typeof ResizeObserver === 'function') {
      const observer = new ResizeObserver(() => {
        scheduleSync()
      })
      observer.observe(host)
      scheduleSync()
      return () => {
        observer.disconnect()
        if (timer) clearTimeout(timer)
      }
    }

    scheduleSync()
    return () => {
      if (timer) clearTimeout(timer)
    }
  }, [syncTerminalSize])

  return (
    <div
      data-testid="terminal-pane"
      className="h-full min-h-0 min-w-0 border-t border-border/80 bg-background flex flex-col"
    >
      <div className="h-9 px-2 border-b border-border/70 flex items-center justify-between gap-2">
        <div className="min-w-0 flex items-center gap-2">
          <span className="ui-text-meta font-medium text-foreground/90">{t('appShell.terminalTitle')}</span>
          {statusLine ? (
            <span className="ui-text-meta text-muted-foreground truncate">{statusLine}</span>
          ) : null}
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-muted-foreground hover:text-foreground"
          aria-label={t('appShell.closeTerminal')}
          onClick={props.onClose}
        >
          <X className="h-4 w-4" />
        </Button>
      </div>
      <div className="flex-1 min-h-0 p-2">
        <div
          ref={terminalHostRef}
          className="h-full min-h-0 w-full overflow-hidden rounded-md border border-border/70"
          style={{ backgroundColor: 'var(--terminal-bg)' }}
        />
      </div>
    </div>
  )
}
