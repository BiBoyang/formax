import { buildToolUiBlocks } from './toolBlocksRegistry'
import type { ToolCallItem, ToolDisplayDensity } from './toolUiBlocksTypes'
import { ToolUiBlocks } from './ToolUiBlocks'

export type ToolTranscriptItemProps = {
  item: ToolCallItem
  open: boolean
  onToggle: () => void
  cwd?: string
  displayDensity?: ToolDisplayDensity
}

export function ToolTranscriptItem(props: ToolTranscriptItemProps) {
  const { item, open, onToggle, cwd, displayDensity = 'compact' } = props
  const blocks = buildToolUiBlocks(item, { cwd, density: displayDensity })
  return <ToolUiBlocks blocks={blocks} open={open} onToggle={onToggle} displayDensity={displayDensity} />
}
