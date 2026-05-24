import { memo, useCallback, useMemo, useReducer, useState, type FormEvent } from 'react'
import { useI18n } from '../app/i18n/I18nProvider'
import { cn } from '../lib/utils'
import { Badge } from './ui/badge'
import type { ContextMeterView, TranscriptItem, ThreadSummary } from '../types'
import { MarkdownRenderer } from './MarkdownRenderer'
import { ToolTranscriptItem } from './tool/ToolTranscriptItem'
import { ComposerDock } from './composer/ComposerDock'
import { TranscriptFeed } from './transcript/TranscriptFeed'
import { DraftProjectSelector, NewThreadDraftSurface } from './transcript/NewThreadDraftSurface'
import { useRenderWindow, type TranscriptRow } from './transcript/useRenderWindow'
import type { VisibleSurface } from '../app/runtime/newThreadDraft'

type OpenIdsAction =
  | { type: 'toggle'; id: string }
  | { type: 'reset' }

function openIdsReducer(state: Set<string>, action: OpenIdsAction): Set<string> {
  if (action.type === 'reset') return new Set<string>()
  const next = new Set(state)
  if (next.has(action.id)) {
    next.delete(action.id)
  } else {
    next.add(action.id)
  }
  return next
}

type RpcErrorLike = {
  at: string
  method: string
  message: string
  code?: number
  data?: unknown
}

const RPC_ERROR_DETAILS_CACHE_LIMIT = 80
const rpcErrorDetailsCache = new Map<string, string>()

function encodeCacheKeyPart(value: string): string {
  return `${value.length}:${value}`
}

function getRpcErrorDataCacheKey(data: unknown): string {
  if (data === null) return 'null'
  if (typeof data === 'undefined') return 'undefined'
  if (typeof data === 'object') {
    try {
      return `obj:${JSON.stringify(data)}`
    } catch {
      return `obj-unserializable:${Object.prototype.toString.call(data)}`
    }
  }
  if (typeof data === 'string') return `str:${data}`
  if (typeof data === 'number') return `num:${String(data)}`
  if (typeof data === 'boolean') return `bool:${String(data)}`
  if (typeof data === 'bigint') return `bigint:${String(data)}`
  return `other:${String(data)}`
}

function makeRpcErrorDetailsCacheKey(error: RpcErrorLike): string {
  return [
    encodeCacheKeyPart(error.at),
    encodeCacheKeyPart(error.method),
    encodeCacheKeyPart(error.message),
    encodeCacheKeyPart(error.code == null ? '' : String(error.code)),
    encodeCacheKeyPart(getRpcErrorDataCacheKey(error.data)),
  ].join('')
}

export function formatRpcErrorDetails(error: RpcErrorLike): string {
  const cacheKey = makeRpcErrorDetailsCacheKey(error)
  const cached = rpcErrorDetailsCache.get(cacheKey)
  if (cached != null) {
    return cached
  }

  const serialized = JSON.stringify(error, null, 2)
  if (rpcErrorDetailsCache.size >= RPC_ERROR_DETAILS_CACHE_LIMIT) {
    const oldestKey = rpcErrorDetailsCache.keys().next().value
    if (typeof oldestKey === 'string') {
      rpcErrorDetailsCache.delete(oldestKey)
    }
  }
  rpcErrorDetailsCache.set(cacheKey, serialized)
  return serialized
}

export type TranscriptPaneProps = {
  activeThread?: ThreadSummary | undefined
  activeThreadId: string | null
  activeTurnId?: string | null
  virtualizationEnabled?: boolean

  surfaceKind?: VisibleSurface
  logs: TranscriptItem[]
  composerLocked?: boolean
  inputText: string
  connectionStatus: 'disconnected' | 'connecting' | 'connected'
  onInputTextChange: (value: string) => void
  mode: 'normal' | 'acceptEdits' | 'plan'
  onModeChange: (value: 'normal' | 'acceptEdits' | 'plan') => void
  onSend: (event: FormEvent) => void
  onInterrupt: () => void
  historyMore?: boolean
  historyLoading?: boolean
  onLoadEarlier?: () => void
  devLoadAllActive?: boolean
  isSending?: boolean
  isInterrupting?: boolean
  lastRpcError?: RpcErrorLike | null
  longTextRequireCmdEnter?: boolean
  draftCwd?: string | null
  draftCwdOptions?: string[]
  onDraftCwdChange?: (cwd: string) => void
  onDraftAddProject?: () => void
  activeContextMeter?: ContextMeterView
  showContextMeter?: boolean
}

function logLevelBadge(level: 'info' | 'warn' | 'error'): 'secondary' | 'outline' | 'destructive' {
  if (level === 'error') return 'destructive'
  if (level === 'warn') return 'outline'
  return 'secondary'
}

function ThinkingItem(props: {
  item: Extract<TranscriptItem, { kind: 'thinking' }>
}) {
  const { t } = useI18n()
  const { item } = props
  if (item.status !== 'running') return null
  return (
    <div className="flex items-center gap-2 py-1">
      <div className="ui-text-meta ui-text-muted tracking-tight animate-pulse">{t('transcript.runningThinking')}</div>
    </div>
  )
}

function TurnFooterItem({ item }: { item: Extract<TranscriptItem, { kind: 'turn_footer' }> }) {
  const { t } = useI18n()
  const styleByStatus = {
    completed: 'text-muted-foreground',
    failed: 'text-red-600',
    interrupted: 'text-amber-700',
  } as const
  const labelByStatus = {
    completed: t('transcript.turn.completed'),
    failed: t('transcript.turn.failed'),
    interrupted: t('transcript.turn.interrupted'),
  } as const
  return (
    <div className="flex items-center gap-2 py-1 pl-1">
      <span className={cn('ui-text-meta font-medium', styleByStatus[item.status])}>{labelByStatus[item.status]}</span>
      <span className="ui-text-micro text-muted-foreground/70 font-mono">{item.turnId.slice(0, 8)}</span>
      {item.message ? <span className="ui-text-micro text-muted-foreground/70 truncate max-w-[320px]">{item.message}</span> : null}
    </div>
  )
}

type TranscriptItemRowProps = {
  item: TranscriptItem
  turnGroupStart: boolean
  showTurnGap: boolean
  activeThreadCwd?: string
  toolOpen: boolean
  onToggleTool: (id: string) => void
}

const TranscriptItemRow = memo(function TranscriptItemRow(props: TranscriptItemRowProps) {
  const { t } = useI18n()
  const {
    item,
    turnGroupStart,
    showTurnGap,
    activeThreadCwd,
    toolOpen,
    onToggleTool,
  } = props

  return (
    <div
      data-turn-group-start={turnGroupStart ? 'true' : undefined}
      className={cn(
        'min-w-0 ui-content-auto',
        showTurnGap ? 'mt-3 pt-1' : null,
      )}
    >
      {item.kind === 'log' ? (
        <div className={cn('rounded-lg border px-3 py-2 ui-text-meta bg-muted/20')}>
          <div className="mb-1 flex items-center gap-2">
            <Badge variant={logLevelBadge(item.level)} className="h-4 px-1 ui-text-micro uppercase font-bold tracking-wider">{item.level}</Badge>
          </div>
          <div className="text-muted-foreground font-mono ui-text-meta whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{item.text}</div>
        </div>
      ) : item.kind === 'notice' ? (
        <div className={cn('rounded-lg border px-3 py-2 ui-text-meta bg-muted/15')}>
          <div className="mb-1 flex items-center gap-2">
            <Badge variant={logLevelBadge(item.level)} className="h-4 px-1 ui-text-micro uppercase font-bold tracking-wider">{item.level}</Badge>
            <span className="ui-text-micro uppercase tracking-wider text-muted-foreground/80">{t('transcript.notice')}</span>
          </div>
          <div className="text-muted-foreground ui-text-meta whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{item.text}</div>
        </div>
      ) : item.kind === 'thinking' ? (
        <ThinkingItem item={item} />
      ) : item.kind === 'turn_footer' ? (
        <TurnFooterItem item={item} />
      ) : item.kind === 'tool_call' ? (
        <ToolTranscriptItem
          item={item}
          cwd={activeThreadCwd}
          displayDensity="compact"
          open={toolOpen}
          onToggle={() => onToggleTool(item.id)}
        />
      ) : (
        <div className={cn('flex w-full mb-1', item.role === 'user' ? 'justify-end' : 'justify-start')}>
          <div
            className={cn(
              'max-w-[85%] transition-all duration-300',
              item.role === 'user'
                ? 'rounded-[14px] ui-surface-user-bubble px-3 py-1 text-foreground selection:bg-primary/20'
                : 'text-foreground py-2'
            )}
          >
            {item.role === 'assistant' ? (
              <MarkdownRenderer text={item.text} cacheKey={item.id} className="ui-text-base leading-relaxed" />
            ) : (
              <div className="ui-text-base leading-relaxed whitespace-pre-wrap break-words [overflow-wrap:anywhere] px-0.5">
                {item.text}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
})

type TranscriptRowsListProps = {
  renderedRows: TranscriptRow[]
  activeThreadCwd?: string
  openToolIds: Set<string>
  onToggleTool: (id: string) => void
}

const TranscriptRowsList = memo(function TranscriptRowsList(props: TranscriptRowsListProps) {
  if (props.renderedRows.length === 0) return null
  return (
    <>
      {props.renderedRows.map((row) => (
        <TranscriptItemRow
          key={row.item.id}
          item={row.item}
          turnGroupStart={row.turnGroupStart}
          showTurnGap={row.showTurnGap}
          activeThreadCwd={props.activeThreadCwd}
          toolOpen={props.openToolIds.has(row.item.id)}
          onToggleTool={props.onToggleTool}
        />
      ))}
    </>
  )
})

export function TranscriptPane(props: TranscriptPaneProps) {
  const { t } = useI18n()
  const {
    activeThread,
    activeThreadId,
    activeTurnId = null,
    virtualizationEnabled = false,
    surfaceKind = activeThreadId ? 'thread' : 'newThreadDraft',
    logs,
    composerLocked = false,
    inputText,
    mode,
    onModeChange,
    connectionStatus,
    onInputTextChange,
    onSend,
    onInterrupt,
    historyMore = false,
    historyLoading = false,
    onLoadEarlier,
    devLoadAllActive = false,
    isSending = false,
    isInterrupting = false,
    lastRpcError = null,
    longTextRequireCmdEnter = false,
    draftCwd = null,
    draftCwdOptions = [],
    onDraftCwdChange,
    onDraftAddProject,
    activeContextMeter,
    showContextMeter = false,
  } = props
  const [showErrorDetails, setShowErrorDetails] = useState(false)
  const [openToolIds, dispatchOpenToolIds] = useReducer(openIdsReducer, new Set<string>())
  const hasActiveTurn = Boolean(activeTurnId)

  const showTurnLoading = Boolean(activeThreadId) &&
    connectionStatus === 'connected' &&
    !isInterrupting &&
    (isSending || hasActiveTurn)
  const {
    transcriptRenderView,
    showJumpToBottom,
    scrollAreaRef,
    bottomRef,
    renderEarlierMessages,
    handleLoadEarlier,
    jumpToBottom,
    stickToBottom,
  } = useRenderWindow({
    logs,
    activeThreadId,
    activeTurnId,
    virtualizationEnabled,
    onLoadEarlier,
    devLoadAllActive,
    showTurnLoading,
  })

  const handleSend = useCallback((event: FormEvent) => {
    stickToBottom()
    onSend(event)
  }, [onSend, stickToBottom])

  const toggleToolOpen = useCallback((id: string) => {
    dispatchOpenToolIds({ type: 'toggle', id })
  }, [])

  const lastRpcErrorDetails = useMemo(
    () => (lastRpcError ? formatRpcErrorDetails(lastRpcError) : ''),
    [lastRpcError?.at, lastRpcError?.method, lastRpcError?.message, lastRpcError?.code, lastRpcError?.data],
  )
  const rowsContent = useMemo(
    () => (
      <TranscriptRowsList
        renderedRows={transcriptRenderView.renderedRows}
        activeThreadCwd={activeThread?.cwd}
        openToolIds={openToolIds}
        onToggleTool={toggleToolOpen}
      />
    ),
    [activeThread?.cwd, openToolIds, toggleToolOpen, transcriptRenderView.renderedRows],
  )
  const hasDraftFeedback = surfaceKind === 'newThreadDraft' && (
    transcriptRenderView.renderedRows.length > 0 ||
    lastRpcError != null
  )
  const canSubmitInThread =
    surfaceKind === 'thread' &&
    connectionStatus === 'connected' &&
    !isSending &&
    !hasActiveTurn &&
    Boolean(inputText.trim())
  const canSubmitInDraft =
    surfaceKind === 'newThreadDraft' &&
    connectionStatus === 'connected' &&
    !isSending &&
    Boolean(draftCwd) &&
    Boolean(inputText.trim())

  return (
    <main data-testid="center-pane" className="center-pane flex-1 min-w-0 overflow-x-hidden flex flex-col bg-background">
      {surfaceKind === 'newThreadDraft' ? (
        !composerLocked ? (
          <NewThreadDraftSurface
            draftCwd={draftCwd}
            cwdOptions={draftCwdOptions}
            onDraftCwdChange={(cwd) => onDraftCwdChange?.(cwd)}
            onDraftAddProject={onDraftAddProject}
            composer={(
              <ComposerDock
                showJumpToBottom={false}
                onJumpToBottom={jumpToBottom}
                inputText={inputText}
                onInputTextChange={onInputTextChange}
                mode={mode}
                onModeChange={onModeChange}
                connectionStatus={connectionStatus}
                canSubmit={canSubmitInDraft}
                isInputDisabled={!draftCwd}
                showInterrupt={false}
                isSending={isSending}
                isInterrupting={isInterrupting}
                onInterrupt={onInterrupt}
                onSend={handleSend}
                longTextRequireCmdEnter={longTextRequireCmdEnter}
                placeholder={draftCwd ? undefined : t('transcript.newThreadSelectProjectFirst')}
                layoutVariant="centered"
                floatingFooterAccessory={
                  <DraftProjectSelector
                    draftCwd={draftCwd}
                    cwdOptions={draftCwdOptions}
                    onDraftCwdChange={(cwd) => onDraftCwdChange?.(cwd)}
                    onDraftAddProject={onDraftAddProject}
                  />
                }
                activeContextMeter={activeContextMeter}
                showContextMeter={showContextMeter}
              />
            )}
            feedback={
              hasDraftFeedback ? (
                <div className="rounded-xl border border-border/70 bg-background/80 p-3 shadow-sm">
                  {lastRpcError ? (
                    <div className="mb-3 rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2">
                      <div className="ui-text-meta font-medium text-destructive">
                        {t('transcript.rpcErrorPrefix')}: {lastRpcError.message}
                      </div>
                    </div>
                  ) : null}
                  {rowsContent}
                </div>
              ) : null
            }
          />
        ) : (
          <div data-testid="composer-locked" className="h-4" />
        )
      ) : (
        <>
          <TranscriptFeed
            isWelcomeState={surfaceKind === 'welcome'}
            historyMore={historyMore}
            historyLoading={historyLoading}
            onLoadEarlier={handleLoadEarlier}
            hiddenInMemoryCount={transcriptRenderView.hiddenInMemoryCount}
            onRenderEarlierMessages={renderEarlierMessages}
            renderedLogsCount={transcriptRenderView.renderedRows.length}
            rowsContent={rowsContent}
            showTurnLoading={showTurnLoading}
            lastRpcError={lastRpcError}
            lastRpcErrorDetails={lastRpcErrorDetails}
            showErrorDetails={showErrorDetails}
            onShowErrorDetailsChange={setShowErrorDetails}
            scrollAreaRef={scrollAreaRef}
            bottomRef={bottomRef}
          />

          {!composerLocked ? (
            <ComposerDock
              showJumpToBottom={showJumpToBottom}
              onJumpToBottom={jumpToBottom}
              inputText={inputText}
              onInputTextChange={onInputTextChange}
              mode={mode}
              onModeChange={onModeChange}
              connectionStatus={connectionStatus}
              canSubmit={canSubmitInThread}
              showInterrupt={hasActiveTurn || isInterrupting}
              isSending={isSending}
              isInterrupting={isInterrupting}
              onInterrupt={onInterrupt}
              onSend={handleSend}
              longTextRequireCmdEnter={longTextRequireCmdEnter}
              layoutVariant="bottom"
              activeContextMeter={activeContextMeter}
              showContextMeter={showContextMeter}
            />
          ) : (
            <div data-testid="composer-locked" className="h-4" />
          )}
        </>
      )}
    </main>
  )
}
