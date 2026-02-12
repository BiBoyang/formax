import { buildToolUiBlocks } from './toolBlocksRegistry'
import type { ToolCallItem } from './toolUiBlocksTypes'
import { ToolUiBlocks } from './ToolUiBlocks'

export type ToolTranscriptItemProps = {
  item: ToolCallItem
  open: boolean
  onToggle: () => void
}

export function ToolTranscriptItem(props: ToolTranscriptItemProps) {
  const { item, open, onToggle } = props
  const blocks = buildToolUiBlocks(item)
  return <ToolUiBlocks blocks={blocks} open={open} onToggle={onToggle} />
}
