import React from 'react'
import { Text } from 'ink'
import { render } from 'ink-testing-library'
import { describe, expect, it } from 'vitest'
import type { ChatHistory } from '../../../../chat/engine'
import { useTurnStreamingRefs } from './refGroups'

type TurnStreamingRefsApi = ReturnType<typeof useTurnStreamingRefs>

function Harness(props: {
  initialHistory: ChatHistory
  apiRef: { current: TurnStreamingRefsApi | null }
}) {
  props.apiRef.current = useTurnStreamingRefs(props.initialHistory)
  return <Text>ready</Text>
}

describe('refGroups', () => {
  it('initializes grouped turn streaming refs with supplied history', () => {
    const initialHistory: ChatHistory = [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }] as any
    const apiRef = { current: null as TurnStreamingRefsApi | null }

    const app = render(<Harness initialHistory={initialHistory} apiRef={apiRef} />)

    expect(apiRef.current).not.toBeNull()
    expect(apiRef.current?.historyRef.current).toEqual(initialHistory)
    expect(apiRef.current?.abortControllerRef.current).toBeNull()
    expect(apiRef.current?.currentAssistantIdRef.current).toBeNull()
    expect(apiRef.current?.assistantBufferRef.current).toBe('')
    expect(apiRef.current?.thinkingRefs.bufferRef.current).toBe('')
    expect(apiRef.current?.thinkingRefs.messageIdRef.current).toBeNull()
    expect(apiRef.current?.thinkingRefs.lastFlushAtRef.current).toBe(0)
    expect(apiRef.current?.thinkingRefs.timingRef.current).toEqual({ startedAtMs: null })

    app.unmount()
  })
})
