import { ChevronDown, ChevronRight } from 'lucide-react'
import { cn } from '../../lib/utils'
import type { ToolInputState, ToolUiBlock, ToolUiBlockDetails, ToolUiBlockHeader, ToolStatus } from './toolUiBlocksTypes'

export type ToolUiBlocksProps = {
  blocks: ToolUiBlock[]
  open: boolean
  onToggle: () => void
}

function statusDotClass(status: ToolStatus): string {
  if (status === 'running') return 'bg-emerald-500 animate-pulse'
  if (status === 'error') return 'bg-red-500'
  if (status === 'completed') return 'bg-emerald-500/80'
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

function HeaderBlock(props: { block: ToolUiBlockHeader; open: boolean; onToggle: () => void }) {
  const { block, open, onToggle } = props
  const label = block.paramsText ? `${block.title} (${block.paramsText})` : block.title
  return (
    <button
      type="button"
      className={cn(
        'flex w-full items-center gap-2.5 py-1 text-left',
        block.expandable ? 'cursor-pointer' : 'cursor-default',
      )}
      onClick={block.expandable ? onToggle : undefined}
    >
      <span
        data-testid="tool-status-dot"
        className={cn('h-2 w-2 shrink-0 rounded-full', statusDotClassForBlock(block.status, block.inputState))}
      />
      <span className="min-w-0 truncate text-[15px] font-medium text-foreground/90">{label}</span>
      <div className="ml-auto flex min-w-0 items-center gap-2">
        {block.inputState ? (
          <span className={cn('shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide', inputStateClass(block.inputState))}>
            {inputStateLabel(block.inputState)}
          </span>
        ) : null}
        {block.summary ? <span className="truncate text-[12px] text-muted-foreground">{block.summary}</span> : null}
        {block.expandable ? (
          open ? <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        ) : null}
      </div>
    </button>
  )
}

function DetailsBlock({ block }: { block: ToolUiBlockDetails }) {
  return (
    <div className="ml-3 mt-1 border-l border-border/60 pl-4">
      <div className="space-y-0.5 font-mono text-[11px] text-muted-foreground/90">
        {block.lines.map((line, index) => (
          <div key={`tool-line-${index}`} className="whitespace-pre-wrap break-all leading-5">
            {line}
          </div>
        ))}
      </div>
    </div>
  )
}

export function ToolUiBlocks({ blocks, open, onToggle }: ToolUiBlocksProps) {
  const header = blocks.find((block): block is ToolUiBlockHeader => block.kind === 'header')
  const details = blocks.find((block): block is ToolUiBlockDetails => block.kind === 'details')
  const info = blocks.find((block) => block.kind === 'info')

  return (
    <div className="py-0.5">
      {header ? <HeaderBlock block={header} open={open} onToggle={onToggle} /> : null}
      {info && info.kind === 'info' ? (
        <div className="ml-[18px] text-[12px] text-muted-foreground">{info.text}</div>
      ) : null}
      {details && open ? <DetailsBlock block={details} /> : null}
    </div>
  )
}
