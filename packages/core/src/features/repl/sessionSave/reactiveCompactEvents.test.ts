import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  readLatestReactiveCompactEventFromSession,
  readLatestReactiveCompactEventFromSessionSync,
} from './reactiveCompactEvents'

describe('reactiveCompactEvents', () => {
  it('reads the latest persisted reactive compact event from session files', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'formax-reactive-compact-'))
    const filePath = path.join(dir, 'session.jsonl')
    await fs.writeFile(
      filePath,
      [
        JSON.stringify({ type: 'event', ts: '2026-05-11T00:00:00.000Z', name: 'reactive_compact_applied', data: {
          triggerKind: 'http_413',
          triggerDetail: 'HTTP 413: request too large',
          strategy: 'model_summary',
        } }),
        JSON.stringify({ type: 'event', ts: '2026-05-11T00:01:00.000Z', name: 'reactive_compact_applied', data: {
          triggerKind: 'maximum_context_length',
          triggerDetail: 'maximum context length exceeded',
          strategy: 'session_memory',
        } }),
      ].join('\n'),
      'utf8',
    )

    await expect(readLatestReactiveCompactEventFromSession({ filePath })).resolves.toEqual({
      occurredAtMs: Date.parse('2026-05-11T00:01:00.000Z'),
      triggerKind: 'maximum_context_length',
      triggerDetail: 'maximum context length exceeded',
      strategy: 'session_memory',
    })

    expect(readLatestReactiveCompactEventFromSessionSync({ filePath })).toEqual({
      occurredAtMs: Date.parse('2026-05-11T00:01:00.000Z'),
      triggerKind: 'maximum_context_length',
      triggerDetail: 'maximum context length exceeded',
      strategy: 'session_memory',
    })
  })
})
