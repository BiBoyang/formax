import type { ToolResult, ToolResultContentBlock } from '../shared/toolContracts.js'
import type {
  McpBlobWriter,
  McpToolCallResult,
} from './types.js'

export const DEFAULT_MCP_MAX_OUTPUT_TOKENS = 25_000
export const MCP_OUTPUT_CHARS_PER_TOKEN = 4
export const MCP_MAX_FILE_BACKED_BLOB_BYTES = 10 * 1024 * 1024

export type MapMcpResultOptions = {
  toolUseId: string
  maxOutputTokens?: number
  blobWriter?: McpBlobWriter
}

function truncationMarker(maxTokens: number, charLimit: number): string {
  return `\n[MCP output truncated after ${maxTokens} tokens / ${charLimit} chars]`
}

function applyAggregateTextBudget(
  blocks: ToolResultContentBlock[],
  maxTokens: number,
): ToolResultContentBlock[] {
  const charLimit = Math.max(1, maxTokens * MCP_OUTPUT_CHARS_PER_TOKEN)
  const marker = truncationMarker(maxTokens, charLimit)
  const out: ToolResultContentBlock[] = []
  let used = 0
  let truncated = false

  const appendMarkerToPreviousText = (): void => {
    let lastTextIndex = -1
    for (let idx = out.length - 1; idx >= 0; idx -= 1) {
      const block = out[idx]
      if (block?.type === 'text' && typeof block.text === 'string') {
        lastTextIndex = idx
        break
      }
    }
    if (lastTextIndex < 0) {
      out.push(textBlock(marker.slice(0, charLimit)))
      return
    }
    const last = out[lastTextIndex] as { type: 'text'; text: string }
    const usedBeforeLast = used - last.text.length
    const markerBudget = Math.max(0, charLimit - usedBeforeLast)
    const cappedMarker = marker.slice(0, markerBudget)
    const lastBudget = Math.max(0, charLimit - usedBeforeLast - cappedMarker.length)
    out[lastTextIndex] = textBlock(`${last.text.slice(0, lastBudget)}${cappedMarker}`)
  }

  for (const block of blocks) {
    if (block.type !== 'text' || typeof block.text !== 'string') {
      out.push(block)
      continue
    }
    if (truncated) continue

    if (used + block.text.length <= charLimit) {
      out.push(block)
      used += block.text.length
      continue
    }

    truncated = true
    const remaining = charLimit - used
    if (remaining >= marker.length) {
      out.push(textBlock(`${block.text.slice(0, remaining - marker.length)}${marker}`))
      used = charLimit
      continue
    }

    appendMarkerToPreviousText()
    used = charLimit
  }

  return out
}

function estimatedBase64DecodedByteLength(data: string): number {
  let length = 0
  let last = ''
  let secondLast = ''
  for (const char of data) {
    if (/\s/.test(char)) continue
    secondLast = last
    last = char
    length += 1
  }
  if (length === 0) return 0
  let padding = 0
  if (last === '=') padding += 1
  if (secondLast === '=') padding += 1
  return Math.max(0, Math.floor((length * 3) / 4) - padding)
}

function extensionForMime(mimeType: string): string {
  if (mimeType === 'image/png') return 'png'
  if (mimeType === 'image/jpeg') return 'jpg'
  if (mimeType === 'image/webp') return 'webp'
  if (mimeType === 'audio/mpeg') return 'mp3'
  if (mimeType === 'application/json') return 'json'
  if (mimeType.startsWith('text/')) return 'txt'
  return 'bin'
}

async function blobPlaceholder(
  label: string,
  data: string,
  mimeType: string,
  writer: McpBlobWriter | undefined,
): Promise<string> {
  const byteLength = estimatedBase64DecodedByteLength(data)
  if (byteLength > MCP_MAX_FILE_BACKED_BLOB_BYTES) {
    return `[MCP ${label} omitted: ${mimeType} blob exceeds 10 MiB file-backed limit]`
  }
  if (!writer) return `[MCP ${label} omitted: file-backed blob writer unavailable for ${mimeType}]`
  const bytes = Buffer.from(data, 'base64')
  const written = await writer.writeBlob({
    bytes,
    mimeType,
    suggestedExtension: extensionForMime(mimeType),
  })
  return `[MCP ${label} written to ${written.path} (${mimeType}, ${bytes.byteLength} bytes)]`
}

function textBlock(text: string): ToolResultContentBlock {
  return { type: 'text', text }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isMcpImageContent(value: Record<string, unknown>): value is { type: 'image'; data: string; mimeType: string } {
  return value.type === 'image'
    && typeof value.data === 'string'
    && typeof value.mimeType === 'string'
}

async function mapContentBlock(
  content: unknown,
  options: MapMcpResultOptions,
  maxOutputTokens: number,
): Promise<ToolResultContentBlock> {
  if (!isRecord(content)) return textBlock(boundedRedactedJsonStringify(content, maxOutputTokens))

  if (content.type === 'text' && typeof content.text === 'string') return textBlock(content.text)

  if (isMcpImageContent(content)) {
    return textBlock(await blobPlaceholder('image', content.data, content.mimeType, options.blobWriter))
  }

  if (content.type === 'audio' && typeof content.data === 'string' && typeof content.mimeType === 'string') {
    return textBlock(await blobPlaceholder('audio', content.data, content.mimeType, options.blobWriter))
  }

  if (content.type === 'resource' && isRecord(content.resource) && typeof content.resource.uri === 'string') {
    if (typeof content.resource.blob === 'string') {
      const mimeType = typeof content.resource.mimeType === 'string'
        ? content.resource.mimeType
        : 'application/octet-stream'
      return textBlock(await blobPlaceholder('resource', content.resource.blob, mimeType, options.blobWriter))
    }
    return textBlock(`[MCP resource available: ${content.resource.uri}${content.resource.mimeType ? ` (${content.resource.mimeType})` : ''}]`)
  }

  if (content.type === 'image' || content.type === 'audio' || content.type === 'resource') {
    return textBlock(`[MCP ${String(content.type)} omitted: malformed content]`)
  }

  return textBlock(boundedRedactedJsonStringify(content, maxOutputTokens))
}

function boundedRedactedJsonStringify(value: unknown, maxTokens: number): string {
  const charLimit = Math.max(1, maxTokens * MCP_OUTPUT_CHARS_PER_TOKEN)
  const marker = '[MCP JSON truncated]'
  const seen = new WeakSet<object>()
  let out = ''
  let truncated = false

  const write = (text: string): void => {
    if (truncated) return
    const remaining = charLimit - out.length
    if (text.length <= remaining) {
      out += text
      return
    }
    out += text.slice(0, Math.max(0, remaining))
    truncated = true
  }

  const visit = (next: unknown, key = ''): void => {
    if (truncated) return
    if (shouldRedactMcpValue(key, next)) {
      write(JSON.stringify('[omitted]'))
      return
    }
    if (!next || typeof next !== 'object') {
      write(JSON.stringify(next) ?? 'null')
      return
    }
    if (seen.has(next)) {
      write(JSON.stringify('[Circular]'))
      return
    }
    seen.add(next)

    if (Array.isArray(next)) {
      write('[')
      for (let idx = 0; idx < next.length; idx += 1) {
        if (idx > 0) write(',')
        visit(next[idx], key)
        if (truncated) break
      }
      write(']')
      return
    }

    write('{')
    const entries = Object.entries(next as Record<string, unknown>).sort(([a], [b]) => (
      a === b ? 0 : a < b ? -1 : 1
    ))
    for (let idx = 0; idx < entries.length; idx += 1) {
      const [childKey, childValue] = entries[idx]!
      if (idx > 0) write(',')
      write(JSON.stringify(childKey))
      write(':')
      visit(childValue, childKey)
      if (truncated) break
    }
    write('}')
  }

  visit(value)
  if (truncated) {
    if (marker.length >= charLimit) return marker.slice(0, charLimit)
    return `${out.slice(0, Math.max(0, charLimit - marker.length))}${marker}`
  }
  return out
}

function shouldRedactMcpValue(key: string, value: unknown): boolean {
  if (typeof value !== 'string') return false
  const lowerKey = key.toLowerCase()
  if (
    lowerKey.includes('blob')
    || lowerKey.includes('base64')
    || lowerKey.includes('bytes')
    || lowerKey.includes('binary')
  ) {
    return true
  }
  if ((lowerKey === 'data' || lowerKey === 'payload') && value.length >= 64 && isBase64Alphabet(value)) {
    return true
  }
  if (value.length >= 1024 && isBase64Alphabet(value)) {
    return true
  }
  return hasKnownBinaryMagic(value)
}

function hasKnownBinaryMagic(value: string): boolean {
  const trimmed = value.trim()
  if (trimmed.length < 4 || trimmed.length % 4 !== 0) return false
  if (!isBase64Alphabet(trimmed)) return false
  return /^(iVBOR|\/9j\/|R0lGOD|UklGR|JVBER|UEsDB|H4sI)/.test(trimmed)
}

function isBase64Alphabet(value: string): boolean {
  const trimmed = value.trim()
  return trimmed.length >= 4
    && trimmed.length % 4 === 0
    && /^[A-Za-z0-9+/]+={0,2}$/.test(trimmed)
}

export async function mapMcpToolResult(
  result: McpToolCallResult,
  options: MapMcpResultOptions,
): Promise<ToolResult> {
  const maxOutputTokens = options.maxOutputTokens ?? DEFAULT_MCP_MAX_OUTPUT_TOKENS
  const blocks: ToolResultContentBlock[] = []
  for (const block of result.content ?? []) {
    blocks.push(await mapContentBlock(block, options, maxOutputTokens))
  }

  if (result.structuredContent !== undefined) {
    blocks.push(textBlock(`MCP structuredContent\n${boundedRedactedJsonStringify(result.structuredContent, maxOutputTokens)}`))
  }

  const content = applyAggregateTextBudget(blocks, maxOutputTokens)

  return {
    tool_use_id: options.toolUseId,
    content,
    ...(result.isError === true ? { is_error: true } : {}),
  }
}
