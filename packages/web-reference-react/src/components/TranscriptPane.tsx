import { memo, useCallback, useMemo, useReducer, useState, type FormEvent } from 'react'
import { ChevronDown, ChevronRight, Copy, SquareTerminal } from 'lucide-react'
import { useI18n } from '../app/i18n/I18nProvider'
import { cn } from '../lib/utils'
import { copyToClipboard } from '../lib/clipboard'
import { Badge } from './ui/badge'
import type { ContextMeterView, PendingTurnRuntime, TranscriptItem, ThreadSummary } from '../types'
import { MarkdownRenderer } from './MarkdownRenderer'
import { ToolTranscriptItem } from './tool/ToolTranscriptItem'
import { buildToolUiBlocks } from './tool/toolBlocksRegistry'
import type { ToolUiBlockHeader } from './tool/toolUiBlocksTypes'
import { CadencedShimmerText } from './CadencedShimmerText'
import { ComposerDock } from './composer/ComposerDock'
import { TranscriptErrorBlock, TranscriptFeed } from './transcript/TranscriptFeed'
import { DraftProjectSelector, NewThreadDraftSurface } from './transcript/NewThreadDraftSurface'
import { useRenderWindow } from './transcript/useRenderWindow'
import {
  buildTranscriptRenderBlocks,
  type TranscriptRenderBlock,
  type TranscriptToolGroupBlock,
  type TranscriptTurnBlock,
} from './transcript/transcriptTurnBlocks'
import type { VisibleSurface } from '../app/runtime/newThreadDraft'
import type { RuntimeModelTier, RuntimeThinkingEffort } from '../app/runtime/runtimePreferences'

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
  pendingTurns?: PendingTurnRuntime[]
  composerLocked?: boolean
  inputText: string
  connectionStatus: 'disconnected' | 'connecting' | 'connected'
  onInputTextChange: (value: string) => void
  mode: 'normal' | 'acceptEdits' | 'plan'
  modelTier: RuntimeModelTier
  thinkingMode: boolean
  thinkingEffort: RuntimeThinkingEffort
  thinkingEffortSupported: boolean
  onModeChange: (value: 'normal' | 'acceptEdits' | 'plan') => void
  onModelTierChange: (modelTier: RuntimeModelTier) => void
  onThinkingModeChange: (thinkingMode: boolean) => void
  onThinkingEffortChange: (thinkingEffort: RuntimeThinkingEffort) => void
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

function ReasoningItem(props: {
  item: Extract<TranscriptItem, { kind: 'thinking' }>
  open: boolean
  onToggle: (id: string) => void
  activeThreadCwd?: string
}) {
  const { t } = useI18n()
  const { item } = props
  const hasContent = Boolean(item.text.trim())
  return (
    <div className="my-1 text-muted-foreground">
      <button
        type="button"
        aria-expanded={props.open}
        className="inline-flex max-w-full items-center gap-1 rounded-md border border-transparent py-0.5 text-left ui-text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
        onClick={() => props.onToggle(item.id)}
      >
        <CadencedShimmerText
          text={t('transcript.reasoning')}
          active={item.status === 'running'}
          className="min-w-0 truncate text-muted-foreground/80"
        />
        {props.open ? (
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60" />
        )}
      </button>
      {props.open && hasContent ? (
        <div data-testid="reasoning-content" className="mt-1 text-muted-foreground/80">
          <MarkdownRenderer
            text={item.text}
            cacheKey={item.id}
            className="reasoning-markdown ui-text-meta leading-relaxed opacity-90"
            cwd={props.activeThreadCwd}
          />
        </div>
      ) : null}
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

function isPendingTurnVisible(args: {
  pending: PendingTurnRuntime
  activeThreadId: string | null
  surfaceKind: VisibleSurface
}): boolean {
  const { pending, activeThreadId, surfaceKind } = args
  if (pending.status === 'rolled_back' || pending.status === 'terminal') {
    return false
  }
  if (surfaceKind === 'newThreadDraft') {
    return activeThreadId == null && pending.owner.kind === 'draft'
  }
  if (surfaceKind === 'thread' && activeThreadId) {
    return pending.threadId === activeThreadId ||
      (pending.owner.kind === 'thread' && pending.owner.threadId === activeThreadId)
  }
  return false
}

function toPendingTranscriptItem(pending: PendingTurnRuntime): Extract<TranscriptItem, { kind: 'message' }> {
  return {
    id: pending.messageId,
    kind: 'message',
    role: 'user',
    text: pending.text,
    turnId: pending.turnId ?? pending.pendingTurnId,
    clientMessageId: pending.clientMessageId,
    optimistic: true,
  }
}

function mergePendingTranscriptItems(args: {
  logs: TranscriptItem[]
  pendingTurns: PendingTurnRuntime[]
  activeThreadId: string | null
  surfaceKind: VisibleSurface
}): TranscriptItem[] {
  if (args.pendingTurns.length === 0) return args.logs
  const canonicalClientMessageIds = collectCanonicalClientMessageIds(args.logs)
  const existingItemIds = new Set<string>()
  for (const item of args.logs) {
    existingItemIds.add(item.id)
  }
  const pendingItems = args.pendingTurns
    .filter((pending) => isPendingTurnVisible({
      pending,
      activeThreadId: args.activeThreadId,
      surfaceKind: args.surfaceKind,
    }))
    .filter((pending) => !canonicalClientMessageIds.has(pending.clientMessageId))
    .sort((a, b) => a.createdAtMs - b.createdAtMs)
    .map(toPendingTranscriptItem)
    .filter((item) => !existingItemIds.has(item.id))
  if (pendingItems.length === 0) return args.logs

  const merged = [...args.logs]
  for (const item of pendingItems) {
    const turnId = item.turnId
    const insertionIndex = turnId
      ? merged.findIndex((existing) => existing.turnId === turnId)
      : -1
    if (insertionIndex >= 0) {
      merged.splice(insertionIndex, 0, item)
    } else {
      merged.push(item)
    }
  }
  return merged
}

function collectCanonicalClientMessageIds(logs: TranscriptItem[]): Set<string> {
  const ids = new Set<string>()
  for (const item of logs) {
    if (item.kind === 'message' && item.role === 'user' && item.clientMessageId) {
      ids.add(item.clientMessageId)
    }
  }
  return ids
}

function hasVisiblePendingTurn(args: {
  logs: TranscriptItem[]
  pendingTurns: PendingTurnRuntime[]
  activeThreadId: string | null
  surfaceKind: VisibleSurface
}): boolean {
  if (args.pendingTurns.length === 0) return false
  const canonicalClientMessageIds = collectCanonicalClientMessageIds(args.logs)
  return args.pendingTurns.some((pending) =>
    isPendingTurnVisible({
      pending,
      activeThreadId: args.activeThreadId,
      surfaceKind: args.surfaceKind,
    }) && !canonicalClientMessageIds.has(pending.clientMessageId),
  )
}

type TranscriptItemRowProps = {
  item: TranscriptItem
  turnGroupStart: boolean
  showTurnGap: boolean
  activeThreadCwd?: string
  toolOpen: boolean
  onToggleTool: (id: string) => void
  reasoningOpen: boolean
  onToggleReasoning: (id: string) => void
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
    reasoningOpen,
    onToggleReasoning,
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
        <ReasoningItem
          item={item}
          open={reasoningOpen}
          onToggle={onToggleReasoning}
          activeThreadCwd={activeThreadCwd}
        />
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
              'transition-all duration-300',
              item.role === 'user'
                ? 'max-w-[85%] rounded-[14px] ui-surface-user-bubble px-3 py-1 text-foreground selection:bg-primary/20'
                : 'w-full text-foreground py-2'
            )}
          >
            {item.role === 'assistant' ? (
              <MarkdownRenderer text={item.text} cacheKey={item.id} className="ui-text-base leading-relaxed" cwd={activeThreadCwd} />
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
  renderedBlocks: TranscriptRenderBlock[]
  activeTurnId: string | null
  activeThreadCwd?: string
  showTurnLoading: boolean
  openToolIds: Set<string>
  openToolGroupIds: Set<string>
  openReasoningIds: Set<string>
  onToggleTool: (id: string) => void
  onToggleToolGroup: (id: string) => void
  onToggleReasoning: (id: string) => void
  onCopyText: (text: string) => void
}

function getLastTurnSegment(block: TranscriptTurnBlock): TranscriptTurnBlock['segments'][number] | undefined {
  return block.segments[block.segments.length - 1]
}

function shouldShowStandaloneLiveActivity(block: TranscriptTurnBlock): boolean {
  const lastSegment = getLastTurnSegment(block)
  return !lastSegment || lastSegment.kind === 'user_message'
}

const TranscriptRowsList = memo(function TranscriptRowsList(props: TranscriptRowsListProps) {
  if (props.renderedBlocks.length === 0) {
    return props.showTurnLoading ? <LiveActivityRow /> : null
  }
  const hasRenderedActiveTurn = props.renderedBlocks.some(
    (block) => block.kind === 'turn' && props.showTurnLoading && props.activeTurnId === block.turnId,
  )
  return (
    <>
      {props.renderedBlocks.map((block) => {
        if (block.kind === 'standalone') {
          return (
            <TranscriptItemRow
              key={block.row.item.id}
              item={block.row.item}
              turnGroupStart={block.row.turnGroupStart}
              showTurnGap={block.row.showTurnGap}
              activeThreadCwd={props.activeThreadCwd}
              toolOpen={props.openToolIds.has(block.row.item.id)}
              onToggleTool={props.onToggleTool}
              reasoningOpen={props.openReasoningIds.has(block.row.item.id)}
              onToggleReasoning={props.onToggleReasoning}
            />
          )
        }
        const isLiveTurn = props.showTurnLoading && props.activeTurnId === block.turnId
        return (
          <TranscriptTurnBlockItem
            key={block.id}
            block={block}
            activeTurnId={props.activeTurnId}
            activeThreadCwd={props.activeThreadCwd}
            showTurnLoading={props.showTurnLoading}
            showStandaloneLiveActivity={isLiveTurn && shouldShowStandaloneLiveActivity(block)}
            openToolIds={props.openToolIds}
            openToolGroupIds={props.openToolGroupIds}
            openReasoningIds={props.openReasoningIds}
            onToggleTool={props.onToggleTool}
            onToggleToolGroup={props.onToggleToolGroup}
            onToggleReasoning={props.onToggleReasoning}
            onCopyText={props.onCopyText}
          />
        )
      })}
      {props.showTurnLoading && !hasRenderedActiveTurn ? <LiveActivityRow /> : null}
    </>
  )
})

function TranscriptOperationButton(props: {
  label: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      aria-label={props.label}
      title={props.label}
      className="inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground/70 transition-colors hover:bg-muted/45 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
      onClick={props.onClick}
    >
      <Copy className="h-3.5 w-3.5" />
    </button>
  )
}

function UserMessageItem(props: {
  item: Extract<TranscriptItem, { kind: 'message' }> & { role: 'user' }
  onCopyText: (text: string) => void
}) {
  const { t } = useI18n()
  const { item } = props
  return (
    <div className="group/message relative flex w-full justify-end mb-1">
      <div className="max-w-[85%] rounded-[14px] ui-surface-user-bubble px-3 py-1 text-foreground selection:bg-primary/20 transition-all duration-300">
        <div className="ui-text-base leading-relaxed whitespace-pre-wrap break-words [overflow-wrap:anywhere] px-0.5">
          {item.text}
        </div>
      </div>
      <div className="absolute right-0 top-full z-10 flex h-6 items-center opacity-0 transition-opacity group-hover/message:opacity-100 focus-within:opacity-100">
        <TranscriptOperationButton
          label={t('transcript.copyUserMessage')}
          onClick={() => props.onCopyText(item.text)}
        />
      </div>
    </div>
  )
}

function AssistantAnswerItem(props: {
  item: Extract<TranscriptItem, { kind: 'message' }> & { role: 'assistant' }
  activeThreadCwd?: string
}) {
  return (
    <div className="flex w-full justify-start mb-1">
      <div className="w-full text-foreground py-2 transition-all duration-300">
        <MarkdownRenderer text={props.item.text} cacheKey={props.item.id} className="ui-text-base leading-relaxed" cwd={props.activeThreadCwd} />
      </div>
    </div>
  )
}

function getAssistantCopyText(block: TranscriptTurnBlock): string {
  const parts: string[] = []
  for (const segment of block.segments) {
    if (segment.kind !== 'assistant_answer') continue
    const text = segment.item.text.trim()
    if (text) parts.push(text)
  }
  return parts.join('\n\n')
}

function AssistantGroupOperations(props: {
  copyText: string
  onCopyText: (text: string) => void
}) {
  const { t } = useI18n()
  if (!props.copyText) return null
  return (
    <div className="flex h-6 items-center justify-start opacity-0 transition-opacity group-hover/assistant:opacity-100 focus-within:opacity-100">
      <TranscriptOperationButton
        label={t('transcript.copyAssistantMessage')}
        onClick={() => props.onCopyText(props.copyText)}
      />
    </div>
  )
}

function LiveActivityRow() {
  const { t } = useI18n()
  return (
    <div data-testid="turn-live-activity" className="my-1 flex min-w-0 items-center gap-1 text-muted-foreground">
      <CadencedShimmerText
        text={t('transcript.thinking')}
        active
        className="min-w-0 truncate ui-text-base text-muted-foreground/85"
      />
      <ChevronDown aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-muted-foreground/70" />
    </div>
  )
}

function getToolHeaderBlock(
  item: Extract<TranscriptItem, { kind: 'tool_call' }>,
  cwd?: string,
): ToolUiBlockHeader | undefined {
  return buildToolUiBlocks(item, { cwd, density: 'compact' }).find(
    (block): block is ToolUiBlockHeader => block.kind === 'header',
  )
}

function getToolHeaderDisplayText(
  item: Extract<TranscriptItem, { kind: 'tool_call' }>,
  cwd?: string,
): string {
  const header = getToolHeaderBlock(item, cwd)
  if (!header) return item.summary || item.toolName
  const parts = [header.title, header.subtitle].filter((part): part is string => Boolean(part?.trim()))
  return parts.length > 0 ? parts.join(' ') : item.summary || item.toolName
}

function getLastRunningTool(group: TranscriptToolGroupBlock): Extract<TranscriptItem, { kind: 'tool_call' }> | null {
  for (let index = group.tools.length - 1; index >= 0; index -= 1) {
    const tool = group.tools[index]
    if (tool?.status === 'running') return tool
  }
  return null
}

function ToolGroupBlockItem(props: {
  group: TranscriptToolGroupBlock
  activeThreadCwd?: string
  open: boolean
  liveRunning: boolean
  liveWaiting: boolean
  openToolIds: Set<string>
  onToggleTool: (id: string) => void
  onToggleToolGroup: (id: string) => void
}) {
  const { t } = useI18n()
  const { group, open } = props
  const runningTool = getLastRunningTool(group)
  const liveText = props.liveRunning && runningTool
    ? getToolHeaderDisplayText(runningTool, props.activeThreadCwd)
    : props.liveWaiting
      ? t('transcript.thinking')
      : null
  const headerText = liveText ?? group.collapsedSummary
  const headerActive = Boolean(liveText)
  return (
    <div className="my-1 text-muted-foreground">
      <button
        type="button"
        aria-expanded={open}
        className="inline-flex max-w-full items-center gap-1 rounded-md border border-transparent py-0.5 text-left ui-text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
        onClick={() => props.onToggleToolGroup(group.id)}
      >
        <SquareTerminal aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-muted-foreground/70" />
        <CadencedShimmerText
          text={headerText}
          active={headerActive}
          className="min-w-0 truncate text-muted-foreground/85"
        />
        {open ? <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground/70" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground/70" />}
      </button>
      {open ? (
        <div className="mt-1 space-y-1">
          {group.tools.map((tool) => (
            <ToolTranscriptItem
              key={tool.id}
              item={tool}
              cwd={props.activeThreadCwd}
              displayDensity="compact"
              open={props.openToolIds.has(tool.id)}
              onToggle={() => props.onToggleTool(tool.id)}
            />
          ))}
        </div>
      ) : null}
    </div>
  )
}

function TranscriptTurnBlockItem(props: {
  block: TranscriptTurnBlock
  activeTurnId: string | null
  activeThreadCwd?: string
  showTurnLoading: boolean
  showStandaloneLiveActivity: boolean
  openToolIds: Set<string>
  openToolGroupIds: Set<string>
  openReasoningIds: Set<string>
  onToggleTool: (id: string) => void
  onToggleToolGroup: (id: string) => void
  onToggleReasoning: (id: string) => void
  onCopyText: (text: string) => void
}) {
  const { block } = props
  const assistantCopyText = getAssistantCopyText(block)
  const isLiveTurn = props.showTurnLoading && props.activeTurnId === block.turnId
  return (
    <div
      data-testid="transcript-turn-block"
      data-turn-group-start={block.turnGroupStart ? 'true' : undefined}
      className={cn('min-w-0 ui-content-auto', block.showTurnGap ? 'mt-3 pt-1' : null)}
    >
      <div className="group/assistant min-w-0">
        {block.segments.map((segment, index) => {
          if (segment.kind === 'user_message') {
            return <UserMessageItem key={segment.item.id} item={segment.item} onCopyText={props.onCopyText} />
          }
          if (segment.kind === 'assistant_answer') {
            return <AssistantAnswerItem key={segment.item.id} item={segment.item} activeThreadCwd={props.activeThreadCwd} />
          }
          if (segment.kind === 'status') {
            return segment.item.status !== 'completed' ? <TurnFooterItem key={segment.item.id} item={segment.item} /> : null
          }
          if (segment.kind === 'thinking') {
            return (
              <ReasoningItem
                key={segment.item.id}
                item={segment.item}
                open={props.openReasoningIds.has(segment.item.id)}
                onToggle={props.onToggleReasoning}
                activeThreadCwd={props.activeThreadCwd}
              />
            )
          }
          return (
            <ToolGroupBlockItem
              key={segment.group.id}
              group={segment.group}
              activeThreadCwd={props.activeThreadCwd}
              open={props.openToolGroupIds.has(segment.group.id)}
              liveRunning={isLiveTurn && index === block.segments.length - 1 && Boolean(getLastRunningTool(segment.group))}
              liveWaiting={isLiveTurn && index === block.segments.length - 1 && !getLastRunningTool(segment.group)}
              openToolIds={props.openToolIds}
              onToggleTool={props.onToggleTool}
              onToggleToolGroup={props.onToggleToolGroup}
            />
          )
        })}
        {props.showStandaloneLiveActivity ? <LiveActivityRow /> : null}
        <AssistantGroupOperations copyText={assistantCopyText} onCopyText={props.onCopyText} />
      </div>
    </div>
  )
}

export function TranscriptPane(props: TranscriptPaneProps) {
  const { t } = useI18n()
  const {
    activeThread,
    activeThreadId,
    activeTurnId = null,
    virtualizationEnabled = false,
    surfaceKind = activeThreadId ? 'thread' : 'newThreadDraft',
    logs,
    pendingTurns = [],
    composerLocked = false,
    inputText,
    mode,
    modelTier,
    thinkingMode,
    thinkingEffort,
    thinkingEffortSupported,
    onModeChange,
    onModelTierChange,
    onThinkingModeChange,
    onThinkingEffortChange,
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
  const [openToolGroupIds, dispatchOpenToolGroupIds] = useReducer(openIdsReducer, new Set<string>())
  const [openReasoningIds, dispatchOpenReasoningIds] = useReducer(openIdsReducer, new Set<string>())
  const hasActiveTurn = Boolean(activeTurnId)
  const hasPendingTurnActivity = useMemo(
    () => hasVisiblePendingTurn({
      logs,
      pendingTurns,
      activeThreadId,
      surfaceKind,
    }),
    [activeThreadId, logs, pendingTurns, surfaceKind],
  )
  const displayLogs = useMemo(
    () => mergePendingTranscriptItems({
      logs,
      pendingTurns,
      activeThreadId,
      surfaceKind,
    }),
    [activeThreadId, logs, pendingTurns, surfaceKind],
  )

  const canShowTurnLoadingOnSurface = Boolean(activeThreadId) ||
    (surfaceKind === 'newThreadDraft' && hasPendingTurnActivity)
  const showTurnLoading = canShowTurnLoadingOnSurface &&
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
    logs: displayLogs,
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
  const toggleToolGroupOpen = useCallback((id: string) => {
    dispatchOpenToolGroupIds({ type: 'toggle', id })
  }, [])
  const toggleReasoningOpen = useCallback((id: string) => {
    dispatchOpenReasoningIds({ type: 'toggle', id })
  }, [])
  const handleCopyText = useCallback((text: string) => {
    void copyToClipboard(text).catch(() => undefined)
  }, [])

  const lastRpcErrorDetails = useMemo(
    () => (lastRpcError ? formatRpcErrorDetails(lastRpcError) : ''),
    [lastRpcError?.at, lastRpcError?.method, lastRpcError?.message, lastRpcError?.code, lastRpcError?.data],
  )
  const renderedBlocks = useMemo(
    () => buildTranscriptRenderBlocks(transcriptRenderView.renderedRows),
    [transcriptRenderView.renderedRows],
  )
  const rowsContent = useMemo(
    () => (
      <TranscriptRowsList
        renderedBlocks={renderedBlocks}
        activeTurnId={activeTurnId}
        activeThreadCwd={activeThread?.cwd}
        showTurnLoading={showTurnLoading}
        openToolIds={openToolIds}
        openToolGroupIds={openToolGroupIds}
        openReasoningIds={openReasoningIds}
        onToggleTool={toggleToolOpen}
        onToggleToolGroup={toggleToolGroupOpen}
        onToggleReasoning={toggleReasoningOpen}
        onCopyText={handleCopyText}
      />
    ),
    [
      activeThread?.cwd,
      activeTurnId,
      openToolIds,
      openToolGroupIds,
      openReasoningIds,
      renderedBlocks,
      showTurnLoading,
      toggleToolOpen,
      toggleToolGroupOpen,
      toggleReasoningOpen,
      handleCopyText,
    ],
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
                modelTier={modelTier}
                thinkingMode={thinkingMode}
                thinkingEffort={thinkingEffort}
                thinkingEffortSupported={thinkingEffortSupported}
                onModeChange={onModeChange}
                onModelTierChange={onModelTierChange}
                onThinkingModeChange={onThinkingModeChange}
                onThinkingEffortChange={onThinkingEffortChange}
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
                    <TranscriptErrorBlock
                      message={lastRpcError.message}
                      details={lastRpcErrorDetails}
                      open={showErrorDetails}
                      onOpenChange={setShowErrorDetails}
                      className="mb-3"
                    />
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
              modelTier={modelTier}
              thinkingMode={thinkingMode}
              thinkingEffort={thinkingEffort}
              thinkingEffortSupported={thinkingEffortSupported}
              onModeChange={onModeChange}
              onModelTierChange={onModelTierChange}
              onThinkingModeChange={onThinkingModeChange}
              onThinkingEffortChange={onThinkingEffortChange}
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
