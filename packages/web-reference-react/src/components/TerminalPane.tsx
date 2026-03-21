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
  background: 'rgba(0, 0, 0, 0)',
  foreground: '#383a42',
  cursor: '#383a42',
  cursorAccent: '#ffffff',
  selectionBackground: 'rgba(56, 58, 66, 0.2)',
  selectionForeground: '#383a42',
  black: '#e5e5e6',
  red: '#e45649',
  green: '#50a14f',
  yellow: '#c18401',
  blue: '#4078f2',
  magenta: '#a626a4',
  cyan: '#0184bc',
  white: '#a0a1a7',
  brightBlack: '#a0a1a7',
  brightRed: '#e45649',
  brightGreen: '#50a14f',
  brightYellow: '#986801',
  brightBlue: '#4078f2',
  brightMagenta: '#a626a4',
  brightCyan: '#0184bc',
  brightWhite: '#fafafa',
}

function readCssColorToken(styles: CSSStyleDeclaration, tokenName: string, fallback: string): string {
  const value = styles.getPropertyValue(tokenName).trim()
  return value.length > 0 ? value : fallback
}

function resolveTerminalThemeFromCss(): XtermTheme {
  const fallback = FALLBACK_TERMINAL_THEME
  if (typeof window === 'undefined' || typeof getComputedStyle !== 'function') {
    return fallback
  }
  const styles = window.getComputedStyle(document.documentElement)

  return {
    background: readCssColorToken(styles, '--terminal-bg', fallback.background ?? 'rgba(0, 0, 0, 0)'),
    foreground: readCssColorToken(styles, '--terminal-fg', fallback.foreground ?? '#383a42'),
    cursor: readCssColorToken(styles, '--terminal-cursor', fallback.cursor ?? '#383a42'),
    cursorAccent: readCssColorToken(styles, '--terminal-cursor-accent', fallback.cursorAccent ?? '#ffffff'),
    selectionBackground: readCssColorToken(
      styles,
      '--terminal-selection-bg',
      fallback.selectionBackground ?? 'rgba(56, 58, 66, 0.2)',
    ),
    selectionForeground: readCssColorToken(styles, '--terminal-selection-fg', fallback.selectionForeground ?? '#383a42'),
    black: readCssColorToken(styles, '--terminal-ansi-black', fallback.black ?? '#e5e5e6'),
    red: readCssColorToken(styles, '--terminal-ansi-red', fallback.red ?? '#e45649'),
    green: readCssColorToken(styles, '--terminal-ansi-green', fallback.green ?? '#50a14f'),
    yellow: readCssColorToken(styles, '--terminal-ansi-yellow', fallback.yellow ?? '#c18401'),
    blue: readCssColorToken(styles, '--terminal-ansi-blue', fallback.blue ?? '#4078f2'),
    magenta: readCssColorToken(styles, '--terminal-ansi-magenta', fallback.magenta ?? '#a626a4'),
    cyan: readCssColorToken(styles, '--terminal-ansi-cyan', fallback.cyan ?? '#0184bc'),
    white: readCssColorToken(styles, '--terminal-ansi-white', fallback.white ?? '#a0a1a7'),
    brightBlack: readCssColorToken(styles, '--terminal-ansi-bright-black', fallback.brightBlack ?? '#a0a1a7'),
    brightRed: readCssColorToken(styles, '--terminal-ansi-bright-red', fallback.brightRed ?? '#e45649'),
    brightGreen: readCssColorToken(styles, '--terminal-ansi-bright-green', fallback.brightGreen ?? '#50a14f'),
    brightYellow: readCssColorToken(styles, '--terminal-ansi-bright-yellow', fallback.brightYellow ?? '#986801'),
    brightBlue: readCssColorToken(styles, '--terminal-ansi-bright-blue', fallback.brightBlue ?? '#4078f2'),
    brightMagenta: readCssColorToken(styles, '--terminal-ansi-bright-magenta', fallback.brightMagenta ?? '#a626a4'),
    brightCyan: readCssColorToken(styles, '--terminal-ansi-bright-cyan', fallback.brightCyan ?? '#0184bc'),
    brightWhite: readCssColorToken(styles, '--terminal-ansi-bright-white', fallback.brightWhite ?? '#fafafa'),
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
      allowTransparency: true,
      convertEol: false,
      cursorBlink: true,
      cursorStyle: 'bar',
      cursorWidth: 2,
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
      className="h-full min-h-0 min-w-0 border-t border-border/80 bg-background flex flex-col pt-1 pb-1"
    >
      <div className="h-8 px-4 flex items-center justify-between gap-2">
        <div className="min-w-0 flex items-center gap-2">
          <span className="text-[13px] font-medium text-foreground/80">{t('appShell.terminalTitle')}</span>
          {statusLine ? (
            <span className="text-[13px] text-muted-foreground truncate">{statusLine}</span>
          ) : null}
        </div>
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-6 w-6 text-muted-foreground/50 hover:text-foreground hover:bg-transparent"
            aria-label={t('appShell.closeTerminal')}
            onClick={props.onClose}
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
      <div className="flex-1 min-h-0 px-4 pt-0.5 pb-2">
        <div
          ref={terminalHostRef}
          className="h-full min-h-0 w-full overflow-hidden"
        />
      </div>
    </div>
  )
}
