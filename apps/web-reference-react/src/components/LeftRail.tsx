import { Circle, SquarePen } from 'lucide-react'
import { cn } from '../lib/utils'
import type { ThreadSummary } from '../types'
import { Button } from './ui/button'

export type LeftRailProps = {
  connectionStatus?: 'disconnected' | 'connecting' | 'connected'
  bridgeUrl?: string
  onBridgeUrlChange?: (value: string) => void
  resumeThreadId?: string
  onResumeThreadIdChange?: (value: string) => void
  onRefreshThreads?: () => void
  onResumeThread?: () => void
  threads: ThreadSummary[]
  activeThreadId: string | null
  onSelectThread: (threadId: string) => void
  onStartThread: () => void
  isBusy?: boolean
}

function threadTitle(thread: ThreadSummary): string {
  return thread.label || thread.lastUserPrompt || `Thread ${thread.id.slice(0, 8)}`
}

function relativeTime(updatedAt: string): string {
  const ts = Date.parse(updatedAt)
  if (!Number.isFinite(ts)) return '--'
  const seconds = Math.max(0, Math.floor((Date.now() - ts) / 1000))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24)
  return `${days}d`
}

export function LeftRail(props: LeftRailProps) {
  const {
    threads,
    activeThreadId,
    connectionStatus,
    onSelectThread,
    onStartThread,
    isBusy = false,
  } = props

  return (
    <aside className="flex flex-col h-screen flex-none w-[260px] border-r bg-sidebar overflow-hidden">
      <div className="flex-1 overflow-y-auto overflow-x-hidden">
        <div className="flex flex-col min-h-full">
          <div className="px-2 pt-4 space-y-0.5 flex-none">
            {connectionStatus ? <div className="px-3 pb-2 text-xs text-muted-foreground">{connectionStatus}</div> : null}
            <Button
              variant="ghost"
              className="w-full justify-start h-9 px-3 text-[14px] font-medium text-foreground/80 hover:bg-muted/40"
              onClick={onStartThread}
              disabled={isBusy}
            >
              <SquarePen className="mr-3 h-4 w-4 opacity-70" />
              New thread
            </Button>
          </div>

          <div className="flex-1 flex flex-col mt-4 pb-12">
            <div className="px-5 py-2 text-[12px] font-medium text-muted-foreground/50 tracking-wide flex-none">Threads</div>

            <div className="space-y-0.5 px-2">
              {threads.length === 0 ? <div className="px-4 py-4 text-xs text-muted-foreground/60 italic">No recent threads</div> : null}
              {threads.map((thread) => {
                const isActive = activeThreadId === thread.id
                return (
                  <Button
                    key={thread.id}
                    variant="ghost"
                    className={cn(
                      'w-full justify-between h-9 px-3 font-normal text-[13.5px] transition-all group',
                      isActive ? 'bg-muted/60 text-foreground font-medium' : 'text-foreground/70 hover:bg-muted/40',
                    )}
                    onClick={() => onSelectThread(thread.id)}
                  >
                    <span className="truncate flex-1 text-left">{threadTitle(thread)}</span>
                    <div className="flex items-center gap-2 ml-2 flex-none opacity-50">
                      {thread.id === activeThreadId ? <Circle className="h-1.5 w-1.5 fill-emerald-500 text-emerald-500" /> : null}
                      <span className="text-[11px] font-mono">{relativeTime(thread.updatedAt)}</span>
                    </div>
                  </Button>
                )
              })}
            </div>
          </div>
        </div>
      </div>
    </aside>
  )
}
