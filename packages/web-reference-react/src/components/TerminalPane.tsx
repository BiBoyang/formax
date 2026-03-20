import { useCallback, useEffect, useRef, useState } from 'react'
import { FitAddon } from '@xterm/addon-fit'
import { Terminal } from '@xterm/xterm'
import { X } from 'lucide-react'
import { Button } from './ui/button'
import { useI18n } from '../app/i18n/I18nProvider'

type DesktopTerminalBridge = NonNullable<NonNullable<Window['formaxDesktop']>['terminal']>

type TerminalPaneProps = {
  threadId: string
  bridge: DesktopTerminalBridge
  onClose: () => void
}

const TERMINAL_RESIZE_DEBOUNCE_MS = 80
const NULL_EXIT_CODE_LABEL = 'null'

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
      theme: {
        background: '#0a0e14',
      },
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
        />
      </div>
    </div>
  )
}
