import type { TranscriptItem } from '../../types'
import type { TranscriptRow } from './useRenderWindow'

type TranscriptMessageItem = Extract<TranscriptItem, { kind: 'message' }>
type TranscriptUserMessageItem = TranscriptMessageItem & { role: 'user' }
type TranscriptAssistantMessageItem = TranscriptMessageItem & { role: 'assistant' }
type TranscriptThinkingItem = Extract<TranscriptItem, { kind: 'thinking' }>
type TranscriptToolCallItem = Extract<TranscriptItem, { kind: 'tool_call' }>

export type TranscriptStandaloneBlock = {
  kind: 'standalone'
  row: TranscriptRow
}

export type TranscriptTurnBlock = {
  kind: 'turn'
  id: string
  turnId: string
  turnGroupStart: boolean
  showTurnGap: boolean
  segments: TranscriptTurnSegment[]
}

export type TranscriptToolGroupBlock = {
  kind: 'tool_group'
  id: string
  collapsedSummary: string
  tools: TranscriptToolCallItem[]
}

export type TranscriptTurnSegment =
  | { kind: 'user_message'; item: TranscriptUserMessageItem }
  | { kind: 'assistant_answer'; item: TranscriptAssistantMessageItem }
  | { kind: 'tool_group'; group: TranscriptToolGroupBlock }
  | { kind: 'thinking'; item: TranscriptThinkingItem }
  | { kind: 'status'; item: Extract<TranscriptItem, { kind: 'turn_footer' }> }

export type TranscriptRenderBlock = TranscriptStandaloneBlock | TranscriptTurnBlock

type MutableTurnBlock = TranscriptTurnBlock & {
  pendingTools: TranscriptToolCallItem[]
}

function makeMutableTurnBlock(row: TranscriptRow, turnId: string): MutableTurnBlock {
  return {
    kind: 'turn',
    id: `turn:${turnId}:${row.item.id}`,
    turnId,
    turnGroupStart: row.turnGroupStart,
    showTurnGap: row.showTurnGap,
    segments: [],
    pendingTools: [],
  }
}

function toFinalTurnBlock(block: MutableTurnBlock): TranscriptTurnBlock {
  flushPendingTools(block)
  return {
    kind: 'turn',
    id: block.id,
    turnId: block.turnId,
    turnGroupStart: block.turnGroupStart,
    showTurnGap: block.showTurnGap,
    segments: block.segments,
  }
}

function appendTurnItem(block: MutableTurnBlock, item: TranscriptItem): void {
  if (item.kind === 'tool_call') {
    block.pendingTools.push(item)
    return
  }

  if (item.kind === 'thinking') {
    flushPendingTools(block)
    block.segments.push({ kind: 'thinking', item })
    return
  }

  flushPendingTools(block)

  if (item.kind === 'message') {
    if (item.role === 'user') {
      block.segments.push({ kind: 'user_message', item: item as TranscriptUserMessageItem })
    } else {
      block.segments.push({ kind: 'assistant_answer', item: item as TranscriptAssistantMessageItem })
    }
    return
  }
  if (item.kind === 'turn_footer') {
    block.segments.push({ kind: 'status', item })
  }
}

function flushPendingTools(block: MutableTurnBlock): void {
  const group = buildToolGroupBlock(block.turnId, block.pendingTools)
  if (group) block.segments.push({ kind: 'tool_group', group })
  block.pendingTools = []
}

export function buildTranscriptRenderBlocks(rows: TranscriptRow[]): TranscriptRenderBlock[] {
  const blocks: TranscriptRenderBlock[] = []
  let currentTurn: MutableTurnBlock | null = null

  const flushTurn = () => {
    if (!currentTurn) return
    blocks.push(toFinalTurnBlock(currentTurn))
    currentTurn = null
  }

  for (const row of rows) {
    const turnId = row.item.turnId
    if (!turnId) {
      flushTurn()
      blocks.push({ kind: 'standalone', row })
      continue
    }

    if (!currentTurn || currentTurn.turnId !== turnId) {
      flushTurn()
      currentTurn = makeMutableTurnBlock(row, turnId)
    }
    appendTurnItem(currentTurn, row.item)
  }

  flushTurn()
  return blocks
}

function buildToolGroupBlock(
  turnId: string,
  tools: TranscriptToolCallItem[],
): TranscriptToolGroupBlock | undefined {
  if (tools.length === 0) return undefined
  const first = tools[0]
  if (!first) return undefined
  return {
    kind: 'tool_group',
    id: `tool-group:${turnId}:${first.id}`,
    collapsedSummary: summarizeToolGroup(tools),
    tools,
  }
}

function summarizeToolGroup(tools: TranscriptToolCallItem[]): string {
  const counts = new Map<string, number>()
  for (const tool of tools) {
    counts.set(tool.toolName, (counts.get(tool.toolName) ?? 0) + 1)
  }
  const phrases: string[] = []
  const consume = (names: string[], phrase: (count: number) => string) => {
    let count = 0
    for (const name of names) {
      count += counts.get(name) ?? 0
      counts.delete(name)
    }
    if (count > 0) phrases.push(phrase(count))
  }

  consume(['Read'], (count) => `Read ${count} ${count === 1 ? 'file' : 'files'}`)
  consume(['Grep'], () => 'searched code')
  consume(['Glob', 'LS'], () => 'listed files')
  consume(['Bash'], (count) => `ran ${count} ${count === 1 ? 'command' : 'commands'}`)
  consume(['Edit', 'MultiEdit', 'Write'], (count) => `edited ${count} ${count === 1 ? 'file' : 'files'}`)
  consume(['ToolSearch'], (count) => `loaded ${count} ${count === 1 ? 'tool' : 'tools'}`)

  for (const [name, count] of counts) {
    phrases.push(`${name} x${count}`)
  }

  if (phrases.length === 0) return `${tools.length} ${tools.length === 1 ? 'tool' : 'tools'}`
  if (phrases.length === 1) return phrases[0] ?? ''
  return `${phrases.slice(0, -1).join(', ')} and ${phrases[phrases.length - 1]}`
}
