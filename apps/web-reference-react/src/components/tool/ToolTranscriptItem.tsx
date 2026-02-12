import { buildToolUiBlocks } from './toolBlocksRegistry'
import type { ToolCallItem } from './toolUiBlocksTypes'
import { ToolUiBlocks } from './ToolUiBlocks'

export type ToolTranscriptItemProps = {
  item: ToolCallItem
  open: boolean
  onToggle: () => void
  cwd?: string
}

export function ToolTranscriptItem(props: ToolTranscriptItemProps) {
  const { item, open, onToggle, cwd } = props
  const blocks = buildToolUiBlocks(item, { cwd })
  return <ToolUiBlocks blocks={blocks} open={open} onToggle={onToggle} />
}
