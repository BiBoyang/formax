import { describe, expect, it } from 'vitest'
import { applyToolEventPatch, findToolEventTargetIndex, mapHistoryToolToTranscript } from './toolEventNormalizer'
import type { TranscriptItem } from './types'

describe('toolEventNormalizer', () => {
  it('maps history tool messages to transcript tool_call shape', () => {
    const out = mapHistoryToolToTranscript({
      id: 'history-1',
      tool: {
        id: 'tool-1',
        kind: 'tool',
        toolName: 'Bash',
        status: 'completed',
        summary: 'Ran command',
        detailLines: ['$ ls'],
      },
    })
    expect(out).toMatchObject({
      id: 'history-1',
      kind: 'tool_call',
      toolName: 'Bash',
      status: 'completed',
      summary: 'Ran command',
      detailLines: ['$ ls'],
    })
  })

  it('coalesces start/update/end patches for the same tool', () => {
    const started = applyToolEventPatch({
      id: 'tool-row-1',
      patch: {
        turnId: 'turn-1',
        toolUseId: 'tool-1',
        toolName: 'Bash',
        phase: 'start',
        input: { command: 'npm run type-check' },
      },
    })
    const updated = applyToolEventPatch({
      id: started.id,
      current: started,
      patch: {
        turnId: 'turn-1',
        toolUseId: 'tool-1',
        phase: 'update',
        text: 'step 1',
      },
    })
    const ended = applyToolEventPatch({
      id: started.id,
      current: updated,
      patch: {
        turnId: 'turn-1',
        toolUseId: 'tool-1',
        phase: 'end',
        text: 'done',
      },
    })

    expect(ended.status).toBe('completed')
    expect(ended.summary).toBe('done')
    expect(ended.paramsText).toContain('command=')
    expect(ended.detailLines).toContain('step 1')
  })

  it('finds latest matching tool row by turnId + toolUseId', () => {
    const logs: TranscriptItem[] = [
      { id: '1', kind: 'message', role: 'assistant', text: 'hello' },
      {
        id: '2',
        kind: 'tool_call',
        turnId: 'turn-1',
        toolUseId: 'tool-1',
        toolName: 'Bash',
        status: 'running',
        summary: 'running',
        detailLines: [],
      },
      {
        id: '3',
        kind: 'tool_call',
        turnId: 'turn-1',
        toolUseId: 'tool-2',
        toolName: 'Bash',
        status: 'running',
        summary: 'running',
        detailLines: [],
      },
    ]
    expect(findToolEventTargetIndex(logs, { turnId: 'turn-1', toolUseId: 'tool-1' })).toBe(1)
    expect(findToolEventTargetIndex(logs, { turnId: 'turn-1', toolUseId: 'missing' })).toBe(-1)
  })
})
