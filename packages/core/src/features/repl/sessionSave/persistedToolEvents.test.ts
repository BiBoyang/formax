import { describe, expect, it } from 'vitest'
import { createPersistedToolEventAggregator } from './persistedToolEvents'

describe('createPersistedToolEventAggregator', () => {
  it('ignores non-object payloads', () => {
    const agg = createPersistedToolEventAggregator()
    agg.ingest({ ts: '2026-02-28T00:00:00.000Z', data: null })
    agg.ingest({ ts: '2026-02-28T00:00:00.000Z', data: 'x' as any })
    expect(agg.finalize()).toEqual([])
  })

  it('aggregates explicit toolUseId events and normalizes fields', () => {
    const agg = createPersistedToolEventAggregator()
    agg.ingest({
      ts: 'invalid-ts',
      data: {
        toolUseId: 'tool-1',
        turnId: 'turn-1',
        toolName: ' Bash ',
        phase: 'start',
        status: 'running',
        summary: '  ',
        input: { command: 'pwd' },
        patchStartLineNumber: 0,
        paramsText: ' command="pwd" ',
        line: '  line 1  ',
        lines: ['line 1', 'line 2', ' ', 42],
      },
    })
    agg.ingest({
      ts: '2026-02-28T12:00:00.000Z',
      data: {
        toolUseId: 'tool-1',
        turnId: 'turn-1',
        toolName: 'Bash',
        phase: 'update',
        status: 'completed',
        summary: '/repo',
        input: ['not-object'],
        patchStartLineNumber: 12.8,
        paramsText: '',
        line: 'line 2',
        lines: ['line 3'],
      },
    })

    const out = agg.finalize()
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({
      id: 'tool-tool-1',
      toolUseId: 'tool-1',
      toolName: 'Bash',
      status: 'completed',
      summary: '/repo',
      input: { command: 'pwd' },
      paramsText: 'command="pwd"',
      patchStartLineNumber: 12,
    })
    expect(out[0]?.detailLines).toEqual(['line 1', 'line 2', 'line 3'])
    expect(out[0]?.occurredAtMs).toBe(Date.parse('2026-02-28T12:00:00.000Z'))
  })

  it('parses non-string timestamps as zero and keeps creation-time patch line', () => {
    const agg = createPersistedToolEventAggregator()
    agg.ingest({
      ts: 12345 as any,
      data: {
        toolUseId: 'tool-with-patch',
        toolName: 'Edit',
        phase: 'start',
        patchStartLineNumber: 5.9,
      },
    })
    const out = agg.finalize()
    expect(out).toHaveLength(1)
    expect(out[0]?.occurredAtMs).toBe(0)
    expect(out[0]?.patchStartLineNumber).toBe(5)
  })

  it('groups anonymous events by turn/tool bucket and rotates on terminal events', () => {
    const agg = createPersistedToolEventAggregator()
    agg.ingest({
      ts: '2026-02-28T00:00:01.000Z',
      data: { turnId: 'turn-1', toolName: 'Read', phase: 'update', line: 'a' },
    })
    agg.ingest({
      ts: '2026-02-28T00:00:02.000Z',
      data: { turnId: 'turn-1', toolName: 'Read', phase: 'update', line: 'b' },
    })
    agg.ingest({
      ts: '2026-02-28T00:00:03.000Z',
      data: { turnId: 'turn-1', toolName: 'Read', phase: 'end', status: 'error', line: 'c' },
    })
    agg.ingest({
      ts: '2026-02-28T00:00:04.000Z',
      data: { turnId: 'turn-1', toolName: 'Read', phase: 'update', line: 'd' },
    })

    const out = agg.finalize().filter((m) => m.toolName === 'Read')
    expect(out).toHaveLength(2)
    expect(out[0]?.status).toBe('error')
    expect(out[0]?.detailLines).toEqual(['a', 'b', 'c'])
    expect(out[1]?.status).toBe('running')
    expect(out[1]?.detailLines).toEqual(['d'])
  })

  it('applies default tool metadata and summary fallbacks in finalize', () => {
    const agg = createPersistedToolEventAggregator()
    agg.ingest({
      ts: '2026-02-28T00:00:10.000Z',
      data: {
        turnId: 'turn-2',
        phase: 'start',
        toolName: '   ',
        summary: '   ',
        status: 'not-valid',
      },
    })
    agg.ingest({
      ts: '2026-02-28T00:00:11.000Z',
      data: {
        turnId: 'turn-3',
        toolName: 'Edit',
        phase: 'update',
        summary: '',
        line: 'first detail',
      },
    })

    const out = agg.finalize()
    const toolDefault = out.find((m) => m.toolName === 'Tool')
    const edit = out.find((m) => m.toolName === 'Edit')
    expect(toolDefault).toBeTruthy()
    expect(toolDefault?.summary).toBe('Tool running')
    expect(toolDefault?.status).toBe('running')
    expect(edit?.summary).toBe('Edit running')
    expect(edit?.detailLines[0]).toBe('first detail')
  })

  it('sorts by occurredAtMs then by sequence', () => {
    const agg = createPersistedToolEventAggregator()
    agg.ingest({
      ts: '2026-02-28T00:00:02.000Z',
      data: { toolUseId: 'b', toolName: 'B', phase: 'start' },
    })
    agg.ingest({
      ts: '2026-02-28T00:00:01.000Z',
      data: { toolUseId: 'a', toolName: 'A', phase: 'start' },
    })
    agg.ingest({
      ts: '2026-02-28T00:00:01.000Z',
      data: { toolUseId: 'c', toolName: 'C', phase: 'start' },
    })

    const out = agg.finalize()
    expect(out.map((m) => m.toolUseId)).toEqual(['a', 'c', 'b'])
  })
})
