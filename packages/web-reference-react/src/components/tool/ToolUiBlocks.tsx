import { ChevronDown, ChevronRight } from 'lucide-react'
import { cn } from '../../lib/utils'
import { DiffPatchView } from '../diff/DiffPatchView'
import { truncatePathFromLeft } from '../diff/diffTypes'
import { Button } from '../ui/button'
import { CadencedShimmerText } from '../CadencedShimmerText'
import { TOOL_PREVIEW_MAX_HEIGHT_PX, TOOL_PREVIEW_MAX_LINES, TOOL_PREVIEW_MAX_RENDER_LINES } from './toolUiConstants'
import type {
  ToolDisplayDensity,
  ToolInputState,
  ToolUiBlock,
  ToolUiBlockCodePreview,
  ToolUiBlockDetails,
  ToolUiBlockDiff,
  ToolUiBlockHeader,
  ToolUiBlockIo,
  ToolUiBlockTodoList,
  ToolStatus,
} from './toolUiBlocksTypes'

export type ToolUiBlocksProps = {
  blocks: ToolUiBlock[]
  open: boolean
  onToggle: () => void
  displayDensity?: ToolDisplayDensity
}

const TOOL_HEADER_DETAIL_MAX_CHARS = 120

function clipHeaderDetailText(text: string | undefined): string | undefined {
  if (!text) return undefined
  if (text.length <= TOOL_HEADER_DETAIL_MAX_CHARS) return text
  return `${text.slice(0, TOOL_HEADER_DETAIL_MAX_CHARS - 3)}...`
}

function statusDotClass(status: ToolStatus): string {
  if (status === 'running') return 'bg-[var(--tool-status-running)] animate-pulse'
  if (status === 'error') return 'bg-[var(--tool-status-error)]'
  if (status === 'completed') return 'bg-[var(--tool-status-completed)]'
  return 'bg-muted-foreground/40'
}

function statusDotClassForBlock(status: ToolStatus, inputState?: ToolInputState): string {
  if (inputState?.status === 'pending') return 'bg-amber-500 animate-pulse'
  if (inputState?.status === 'failed') return 'bg-red-500'
  if (inputState?.status === 'expired' || inputState?.status === 'canceled') return 'bg-muted-foreground/50'
  return statusDotClass(status)
}

function inputStateLabel(inputState: ToolInputState): string {
  const prefix = inputState.kind === 'approval' ? 'approval' : 'question'
  return `${prefix}:${inputState.status}`
}

function inputStateClass(inputState: ToolInputState): string {
  if (inputState.status === 'pending') return 'bg-amber-500/15 text-amber-700 border-amber-500/30 animate-pulse'
  if (inputState.status === 'submitted') return 'bg-emerald-500/12 text-emerald-700 border-emerald-500/25'
  if (inputState.status === 'failed') return 'bg-red-500/12 text-red-700 border-red-500/25'
  if (inputState.status === 'expired' || inputState.status === 'canceled') return 'bg-muted text-muted-foreground border-border'
  return 'bg-muted text-muted-foreground border-border'
}

function HeaderBlock(props: { block: ToolUiBlockHeader; open: boolean; onToggle: () => void; displayDensity: ToolDisplayDensity }) {
  const { block, open, onToggle, displayDensity } = props
  const showParams = Boolean(block.paramsText) && (displayDensity === 'verbose' || open || !block.expandable)
  const label = block.title
  const subtitle = clipHeaderDetailText(block.subtitle ?? (showParams ? block.paramsText : undefined))
  const trailingParams = clipHeaderDetailText(block.subtitle && showParams ? block.paramsText : undefined)
  const showInputStateBadge = Boolean(block.inputState && block.inputState.status !== 'submitted')
  const isRunning = block.status === 'running'
  return (
    <button
      type="button"
      className={cn(
        'flex w-full items-center gap-2 py-0.5 text-left',
        block.expandable ? 'cursor-pointer' : 'cursor-default',
      )}
      onClick={block.expandable ? onToggle : undefined}
    >
      <span
        data-testid="tool-status-dot"
        className={cn('h-2 w-2 shrink-0 rounded-full', statusDotClassForBlock(block.status, block.inputState))}
      />
      <CadencedShimmerText
        text={label}
        active={isRunning}
        className="shrink-0 ui-text-base leading-5 font-semibold ui-text-primary"
      />
      {subtitle ? (
        <CadencedShimmerText
          text={subtitle}
          active={isRunning}
          className={cn(
            'min-w-0 truncate ui-text-base leading-5 text-muted-foreground',
            block.subtitleMono ? 'font-mono' : null,
          )}
        />
      ) : null}
      {trailingParams ? (
        <CadencedShimmerText
          text={trailingParams}
          active={isRunning}
          className="min-w-0 truncate ui-text-base leading-5 text-muted-foreground"
        />
      ) : null}
      {showInputStateBadge && block.inputState ? (
        <span className={cn('shrink-0 rounded-full border px-2 py-0.5 ui-text-micro font-medium uppercase tracking-wide', inputStateClass(block.inputState))}>
          {inputStateLabel(block.inputState)}
        </span>
      ) : null}
      {block.expandable ? (
        open ? <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      ) : null}
    </button>
  )
}

function PreviewLines(props: { lines: string[]; maxLines?: number }) {
  const { lines, maxLines = TOOL_PREVIEW_MAX_LINES } = props
  const renderLimit = Math.max(maxLines, TOOL_PREVIEW_MAX_RENDER_LINES)
  const renderedLines = lines.slice(0, renderLimit)
  const hiddenLineCount = Math.max(0, lines.length - renderedLines.length)
  const showOverflowAffordance = renderedLines.length > maxLines
  return (
    <div className="relative min-w-0">
      <div
        className="space-y-0.5 overflow-y-auto pr-2 font-mono ui-text-base ui-text-secondary leading-8 whitespace-pre-wrap break-words [overflow-wrap:anywhere]"
        style={{ maxHeight: `${TOOL_PREVIEW_MAX_HEIGHT_PX}px` }}
      >
        {renderedLines.map((line, index) => (
          <div key={`preview-line-${index}`}>{line || '\u00a0'}</div>
        ))}
        {hiddenLineCount > 0 ? (
          <div className="ui-text-meta text-muted-foreground">{`... ${hiddenLineCount} more lines not shown`}</div>
        ) : null}
      </div>
      {showOverflowAffordance ? (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-8 bg-gradient-to-t from-background via-background/95 to-transparent" />
      ) : null}
    </div>
  )
}

function IoBlock({ block }: { block: ToolUiBlockIo }) {
  const outputLines = block.outputLines ?? []
  return (
    <div className="mt-2 rounded-[12px] border border-border/60 bg-muted/20 overflow-hidden">
      <div className="grid grid-cols-[56px_minmax(0,1fr)] items-start gap-2 px-3 py-2">
        <div className="ui-text-base font-semibold tracking-tight text-muted-foreground">{block.inputLabel}</div>
        <div className="font-mono ui-text-base ui-text-primary whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{block.inputText}</div>
      </div>
      {block.outputLabel && outputLines.length > 0 ? (
        <div className="grid grid-cols-[56px_minmax(0,1fr)] items-start gap-2 border-t border-border/60 px-3 py-2">
          <div className="ui-text-base font-semibold tracking-tight text-muted-foreground">{block.outputLabel}</div>
          <PreviewLines lines={outputLines} />
        </div>
      ) : null}
    </div>
  )
}

function CodePreviewBlock({ block }: { block: ToolUiBlockCodePreview }) {
  return (
    <div className="mt-1">
      <div className="ui-text-base text-muted-foreground">{`${block.lineCount} lines`}</div>
      <div className="mt-2 rounded-[12px] border border-border/70 bg-background/60 px-4 py-3">
        <PreviewLines lines={block.lines} />
      </div>
    </div>
  )
}

function DetailsBlock({ block }: { block: ToolUiBlockDetails }) {
  return (
    <div className="mt-1">
      <div className="space-y-0.5 font-mono ui-text-meta ui-text-secondary">
        {block.lines.map((line, index) => (
          <div key={`tool-line-${index}`} className="whitespace-pre-wrap break-all leading-5">
            {line}
          </div>
        ))}
      </div>
    </div>
  )
}

function TodoListBlock({ block }: { block: ToolUiBlockTodoList }) {
  const toStatusGlyph = (status: ToolUiBlockTodoList['items'][number]['status']): string => {
    if (status === 'completed') return '✓'
    if (status === 'in_progress') return '*'
    return ''
  }

  return (
    <div className="mt-2 space-y-2.5">
      {block.items.map((item, index) => (
        <div key={`todo-item-${index}-${item.content}`} className="flex items-center gap-2 min-w-0">
          <Button
            type="button"
            variant="outline"
            size="icon"
            tabIndex={-1}
            aria-hidden="true"
            data-testid={`todo-item-status-${index}`}
            data-status={item.status}
            className={cn(
              'h-4 w-4 flex items-center justify-center shrink-0 rounded-[5px] p-0 text-[13px] leading-none font-semibold pointer-events-none',
              item.status === 'completed' ? 'border-border/80 text-muted-foreground/80 bg-muted/25' : null,
              item.status === 'in_progress' ? 'border-border/80 text-muted-foreground bg-muted/15' : null,
              item.status === 'pending' ? 'border-border/80 text-transparent bg-transparent' : null,
            )}
          >
            {toStatusGlyph(item.status)}
          </Button>
          <span
            className={cn(
              'min-w-0 truncate ui-text-base leading-6',
              item.status === 'completed' ? 'line-through text-muted-foreground/70' : 'ui-text-primary',
            )}
          >
            {item.content}
          </span>
        </div>
      ))}
    </div>
  )
}

function DiffBlock({ block }: { block: ToolUiBlockDiff }) {
  const showFileHeader = block.files.length > 1
  return (
    <div className="mt-2 space-y-2">
      {block.files.map((file) => (
        <div key={`${file.path}-${(file.patch ?? '').length}`} className="rounded-[10px] overflow-hidden border border-border/70 bg-muted/25">
          {showFileHeader ? (
            <div className="flex min-w-0 items-center justify-between w-full text-left px-3.5 py-2 ui-surface-subtle">
              <div className="flex items-center gap-x-2.5 min-w-0 flex-1">
                <span title={file.path} className="font-mono min-w-0 truncate ui-text-primary ui-text-base leading-4 font-medium">
                  {truncatePathFromLeft(file.path)}
                </span>
                <div className="flex items-center gap-1 ui-text-base leading-4 font-mono font-normal shrink-0">
                  <span className="ui-text-diff-add">+{file.additions}</span>
                  <span className="ui-text-diff-del">-{file.deletions}</span>
                </div>
              </div>
            </div>
          ) : null}
          <DiffPatchView patch={file.patch ?? ''} maxHeightClassName="max-h-[420px]" />
        </div>
      ))}
    </div>
  )
}

export function ToolUiBlocks({ blocks, open, onToggle, displayDensity = 'compact' }: ToolUiBlocksProps) {
  const header = blocks.find((block): block is ToolUiBlockHeader => block.kind === 'header')
  const ioBlock = blocks.find((block): block is ToolUiBlockIo => block.kind === 'io')
  const codePreviewBlock = blocks.find((block): block is ToolUiBlockCodePreview => block.kind === 'code_preview')
  const details = blocks.find((block): block is ToolUiBlockDetails => block.kind === 'details')
  const info = blocks.find((block) => block.kind === 'info')
  const todoList = blocks.find((block): block is ToolUiBlockTodoList => block.kind === 'todo_list')
  const diff = blocks.find((block): block is ToolUiBlockDiff => block.kind === 'diff')
  const showSupplementalBlocks = open || !header || !header.expandable
  const showExpandableDetails = Boolean(open && header?.expandable)
  const showDiff = Boolean(diff) && showSupplementalBlocks

  return (
    <div className="py-0.5">
      {header ? <HeaderBlock block={header} open={open} onToggle={onToggle} displayDensity={displayDensity} /> : null}
      {ioBlock && showSupplementalBlocks ? <IoBlock block={ioBlock} /> : null}
      {codePreviewBlock && showSupplementalBlocks ? <CodePreviewBlock block={codePreviewBlock} /> : null}
      {info && info.kind === 'info' && showSupplementalBlocks ? (
        <div className="ui-text-base text-muted-foreground">{info.text}</div>
      ) : null}
      {todoList && showSupplementalBlocks ? <TodoListBlock block={todoList} /> : null}
      {showDiff && diff ? <DiffBlock block={diff} /> : null}
      {details && showExpandableDetails ? <DetailsBlock block={details} /> : null}
    </div>
  )
}
