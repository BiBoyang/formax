import type { FormEvent } from 'react'
import type { TranscriptItem } from '../types'

export type TranscriptPaneProps = {
  activeThreadId: string | null
  activeTurnId: string | null
  logs: TranscriptItem[]
  inputText: string
  connectionStatus: 'disconnected' | 'connecting' | 'connected'
  onInputTextChange: (value: string) => void
  onSend: (event: FormEvent) => void
  onInterrupt: () => void
}

export function TranscriptPane(props: TranscriptPaneProps) {
  const {
    activeThreadId,
    activeTurnId,
    logs,
    inputText,
    connectionStatus,
    onInputTextChange,
    onSend,
    onInterrupt,
  } = props

  return (
    <main className="center-pane">
      <header className="pane-header">
        <div>
          Active thread: <strong>{activeThreadId ? activeThreadId.slice(0, 8) : 'none'}</strong>
        </div>
        <button disabled={!activeTurnId} onClick={onInterrupt}>
          Interrupt
        </button>
      </header>

      <section className="transcript">
        {logs.length === 0 && <div className="empty">Start a thread and send a turn.</div>}
        {logs.map((item) =>
          item.kind === 'log' ? (
            <div key={item.id} className={`line ${item.level}`}>
              {item.text}
            </div>
          ) : (
            <div key={item.id} className={`bubble ${item.role}`}>
              {item.text}
            </div>
          ),
        )}
      </section>

      <form className="composer" onSubmit={onSend}>
        <textarea
          value={inputText}
          onChange={(event) => onInputTextChange(event.target.value)}
          placeholder="Type a prompt for turn/start..."
        />
        <button type="submit" disabled={!activeThreadId || connectionStatus !== 'connected'}>
          Send
        </button>
      </form>
    </main>
  )
}
