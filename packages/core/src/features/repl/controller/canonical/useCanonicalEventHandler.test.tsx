import React from 'react'
import { Text } from 'ink'
import { render } from 'ink-testing-library'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Msg } from '../../../../shared/toolMessageTypes'
import { useCanonicalEventHandler } from './useCanonicalEventHandler'

const { projectCanonicalEventMock, applyCanonicalProjectionToUiMock } = vi.hoisted(() => ({
  projectCanonicalEventMock: vi.fn(),
  applyCanonicalProjectionToUiMock: vi.fn(),
}))

vi.mock('./canonicalProjectionPipeline', () => ({
  projectCanonicalEvent: projectCanonicalEventMock,
  applyCanonicalProjectionToUi: applyCanonicalProjectionToUiMock,
}))

type HandlerApi = ReturnType<typeof useCanonicalEventHandler>

function Harness(props: {
  apiRef: { current: HandlerApi | null }
  args: Parameters<typeof useCanonicalEventHandler>[0]
}) {
  props.apiRef.current = useCanonicalEventHandler(props.args)
  return <Text>ready</Text>
}

describe('useCanonicalEventHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('persists events, projects canonical state, and applies UI projection', () => {
    const apiRef = { current: null as HandlerApi | null }
    const order: string[] = []
    const projectionRef = { current: { turns: [] } as any }
    const pendingStaticSurfaceResetRef = { current: false }
    const transientSnapshotRef = { current: null as { turnId: string; includeAssistantStreaming: boolean; messages: Msg[] } | null }

    const nextProjection = { turns: [{ id: 't1' }] } as any
    const projected = { staticRows: [{ id: 's1' }], transientRows: [] } as any
    const event = { kind: 'assistant_text_delta', turnId: 'turn-1', text: 'hello' } as any

    const persistEvent = vi.fn(() => {
      order.push('persist')
    })

    projectCanonicalEventMock.mockImplementation((args: any) => {
      order.push('project')
      expect(args.assistantTextMode).toBe('stream')
      expect(args.event).toBe(event)
      expect(args.projection).toBe(projectionRef.current)
      expect(args.activeTurnId).toBe('turn-1')
      expect(args.previousTransient).toBeNull()

      return {
        projected: {
          ...projected,
          projection: nextProjection,
        },
        projectedStaticRows: [{ id: 'row-1' }],
        projectedTransientRows: [{ id: 'row-2' }],
        includeAssistantStreaming: true,
      }
    })

    applyCanonicalProjectionToUiMock.mockImplementation((args: any) => {
      order.push('apply')
      expect(args.event).toBe(event)
      expect(args.projected).toEqual({
        ...projected,
        projection: nextProjection,
      })
      expect(args.projectedStaticRows).toEqual([{ id: 'row-1' }])
      expect(args.projectedTransientRows).toEqual([{ id: 'row-2' }])
      expect(args.includeAssistantStreaming).toBe(true)
      expect(args.pendingStaticSurfaceResetRef).toBe(pendingStaticSurfaceResetRef)
      expect(args.transientSnapshotRef).toBe(transientSnapshotRef)
    })

    const app = render(
      <Harness
        apiRef={apiRef}
        args={{
          assistantTextMode: 'stream',
          projectionRef,
          turnIdRef: { current: 'turn-1' },
          transientSnapshotRef,
          pendingStaticSurfaceResetRef,
          setMessages: vi.fn() as any,
          setCanonicalTransientActive: vi.fn() as any,
          setCanonicalTurnMessages: vi.fn() as any,
          persistEvent,
        }}
      />,
    )

    apiRef.current?.onCanonicalEvent(event)

    expect(persistEvent).toHaveBeenCalledWith(event)
    expect(projectionRef.current).toBe(nextProjection)
    expect(order).toEqual(['persist', 'project', 'apply'])

    app.unmount()
  })
})
