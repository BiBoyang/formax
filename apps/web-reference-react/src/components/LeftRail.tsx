import type { ThreadSummary } from '../types'

export type LeftRailProps = {
  connectionStatus: 'disconnected' | 'connecting' | 'connected'
  bridgeUrl: string
  onBridgeUrlChange: (value: string) => void
  threads: ThreadSummary[]
  activeThreadId: string | null
  onSelectThread: (threadId: string) => void
  onStartThread: () => void
  onRefreshThreads: () => void
}

export function LeftRail(props: LeftRailProps) {
  const {
    connectionStatus,
    bridgeUrl,
    onBridgeUrlChange,
    threads,
    activeThreadId,
    onSelectThread,
    onStartThread,
    onRefreshThreads,
  } = props

  return (
    <aside className="left-rail">
      <div className="rail-head">
        <h1>Formax App Server</h1>
        <span className={`status ${connectionStatus}`}>{connectionStatus}</span>
      </div>

      <label className="bridge-input-wrap">
        <span>Bridge URL</span>
        <input value={bridgeUrl} onChange={(event) => onBridgeUrlChange(event.target.value)} />
      </label>

      <div className="rail-actions">
        <button onClick={onStartThread}>New Thread</button>
        <button onClick={onRefreshThreads}>Refresh</button>
      </div>

      <div className="thread-list">
        {threads.map((thread) => (
          <button
            key={thread.id}
            className={`thread-item ${thread.id === activeThreadId ? 'active' : ''}`}
            onClick={() => onSelectThread(thread.id)}
          >
            <div className="thread-title">{thread.label || thread.lastUserPrompt || `Thread ${thread.id.slice(0, 8)}`}</div>
            <div className="thread-meta">{thread.id.slice(0, 8)}</div>
          </button>
        ))}
        {threads.length === 0 && <div className="empty">No threads yet.</div>}
      </div>
    </aside>
  )
}
