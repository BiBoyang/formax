import { describe, expect, it, vi } from 'vitest'
import { toolResultContentToText } from '../shared/utils/toolResultContent.js'
import {
  MCP_MAX_FILE_BACKED_BLOB_BYTES,
  mapMcpToolResult,
} from './resultMapper.js'

describe('MCP result mapper', () => {
  it('maps text and structuredContent into aggregate bounded text blocks', async () => {
    const result = await mapMcpToolResult({
      content: [
        { type: 'text', text: 'a'.repeat(60) },
        { type: 'text', text: 'b'.repeat(60) },
      ],
      structuredContent: { long: 'c'.repeat(60) },
    }, { toolUseId: 'toolu_1', maxOutputTokens: 25 })

    const text = (result.content as Array<{ type: string; text?: string }>)
      .filter((block) => block.type === 'text')
      .map((block) => block.text ?? '')
      .join('')

    expect(text.length).toBeLessThanOrEqual(25 * 4)
    expect(text).toContain('[MCP output truncated after 25 tokens / 100 chars]')
  })

  it('keeps aggregate truncation bounded even when the marker exceeds the remaining budget', async () => {
    const result = await mapMcpToolResult({
      content: [
        { type: 'text', text: 'ab' },
        { type: 'text', text: 'cdef' },
      ],
    }, { toolUseId: 'toolu_1', maxOutputTokens: 1 })

    const text = toolResultContentToText(result.content)
    expect(text.length).toBeLessThanOrEqual(4)
  })

  it('never stores raw image base64 in generic ToolResult content', async () => {
    const data = Buffer.from('png-bytes').toString('base64')
    const writer = { writeBlob: vi.fn(async () => ({ path: '/tmp/mcp/blob.png' })) }
    const result = await mapMcpToolResult({
      content: [{ type: 'image', data, mimeType: 'image/png' }],
    }, { toolUseId: 'toolu_image', blobWriter: writer })

    expect(result.content).toEqual([
      { type: 'text', text: '[MCP image written to /tmp/mcp/blob.png (image/png, 9 bytes)]' },
    ])
    expect(toolResultContentToText(result.content)).not.toContain(data)
  })

  it('uses file-backed image placeholders', async () => {
    const data = Buffer.from('png-bytes').toString('base64')
    const writer = { writeBlob: vi.fn(async () => ({ path: '/tmp/mcp/blob.png' })) }
    const result = await mapMcpToolResult({
      content: [{ type: 'image', data, mimeType: 'image/png' }],
    }, { toolUseId: 'toolu_image', blobWriter: writer })

    expect(writer.writeBlob).toHaveBeenCalledWith({
      bytes: Buffer.from('png-bytes'),
      mimeType: 'image/png',
      suggestedExtension: 'png',
    })
    expect(result.content).toEqual([
      { type: 'text', text: '[MCP image written to /tmp/mcp/blob.png (image/png, 9 bytes)]' },
    ])
  })

  it('falls back to file-backed output for unsupported image MIME types', async () => {
    const data = Buffer.from('<svg />').toString('base64')
    const writer = { writeBlob: vi.fn(async () => ({ path: '/tmp/mcp/blob.svg' })) }
    const result = await mapMcpToolResult({
      content: [{ type: 'image', data, mimeType: 'image/svg+xml' }],
    }, { toolUseId: 'toolu_image', blobWriter: writer })

    expect(writer.writeBlob).toHaveBeenCalledWith({
      bytes: Buffer.from('<svg />'),
      mimeType: 'image/svg+xml',
      suggestedExtension: 'bin',
    })
    expect(result.content).toEqual([
      { type: 'text', text: '[MCP image written to /tmp/mcp/blob.svg (image/svg+xml, 7 bytes)]' },
    ])
  })

  it('omits blobs above the file-backed hard limit', async () => {
    const tooLarge = Buffer.alloc(MCP_MAX_FILE_BACKED_BLOB_BYTES + 1).toString('base64')
    const writer = { writeBlob: vi.fn(async () => ({ path: '/tmp/never' })) }
    const result = await mapMcpToolResult({
      content: [{ type: 'audio', data: tooLarge, mimeType: 'audio/mpeg' }],
    }, { toolUseId: 'toolu_audio', blobWriter: writer })

    expect(writer.writeBlob).not.toHaveBeenCalled()
    expect(result.content).toEqual([
      { type: 'text', text: '[MCP audio omitted: audio/mpeg blob exceeds 10 MiB file-backed limit]' },
    ])
  })

  it('maps resource links without injecting resource bodies', async () => {
    const result = await mapMcpToolResult({
      content: [{ type: 'resource', resource: { uri: 'file:///tmp/a.txt', mimeType: 'text/plain', text: 'secret body' } }],
      isError: true,
    }, { toolUseId: 'toolu_resource' })

    expect(result).toEqual({
      tool_use_id: 'toolu_resource',
      content: [{ type: 'text', text: '[MCP resource available: file:///tmp/a.txt (text/plain); body omitted]' }],
      is_error: true,
    })
    expect(toolResultContentToText(result.content)).not.toContain('secret body')
  })

  it('does not crash on malformed content blocks or leak malformed blob payloads', async () => {
    const data = Buffer.from('raw-bytes').toString('base64')
    const result = await mapMcpToolResult({
      content: [
        null,
        42,
        { type: 'image', data },
        { type: 'unknown', data: 'abcdefgh', payload: { parts: [{ blob: data, contentBase64: data, bytes: data, thumbnail: 'iVBORw0KGgo=' }] }, other: true },
      ],
      structuredContent: {
        data: { ordinary: true },
        id: 'deadbeef',
        nextCursor: 'YWJjZA==',
        nested: { data: 'aGk=', payload: Buffer.from('z'.repeat(128)).toString('base64'), parts: [{ blob: data, contentBase64: data, bytes: data, thumbnail: 'aGk=' }] },
        suspicious: Buffer.from('x'.repeat(256)).toString('base64'),
      },
    }, { toolUseId: 'toolu_malformed' })

    const text = toolResultContentToText(result.content)
    expect(text).toContain('null')
    expect(text).toContain('42')
    expect(text).toContain('[MCP image omitted: malformed content]')
    expect(text).not.toContain(data)
    expect(text).toContain('"data":"abcdefgh"')
    expect(text).toContain('"data":{"ordinary":true}')
    expect(text).toContain('"id":"deadbeef"')
    expect(text).toContain('"nextCursor":"YWJjZA=="')
    expect(text).toContain('"payload":"[omitted]"')
    expect(text).toContain('"blob":"[omitted]"')
    expect(text).toContain('"contentBase64":"[omitted]"')
    expect(text).toContain('"bytes":"[omitted]"')
    expect(text).toContain('"thumbnail":"[omitted]"')
    expect(text).toContain('MCP structuredContent')
  })

  it('bounds JSON serialization before emitting structured payloads', async () => {
    const result = await mapMcpToolResult({
      content: [{ type: 'unknown', payload: Array.from({ length: 1_000 }, (_, idx) => ({ idx, value: 'x'.repeat(100) })) }],
      structuredContent: { huge: Array.from({ length: 1_000 }, (_, idx) => ({ idx, value: 'y'.repeat(100) })) },
    }, { toolUseId: 'toolu_huge', maxOutputTokens: 20 })

    const text = toolResultContentToText(result.content)
    expect(text.length).toBeLessThanOrEqual(80)
    expect(text).toContain('[MCP')
  })
})
