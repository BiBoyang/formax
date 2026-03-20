import {
  ArrowDown,
  ArrowUp,
  ChevronsRight,
  FolderSearch,
  Pause,
  Pencil,
  Square,
} from 'lucide-react'
import { memo, useCallback, useEffect, useMemo, useReducer, useRef, useState, type FormEvent } from 'react'
import { getWebSupportedSlashCommandSpecs, type WebSupportedSlashCommandSpec } from '../app/core/commandSupport'
import { useI18n, type I18nTranslator } from '../app/i18n/I18nProvider'
import { shouldTreatAsLongPrompt } from '../app/core/userSettings'
import { cn } from '../lib/utils'
import { resolveCommandRouting } from '../semantics'
import { Badge } from './ui/badge'
import { Button } from './ui/button'
import { Card } from './ui/card'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from './ui/collapsible'
import { ScrollArea } from './ui/scroll-area'
import { Textarea } from './ui/textarea'
import type { TranscriptItem, ThreadSummary } from '../types'
import { LoadingStatusLine } from './LoadingStatusLine'
import { shouldStopWheelPropagation } from './scrollBoundary'
import { MarkdownRenderer } from './MarkdownRenderer'
import { ToolTranscriptItem } from './tool/ToolTranscriptItem'

const TURN_INIT_RENDER_LIMIT = 30
const TURN_BATCH_RENDER_SIZE = 20
const HISTORY_BATCH_RENDER_SIZE = 50
const RENDER_WINDOW_CAP = 200
const VIRTUALIZED_TURN_INIT_RENDER_LIMIT = 20
const VIRTUALIZED_TURN_BATCH_RENDER_SIZE = 16
const VIRTUALIZED_HISTORY_BATCH_RENDER_SIZE = 40
const VIRTUALIZED_RENDER_WINDOW_CAP = 120
const NEAR_BOTTOM_THRESHOLD_PX = 32

type OpenIdsAction =
  | { type: 'toggle'; id: string }
  | { type: 'reset' }

function shouldRenderTranscriptItem(item: TranscriptItem): boolean {
  if (item.kind !== 'thinking') return true
  return item.status === 'running'
}

function isViewportNearBottom(viewport: HTMLElement): boolean {
  return viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight <= NEAR_BOTTOM_THRESHOLD_PX
}

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

type ComposerMode = 'normal' | 'acceptEdits' | 'plan'

const MODE_CYCLE: ComposerMode[] = ['normal', 'acceptEdits', 'plan']

function nextComposerMode(mode: ComposerMode): ComposerMode {
  const idx = MODE_CYCLE.indexOf(mode)
  if (idx < 0) return 'normal'
  return MODE_CYCLE[(idx + 1) % MODE_CYCLE.length] ?? 'normal'
}

function modeMeta(mode: ComposerMode, t: I18nTranslator): { label: string; icon: typeof Pencil; toneClass: string } {
  if (mode === 'plan') {
    return {
      label: t('transcript.mode.plan'),
      icon: Pause,
      toneClass: 'text-foreground/70 hover:text-foreground',
    }
  }
  if (mode === 'acceptEdits') {
    return {
      label: t('transcript.mode.acceptEdits'),
      icon: ChevronsRight,
      toneClass: 'text-foreground/70 hover:text-foreground',
    }
  }
  return {
    label: t('transcript.mode.normal'),
    icon: Pencil,
    toneClass: 'text-foreground/70 hover:text-foreground',
  }
}

const WEB_SUPPORTED_SLASH_COMMANDS = getWebSupportedSlashCommandSpecs()

function filterSlashCommandSpecs(
  specs: readonly WebSupportedSlashCommandSpec[],
  query: string,
): WebSupportedSlashCommandSpec[] {
  const normalizedQuery = query.trim().toLowerCase()
  if (!normalizedQuery) return Array.from(specs)

  return specs
    .map((spec) => {
      const normalizedCommand = spec.command.slice(1).toLowerCase()
      if (normalizedCommand.startsWith(normalizedQuery)) {
        return { spec, rank: 0 as const }
      }
      if (normalizedCommand.includes(normalizedQuery)) {
        return { spec, rank: 1 as const }
      }
      return null
    })
    .filter((entry): entry is { spec: WebSupportedSlashCommandSpec; rank: 0 | 1 } => entry != null)
    .sort((a, b) => {
      if (a.rank !== b.rank) return a.rank - b.rank
      return a.spec.command.localeCompare(b.spec.command)
    })
    .map((entry) => entry.spec)
}

function buildSlashCommandInput(currentInput: string, command: string): string {
  const leadingWhitespaceMatch = currentInput.match(/^\s*/)
  const leadingWhitespace = leadingWhitespaceMatch?.[0] ?? ''
  const trimmedStart = currentInput.slice(leadingWhitespace.length)
  if (!trimmedStart.startsWith('/')) {
    return `${command} `
  }

  const firstWhitespaceIndex = trimmedStart.search(/\s/)
  if (firstWhitespaceIndex === -1) {
    return `${leadingWhitespace}${command} `
  }

  const args = trimmedStart.slice(firstWhitespaceIndex).trimStart()
  if (!args) {
    return `${leadingWhitespace}${command} `
  }
  return `${leadingWhitespace}${command} ${args}`
}

export type TranscriptPaneProps = {
  activeThread?: ThreadSummary | undefined
  activeThreadId: string | null
  activeTurnId?: string | null
  virtualizationEnabled?: boolean

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

type TranscriptRow = {
  item: TranscriptItem
  turnGroupStart: boolean
  showTurnGap: boolean
}

type TranscriptRenderView = {
  visibleLogCount: number
  hiddenInMemoryCount: number
  renderedRows: TranscriptRow[]
}

type TranscriptFeedProps = {
  isWelcomeState: boolean
  activeThreadCwd?: string
  historyMore: boolean
  historyLoading: boolean
  onLoadEarlier: () => void
  hiddenInMemoryCount: number
  onRenderEarlierMessages: () => void
  renderedLogsCount: number
  renderedRows: TranscriptRow[]
  openToolIds: Set<string>
  onToggleTool: (id: string) => void
  showTurnLoading: boolean
  lastRpcError: RpcErrorLike | null
  showErrorDetails: boolean
  onShowErrorDetailsChange: (open: boolean) => void
  scrollAreaRef: { current: HTMLDivElement | null }
  bottomRef: { current: HTMLDivElement | null }
}

type TranscriptRowsListProps = {
  renderedRows: TranscriptRow[]
  activeThreadCwd?: string
  openToolIds: Set<string>
  onToggleTool: (id: string) => void
}

type WelcomePromptIdea = {
  icon: string
  text: string
}

// Temporarily disabled in web: welcome prompt ideas are not ready yet.
const WELCOME_PROMPT_IDEAS: WelcomePromptIdea[] = [
  // {
  //   icon: '🎮',
  //   text: 'Build a classic Snake game in this repo.',
  // },
  // {
  //   icon: '📄',
  //   text: 'Create a one-page $pdf that summarizes this app.',
  // },
  // {
  //   icon: '✏️',
  //   text: 'Create a plan to...',
  // },
]

function WelcomePromptCard(props: WelcomePromptIdea) {
  return (
    <button
      type="button"
      className="w-full min-h-[118px] rounded-[24px] border border-border/70 bg-background/58 px-4 py-4 text-left shadow-[0_1px_2px_hsl(var(--foreground)/0.02)] transition-colors hover:bg-background/74"
    >
      <span aria-hidden className="inline-flex h-5 w-5 items-center justify-center text-base leading-none">
        {props.icon}
      </span>
      <p className="mt-3 ui-text-base leading-relaxed font-medium text-foreground/90">{props.text}</p>
    </button>
  )
}

function WelcomeCanvas() {
  const { t } = useI18n()
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-1 items-center justify-center pb-8">
        <div className="text-center">
          <div className="text-2xl leading-tight font-semibold tracking-tight text-foreground/72">{t('transcript.welcomeTitle')}</div>
        </div>
      </div>

      <div className="w-full pb-1">

        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {WELCOME_PROMPT_IDEAS.map((idea) => (
            <WelcomePromptCard key={idea.text} {...idea} />
          ))}
        </div>
      </div>
    </div>
  )
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

const TranscriptFeed = memo(function TranscriptFeed(props: TranscriptFeedProps) {
  const { t } = useI18n()
  const lastRpcErrorDetails = useMemo(
    () => (props.lastRpcError ? formatRpcErrorDetails(props.lastRpcError) : ''),
    [
      props.lastRpcError?.at,
      props.lastRpcError?.method,
      props.lastRpcError?.message,
      props.lastRpcError?.code,
      props.lastRpcError?.data,
    ],
  )
  const showStaticWelcomeLayout =
    props.isWelcomeState &&
    props.renderedLogsCount === 0 &&
    !props.historyMore &&
    props.hiddenInMemoryCount === 0 &&
    !props.showTurnLoading &&
    props.lastRpcError == null

  if (showStaticWelcomeLayout) {
    return (
      <section className="transcript flex-1 min-h-0 overflow-hidden relative">
        <div className="h-full w-full px-8 pt-8">
          <div className="h-full max-w-3xl mx-auto">
            <WelcomeCanvas />
          </div>
        </div>
      </section>
    )
  }

  return (
    <section className="transcript flex-1 overflow-hidden relative">
      <ScrollArea 
        ref={props.scrollAreaRef} 
        className="h-full [mask-image:linear-gradient(to_bottom,transparent,black_32px)]"
      >
        <div
          className={cn(
            'flex min-w-0 flex-col gap-4 py-8 pb-14 w-full',
            props.isWelcomeState && props.renderedLogsCount === 0 ? 'px-8 lg:px-10 max-w-none' : 'px-8 max-w-3xl mx-auto',
          )}
        >
          {props.historyMore ? (
            <div className="flex justify-center">
              <Button type="button" variant="ghost" size="sm" disabled={props.historyLoading} onClick={props.onLoadEarlier}>
                {props.historyLoading ? t('transcript.loadingEarlierMessages') : t('transcript.loadEarlierMessages')}
              </Button>
            </div>
          ) : null}

          {props.hiddenInMemoryCount > 0 ? (
            <div className="flex justify-center">
              <Button type="button" variant="ghost" size="sm" onClick={props.onRenderEarlierMessages}>
                {t('transcript.renderEarlierMessages', { count: props.hiddenInMemoryCount })}
              </Button>
            </div>
          ) : null}

          {props.renderedLogsCount === 0 ? (
            props.isWelcomeState ? (
              <WelcomeCanvas />
            ) : (
              <div className="flex flex-col items-center justify-center py-20 text-muted-foreground gap-2">
                <FolderSearch className="h-8 w-8 text-muted-foreground/25" />
                <span className="ui-text-base ui-text-muted">{t('transcript.emptyThread')}</span>
              </div>
            )
          ) : null}

          <TranscriptRowsList
            renderedRows={props.renderedRows}
            activeThreadCwd={props.activeThreadCwd}
            openToolIds={props.openToolIds}
            onToggleTool={props.onToggleTool}
          />

          {props.showTurnLoading ? (
            <div data-testid="turn-loading" className="py-1">
              <LoadingStatusLine text={t('transcript.thinking')} cycleWords />
            </div>
          ) : null}

          {props.lastRpcError ? (
            <Collapsible open={props.showErrorDetails} onOpenChange={props.onShowErrorDetailsChange}>
              <Card className="gap-2 rounded-xl border-destructive/30 bg-destructive/5 px-3 py-3 shadow-none mx-4">
                <div className="flex items-center justify-between gap-2">
                  <div className="ui-text-meta text-destructive font-medium">
                    {t('transcript.rpcErrorPrefix')}: {props.lastRpcError.message}
                  </div>
                  <CollapsibleTrigger asChild>
                    <Button type="button" variant="ghost" size="xs" className="h-6 px-2 ui-text-meta hover:bg-destructive/10">
                      {props.showErrorDetails ? t('transcript.hide') : t('transcript.details')}
                    </Button>
                  </CollapsibleTrigger>
                </div>
                <CollapsibleContent>
                  <pre className="mt-2 max-h-52 overflow-auto rounded border bg-background/50 p-2 ui-text-micro whitespace-pre-wrap font-mono">
                    {lastRpcErrorDetails}
                  </pre>
                </CollapsibleContent>
              </Card>
            </Collapsible>
          ) : null}
          <div ref={props.bottomRef} className="h-4" />
        </div>
      </ScrollArea>
    </section>
  )
})

type ComposerDockProps = {
  showJumpToBottom: boolean
  onJumpToBottom: () => void
  inputText: string
  onInputTextChange: (value: string) => void
  mode: ComposerMode
  onModeChange: (value: ComposerMode) => void
  activeThreadId: string | null
  connectionStatus: 'disconnected' | 'connecting' | 'connected'
  isSending: boolean
  isInterrupting: boolean
  onInterrupt: () => void
  onSend: (event: FormEvent) => void
  longTextRequireCmdEnter: boolean
}

const ComposerDock = memo(function ComposerDock(props: ComposerDockProps) {
  const { t } = useI18n()
  const [isImeComposing, setIsImeComposing] = useState(false)
  const [isSlashMenuPinnedOpen, setIsSlashMenuPinnedOpen] = useState(false)
  const [isSlashAutoOpenSuppressed, setIsSlashAutoOpenSuppressed] = useState(false)
  const [slashSelectionIndex, setSlashSelectionIndex] = useState(0)
  const composerRootRef = useRef<HTMLDivElement | null>(null)
  const modeInfo = modeMeta(props.mode, t)
  const commandRouting = useMemo(
    () => resolveCommandRouting(props.inputText),
    [props.inputText],
  )
  const slashQuery = useMemo(() => {
    if (!commandRouting.isSlashCommandAfterTrim) return null
    if ((commandRouting.commandArgs ?? '').length > 0) return null
    return (commandRouting.commandName ?? '').slice(1)
  }, [commandRouting.commandArgs, commandRouting.commandName, commandRouting.isSlashCommandAfterTrim])

  const slashCommandSpecs = useMemo(() => {
    if (isSlashMenuPinnedOpen && slashQuery == null) {
      return WEB_SUPPORTED_SLASH_COMMANDS
    }
    return filterSlashCommandSpecs(WEB_SUPPORTED_SLASH_COMMANDS, slashQuery ?? '')
  }, [isSlashMenuPinnedOpen, slashQuery])

  const isSlashMenuVisible = isSlashMenuPinnedOpen || (slashQuery != null && !isSlashAutoOpenSuppressed)

  useEffect(() => {
    if (!isSlashAutoOpenSuppressed) return
    if (slashQuery == null) {
      setIsSlashAutoOpenSuppressed(false)
      return
    }
    if (props.inputText.trim() === (commandRouting.commandName ?? '')) {
      return
    }
    setIsSlashAutoOpenSuppressed(false)
  }, [commandRouting.commandName, isSlashAutoOpenSuppressed, props.inputText, slashQuery])

  useEffect(() => {
    if (slashCommandSpecs.length === 0) {
      setSlashSelectionIndex(0)
      return
    }
    setSlashSelectionIndex((previous) => Math.min(previous, slashCommandSpecs.length - 1))
  }, [slashCommandSpecs.length])

  useEffect(() => {
    if (!isSlashMenuPinnedOpen) return
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null
      if (!target) return
      if (composerRootRef.current?.contains(target)) return
      setIsSlashMenuPinnedOpen(false)
    }
    window.addEventListener('pointerdown', handlePointerDown)
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown)
    }
  }, [isSlashMenuPinnedOpen])

  const focusComposerInput = useCallback(() => {
    const input = composerRootRef.current?.querySelector('textarea')
    input?.focus()
  }, [])

  const applySlashCommandSelection = useCallback((command: string) => {
    props.onInputTextChange(buildSlashCommandInput(props.inputText, command))
    setIsSlashMenuPinnedOpen(false)
    setIsSlashAutoOpenSuppressed(true)
    window.requestAnimationFrame(() => {
      focusComposerInput()
    })
  }, [focusComposerInput, props.inputText, props.onInputTextChange])

  const toggleSlashMenu = useCallback(() => {
    setSlashSelectionIndex(0)
    setIsSlashMenuPinnedOpen((previous) => !previous)
    window.requestAnimationFrame(() => {
      focusComposerInput()
    })
  }, [focusComposerInput])

  return (
    <div data-testid="composer" className="composer p-4 pb-8">
      <div ref={composerRootRef} className="max-w-3xl mx-auto relative">
        {props.showJumpToBottom ? (
          <div className="pointer-events-none absolute left-1/2 -top-12 z-10 -translate-x-1/2">
            <Button
              type="button"
              aria-label={t('transcript.jumpToBottom')}
              size="icon"
              variant="outline"
              className="pointer-events-auto h-9 w-9 rounded-full border-border/70 bg-background/95 shadow-sm backdrop-blur supports-[backdrop-filter]:bg-background/80"
              onClick={props.onJumpToBottom}
            >
              <ArrowDown className="h-4 w-4" />
            </Button>
          </div>
        ) : null}
        {isSlashMenuVisible ? (
          <div
            data-testid="composer-slash-menu"
            className="absolute inset-x-2 bottom-[calc(100%+0.5rem)] z-30 overflow-hidden rounded-2xl border border-border/80 bg-background/96 shadow-lg backdrop-blur supports-[backdrop-filter]:bg-background/88"
          >
            <div className="px-3 py-2 border-b border-border/70 ui-text-meta text-muted-foreground">
              {slashQuery == null ? t('transcript.webSlashCommands') : t('transcript.slashFilter', { query: slashQuery })}
            </div>
            <div className="max-h-64 overflow-y-auto px-1 py-1.5">
              {slashCommandSpecs.length === 0 ? (
                <div className="rounded-lg px-2 py-2 ui-text-meta text-muted-foreground">
                  {t('transcript.noMatchingSlashCommand')}
                </div>
              ) : (
                slashCommandSpecs.map((spec, index) => (
                  <button
                    key={spec.command}
                    type="button"
                    aria-label={t('transcript.insertSlashCommand', { command: spec.command })}
                    className={cn(
                      'flex w-full items-start justify-between gap-3 rounded-xl px-2.5 py-2 text-left transition-colors',
                      index === slashSelectionIndex ? 'bg-muted/70 text-foreground' : 'text-foreground/92 hover:bg-muted/55',
                    )}
                    onMouseDown={(event) => {
                      event.preventDefault()
                    }}
                    onMouseEnter={() => {
                      setSlashSelectionIndex(index)
                    }}
                    onClick={() => {
                      applySlashCommandSelection(spec.command)
                    }}
                  >
                    <span className="font-mono text-[13px] leading-5">{spec.command}</span>
                    <span className="ui-text-meta text-muted-foreground text-right">{spec.description}</span>
                  </button>
                ))
              )}
            </div>
          </div>
        ) : null}
        <form
          className="group relative flex flex-col overflow-hidden rounded-[24px] border border-border/85 bg-card/95 shadow-sm focus-within:border-ring/30 focus-within:shadow-md transition-all duration-200"
          onSubmit={props.onSend}
        >
          <Textarea
            value={props.inputText}
            onChange={(event) => props.onInputTextChange(event.target.value)}
            placeholder={t('transcript.followUpPlaceholder')}
            className="min-h-[72px] max-h-[300px] w-full resize-none border-none bg-transparent px-5 pt-2 pb-1 ui-text-base leading-relaxed placeholder:text-muted-foreground/55 focus-visible:ring-0 shadow-none"
            onCompositionStart={() => setIsImeComposing(true)}
            onCompositionEnd={() => setIsImeComposing(false)}
            onKeyDown={(event) => {
              if (event.key === 'Tab' && event.shiftKey) {
                event.preventDefault()
                props.onModeChange(nextComposerMode(props.mode))
                return
              }
              if (isSlashMenuVisible && slashCommandSpecs.length > 0) {
                if (event.key === 'ArrowDown') {
                  event.preventDefault()
                  setSlashSelectionIndex((previous) => (previous + 1) % slashCommandSpecs.length)
                  return
                }
                if (event.key === 'ArrowUp') {
                  event.preventDefault()
                  setSlashSelectionIndex((previous) => (previous + slashCommandSpecs.length - 1) % slashCommandSpecs.length)
                  return
                }
                if (event.key === 'Tab') {
                  event.preventDefault()
                  const selected = slashCommandSpecs[slashSelectionIndex] ?? slashCommandSpecs[0]
                  if (selected) {
                    applySlashCommandSelection(selected.command)
                  }
                  return
                }
              }
              if (event.key === 'Escape' && isSlashMenuVisible) {
                event.preventDefault()
                setIsSlashMenuPinnedOpen(false)
                setIsSlashAutoOpenSuppressed(true)
                return
              }
              if (event.key !== 'Enter' || event.shiftKey) return
              const nativeEvent = event.nativeEvent as KeyboardEvent
              if (isImeComposing || nativeEvent.isComposing || nativeEvent.keyCode === 229) return
              if (
                props.longTextRequireCmdEnter === true &&
                shouldTreatAsLongPrompt(props.inputText) &&
                !nativeEvent.metaKey &&
                !nativeEvent.ctrlKey
              ) {
                return
              }
              event.preventDefault()
              if (props.activeThreadId && props.connectionStatus === 'connected' && !props.inputText.trim()) return
              if (props.activeThreadId && props.connectionStatus === 'connected' && !props.isSending) {
                props.onSend(event as unknown as FormEvent)
              }
            }}
          />

          <div className="flex items-center justify-between px-3 py-2">
            <div className="flex min-w-0 items-center gap-2.5">
              <Button
                type="button"
                variant="ghost"
                aria-label={t('transcript.openSlashCommands')}
                aria-expanded={isSlashMenuVisible}
                data-testid="composer-slash-trigger"
                onClick={toggleSlashMenu}
                className={cn(
                  'h-7 rounded-md px-2 font-mono text-[13px] leading-none tracking-tight text-muted-foreground transition-colors hover:text-foreground',
                  isSlashMenuVisible && 'bg-muted text-foreground',
                )}
                title={t('transcript.slashCommandsTitle')}
              >
                /
              </Button>
              <Button
                type="button"
                variant="ghost"
                aria-label={t('transcript.executionMode')}
                onClick={() => props.onModeChange(nextComposerMode(props.mode))}
                className={cn('h-7 rounded-md px-2 ui-text-base font-medium tracking-tight transition-colors', modeInfo.toneClass)}
                title={t('transcript.modeCycleTitle')}
              >
                <modeInfo.icon className="mr-0.5 size-3 shrink-0" />
                <span>{modeInfo.label}</span>
              </Button>
              <div className="hidden lg:block ui-text-base text-muted-foreground/85">
                {t('transcript.modeCycleHint')}
              </div>
            </div>
            <div className="flex items-center gap-1 pr-1 text-muted-foreground">
              {props.isSending || props.isInterrupting ? (
                <Button
                  type="button"
                  aria-label={t('transcript.interruptTurn')}
                  size="icon"
                  disabled={props.isInterrupting}
                  className="h-7 w-7 rounded-full shrink-0 border-0 bg-black text-white shadow-none hover:bg-black/90"
                  onClick={props.onInterrupt}
                >
                  <Square className="size-3 fill-current" />
                </Button>
              ) : (
                <Button
                  type="submit"
                  aria-label={t('transcript.sendMessage')}
                  disabled={!props.activeThreadId || props.connectionStatus !== 'connected' || !props.inputText.trim()}
                  size="icon"
                  className={cn(
                    'h-7 w-7 rounded-full shrink-0 border-0 shadow-none transition-colors duration-150 disabled:opacity-100',
                    !props.inputText.trim() ? 'ui-button-disabled text-white hover:ui-button-disabled' : 'bg-black text-white hover:bg-black/90',
                  )}
                >
                  <ArrowUp className="h-4 w-4" />
                </Button>
              )}
            </div>
          </div>
        </form>
      </div>
    </div>
  )
})

export function TranscriptPane(props: TranscriptPaneProps) {
  const {
    activeThread,
    activeThreadId,
    activeTurnId = null,
    virtualizationEnabled = false,
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
  } = props
  const turnInitRenderLimit = virtualizationEnabled ? VIRTUALIZED_TURN_INIT_RENDER_LIMIT : TURN_INIT_RENDER_LIMIT
  const turnBatchRenderSize = virtualizationEnabled ? VIRTUALIZED_TURN_BATCH_RENDER_SIZE : TURN_BATCH_RENDER_SIZE
  const historyBatchRenderSize = virtualizationEnabled ? VIRTUALIZED_HISTORY_BATCH_RENDER_SIZE : HISTORY_BATCH_RENDER_SIZE
  const renderWindowCap = virtualizationEnabled ? VIRTUALIZED_RENDER_WINDOW_CAP : RENDER_WINDOW_CAP

  const [isNearBottom, setIsNearBottom] = useState(true)
  const [autoStick, setAutoStick] = useState(true)
  const [renderLimit, setRenderLimit] = useState(turnInitRenderLimit)
  const [showErrorDetails, setShowErrorDetails] = useState(false)
  const [openToolIds, dispatchOpenToolIds] = useReducer(openIdsReducer, new Set<string>())
  const bottomRef = useRef<HTMLDivElement | null>(null)
  const scrollAreaRef = useRef<HTMLDivElement | null>(null)
  const viewportRef = useRef<HTMLElement | null>(null)
  const autoStickRef = useRef(autoStick)
  const autoStickStateRef = useRef(autoStick)
  const scrollRafHandleRef = useRef<number | null>(null)
  const scrollFallbackHandleRef = useRef<number | null>(null)
  const previousActiveTurnIdRef = useRef<string | null>(activeTurnId)

  const showTurnLoading = Boolean(activeThreadId) &&
    connectionStatus === 'connected' &&
    !isInterrupting &&
    (isSending || Boolean(activeTurnId))

  const transcriptRenderView = useMemo<TranscriptRenderView>(() => {
    const visibleItems: TranscriptItem[] = []
    for (const item of logs) {
      if (shouldRenderTranscriptItem(item)) {
        visibleItems.push(item)
      }
    }

    const visibleLogCount = visibleItems.length
    const hiddenInMemoryCount = Math.max(0, visibleLogCount - renderLimit)
    const renderStart = Math.max(0, visibleLogCount - renderLimit)
    const renderedRows: TranscriptRow[] = []

    let lastKnownTurnId: string | undefined

    for (let visibleIndex = renderStart; visibleIndex < visibleItems.length; visibleIndex += 1) {
      const item = visibleItems[visibleIndex]
      if (!item) continue
      const turnGroupStart = Boolean(item.turnId) && item.turnId !== lastKnownTurnId
      if (item.turnId) {
        lastKnownTurnId = item.turnId
      }
      renderedRows.push({
        item,
        turnGroupStart,
        showTurnGap: turnGroupStart && renderedRows.length > 0,
      })
    }

    return {
      visibleLogCount,
      hiddenInMemoryCount,
      renderedRows,
    }
  }, [logs, renderLimit])
  const showJumpToBottom = transcriptRenderView.visibleLogCount > 0 && !isNearBottom

  const setAutoStickState = useCallback((next: boolean) => {
    autoStickRef.current = next
    if (autoStickStateRef.current === next) return
    autoStickStateRef.current = next
    setAutoStick(next)
  }, [])

  const setNearBottomState = useCallback((next: boolean) => {
    setIsNearBottom((previous) => (previous === next ? previous : next))
  }, [])

  const syncViewportScrollState = useCallback((viewport: HTMLElement, nearBottom: boolean, syncNearBottom = true) => {
    viewport.style.overflowAnchor = nearBottom ? 'auto' : 'none'
    if (syncNearBottom) {
      setNearBottomState(nearBottom)
    }
    setAutoStickState(nearBottom)
  }, [setAutoStickState, setNearBottomState])

  useEffect(() => {
    return () => {
      if (scrollRafHandleRef.current != null) {
        window.cancelAnimationFrame(scrollRafHandleRef.current)
        scrollRafHandleRef.current = null
      }
      if (scrollFallbackHandleRef.current != null) {
        window.clearTimeout(scrollFallbackHandleRef.current)
        scrollFallbackHandleRef.current = null
      }
    }
  }, [])

  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'smooth') => {
    const viewport = viewportRef.current
    if (!viewport) {
      bottomRef.current?.scrollIntoView({ behavior, block: 'end' })
      setAutoStickState(true)
      setNearBottomState(true)
      return
    }
    viewport.style.overflowAnchor = 'auto'
    if (typeof viewport.scrollTo === 'function') {
      viewport.scrollTo({ top: viewport.scrollHeight, behavior })
    } else {
      viewport.scrollTop = viewport.scrollHeight
    }
    setAutoStickState(true)
    setNearBottomState(true)
  }, [setAutoStickState, setNearBottomState])

  const flushScrollFrame = useCallback(() => {
    if (scrollRafHandleRef.current != null) {
      window.cancelAnimationFrame(scrollRafHandleRef.current)
      scrollRafHandleRef.current = null
    }
    if (scrollFallbackHandleRef.current != null) {
      window.clearTimeout(scrollFallbackHandleRef.current)
      scrollFallbackHandleRef.current = null
    }
    const nextViewport = viewportRef.current
    if (!nextViewport) return
    const nearBottom = isViewportNearBottom(nextViewport)
    syncViewportScrollState(nextViewport, nearBottom)
  }, [syncViewportScrollState])

  const handleViewportScroll = useCallback(() => {
    const viewport = viewportRef.current
    if (!viewport) return
    const nearBottom = isViewportNearBottom(viewport)
    syncViewportScrollState(viewport, nearBottom, false)
    if (scrollRafHandleRef.current != null || scrollFallbackHandleRef.current != null) return
    scrollRafHandleRef.current = window.requestAnimationFrame(() => {
      flushScrollFrame()
    })
    // jsdom and throttled tabs may defer RAF indefinitely; keep scroll state eventually consistent.
    scrollFallbackHandleRef.current = window.setTimeout(() => {
      flushScrollFrame()
    }, 48)
  }, [flushScrollFrame, syncViewportScrollState])

  const handleBoundaryWheel = useCallback((event: WheelEvent) => {
    const viewport = viewportRef.current
    if (!viewport) return
    if (
      shouldStopWheelPropagation({
        deltaY: event.deltaY,
        scrollTop: viewport.scrollTop,
        scrollHeight: viewport.scrollHeight,
        clientHeight: viewport.clientHeight,
      })
    ) {
      event.stopPropagation()
    }
  }, [])

  useEffect(() => {
    if (!autoStick) return
    const raf = window.requestAnimationFrame(() => {
      if (!autoStickRef.current) return
      scrollToBottom('auto')
    })
    return () => {
      window.cancelAnimationFrame(raf)
    }
  }, [autoStick, scrollToBottom, transcriptRenderView.visibleLogCount, showTurnLoading])

  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return
    viewport.style.overflowAnchor = autoStick ? 'auto' : 'none'
  }, [autoStick])

  useEffect(() => {
    const root = scrollAreaRef.current
    if (!root) return
    const viewport = root.querySelector<HTMLElement>('[data-radix-scroll-area-viewport]')
    if (!viewport) return
    viewportRef.current = viewport
    viewport.style.overflowAnchor = autoStickStateRef.current ? 'auto' : 'none'
    viewport.addEventListener('scroll', handleViewportScroll, { passive: true })
    viewport.addEventListener('wheel', handleBoundaryWheel, { passive: true })
    syncViewportScrollState(viewport, isViewportNearBottom(viewport))
    return () => {
      if (scrollRafHandleRef.current != null) {
        window.cancelAnimationFrame(scrollRafHandleRef.current)
        scrollRafHandleRef.current = null
      }
      if (scrollFallbackHandleRef.current != null) {
        window.clearTimeout(scrollFallbackHandleRef.current)
        scrollFallbackHandleRef.current = null
      }
      viewport.removeEventListener('scroll', handleViewportScroll)
      viewport.removeEventListener('wheel', handleBoundaryWheel)
      if (viewportRef.current === viewport) {
        viewportRef.current = null
      }
    }
  }, [activeThreadId, handleBoundaryWheel, handleViewportScroll, syncViewportScrollState])

  const handleSend = useCallback((event: FormEvent) => {
    setAutoStickState(true)
    onSend(event)
  }, [onSend, setAutoStickState])

  const toggleToolOpen = useCallback((id: string) => {
    dispatchOpenToolIds({ type: 'toggle', id })
  }, [])

  const increaseRenderLimit = useCallback((delta: number, preserveAnchor: boolean, maxLimit: number) => {
    if (delta <= 0) return
    const viewport = viewportRef.current
    const beforeTop = viewport?.scrollTop ?? 0
    const beforeHeight = viewport?.scrollHeight ?? 0
    setRenderLimit((previous) => {
      const boundedNext = Math.min(maxLimit, previous + delta)
      return Math.max(previous, boundedNext)
    })
    if (!viewport) return
    if (!preserveAnchor) return
    window.requestAnimationFrame(() => {
      const afterHeight = viewport.scrollHeight
      viewport.scrollTop = beforeTop + Math.max(0, afterHeight - beforeHeight)
    })
  }, [])

  const renderEarlierMessages = useCallback(() => {
    if (transcriptRenderView.hiddenInMemoryCount <= 0) return
    increaseRenderLimit(historyBatchRenderSize, true, transcriptRenderView.visibleLogCount)
  }, [
    transcriptRenderView.hiddenInMemoryCount,
    transcriptRenderView.visibleLogCount,
    historyBatchRenderSize,
    increaseRenderLimit,
  ])

  const resetRenderLimit = useCallback(() => {
    setRenderLimit((previous) => (previous === turnInitRenderLimit ? previous : turnInitRenderLimit))
  }, [turnInitRenderLimit])

  useEffect(() => {
    resetRenderLimit()
  }, [activeThreadId, resetRenderLimit])

  const handleLoadEarlier = useCallback(() => {
    increaseRenderLimit(historyBatchRenderSize, true, transcriptRenderView.visibleLogCount)
    onLoadEarlier?.()
  }, [historyBatchRenderSize, increaseRenderLimit, onLoadEarlier, transcriptRenderView.visibleLogCount])
  const jumpToBottom = useCallback(() => {
    scrollToBottom('smooth')
  }, [scrollToBottom])

  useEffect(() => {
    if (!devLoadAllActive) return
    if (transcriptRenderView.hiddenInMemoryCount > 0) {
      increaseRenderLimit(
        transcriptRenderView.hiddenInMemoryCount,
        true,
        transcriptRenderView.visibleLogCount,
      )
    }
  }, [
    devLoadAllActive,
    transcriptRenderView.hiddenInMemoryCount,
    transcriptRenderView.visibleLogCount,
    increaseRenderLimit,
  ])

  useEffect(() => {
    if (activeTurnId && activeTurnId !== previousActiveTurnIdRef.current) {
      resetRenderLimit()
    }
    previousActiveTurnIdRef.current = activeTurnId
  }, [activeTurnId, resetRenderLimit])

  useEffect(() => {
    if (!activeTurnId) return
    const target = Math.min(transcriptRenderView.visibleLogCount, renderWindowCap)
    if (renderLimit >= target) return
    const schedule = (callback: () => void): number => {
      const withIdle = window as Window & {
        requestIdleCallback?: (cb: IdleRequestCallback) => number
      }
      if (typeof withIdle.requestIdleCallback === 'function') {
        return withIdle.requestIdleCallback(() => callback())
      }
      return window.setTimeout(callback, 0)
    }
    const cancel = (handle: number) => {
      const withIdle = window as Window & {
        cancelIdleCallback?: (id: number) => void
      }
      if (typeof withIdle.cancelIdleCallback === 'function') {
        withIdle.cancelIdleCallback(handle)
        return
      }
      window.clearTimeout(handle)
    }
    const handle = schedule(() => {
      increaseRenderLimit(turnBatchRenderSize, true, target)
    })
    return () => {
      cancel(handle)
    }
  }, [
    activeTurnId,
    transcriptRenderView.visibleLogCount,
    renderLimit,
    renderWindowCap,
    turnBatchRenderSize,
  ])

  return (
    <main data-testid="center-pane" className="center-pane flex-1 min-w-0 overflow-x-hidden flex flex-col bg-background">
      <TranscriptFeed
        isWelcomeState={!activeThreadId}
        activeThreadCwd={activeThread?.cwd}
        historyMore={historyMore}
        historyLoading={historyLoading}
        onLoadEarlier={handleLoadEarlier}
        hiddenInMemoryCount={transcriptRenderView.hiddenInMemoryCount}
        onRenderEarlierMessages={renderEarlierMessages}
        renderedLogsCount={transcriptRenderView.renderedRows.length}
        renderedRows={transcriptRenderView.renderedRows}
        openToolIds={openToolIds}
        onToggleTool={toggleToolOpen}
        showTurnLoading={showTurnLoading}
        lastRpcError={lastRpcError}
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
          activeThreadId={activeThreadId}
          connectionStatus={connectionStatus}
          isSending={isSending}
          isInterrupting={isInterrupting}
          onInterrupt={onInterrupt}
          onSend={handleSend}
          longTextRequireCmdEnter={longTextRequireCmdEnter}
        />
      ) : (
        <div data-testid="composer-locked" className="h-4" />
      )}
    </main>
  )
}
