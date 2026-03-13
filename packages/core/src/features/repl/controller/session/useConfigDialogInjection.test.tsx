import React from 'react'
import { Text } from 'ink'
import { render } from 'ink-testing-library'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useConfigDialogInjection } from './useConfigDialogInjection'

const { applyConfigExitInjectionMock } = vi.hoisted(() => ({
  applyConfigExitInjectionMock: vi.fn(),
}))

vi.mock('./localCommandInjection', () => ({
  applyConfigExitInjection: applyConfigExitInjectionMock,
}))

type ConfigInjectionApi = ReturnType<typeof useConfigDialogInjection>

function Harness(props: {
  apiRef: { current: ConfigInjectionApi | null }
  args: Parameters<typeof useConfigDialogInjection>[0]
}) {
  props.apiRef.current = useConfigDialogInjection(props.args)
  return <Text>ready</Text>
}

describe('useConfigDialogInjection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('closes dialog first, then applies config-exit injection with current refs', () => {
    const apiRef = { current: null as ConfigInjectionApi | null }
    const writer = { appendEvent: vi.fn(async () => undefined) } as any
    const writerRef = { current: writer }
    const pendingInjectedBlocksRef = { current: [] as any[] }
    const order: string[] = []

    const closeConfigDialog = vi.fn(() => {
      order.push('close')
    })
    applyConfigExitInjectionMock.mockImplementation(() => {
      order.push('inject')
    })

    const app = render(
      <Harness
        apiRef={apiRef}
        args={{
          closeConfigDialog,
          sessionSaveEnabled: true,
          writerRef,
          pendingInjectedBlocksRef,
        }}
      />,
    )

    const exit = { kind: 'changed', message: 'Set output style to concise' } as const
    apiRef.current?.closeConfigDialogWithInjection(exit)

    expect(order).toEqual(['close', 'inject'])
    expect(closeConfigDialog).toHaveBeenCalledWith(exit)
    expect(applyConfigExitInjectionMock).toHaveBeenCalledWith({
      exit,
      sessionSaveEnabled: true,
      writer,
      pendingInjectedBlocksRef,
    })

    app.unmount()
  })
})
